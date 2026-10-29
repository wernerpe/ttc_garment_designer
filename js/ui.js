// Everything around the canvases: the artwork tray (click or drag tiles onto the pattern or the 3D
// shirt), the floating toolbar on the selected print, the print list, the properties panel, and
// the undo toast after a delete.

import { FONTS, textArt } from './art/text.js';
import { MOTIFS, motifArt } from './art/motifs.js';
import { FINISHES, VINYL, designSize } from './art/render.js';
import { SIZE_CHART, IN } from './garments/singlet.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cm = (n) => `${(+n).toFixed(1)} cm`;
const inch = (n) => `${(n / IN).toFixed(2)}″`;
const $ = (s) => document.querySelector(s);

const ICONS = {
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A10.6 10.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.5 7.6C3.8 9.3 2 12 2 12s3.6 6 10 6c1.6 0 3-.4 4.2-.9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  mirror: '<path d="M12 3v18M9 7L4 17h5zM15 7l5 10h-5z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  link: '<path d="M9.5 14.5l5-5"/><path d="M11 6.5l1.4-1.4a4 4 0 0 1 5.6 5.6L16.5 12.2M13 17.5l-1.4 1.4a4 4 0 0 1-5.6-5.6L7.5 11.8"/>',
  unlink: '<path d="M11 6.5l1.4-1.4a4 4 0 0 1 5.6 5.6L16.5 12.2M13 17.5l-1.4 1.4a4 4 0 0 1-5.6-5.6L7.5 11.8M4 4l2.5 2.5M20 20l-2.5-2.5"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// What each tray tile adds (built when the tray is, after the design packs have registered their
// motifs). Widths are a sensible starting size in cm.
function trayTiles() {
  return [
    { key: 'text', label: 'Text', make: () => ({ kind: 'text', name: '', text: 'TEXT', font: 'graduate', spacing: 60, arc: 0, w: 12 }) },
    ...Object.entries(MOTIFS).map(([key, m]) => ({
      key,
      label: m.name,
      make: () => ({ kind: 'motif', name: m.name, motif: key, w: m.width || 14 }),
    })),
  ];
}

export class Inspector {
  constructor(root, store, { editor, viewer, garment }) {
    this.root = root;
    this.store = store;
    this.editor = editor;
    this.viewer = viewer;
    this.garment = garment;
    this.warnings = new Map();
    root.addEventListener('input', (e) => this.onInput(e, false));
    root.addEventListener('change', (e) => this.onInput(e, true));
    root.addEventListener('click', (e) => this.onClick(e));
    this.setupSelectionTools(); // the tray is built once fonts have loaded (main.js)
  }

  // ---------- adding ----------

  // A free spot for new artwork on the side of the shirt you're looking at: under the chest line,
  // stepping down past prints that are already there.
  placement() {
    const panel = this.viewer.facing();
    let y = 30;
    while (y < 62 && this.store.state.designs.some((d) => d.panel === panel && Math.abs(d.x) < 6 && Math.abs(d.y - y) < 4)) y += 5;
    return { panel, x: 0, y };
  }

  addDesign(design, place = this.placement()) {
    const d = this.store.add({ color: '#f4f4f1', color2: '#4f9a5b', finish: 'matte', ...design, ...place });
    if (this.viewer.facing() !== d.panel) this.viewer.view(d.panel);
    this.render();
    if (d.kind === 'text') this.root.querySelector('[data-prop="text"]')?.select();
    return d;
  }

  // One band down each side seam, from just under the armpit to just above the hem, each with
  // its own random layout.
  addArmpitBands(motif) {
    const g = this.garment();
    const { m } = g;
    const margin = this.store.state.safeMargin;
    const top = m.armholeDepth + margin + 0.5;
    const bottom = m.length - m.hemRise - margin - 0.3;
    for (const side of [1, -1]) {
      const seed = 1 + Math.floor(Math.random() * 1e6);
      const [, , vw, vh] = motifArt(motif, seed).viewBox;
      this.store.add({
        kind: 'motif', motif, seed,
        name: `${MOTIFS[motif].name} (${side > 0 ? 'left' : 'right'})`,
        panel: 'front', x: +(side * g.layout.hc).toFixed(1), y: +((top + bottom) / 2).toFixed(1),
        w: +(((bottom - top) * vw) / vh).toFixed(1),
        color: '#f4f4f1', color2: '#d79a2b', finish: 'dtf',
      });
    }
    this.viewer.view('left');
    this.render();
  }

  async addFiles(files, place) {
    for (const file of files) {
      const src = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
      } catch {
        setStatus(`Couldn't read ${file.name}. Use SVG, PNG, JPEG or WebP.`);
        continue;
      }
      const isSvg = file.type.includes('svg');
      this.addDesign(
        { kind: 'image', name: file.name.replace(/\.[^.]+$/, ''), src, natW: img.naturalWidth || 300, natH: img.naturalHeight || 300, w: 15, recolor: false, finish: isSvg ? 'matte' : 'dtf' },
        place || this.placement(),
      );
    }
  }

  setupTray() {
    const tray = $('#tray');
    tray.innerHTML = '';
    const tiles = trayTiles();
    for (const t of tiles) {
      const b = document.createElement('button');
      b.className = 'tile';
      b.type = 'button';
      b.dataset.tile = t.key;
      b.title = `Add ${t.label.toLowerCase()}. Click, or drag onto the pattern or the shirt.`;
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 80;
      drawThumb(c, t.key === 'text' ? textArt({ text: 'Aa', font: 'graduate', spacing: 20 }) : motifArt(t.key));
      b.append(c, Object.assign(document.createElement('span'), { textContent: t.label }));
      tray.appendChild(b);
    }
    const up = document.createElement('label');
    up.className = 'tile';
    up.htmlFor = 'upload';
    up.title = 'Upload an SVG, PNG, JPEG or WebP. You can also drop files onto the pattern.';
    up.innerHTML = `<span class="tile-icon">${icon('upload')}</span><span>Your image</span>`;
    tray.appendChild(up);
    $('#upload').addEventListener('change', (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      this.addFiles(files);
    });

    // click to add; drag a tile and drop it on the pattern or the 3D shirt to place it there
    let drag = null;
    tray.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-tile]');
      if (!b || e.button !== 0) return;
      drag = { tile: tiles.find((t) => t.key === b.dataset.tile), x: e.clientX, y: e.clientY, ghost: null, el: b };
      b.setPointerCapture(e.pointerId);
    });
    tray.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
        drag.ghost = drag.el.querySelector('canvas').cloneNode();
        drag.ghost.getContext('2d').drawImage(drag.el.querySelector('canvas'), 0, 0);
        drag.ghost.className = 'drag-ghost';
        document.body.appendChild(drag.ghost);
      }
      if (drag.ghost) drag.ghost.style.transform = `translate(${e.clientX - 48}px, ${e.clientY - 30}px)`;
    });
    const end = (e) => {
      if (!drag) return;
      const { tile, ghost } = drag;
      drag = null;
      if (!ghost || MOTIFS[tile.key]?.pair) {
        ghost?.remove();
        if (e.type !== 'pointerup') return;
        if (MOTIFS[tile.key]?.pair) this.addArmpitBands(tile.key);
        else this.addDesign(tile.make());
        return;
      }
      ghost.remove();
      if (e.type !== 'pointerup') return;
      const place = this.editor.placeAt(e.clientX, e.clientY) || this.viewer.pick(e.clientX, e.clientY);
      if (place) this.addDesign(tile.make(), { panel: place.panel, x: +place.x.toFixed(1), y: +place.y.toFixed(1) });
    };
    tray.addEventListener('pointerup', end);
    tray.addEventListener('pointercancel', end);
  }

  // ---------- removing and the selection toolbar ----------

  remove(d) {
    const name = d.name || d.text || 'print';
    this.store.remove(d.id);
    this.render();
    toast(`Removed “${name}”.`, 'Undo', () => {
      this.store.undo();
      this.render();
    });
  }

  duplicate(d) {
    const { id, ...rest } = d;
    this.store.add({ ...rest, name: d.name ? `${d.name} copy` : '', x: d.x + 2, y: d.y + 2 });
    this.render();
  }

  setupSelectionTools() {
    const bar = $('#sel-tools');
    bar.innerHTML = `
      <button type="button" data-sel="dup" title="Duplicate (Ctrl+D)">${icon('copy')}<span>Duplicate</span></button>
      <button type="button" data-sel="flip" title="Mirror left to right">${icon('mirror')}<span>Mirror</span></button>
      <button type="button" data-sel="delete" class="danger" title="Delete (Del)">${icon('trash')}<span>Delete</span></button>`;
    bar.addEventListener('click', (e) => {
      const act = e.target.closest('[data-sel]')?.dataset.sel;
      const sel = this.store.selected;
      if (!act || !sel) return;
      if (act === 'dup') this.duplicate(sel);
      else if (act === 'flip') this.store.update(sel.id, { flip: !sel.flip });
      else if (act === 'delete') this.remove(sel);
    });
  }

  positionToolbar(rect) {
    const bar = $('#sel-tools');
    if (!rect) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = rect.top - bh - 10;
    if (top < 6) top = rect.bottom + 34; // below the size label instead
    top = Math.min(top, rect.height - bh - 6);
    const left = Math.max(6, Math.min(rect.width - bw - 6, (rect.left + rect.right) / 2 - bw / 2));
    bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  // ---------- inspector panel ----------

  setWarnings(w) {
    const key = JSON.stringify([...w.entries()]);
    if (key === this.warnKey) return;
    this.warnKey = key;
    this.warnings = w;
    this.renderLayers();
    this.renderWarnings();
  }

  render() {
    const focusId = document.activeElement?.closest?.('#inspector') ? document.activeElement.dataset.prop : null;
    const sel = this.store.selected;
    this.renderedId = sel?.id ?? null;
    this.root.innerHTML = `
      <section><h2>Prints on this shirt</h2><ul class="layers" id="layers" aria-label="Prints"></ul></section>
      <section id="props">${sel ? this.propsHTML(sel) : `<p class="hint">Pick a print on the pattern or the 3D shirt to edit it.</p><p class="hint">To add one, click a tile under the pattern or drag it onto the shirt. Image files can be dropped straight onto the pattern.</p>`}</section>
      <section>${this.specHTML()}</section>`;
    this.renderLayers();
    this.renderWarnings();
    if (focusId) {
      const el = this.root.querySelector(`[data-prop="${focusId}"]`);
      if (el) {
        el.focus();
        if (el.setSelectionRange && el.type !== 'range' && el.type !== 'number') el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }

  // Refresh only the numbers while dragging, so inputs keep focus and the list doesn't flicker.
  sync() {
    const sel = this.store.selected;
    if (!sel || sel.id !== this.renderedId) return this.render();
    for (const el of this.root.querySelectorAll('[data-prop]')) {
      if (el === document.activeElement) continue;
      const k = el.dataset.prop;
      if (k === 'h') el.value = designSize(sel).h.toFixed(1);
      else if (k in sel && el.type !== 'checkbox' && el.tagName !== 'BUTTON') el.value = sel[k];
    }
    const hint = this.root.querySelector('[data-size-hint]');
    if (hint) hint.textContent = sizeHint(sel);
    if (!!this.root.querySelector('[data-act="unstretch"]') !== (sel.h != null)) this.render();
    this.renderLayers();
  }

  renderLayers() {
    const ul = this.root.querySelector('#layers');
    if (!ul) return;
    const list = [...this.store.state.designs].reverse();
    const html = list.length
      ? list
          .map((d) => {
            const warn = this.warnings.get(d.id)?.some((w) => w.level === 'warn');
            const name = esc(d.name || d.text || 'Print');
            return `<li data-id="${d.id}" aria-current="${d.id === this.store.selectedId}" class="${d.visible ? '' : 'hidden'} ${warn ? 'warn' : ''}">
              <button class="pick" data-act="pick"><span class="chip" style="background:${d.kind === 'image' && !d.recolor ? 'conic-gradient(#e55,#ec5,#5c7,#59e,#e55)' : esc(d.color)}"></span><span class="name">${name}</span><span class="where">${d.panel}</span></button>
              <button class="icon-btn" data-act="toggle" aria-label="${d.visible ? 'Hide' : 'Show'} ${name}" title="${d.visible ? 'Hide' : 'Show'}">${icon(d.visible ? 'eye' : 'eyeOff')}</button>
              <button class="icon-btn danger" data-act="remove" aria-label="Delete ${name}" title="Delete">${icon('trash')}</button>
            </li>`;
          })
          .join('')
      : '<li class="hint">Nothing on the shirt yet. Add something from the tray under the pattern.</li>';
    // only touch the DOM when something changed, so clicks never land on a replaced row
    if (ul.dataset.html !== html) {
      ul.innerHTML = html;
      ul.dataset.html = html;
    }
  }

  renderWarnings() {
    const box = this.root.querySelector('#warn-box');
    if (!box) return;
    const list = this.warnings.get(this.store.selectedId) || [];
    box.innerHTML = list.length ? `<ul class="warnings">${list.map((w) => `<li class="${w.level}">${esc(w.text)}</li>`).join('')}</ul>` : '';
  }

  propsHTML(d) {
    const { h } = designSize(d);
    const num = (prop, label, value, step = 0.1, unit = 'cm', extra = '') =>
      `<label>${label}<span class="unit"><input type="number" step="${step}" data-prop="${prop}" value="${value}" ${extra}><small>${unit}</small></span></label>`;
    const colorRow = (prop, label) => `
      <div class="wide"><label id="lbl-${prop}">${label}</label>
        <div class="vinyl" role="radiogroup" aria-labelledby="lbl-${prop}">
          ${VINYL.map(([n, hex]) => `<button role="radio" title="${n}" aria-label="${n}" data-act="color" data-prop="${prop}" data-hex="${hex}" aria-checked="${(d[prop] || '').toLowerCase() === hex}" style="background:${hex}"></button>`).join('')}
          <input type="color" data-prop="${prop}" value="${esc(d[prop] || '#ffffff')}" aria-label="Custom ${label.toLowerCase()}">
        </div></div>`;
    const twoColor = d.kind === 'motif' && (MOTIFS[d.motif]?.colors || 1) > 1;
    return `
      <div class="props-head">
        <h2>${esc(d.name || d.text || 'Print')}</h2>
        <button class="icon-btn" data-act="dup" title="Duplicate" aria-label="Duplicate">${icon('copy')}</button>
        <button class="icon-btn danger" data-act="delete" title="Delete" aria-label="Delete">${icon('trash')}</button>
      </div>
      <div class="props">
        ${
          d.kind === 'text'
            ? `<label class="wide">Text<textarea data-prop="text" rows="2">${esc(d.text)}</textarea></label>
               <label class="wide">Font<select data-prop="font">${Object.entries(FONTS).map(([k, f]) => `<option value="${k}" ${k === d.font ? 'selected' : ''}>${f.name}</option>`).join('')}</select></label>
               <label>Letter spacing <output>${d.spacing}</output><input type="range" min="-50" max="400" step="5" data-prop="spacing" value="${d.spacing}"></label>
               <label>Arc <output>${d.arc}°</output><input type="range" min="-120" max="120" step="1" data-prop="arc" value="${d.arc}"></label>`
            : `<label class="wide">Name<input type="text" data-prop="name" value="${esc(d.name)}"></label>`
        }
        <label>Piece<select data-prop="panel"><option value="front" ${d.panel === 'front' ? 'selected' : ''}>Front</option><option value="back" ${d.panel === 'back' ? 'selected' : ''}>Back</option></select></label>
        ${num('rot', 'Rotation', d.rot, 1, '°')}
        ${num('x', 'From centre line', d.x)}
        ${num('y', 'Below HPS (centre)', d.y)}
        <div class="wide size-row">
          ${num('w', 'Width', d.w, 0.1, 'cm', 'min="0.5"')}
          <button class="icon-btn" data-act="lock" aria-pressed="${d.lockAspect !== false}" title="${d.lockAspect !== false ? 'Proportions locked: click to stretch width and height separately' : 'Width and height are independent: click to keep proportions'}" aria-label="Keep proportions">${icon(d.lockAspect !== false ? 'link' : 'unlink')}</button>
          ${num('h', 'Height', h.toFixed(1), 0.1, 'cm', 'min="0.5"')}
        </div>
        <p class="hint wide" data-size-hint>${sizeHint(d)}</p>
        <label class="wide">Material<select data-prop="finish">${Object.entries(FINISHES).map(([k, f]) => `<option value="${k}" ${k === d.finish ? 'selected' : ''}>${f.name}</option>`).join('')}</select></label>
        ${d.kind === 'image' ? `<label class="wide check"><input type="checkbox" data-prop="recolor" ${d.recolor ? 'checked' : ''}> Single colour: cut the artwork's shape from one vinyl</label>` : ''}
        ${d.kind !== 'image' || d.recolor ? colorRow('color', twoColor ? 'Main colour' : 'Colour') : ''}
        ${twoColor ? colorRow('color2', 'Accent colour') : ''}
      </div>
      <div id="warn-box"></div>
      <div class="row-actions">
        ${MOTIFS[d.motif]?.generative ? '<button data-act="reseed" title="Same style, new random layout">New pattern</button>' : ''}
        ${d.h != null ? '<button data-act="unstretch" title="Go back to the artwork\'s own proportions">Reset proportions</button>' : ''}
        <button data-act="center">Centre on piece</button>
        <button data-act="flip">Mirror</button>
        <button data-act="up" title="Bring forward">Forward</button>
        <button data-act="down" title="Send backward">Backward</button>
      </div>`;
  }

  specHTML() {
    const g = this.garment();
    if (!g) return '';
    const m = g.m;
    const chart = SIZE_CHART[g.size];
    const row = (label, v, fromChart = false) => `<tr class="${fromChart ? 'from-chart' : ''}"><td>${label}</td><td>${cm(v)} <small>(${inch(v)})</small></td></tr>`;
    return `<h2>Miler Base Singlet, size ${g.size}</h2>
      <table class="spec">
        ${row('Chest, all round', chart.chest * IN, true)}
        ${row('Length, HPS to hem', chart.length * IN, true)}
        ${row('Width across chest, flat', m.halfChest * 2)}
        ${row('Neck width', m.neckWidth)}
        ${row('Front neck drop', m.frontNeckDrop)}
        ${row('Back neck drop', m.backNeckDrop)}
        ${row('Strap at shoulder', m.strapWidth)}
        ${row('HPS to underarm', m.armholeDepth)}
        ${row('Hem curve rise', m.hemRise)}
      </table>
      <p class="footnote">* From Miler's size guide. Other values are estimated from product photos; measure your shirt and correct them in js/garments/singlet.js.</p>`;
  }

  onInput(e, committed) {
    const el = e.target;
    const prop = el.dataset.prop;
    const sel = this.store.selected;
    if (!prop || !sel || el.dataset.act) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number' || el.type === 'range') {
      v = parseFloat(v);
      if (!Number.isFinite(v)) return;
    }
    if (el.type === 'range') {
      const out = el.parentElement.querySelector('output');
      if (out) out.textContent = prop === 'arc' ? `${v}°` : v;
    }
    const locked = sel.lockAspect !== false;
    if (prop === 'h' || prop === 'w') {
      if (v <= 0.4) return;
      const { w, h } = designSize(sel);
      let patch;
      if (prop === 'w') patch = locked ? { w: v, ...(sel.h != null && { h: +((h * v) / w).toFixed(2) }) } : { w: v, h };
      else patch = locked ? { w: +((w * v) / h).toFixed(2), ...(sel.h != null && { h: v }) } : { h: v };
      this.store.update(sel.id, patch, { commit: committed });
    } else {
      this.store.update(sel.id, { [prop]: v }, { commit: committed });
    }
    if (prop === 'panel' || prop === 'recolor' || prop === 'font') this.render();
  }

  onClick(e) {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    const li = e.target.closest('li[data-id]');
    if (li && act) {
      const d = this.store.state.designs.find((x) => x.id === li.dataset.id);
      if (!d) return;
      if (act === 'toggle') this.store.update(d.id, { visible: !d.visible });
      else if (act === 'remove') this.remove(d);
      else if (act === 'pick') {
        this.store.select(d.id);
        if (this.viewer.facing() !== d.panel) this.viewer.view(d.panel);
      }
      return;
    }
    const sel = this.store.selected;
    if (!sel || !act) return;
    if (act === 'color') this.store.update(sel.id, { [btn.dataset.prop]: btn.dataset.hex });
    else if (act === 'center') this.store.update(sel.id, { x: 0 });
    else if (act === 'reseed') this.store.update(sel.id, { seed: 1 + Math.floor(Math.random() * 1e6) });
    else if (act === 'lock') return this.store.update(sel.id, { lockAspect: sel.lockAspect === false }), this.render();
    else if (act === 'unstretch') return this.store.update(sel.id, { h: undefined }), this.render();
    else if (act === 'flip') this.store.update(sel.id, { flip: !sel.flip });
    else if (act === 'up') this.store.move(sel.id, 1);
    else if (act === 'down') this.store.move(sel.id, -1);
    else if (act === 'dup') return this.duplicate(sel);
    else if (act === 'delete') return this.remove(sel);
    if (act === 'color') this.render();
  }
}

function sizeHint(d) {
  const { w, h } = designSize(d);
  return `${(w / IN).toFixed(2)} × ${(h / IN).toFixed(2)} in. Top edge ${cm(d.y - h / 2)} below the HPS line.`;
}

function setStatus(msg) {
  const s = $('#status');
  if (s) s.textContent = msg;
}

let toastTimer = 0;
export function toast(message, actionLabel, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  el.hidden = false;
  el.querySelector('button')?.addEventListener('click', () => {
    el.hidden = true;
    action();
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

function drawThumb(canvas, art) {
  const ctx = canvas.getContext('2d');
  const [vx, vy, vw, vh] = art.viewBox;
  const tall = vh > vw * 1.5;
  const [fw, fh] = tall ? [vh, vw] : [vw, vh];
  const k = Math.min((canvas.width - 16) / fw, (canvas.height - 16) / fh);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (tall) ctx.rotate(-Math.PI / 2);
  ctx.scale(k, k);
  ctx.translate(-vx - vw / 2, -vy - vh / 2);
  for (const p of art.paths) {
    ctx.fillStyle = p.fill === 'color2' ? '#e0b25a' : '#f1eee4';
    ctx.fill(new Path2D(p.d), p.rule);
  }
}
