// Everything that leaves the app: project files, the placement sheet you take to the heat press,
// mirrored cut files for vinyl, 1:1 pattern SVGs and 300 dpi PNGs for print shops.

import { artFor, designSize, designSVG, designCorners, drawArt, FINISHES, VINYL } from './art/render.js';
import { IN, SIZE_CHART, COLORS } from './garments/singlet.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const r1 = (n) => (+n).toFixed(1);
const inch = (n) => (n / IN).toFixed(2);
const colorName = (hex) => VINYL.find(([, h]) => h.toLowerCase() === String(hex).toLowerCase())?.[0] || hex;

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const slug = (s) => String(s || 'print').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'print';
const stamp = () => new Date().toISOString().slice(0, 10);

function outlineD(garment, side) {
  return 'M' + garment.panels[side].outline.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L') + 'Z';
}

// One pattern piece with its prints, in pattern coordinates (cm).
function pieceSVG(garment, state, side, { annotate = false } = {}) {
  const fabric = COLORS[state.garment.color] || COLORS.Black;
  const m = garment.m;
  const designs = state.designs.filter((d) => d.visible && d.panel === side);
  const clipId = `clip-${side}`;
  let s = `<clipPath id="${clipId}"><path d="${outlineD(garment, side)}"/></clipPath>`;
  s += `<path d="${outlineD(garment, side)}" fill="${fabric}" stroke="#222" stroke-width="0.12"/>`;
  s += `<line x1="0" y1="${side === 'front' ? m.frontNeckDrop : m.backNeckDrop}" x2="0" y2="${m.length}" stroke="#999" stroke-width="0.08" stroke-dasharray="0.6 0.5"/>`;
  s += `<line x1="${-m.halfChest}" y1="${m.armholeDepth}" x2="${m.halfChest}" y2="${m.armholeDepth}" stroke="#999" stroke-width="0.06" stroke-dasharray="0.2 0.4"/>`;
  // prints anchored on the other piece that wrap across a side seam show up here too
  const hc = garment.layout.hc;
  const others = state.designs
    .filter((d) => d.visible && d.panel !== side)
    .flatMap((d) => [designSVG({ ...d, x: d.x + 2 * hc }), designSVG({ ...d, x: d.x - 2 * hc })]);
  s += `<g clip-path="url(#${clipId})">${designs.map((d) => designSVG(d)).join('')}${others.join('')}</g>`;
  if (annotate) {
    designs.forEach((d) => {
      const c = designCorners(d);
      const top = Math.min(...c.map((p) => p.y));
      const left = Math.min(...c.map((p) => p.x));
      const right = Math.max(...c.map((p) => p.x));
      const mark = String.fromCharCode(65 + state.designs.indexOf(d));
      // vertical dimension from the HPS line to the top of the print
      s += `<line x1="${right + 0.8}" y1="0" x2="${right + 0.8}" y2="${top}" stroke="#d48a12" stroke-width="0.1" marker-start="url(#tick)" marker-end="url(#tick)"/>`;
      s += `<rect x="${left}" y="${top}" width="${right - left}" height="${Math.max(...c.map((p) => p.y)) - top}" fill="none" stroke="#d48a12" stroke-width="0.1" stroke-dasharray="0.4 0.3"/>`;
      s += `<circle cx="${left - 1.2}" cy="${top + 0.6}" r="1" fill="#d48a12"/><text x="${left - 1.2}" y="${top + 0.95}" font-size="1.1" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-weight="700">${mark}</text>`;
    });
    s += `<line x1="${-m.halfChest - 3}" y1="0" x2="${m.halfChest + 3}" y2="0" stroke="#d48a12" stroke-width="0.08"/>`;
    s += `<text x="${-m.halfChest - 3}" y="-0.6" font-size="1.2" fill="#d48a12" font-family="Arial, sans-serif">HPS line</text>`;
  }
  return s;
}

function placementSheet(state, garment) {
  const g = state.garment;
  const m = garment.m;
  const chart = SIZE_CHART[g.size];
  const designs = state.designs.filter((d) => d.visible);
  const vb = `${-m.halfChest - 5} -4 ${m.halfChest * 2 + 10} ${m.length + 8}`;
  const defs = `<defs><marker id="tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 5H10" stroke="#d48a12" stroke-width="2"/></marker></defs>`;
  const piece = (side) => `<figure><svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${defs}${pieceSVG(garment, state, side, { annotate: true })}</svg><figcaption>${side === 'front' ? 'Front' : 'Back'}, seen from outside</figcaption></figure>`;
  const rows = designs
    .map((d) => {
      const { w, h } = designSize(d);
      const c = designCorners(d);
      const top = Math.min(...c.map((p) => p.y));
      const mark = String.fromCharCode(65 + state.designs.indexOf(d));
      const colors = d.kind === 'image' && !d.recolor ? 'full colour' : [d.color, artFor(d).paths?.some((p) => p.fill === 'color2') ? d.color2 : null].filter(Boolean).map(colorName).join(' + ');
      let horiz = Math.abs(d.x) < 0.05 ? 'centred' : `${r1(Math.abs(d.x))} cm ${d.x > 0 ? 'right' : 'left'} of centre`;
      const xs = c.map((p) => p.x);
      if (Math.max(...xs) > garment.layout.hc || Math.min(...xs) < -garment.layout.hc) horiz += `<br><small>wraps round the side seam onto the ${d.panel === 'front' ? 'back' : 'front'}</small>`;
      return `<tr><td><b>${mark}</b></td><td>${esc(d.name || d.text)}</td><td>${d.panel}</td><td>${r1(w)} × ${r1(h)} cm<br><small>${inch(w)} × ${inch(h)} in</small></td><td>${r1(top)} cm<br><small>${inch(top)} in</small></td><td>${horiz}</td><td>${d.rot ? `${r1(d.rot)}°` : '–'}</td><td>${esc(FINISHES[d.finish]?.name || d.finish)}<br><small>${esc(colors)}</small></td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TTC placement sheet</title>
<style>
  body { font: 13px/1.4 Arial, Helvetica, sans-serif; color: #1e2421; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 8px; }
  .pieces { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
  figure { margin: 0; } figure svg { width: 100%; height: auto; border: 1px solid #ddd; }
  figcaption { font-weight: 700; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid #ddd; padding: 6px 6px 6px 0; text-align: left; vertical-align: top; }
  th { font-size: 12px; color: #555; font-weight: 600; } small { color: #666; }
  .notes { margin-top: 16px; padding: 10px 12px; background: #f4f5f2; } .notes li { margin: 3px 0; }
  @media print { body { margin: 10mm; } .pieces { break-inside: avoid; } }
</style></head><body>
<h1>Tortoise Track Club singlet, placement sheet</h1>
<p>Miler Base Running Singlet, size ${g.size} (chest ${chart.chest} in, length ${chart.length} in), ${g.color.toLowerCase()}. Printed ${stamp()}.</p>
<p>Measure every position from the HPS line (where strap meets neckline, shirt lying flat) and from the centre line. "Top edge" is the highest point of the print.</p>
<div class="pieces">${piece('front')}${piece('back')}</div>
<table><thead><tr><th></th><th>Print</th><th>Piece</th><th>Size</th><th>Top edge below HPS</th><th>Across</th><th>Rotation</th><th>Material</th></tr></thead><tbody>${rows}</tbody></table>
<div class="notes"><b>Pressing notes</b><ul>
  <li>Coolmax mesh is polyester: use a vinyl rated for polyester / low temperature and follow its time and temperature.</li>
  <li>Miler's seams and hems are bonded with heat-activated tape. Keep the platen at least ${state.safeMargin} cm away from them, or protect them with a folded pressing pillow under the print area only.</li>
  <li>Load the shirt on the press so only one layer is under the platen, and cover the art with a teflon sheet.</li>
  <li>Test-press a small offcut or an inside hem area first.</li>
</ul></div>
</body></html>`;
}

// All vinyl prints laid out flat per colour, mirrored, 1 unit = 1 cm, sized in mm.
function cutFileSVG(state) {
  const designs = state.designs.filter((d) => d.visible && (d.kind !== 'image' || d.recolor));
  const groups = new Map();
  for (const d of designs) {
    const art = artFor(d);
    const slots = art.image ? ['color'] : [...new Set(art.paths.map((p) => (p.fill === 'color2' && d.color2 ? 'color2' : 'color')))];
    for (const slot of slots) {
      const hex = slot === 'color2' ? d.color2 : d.color;
      if (!groups.has(hex)) groups.set(hex, []);
      groups.get(hex).push({ d, slot });
    }
  }
  const sheetW = 30; // 12 in cutting mat
  const gap = 1;
  let y = gap;
  let body = '';
  let maxW = 0;
  for (const [hex, items] of groups) {
    let x = gap, rowH = 0;
    let g = '';
    for (const { d, slot } of items) {
      const { w, h } = designSize(d);
      if (x + w > sheetW && x > gap) {
        x = gap;
        y += rowH + gap;
        rowH = 0;
      }
      // unrotated, mirrored for heat-transfer vinyl (you cut the back of the film)
      const flat = { ...d, x: x + w / 2, y: y + h / 2, rot: 0, flip: !d.flip };
      g += designSVG(flat, { only: d.kind === 'image' ? null : slot, solid: hex });
      x += w + gap;
      rowH = Math.max(rowH, h);
      maxW = Math.max(maxW, x);
    }
    body += `<g id="vinyl-${slug(colorName(hex))}">${g}</g>`;
    y += rowH + gap * 2;
  }
  const W = Math.max(sheetW, maxW), H = y;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(W * 10).toFixed(1)}mm" height="${(H * 10).toFixed(1)}mm" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">${body}</svg>`;
}

function panelsSVG(state, garment) {
  const m = garment.m;
  const pad = 3;
  const w = m.halfChest * 2 + pad * 2;
  const h = m.length + pad * 2;
  const piece = (side, ox) => `<g transform="translate(${ox + pad + m.halfChest} ${pad})">${pieceSVG(garment, state, side)}<text x="0" y="${m.length - 6}" font-size="1.6" text-anchor="middle" fill="#888" font-family="Arial, sans-serif">${side === 'front' ? 'Front' : 'Back'}, size ${garment.size}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(w * 20).toFixed(1)}mm" height="${(h * 10).toFixed(1)}mm" viewBox="0 0 ${(w * 2).toFixed(2)} ${h.toFixed(2)}">${piece('front', 0)}${piece('back', w)}</svg>`;
}

function designPNG(d, dpi = 300) {
  const pxPerCm = dpi / 2.54;
  const { w, h } = designSize(d);
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * pxPerCm);
  c.height = Math.ceil(h * pxPerCm);
  const ctx = c.getContext('2d');
  ctx.setTransform(pxPerCm, 0, 0, pxPerCm, c.width / 2, c.height / 2);
  drawArt(ctx, { ...d, rot: 0 }, 'color', pxPerCm);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// The hosted preview (a sandboxed page) can't start downloads, so it shows the sheet in-page.
const hosted = !!document.querySelector('meta[name="ttc:hosted"]');

function showSheetInPage(html) {
  let dlg = $('#sheet-view');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'sheet-view';
    dlg.className = 'sheet sheet-wide';
    dlg.innerHTML = '<div class="sheet-host"></div><div class="sheet-actions"><button type="button" id="sheet-close">Close</button></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#sheet-close').addEventListener('click', () => dlg.close());
    dlg.querySelector('.sheet-host').attachShadow({ mode: 'open' });
  }
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] || '';
  dlg.querySelector('.sheet-host').shadowRoot.innerHTML = `<style>${style.replace(/\bbody\b/g, ':host')} :host { display: block; background: #fff; color: #1e2421; margin: 0; padding: 16px; }</style>${body}`;
  dlg.showModal();
}

export function setupExports({ store, garment }) {
  const dlg = $('#export-dialog');
  if (hosted) {
    const note = document.createElement('p');
    note.className = 'export-note';
    note.textContent = 'This hosted preview can\'t save files. The placement sheet opens here; to download cut files, SVGs, PNGs or a project file, run the app from the repo (see README).';
    dlg.querySelector('.export-list').before(note);
    for (const b of dlg.querySelectorAll('[data-export]')) if (b.dataset.export !== 'sheet') b.disabled = true;
    $('#save').disabled = true;
    $('#save').title = 'Saving files needs the local version; your work autosaves in this browser.';
  }
  $('#export').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('click', async (e) => {
    const kind = e.target.closest('[data-export]')?.dataset.export;
    if (!kind) return;
    const st = store.state, g = garment();
    if (kind === 'sheet' && hosted) {
      dlg.close();
      showSheetInPage(placementSheet(st, g));
      return;
    }
    if (kind === 'sheet') {
      const html = placementSheet(st, g);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const win = window.open(url, '_blank');
      if (!win) download(`ttc-placement-sheet-${g.size}.html`, html, 'text/html');
    } else if (kind === 'cut') {
      download(`ttc-cut-file-mirrored-${stamp()}.svg`, cutFileSVG(st), 'image/svg+xml');
    } else if (kind === 'panels') {
      download(`ttc-singlet-${g.size}-pieces-1to1.svg`, panelsSVG(st, g), 'image/svg+xml');
    } else if (kind === 'png') {
      for (const d of st.designs.filter((x) => x.visible)) {
        download(`ttc-${slug(d.name || d.text)}-300dpi.png`, await designPNG(d), 'image/png');
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    dlg.close();
  });

  $('#save').addEventListener('click', () => {
    download(`ttc-singlet-${stamp()}.json`, JSON.stringify(store.state, null, 2), 'application/json');
  });
  $('#open').addEventListener('click', () => $('#open-file').click());
  $('#open-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.designs)) throw new Error('no designs in file');
      store.replaceAll(data);
    } catch (err) {
      $('#status').textContent = `Couldn't open ${file.name}: ${err.message}.`;
    }
  });
}

export { placementSheet, cutFileSVG, panelsSVG };
