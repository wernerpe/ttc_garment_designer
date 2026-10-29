// One renderer for every surface: the cutting-mat editor, the 3D texture and the exports all go
// through artFor() + drawDesign()/designSVG(), so what you place is what gets printed.

import { textArt } from './text.js';
import { motifArt } from './motifs.js';

export const FINISHES = {
  matte: { name: 'Matte vinyl (HTV)', rough: 0.62, metal: 0 },
  gloss: { name: 'Gloss vinyl (HTV)', rough: 0.3, metal: 0 },
  reflective: { name: 'Reflective vinyl', rough: 0.34, metal: 0.78 },
  foil: { name: 'Metallic foil', rough: 0.18, metal: 1 },
  dtf: { name: 'DTF full-colour print', rough: 0.55, metal: 0 },
};
export const FABRIC_FINISH = { rough: 0.9, metal: 0 };

export const VINYL = [
  ['White', '#f4f4f1'],
  ['Reflective silver', '#aeb2b5'],
  ['Black', '#161616'],
  ['Shell green', '#4f9a5b'],
  ['Forest', '#1f5c3a'],
  ['Volt', '#d4ef3a'],
  ['Amber', '#d79a2b'],
  ['Orange', '#ff6a13'],
  ['Red', '#c8102e'],
  ['Pink', '#f28ab2'],
  ['Sky', '#6cb4e4'],
  ['Royal', '#2450c0'],
];

const images = new Map(); // src -> HTMLImageElement
let onImageLoad = () => {};
export function setImageLoadHandler(fn) {
  onImageLoad = fn;
}

function imageFor(src) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onImageLoad();
    img.src = src;
    images.set(src, img);
  }
  return img;
}

const artCache = new Map();
export function artFor(d) {
  if (d.kind === 'image') {
    const img = imageFor(d.src);
    const w = d.natW || img.naturalWidth || 100, h = d.natH || img.naturalHeight || 100;
    return { image: img, viewBox: [0, 0, w, h] };
  }
  const key = d.kind === 'text' ? `t|${d.text}|${d.font}|${d.spacing}|${d.arc}|${d.lineHeight}` : `m|${d.motif}|${d.seed ?? 1}`;
  let art = artCache.get(key);
  if (!art) {
    art = d.kind === 'text' ? textArt(d) : motifArt(d.motif, d.seed ?? 1);
    if (artCache.size > 200) artCache.clear();
    artCache.set(key, art);
  }
  return art;
}

// A design's printed size. Height follows the artwork's own proportions unless the design has
// been stretched, in which case it carries an explicit `h`.
export function designSize(d) {
  const vb = artFor(d).viewBox;
  return { w: d.w, h: d.h ?? (d.w * vb[3]) / Math.max(vb[2], 1e-6) };
}

// Corners of the design's rotated box in panel coordinates.
export function designCorners(d) {
  const { w, h } = designSize(d);
  const a = (d.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: d.x + x * c - y * s, y: d.y + x * s + y * c }));
}

const path2d = new Map();
function P(d) {
  let p = path2d.get(d);
  if (!p) {
    p = new Path2D(d);
    if (path2d.size > 2000) path2d.clear();
    path2d.set(d, p);
  }
  return p;
}

function finishColor(f) {
  // three.js reads roughness from G and metalness from B
  return `rgb(0, ${Math.round(f.rough * 255)}, ${Math.round(f.metal * 255)})`;
}

let scratch;
function maskedImage(img, w, h, fill) {
  scratch ||= document.createElement('canvas');
  const cw = Math.max(1, Math.min(2048, Math.round(w))), ch = Math.max(1, Math.min(2048, Math.round(h)));
  scratch.width = cw;
  scratch.height = ch;
  const c = scratch.getContext('2d');
  c.clearRect(0, 0, cw, ch);
  c.drawImage(img, 0, 0, cw, ch);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = fill;
  c.fillRect(0, 0, cw, ch);
  c.globalCompositeOperation = 'source-over';
  return scratch;
}

// Draw a design's artwork centred on the origin of ctx (units: cm).
// mode 'color' paints the artwork; 'finish' paints its roughness/metalness signature.
export function drawArt(ctx, d, mode = 'color', pxPerCm = 16) {
  const art = artFor(d);
  const [vx, vy, vw, vh] = art.viewBox;
  const { w, h } = designSize(d);
  ctx.save();
  ctx.rotate((d.rot * Math.PI) / 180);
  if (d.flip) ctx.scale(-1, 1);
  if (art.image) {
    if (art.image.complete && art.image.naturalWidth) {
      const finish = FINISHES[d.finish] || FINISHES.dtf;
      if (mode === 'finish') ctx.drawImage(maskedImage(art.image, w * pxPerCm, h * pxPerCm, finishColor(finish)), -w / 2, -h / 2, w, h);
      else if (d.recolor) ctx.drawImage(maskedImage(art.image, w * pxPerCm, h * pxPerCm, d.color), -w / 2, -h / 2, w, h);
      else ctx.drawImage(art.image, -w / 2, -h / 2, w, h);
    }
  } else {
    ctx.scale(w / vw, h / vh);
    ctx.translate(-vx - vw / 2, -vy - vh / 2);
    const fin = finishColor(FINISHES[d.finish] || FINISHES.matte);
    for (const p of art.paths) {
      if (mode === 'finish') ctx.fillStyle = fin;
      else ctx.fillStyle = p.fill === 'color' ? d.color : p.fill === 'color2' ? d.color2 || d.color : p.fill;
      ctx.fill(P(p.d), p.rule);
    }
  }
  ctx.restore();
}

// Draw a design onto the flat layout (ctx maps layout cm to pixels). Art is drawn again one
// circumference to either side so anything crossing the strip's ends wraps round the body.
export function drawDesign(ctx, d, layout, mode = 'color', pxPerCm = 16, { wrap = true } = {}) {
  const at = layout.toAtlas(d.panel, d.x, d.y);
  for (const off of wrap ? [0, -layout.period, layout.period] : [0]) {
    ctx.save();
    ctx.translate(at.x + off, at.y);
    drawArt(ctx, d, mode, pxPerCm);
    ctx.restore();
  }
}

export function fillFinish(ctx, f = FABRIC_FINISH) {
  ctx.fillStyle = finishColor(f);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// SVG fragment for one design in panel coordinates (cm). `only` limits output to one colour
// slot ('color' or 'color2') for per-colour cut files.
export function designSVG(d, { only = null, solid = null } = {}) {
  const art = artFor(d);
  const [vx, vy, vw, vh] = art.viewBox;
  const { w, h } = designSize(d);
  const r = (n) => +n.toFixed(4);
  let body = '';
  if (art.image) {
    body = `<image href="${esc(d.src)}" x="${r(-w / 2)}" y="${r(-h / 2)}" width="${r(w)}" height="${r(h)}" preserveAspectRatio="none"/>`;
  } else {
    const paths = art.paths
      .filter((p) => !only || p.fill === only || (only === 'color' && !d.color2 && p.fill === 'color2'))
      .map((p) => {
        const fill = solid || (p.fill === 'color' ? d.color : p.fill === 'color2' ? d.color2 || d.color : p.fill);
        return `<path d="${p.d}" fill="${fill}" fill-rule="${p.rule}"/>`;
      })
      .join('');
    if (!paths) return '';
    body = `<g transform="scale(${r(w / vw)} ${r(h / vh)}) translate(${r(-vx - vw / 2)} ${r(-vy - vh / 2)})">${paths}</g>`;
  }
  return `<g transform="translate(${r(d.x)} ${r(d.y)}) rotate(${r(d.rot)})${d.flip ? ' scale(-1 1)' : ''}">${body}</g>`;
}
