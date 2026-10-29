import { Store } from './state.js';
import { loadFonts } from './art/text.js';
import { setImageLoadHandler } from './art/render.js';
import { buildSinglet, SIZES, COLORS } from './garments/singlet.js';
import { loadBody } from './body/mannequin.js';
import { buildCloth, initialPositions, createDrape } from './sim/drape.js';
import { Viewer3D } from './view3d.js';
import { Compositor } from './compose.js';
import { PatternEditor } from './editor.js';
import { Inspector } from './ui.js';
import { setupExports } from './export.js';
import { loadDesignPacks } from './designs/load.js';

const $ = (s) => document.querySelector(s);
const status = $('#status');
const params = new URLSearchParams(location.search);
const say = (t) => (status.textContent = t);

// design packs decide the tray's motifs and the starting layout, so load them before anything else
await loadDesignPacks();
const store = new Store();
let garment, body, drapeJob = 0;

const viewer = new Viewer3D($('#viewer'));
const compositor = new Compositor(16);

let warnings = new Map();
const editor = new PatternEditor($('#mat'), store, {
  onWarnings: (w) => {
    warnings = w;
    inspector.setWarnings(w);
  },
  onInteract: (d) => {
    if (viewer.facing() !== d.panel) viewer.view(d.panel);
  },
  onSelectionRect: (r) => inspector.positionToolbar(r),
  onDropFiles: (files, place) => inspector.addFiles(files, place),
});
const inspector = new Inspector($('#inspector'), store, { editor, viewer, garment: () => garment });

let textureQueued = false;
function refreshTexture() {
  if (textureQueued) return;
  textureQueued = true;
  requestAnimationFrame(() => {
    textureQueued = false;
    if (!garment) return;
    compositor.render(store.state, garment);
    viewer.texturesChanged();
  });
}
setImageLoadHandler(() => {
  refreshTexture();
  editor.requestDraw();
});

// Sew and drape the current garment, animating the result into the 3D view.
async function drape() {
  const job = ++drapeJob;
  const cloth = buildCloth(garment, 1.5);
  // start the shirt floating just above the shoulders, then sew and drop it
  const pos = initialPositions(cloth, garment, body.measures.shoulderTop + 4.5, 0);
  viewer.setCloth(cloth, pos, garment.layout);
  const sim = createDrape(cloth, body, pos);
  const instant = params.has('instant');
  while (!sim.done) {
    if (job !== drapeJob) return;
    const t0 = performance.now();
    while (!sim.done && performance.now() - t0 < (instant ? 1e9 : 14)) sim.step(1);
    viewer.updateCloth(pos);
    say(sim.progress < 0.35 ? 'Sewing seams' : 'Draping');
    await new Promise((r) => requestAnimationFrame(r));
  }
  sim.finish();
  viewer.updateCloth(pos);
  say(`Size ${garment.size}, ${store.state.garment.color.toLowerCase()}. Drag to orbit, click the shirt to pick a print.`);
  document.body.dataset.ready = '1';
}

function applyGarment() {
  const g = store.state.garment;
  garment = buildSinglet(g.size);
  if (compositor.setLayout(garment.layout) || !viewer.colorTex) viewer.setTextures(compositor.color, compositor.finish);
  editor.setGarment(garment);
  viewer.setFabricColor(COLORS[g.color]);
  refreshTexture();
  inspector.render();
  syncGarmentControls();
  drape();
}

// ---------- top bar ----------

function syncGarmentControls() {
  const g = store.state.garment;
  $('#size').value = g.size;
  for (const b of $('#fabric').children) b.setAttribute('aria-checked', String(b.dataset.color === g.color));
  for (const el of document.querySelectorAll('[data-overlay]')) el.checked = !!store.state.overlays[el.dataset.overlay];
}

$('#size').innerHTML = SIZES.map((s) => `<option value="${s}">${s}</option>`).join('');
$('#size').addEventListener('change', (e) => store.setGarment({ size: e.target.value }));
$('#fabric').innerHTML = Object.entries(COLORS)
  .map(([name, hex]) => `<button role="radio" data-color="${name}" title="${name}" aria-label="${name}" style="background:${hex}"></button>`)
  .join('');
$('#fabric').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (b) store.setGarment({ color: b.dataset.color });
});
for (const el of document.querySelectorAll('[data-overlay]')) {
  el.addEventListener('change', () => store.setOverlay(el.dataset.overlay, el.checked));
}
$('#fit').addEventListener('click', () => editor.fit());
$('#undo').addEventListener('click', () => store.undo());
$('#redo').addEventListener('click', () => store.redo());
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => viewer.view(b.dataset.view));
$('#turntable').addEventListener('click', (e) => {
  viewer.autoRotate = !viewer.autoRotate;
  e.currentTarget.setAttribute('aria-pressed', String(viewer.autoRotate));
});
if (document.querySelector('meta[name="ttc:hosted"]')) $('#shot').hidden = true;
$('#shot').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = viewer.screenshot();
  a.download = 'ttc-singlet.png';
  a.click();
});

// ---------- 3D picking: click a print on the shirt to select it, drag to slide it ----------

{
  const el = viewer.renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    const hit = viewer.pick(e.clientX, e.clientY);
    if (!hit) return;
    const d = editor.hitDesignAt(hit.panel, hit.x, hit.y);
    if (!d) return;
    store.select(d.id);
    const L = garment.layout;
    const a = L.toAtlas(hit.panel, hit.x, hit.y), c = L.toAtlas(d.panel, d.x, d.y);
    // grab offset along the strip, taking the short way round the body
    let dx = a.x - c.x;
    dx -= Math.round(dx / L.period) * L.period;
    drag = { id: d.id, off: { x: dx, y: a.y - c.y } };
    viewer.controls.enabled = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) {
      const hit = viewer.pick(e.clientX, e.clientY);
      el.style.cursor = hit && editor.hitDesignAt(hit.panel, hit.x, hit.y) ? 'move' : '';
      return;
    }
    const hit = viewer.pick(e.clientX, e.clientY);
    if (!hit) return;
    const L = garment.layout;
    const a = L.toAtlas(hit.panel, hit.x, hit.y);
    const p = L.fromAtlas(a.x - drag.off.x, a.y - drag.off.y);
    store.update(drag.id, { panel: p.panel, x: +p.x.toFixed(1), y: +p.y.toFixed(1) }, { commit: false });
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    viewer.controls.enabled = true;
    store.commit();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// ---------- keyboard ----------

window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  const sel = store.selected;
  if (!sel) return;
  if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    inspector.duplicate(sel);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    inspector.remove(sel);
  } else if (e.key === 'Escape') {
    store.select(null);
  } else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    store.update(sel.id, { x: +(sel.x + dx).toFixed(2), y: +(sel.y + dy).toFixed(2) });
  }
});

// ---------- store wiring ----------

let booted = false;
store.subscribe((reason) => {
  if (!booted) return;
  if (reason === 'garment') return applyGarment();
  if (reason === 'designs' || reason === 'overlays') refreshTexture();
  if (reason === 'overlays') syncGarmentControls();
  editor.requestDraw();
  if (reason === 'select') inspector.render();
  else if (reason === 'designs') inspector.sync();
});

// handy from the browser console: ttc.store.state, ttc.viewer, ttc.editor
window.ttc = { store, viewer, editor };

// ---------- boot ----------

(async function boot() {
  try {
    say('Loading');
    [, body] = await Promise.all([loadFonts(), loadBody()]);
    viewer.setMannequin(body.mesh);
    inspector.setupTray();
    setupExports({ store, garment: () => garment });
    booted = true;
    if (params.has('back')) viewer.view('back', 1);
    if (params.has('three')) viewer.view('three', 1);
    applyGarment();
    if (window.matchMedia('(max-width: 760px)').matches) editor.focusPanel('front');
  } catch (err) {
    console.error(err);
    say(`Couldn't start: ${err.message}. Serve this folder over http (see README), not file://.`);
  }
})();
