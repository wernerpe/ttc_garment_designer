// The cutting mat: both pattern pieces at true scale, joined along the wearer's left side seam so
// the strip runs all the way round the body (the right side seam is at both ends and art wraps
// across it). Designs are placed, dragged, scaled and rotated here; positions are stored per piece
// (cm from that piece's centre line and from the HPS line) so they mean the same thing on the mat,
// on the 3D shirt and on the printed placement sheet.

import { COLORS } from './garments/singlet.js';
import { drawDesign, designSize, designCorners } from './art/render.js';
import { panelPath, milerLogo } from './compose.js';
import { insetPolygon, distToSegment, pointInPolygon } from './geometry/curves.js';

const MAT = '#2d5b48';
const CHALK = '#f1eee4';
const AMBER = '#e3a73b';
const WARN = '#ff7a5c';
const HANDLE = 9; // px

export class PatternEditor {
  constructor(container, store, { onWarnings, onInteract, onSelectionRect, onDropFiles } = {}) {
    this.store = store;
    this.container = container;
    this.onInteract = onInteract || (() => {});
    this.onWarnings = onWarnings || (() => {});
    this.onSelectionRect = onSelectionRect || (() => {});
    const canvas = (this.canvas = document.createElement('canvas'));
    canvas.className = 'mat-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Pattern pieces. Drag artwork to place it; arrow keys nudge the selection.');
    container.appendChild(canvas);
    this.ctx = canvas.getContext('2d');
    this.view = { s: 8, ox: 0, oy: 0 };
    this.fitted = false;
    this.pointers = new Map();
    this.drag = null;
    this.snapGuide = null;
    this.garment = null;
    new ResizeObserver(() => this.resize()).observe(container);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      if (!this.hitDesign(this.toWorld(e.clientX, e.clientY))) this.fit();
    });
    // drop image files straight onto the pattern
    container.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
        e.preventDefault();
        container.classList.add('dropping');
      }
    });
    container.addEventListener('dragleave', () => container.classList.remove('dropping'));
    container.addEventListener('drop', (e) => {
      container.classList.remove('dropping');
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      onDropFiles?.([...e.dataTransfer.files], this.placeAt(e.clientX, e.clientY));
    });
  }

  get layout() {
    return this.garment.layout;
  }

  setGarment(garment) {
    this.garment = garment;
    const L = garment.layout;
    const margin = this.store.state.safeMargin;
    this.paths = { front: panelPath(garment, 'front'), back: panelPath(garment, 'back') };
    this.union = new Path2D();
    this.union.addPath(this.paths.front);
    this.union.addPath(this.paths.back);
    this.pieces = {};
    for (const side of ['front', 'back']) {
      const p = garment.panels[side];
      const n = p.outline.length;
      const onSide = new Set([...p.seams.sideR, ...p.seams.sideL]);
      // a segment is part of a side seam when both its ends are side-seam samples
      const isSeam = (i) => onSide.has(i) && onSide.has((i + 1) % n);
      const edges = [];
      for (let i = 0; i < n; i++) if (!isSeam(i)) edges.push([p.outline[i], p.outline[(i + 1) % n]]);
      const inset = insetPolygon(p.outline, margin);
      const A = (q) => L.toAtlas(side, q.x, q.y);
      // runs of the outline: cut edges vs. side seams (drawn differently)
      const runs = [];
      let cur = null;
      for (let i = 0; i < n; i++) {
        const kind = isSeam(i) ? (p.seams.sideR.includes(i) ? 'seamR' : 'seamL') : 'edge';
        if (!cur || cur.kind !== kind) {
          cur = { kind, pts: [A(p.outline[i])], safe: [A(inset[i])] };
          runs.push(cur);
        }
        cur.pts.push(A(p.outline[(i + 1) % n]));
        cur.safe.push(A(inset[(i + 1) % n]));
      }
      this.pieces[side] = { outline: p.outline, edges, runs };
    }
    this.requestDraw();
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    if (!this.fitted) this.fit();
    else this.requestDraw();
  }

  fit() {
    if (!this.w || !this.garment) return;
    const L = this.layout;
    const pad = 24;
    const s = Math.min((this.w - pad * 2) / (L.width - 4), (this.h - pad * 2) / (L.height - 1));
    this.view.s = s;
    this.view.ox = (this.w - L.width * s) / 2;
    this.view.oy = (this.h - L.height * s) / 2 + 4;
    this.fitted = true;
    this.requestDraw();
  }

  // Centre one piece (used on narrow screens where the whole strip would be tiny).
  focusPanel(side) {
    if (!this.garment) return;
    const L = this.layout;
    const s = Math.min((this.w - 32) / (L.hc * 2 + 8), (this.h - 32) / (L.height - 2));
    this.view.s = s;
    this.view.ox = this.w / 2 - L.centre(side) * s;
    this.view.oy = (this.h - L.height * s) / 2;
    this.fitted = true;
    this.requestDraw();
  }

  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.ox) / this.view.s, y: (clientY - r.top - this.view.oy) / this.view.s };
  }

  // Pattern position under a screen point, or null when it isn't over the mat.
  placeAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    if (!this.garment || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const w = this.toWorld(clientX, clientY);
    const p = this.layout.fromAtlas(w.x, w.y);
    return { panel: p.panel, x: round(p.x), y: round(Math.max(2, Math.min(this.garment.m.length - 2, p.y))) };
  }

  requestDraw() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.draw();
    });
  }

  // ---------- drawing ----------

  draw() {
    const { ctx, view, dpr } = this;
    const g = this.garment;
    const st = this.store.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MAT;
    ctx.fillRect(0, 0, this.w, this.h);
    if (st.overlays.grid) this.drawGrid();
    if (!g) return;
    const L = this.layout;
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.ox, dpr * view.oy);
    const px = 1 / view.s; // one screen pixel in cm
    const fabric = COLORS[st.garment.color] || COLORS.Black;
    const light = ['White', 'Limestone'].includes(st.garment.color);
    const ink = light ? '#2b2b2b' : CHALK;

    // the joined pieces, with a soft shadow like paper lying on the mat
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10 * dpr;
    ctx.shadowOffsetY = 3 * dpr;
    ctx.fillStyle = fabric;
    ctx.fill(this.union);
    ctx.restore();
    for (const side of ['front', 'back']) this.drawMarkings(side, ink, px);

    // designs: faint where they hang off the pieces, solid where they will actually print
    const designs = st.designs.filter((d) => d.visible);
    ctx.save();
    ctx.globalAlpha = 0.28;
    for (const d of designs) drawDesign(ctx, d, L, 'color', view.s * dpr, { wrap: false });
    ctx.restore();
    ctx.save();
    ctx.clip(this.union);
    if (st.overlays.logo) drawDesign(ctx, milerLogo(g), L, 'color', view.s * dpr, { wrap: false });
    for (const d of designs) drawDesign(ctx, d, L, 'color', view.s * dpr);
    ctx.restore();
    this.drawEdges(ink, px);

    const warnings = this.computeWarnings();
    for (const [id, list] of warnings) {
      const d = st.designs.find((x) => x.id === id);
      if (!d || d.id === this.store.selectedId || !list.some((w) => w.level === 'warn')) continue;
      this.outline(d, WARN, px, [4 * px, 3 * px]);
    }
    const sel = this.store.selected;
    if (sel) this.drawSelection(sel, px, warnings.get(sel.id)?.some((w) => w.level === 'warn'));
    if (this.snapGuide) {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1 * px;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(this.snapGuide.x, -2);
      ctx.lineTo(this.snapGuide.x, L.height);
      ctx.stroke();
    }
    this.onWarnings(warnings);
    this.reportSelection();
  }

  drawGrid() {
    const { ctx, view } = this;
    const steps = [1, 5, 10];
    const colors = ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.22)'];
    const x0 = Math.floor(-view.ox / view.s), x1 = Math.ceil((this.w - view.ox) / view.s);
    const y0 = Math.floor(-view.oy / view.s), y1 = Math.ceil((this.h - view.oy) / view.s);
    steps.forEach((step, i) => {
      if (step * view.s < 5) return;
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const sx = Math.round(view.ox + x * view.s) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, this.h);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const sy = Math.round(view.oy + y * view.s) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(this.w, sy);
      }
      ctx.stroke();
    });
    // ruler numbers every 10 cm along the top and left, measured on the mat
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '500 10px Archivo, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) ctx.fillText(String(x), view.ox + x * view.s + 3, 4);
    for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) if (y > 0) ctx.fillText(String(y), 4, view.oy + y * view.s + 3);
  }

  // Cut edges solid; the joined left side seam as a stitch line; the right side seam (split
  // across both ends of the strip) solid but labelled so it reads as "continues over there".
  drawEdges(ink, px) {
    const { ctx } = this;
    const m = this.garment.m;
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineJoin = 'round';
    for (const side of ['front', 'back']) {
      for (const run of this.pieces[side].runs) {
        const joined = (side === 'front' && run.kind === 'seamR') || (side === 'back' && run.kind === 'seamL');
        if (joined && side === 'back') continue; // drawn once, from the front piece
        ctx.lineWidth = (joined ? 1.2 : 1.5) * px;
        ctx.setLineDash(joined ? [5 * px, 4 * px] : []);
        ctx.globalAlpha = joined ? 0.7 : 1;
        ctx.beginPath();
        run.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = ink;
    const fs = Math.max(1, 11 * px);
    ctx.font = `500 ${fs}px Archivo, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const midY = (m.armholeDepth + m.length - m.hemRise) / 2;
    const L = this.layout;
    const label = (x, text) => {
      ctx.save();
      ctx.translate(x, midY - L.top);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    label(L.centre('front') + L.hc - 0.7, 'left side seam');
    label(L.centre('front') - L.hc + 1.6, 'right side seam, joins the far end');
    label(L.centre('back') + L.hc - 0.7, 'right side seam, joins the far end');
    ctx.restore();
  }

  drawMarkings(side, ink, px) {
    const { ctx } = this;
    const g = this.garment;
    const m = g.m;
    const st = this.store.state;
    const A = (x, y) => this.layout.toAtlas(side, x, y);
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    // centre line
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1 * px;
    ctx.setLineDash([6 * px, 5 * px]);
    const neck = side === 'front' ? m.frontNeckDrop : m.backNeckDrop;
    let a = A(0, neck), b = A(0, m.length);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // underarm line
    ctx.setLineDash([2 * px, 4 * px]);
    a = A(-m.halfChest, m.armholeDepth);
    b = A(m.halfChest, m.armholeDepth);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // safe zone: keep heat this far from every cut edge (the side seams are joined, so none there)
    if (st.overlays.safe) {
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.2 * px;
      for (const run of this.pieces[side].runs) {
        if (run.kind !== 'edge') continue;
        ctx.beginPath();
        run.safe.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
      ctx.strokeStyle = ink;
    }
    ctx.setLineDash([]);
    // grainline: double-headed arrow, the pattern-maker's "this way up"
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.2 * px;
    const gx = -m.halfChest * 0.62;
    a = A(gx, m.armholeDepth + 8);
    b = A(gx, m.length - 14);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    for (const [p, dir] of [[a, 1], [b, -1]]) {
      ctx.moveTo(p.x - 0.8, p.y + dir * 1.6);
      ctx.lineTo(p.x, p.y);
      ctx.lineTo(p.x + 0.8, p.y + dir * 1.6);
    }
    ctx.stroke();
    // labels
    ctx.globalAlpha = 0.75;
    const fs = Math.max(1.1, 13 * px);
    ctx.font = `600 ${fs}px Archivo, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const lab = A(0, m.length - 7.5);
    ctx.fillText(side === 'front' ? 'Front' : 'Back', lab.x, lab.y);
    ctx.globalAlpha = 0.5;
    ctx.font = `400 ${fs * 0.78}px Archivo, system-ui, sans-serif`;
    ctx.fillText(`Miler Base Singlet, size ${g.size}`, lab.x, lab.y + fs * 1.3);
    ctx.textAlign = 'left';
    const ua = A(-m.halfChest + 1.2, m.armholeDepth + fs * 1.1);
    ctx.fillText('underarm', ua.x, ua.y);
    const hp = A(m.neckWidth / 2 + 0.4, -0.6);
    ctx.fillStyle = CHALK; // sits on the mat, not the fabric
    ctx.fillText('HPS', hp.x, hp.y);
    ctx.restore();
  }

  // Corners of every copy of a design that touches the strip (the design plus its wrapped twins).
  copies(d) {
    const L = this.layout;
    const base = designCorners(d).map((p) => L.toAtlas(d.panel, p.x, p.y));
    const out = [];
    for (const off of [0, -L.period, L.period]) {
      const pts = base.map((p) => ({ x: p.x + off, y: p.y }));
      const xs = pts.map((p) => p.x);
      if (off === 0 || (Math.max(...xs) > 0 && Math.min(...xs) < L.width)) out.push({ off, pts });
    }
    return out;
  }

  outline(d, color, px, dash = []) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * px;
    for (const { off, pts } of this.copies(d)) {
      ctx.setLineDash(off ? [3 * px, 3 * px] : dash);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  handles(d) {
    const px = 1 / this.view.s;
    const L = this.layout;
    const corners = designCorners(d).map((p) => L.toAtlas(d.panel, p.x, p.y));
    const a = (d.rot * Math.PI) / 180;
    const { h } = designSize(d);
    const c = L.toAtlas(d.panel, d.x, d.y);
    const off = h / 2 + 26 * px;
    const rot = { x: c.x + Math.sin(a) * off, y: c.y - Math.cos(a) * off };
    const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    // edge midpoints stretch one way: right, bottom, left, top
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const sides = [
      { ...mid(corners[1], corners[2]), axis: 'w', sign: 1 },
      { ...mid(corners[2], corners[3]), axis: 'h', sign: 1 },
      { ...mid(corners[3], corners[0]), axis: 'w', sign: -1 },
      { ...topMid, axis: 'h', sign: -1 },
    ];
    return { corners, rot, topMid, center: c, sides };
  }

  drawSelection(d, px, warn) {
    const { ctx } = this;
    this.outline(d, warn ? WARN : AMBER, px);
    const { corners, rot, topMid } = this.handles(d);
    ctx.save();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.2 * px;
    ctx.beginPath();
    ctx.moveTo(topMid.x, topMid.y);
    ctx.lineTo(rot.x, rot.y);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.5 * px;
    const hs = HANDLE * px;
    for (const p of corners) {
      ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
      ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    }
    ctx.beginPath();
    ctx.arc(rot.x, rot.y, hs * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (const sd of this.handles(d).sides) {
      ctx.save();
      ctx.translate(sd.x, sd.y);
      ctx.rotate((d.rot * Math.PI) / 180 + (sd.axis === 'w' ? Math.PI / 2 : 0));
      ctx.beginPath();
      ctx.roundRect(-hs * 0.75, -hs * 0.28, hs * 1.5, hs * 0.56, hs * 0.28);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // live dimensions
    const { w, h } = designSize(d);
    const label = `${w.toFixed(1)} × ${h.toFixed(1)} cm`;
    const bottom = corners.reduce((m, p) => (p.y > m.y ? p : m), corners[0]);
    const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
    ctx.font = `600 ${12 * px}px Archivo, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = AMBER;
    ctx.fillRect(cx - tw / 2 - 6 * px, bottom.y + 8 * px, tw + 12 * px, 18 * px);
    ctx.fillStyle = '#1d2420';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, bottom.y + 17 * px);
    ctx.restore();
  }

  // Screen rectangle of the selection (for the floating toolbar), relative to the mat container.
  reportSelection() {
    const sel = this.store.selected;
    if (!sel || !this.garment || (this.drag && this.drag.mode !== 'pan')) return this.onSelectionRect(null);
    const { corners, rot } = this.handles(sel);
    const xs = [...corners.map((p) => p.x), rot.x], ys = [...corners.map((p) => p.y), rot.y];
    const S = (x, y) => ({ x: this.view.ox + x * this.view.s, y: this.view.oy + y * this.view.s });
    const a = S(Math.min(...xs), Math.min(...ys)), b = S(Math.max(...xs), Math.max(...ys));
    this.onSelectionRect({ left: a.x, top: a.y, right: b.x, bottom: b.y, width: this.w, height: this.h });
  }

  // ---------- checks ----------

  computeWarnings() {
    const st = this.store.state;
    const g = this.garment;
    const out = new Map();
    if (!g) return out;
    const L = this.layout;
    const margin = st.safeMargin;
    for (const d of st.designs) {
      if (!d.visible) continue;
      const list = [];
      const { w, h } = designSize(d);
      const corners = designCorners(d);
      let unsafe = false;
      const touched = new Set();
      for (let i = 0; i < 4; i++) {
        const p = corners[i], q = corners[(i + 1) % 4];
        for (let t = 0; t < 1; t += 0.1) {
          const loc = L.locate(d.panel, p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
          const piece = this.pieces[loc.panel];
          if (!pointInPolygon(loc, piece.outline)) {
            unsafe = true;
            continue;
          }
          touched.add(loc.panel);
          if (!unsafe && piece.edges.some(([a, b]) => distToSegment(loc, a, b) < margin)) unsafe = true;
        }
      }
      if (unsafe) list.push({ level: 'warn', text: `Runs off the shirt or within ${margin} cm of a hem or seam edge, where heat can lift the bonded tape.` });
      if (touched.size > 1) list.push({ level: 'note', text: 'Wraps across a side seam. Press each side separately and keep the platen off the seam tape.' });
      const bw = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x));
      const bh = Math.max(...corners.map((p) => p.y)) - Math.min(...corners.map((p) => p.y));
      if (bw > st.press.w || bh > st.press.h) list.push({ level: 'note', text: `Larger than a ${st.press.w} × ${st.press.h} cm press. Plan two pressings.` });
      if (Math.min(w, h) < 0.6) list.push({ level: 'warn', text: 'Very thin: vinyl under 6 mm tends to peel on mesh.' });
      out.set(d.id, list);
    }
    return out;
  }

  // ---------- interaction ----------

  hitDesign(w) {
    const st = this.store.state;
    const L = this.layout;
    for (let i = st.designs.length - 1; i >= 0; i--) {
      const d = st.designs[i];
      if (!d.visible) continue;
      const c = L.toAtlas(d.panel, d.x, d.y);
      const a = (-d.rot * Math.PI) / 180;
      const { w: dw, h: dh } = designSize(d);
      for (const off of [0, -L.period, L.period]) {
        const dx = w.x - c.x - off, dy = w.y - c.y;
        const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
        if (Math.abs(lx) <= dw / 2 && Math.abs(ly) <= dh / 2) return { d, off };
      }
    }
    return null;
  }

  // Hit test in pattern coordinates (used by 3D picking).
  hitDesignAt(panel, x, y) {
    const a = this.layout.toAtlas(panel, x, y);
    return this.hitDesign(a)?.d || null;
  }

  down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // pinch zoom takes over
      const [p, q] = [...this.pointers.values()];
      this.drag = { mode: 'pinch', dist: Math.hypot(p.x - q.x, p.y - q.y), s: this.view.s, ox: this.view.ox, oy: this.view.oy, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
      return;
    }
    if (!this.garment) return;
    const w = this.toWorld(e.clientX, e.clientY);
    const sel = this.store.selected;
    const grab = (HANDLE + 6) / this.view.s;
    if (sel) {
      const h = this.handles(sel);
      if (Math.hypot(w.x - h.rot.x, w.y - h.rot.y) < grab) {
        this.drag = { mode: 'rotate', id: sel.id, c: h.center };
        return;
      }
      for (const p of h.corners) {
        if (Math.hypot(w.x - p.x, w.y - p.y) < grab) {
          this.drag = { mode: 'scale', id: sel.id, c: h.center, w0: sel.w, h0: sel.h, r0: Math.hypot(w.x - h.center.x, w.y - h.center.y) };
          return;
        }
      }
      for (const sd of h.sides) {
        if (Math.hypot(w.x - sd.x, w.y - sd.y) < grab) {
          const a = (sel.rot * Math.PI) / 180;
          const { w: w0, h: h0 } = designSize(sel);
          // unit vector of the edge's normal in atlas space
          const ax = sd.axis === 'w' ? { x: Math.cos(a), y: Math.sin(a) } : { x: -Math.sin(a), y: Math.cos(a) };
          this.drag = { mode: 'stretch', id: sel.id, c: h.center, axis: sd.axis, sign: sd.sign, ax, w0, h0 };
          return;
        }
      }
    }
    const hit = this.hitDesign(w);
    if (hit) {
      const { d, off } = hit;
      this.store.select(d.id);
      const a = this.layout.toAtlas(d.panel, d.x, d.y);
      this.drag = { mode: 'move', id: d.id, off: { x: w.x - a.x - off, y: w.y - a.y } };
      this.onInteract(d);
      return;
    }
    this.drag = { mode: 'pan', start: { x: e.clientX, y: e.clientY }, ox: this.view.ox, oy: this.view.oy, moved: false };
  }

  move(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const drag = this.drag;
    if (!this.garment) return;
    const w = this.toWorld(e.clientX, e.clientY);
    if (!drag) {
      const sel = this.store.selected;
      let cursor = 'grab';
      if (sel) {
        const h = this.handles(sel);
        const grab = (HANDLE + 6) / this.view.s;
        if (Math.hypot(w.x - h.rot.x, w.y - h.rot.y) < grab) cursor = 'alias';
        else if (h.corners.some((p) => Math.hypot(w.x - p.x, w.y - p.y) < grab)) cursor = 'nwse-resize';
        else {
          const sd = h.sides.find((p) => Math.hypot(w.x - p.x, w.y - p.y) < grab);
          if (sd) cursor = sd.axis === 'w' ? 'ew-resize' : 'ns-resize';
        }
      }
      if (cursor === 'grab' && this.hitDesign(w)) cursor = 'move';
      this.canvas.style.cursor = cursor;
      return;
    }
    const st = this.store;
    const L = this.layout;
    if (drag.mode === 'pinch' && this.pointers.size >= 2) {
      const [p, q] = [...this.pointers.values()];
      const k = Math.hypot(p.x - q.x, p.y - q.y) / drag.dist;
      const r = this.canvas.getBoundingClientRect();
      const mx = drag.mid.x - r.left, my = drag.mid.y - r.top;
      this.view.s = Math.max(2, Math.min(60, drag.s * k));
      this.view.ox = mx - ((mx - drag.ox) / drag.s) * this.view.s;
      this.view.oy = my - ((my - drag.oy) / drag.s) * this.view.s;
      this.requestDraw();
    } else if (drag.mode === 'pan') {
      const dx = e.clientX - drag.start.x, dy = e.clientY - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      this.view.ox = drag.ox + dx;
      this.view.oy = drag.oy + dy;
      this.requestDraw();
    } else if (drag.mode === 'move') {
      const d = st.state.designs.find((x) => x.id === drag.id);
      const p = L.fromAtlas(w.x - drag.off.x, w.y - drag.off.y);
      let x = p.x;
      this.snapGuide = null;
      if (!e.altKey) {
        // snap to the piece's centre line or onto a side seam
        for (const target of [0, L.hc, -L.hc]) {
          if (Math.abs(x - target) < 0.6) {
            x = target;
            this.snapGuide = { x: L.toAtlas(p.panel, target, 0).x };
            break;
          }
        }
      }
      const changedPanel = p.panel !== d.panel;
      st.update(drag.id, { panel: p.panel, x: round(x), y: round(p.y) }, { commit: false });
      if (changedPanel) this.onInteract(d);
    } else if (drag.mode === 'scale') {
      const r = Math.hypot(w.x - drag.c.x, w.y - drag.c.y);
      const nw = round(Math.max(0.5, (drag.w0 * r) / drag.r0));
      st.update(drag.id, drag.h0 != null ? { w: nw, h: round((drag.h0 * nw) / drag.w0) } : { w: nw }, { commit: false });
    } else if (drag.mode === 'stretch') {
      // the opposite edge stays put; the centre moves half as far as the dragged edge
      const size0 = drag.axis === 'w' ? drag.w0 : drag.h0;
      const along = (w.x - drag.c.x) * drag.ax.x + (w.y - drag.c.y) * drag.ax.y;
      const size = Math.max(0.5, along * drag.sign + size0 / 2);
      const shift = ((size - size0) / 2) * drag.sign;
      const p = L.fromAtlas(drag.c.x + drag.ax.x * shift, drag.c.y + drag.ax.y * shift);
      const patch = { panel: p.panel, x: round(p.x), y: round(p.y) };
      if (drag.axis === 'w') Object.assign(patch, { w: round(size), h: round(drag.h0) });
      else patch.h = round(size);
      st.update(drag.id, patch, { commit: false });
    } else if (drag.mode === 'rotate') {
      let ang = (Math.atan2(w.x - drag.c.x, -(w.y - drag.c.y)) * 180) / Math.PI;
      if (!e.altKey) {
        const snapped = Math.round(ang / 15) * 15;
        if (Math.abs(snapped - ang) < 3) ang = snapped;
      }
      st.update(drag.id, { rot: round(ang, 1) }, { commit: false });
    }
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    const drag = this.drag;
    if (!drag) return;
    if (drag.mode === 'pinch') {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    this.drag = null;
    this.snapGuide = null;
    if (drag.mode === 'pan' && !drag.moved) this.store.select(null);
    this.store.commit();
    this.requestDraw();
  }

  wheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const s = Math.max(2, Math.min(60, this.view.s * k));
    this.view.ox = mx - ((mx - this.view.ox) / this.view.s) * s;
    this.view.oy = my - ((my - this.view.oy) / this.view.s) * s;
    this.view.s = s;
    this.requestDraw();
  }
}

function round(n, step = 0.1) {
  return +(Math.round(n / step) * step).toFixed(2);
}
