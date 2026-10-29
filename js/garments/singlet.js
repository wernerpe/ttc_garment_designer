// Miler Running "Base Running Singlet" (style 711) as a parametric flat pattern.
//
// Source: milerrunning.com/products/base-running-singlet size guide (chest A, length B, inches).
// Chest is the full circumference of the garment at the underarm; length is HPS (high point
// shoulder, where the strap meets the neckline) down to the lowest point of the curved hem.
// Everything else (neck, straps, armhole, racer back, hem curve, logo position) is estimated from
// the product photos, which are ghost-mannequin shots rather than flat lays, so treat those as
// "close, verify with a tape measure". Edit DETAILS below once you've measured your own shirt.
//
// Pattern coordinates: centimetres, x = 0 on the centre line, +x to the viewer's right when looking
// at the OUTSIDE of that panel; y = 0 at the HPS line, +y downwards. Both panels are finished
// shapes (no seam allowance) because that is what you print on.

import { pt, densify, polylineLength, resample } from '../geometry/curves.js';

export const IN = 2.54;

export const SIZE_CHART = {
  S: { chest: 37.5, length: 27 },
  M: { chest: 40, length: 27.5 },
  L: { chest: 42.5, length: 28 },
  XL: { chest: 45, length: 28.75 },
};
export const SIZES = Object.keys(SIZE_CHART);

export const COLORS = {
  Black: '#141414',
  Navy: '#1d2433',
  Bluestone: '#7d8b96',
  Limestone: '#cfc8b8',
  White: '#f2f2ef',
};

// Estimated detail measurements for size L (cm) and the change per size step.
const DETAILS = {
  neckWidth: [19.0, 0.5], // HPS to HPS, straight across
  frontNeckDrop: [13.0, 0.4], // HPS line down to centre-front neckline
  backNeckDrop: [5.5, 0.2],
  strapWidth: [6.0, 0.2], // shoulder seam, horizontal span
  shoulderDrop: [1.5, 0.0], // shoulder seam slope over the strap width
  armholeDepth: [26.0, 0.75], // HPS line down to underarm / top of side seam
  frontStrapOut: [0.8, 0.0], // how far the front armhole bulges out below the shoulder
  racerX: [11.0, 0.4], // back armhole: narrowest point from centre back (racer back)
  hemRise: [5.5, 0.15], // side seam ends this much higher than the centre hem (shirttail curve)
  logoDrop: [30.0, 0.75], // centre of the reflective MILER RUNNING logo below the HPS line
  logoWidth: [11.5, 0.0],
};

export function measurements(size = 'L') {
  const step = SIZES.indexOf(size) - SIZES.indexOf('L');
  const m = {};
  for (const [k, [base, grade]] of Object.entries(DETAILS)) m[k] = +(base + grade * step).toFixed(2);
  const { chest, length } = SIZE_CHART[size];
  m.chestCirc = chest * IN;
  m.halfChest = m.chestCirc / 4; // centre line to side seam on each panel
  m.length = length * IN;
  m.size = size;
  return m;
}

// Each panel is a closed outline made of named edges; seams are edges that get sewn together.
function panelEdges(m, side) {
  const hx = m.neckWidth / 2;
  const sp = pt(hx + m.strapWidth, m.shoulderDrop);
  const hps = pt(hx, 0);
  const cw = m.halfChest;
  const ad = m.armholeDepth;
  const L = m.length;
  const sideBottom = pt(cw, L - m.hemRise);
  const under = pt(cw, ad);
  const midY = sp.y + (ad - sp.y) * 0.5;

  let neck, armhole;
  if (side === 'front') {
    const nd = m.frontNeckDrop;
    neck = [{ cubic: [pt(0, nd), pt(hx * 0.48, nd), pt(hx - 0.4, nd * 0.62), hps] }];
    const mid = pt(sp.x + m.frontStrapOut, midY);
    armhole = [
      { cubic: [sp, pt(sp.x + 0.1, sp.y + (mid.y - sp.y) * 0.33), pt(mid.x - 0.3, mid.y - (mid.y - sp.y) * 0.3), mid] },
      { cubic: [mid, pt(mid.x + 0.6, mid.y + (ad - mid.y) * 0.55), pt(cw - (cw - mid.x) * 0.55, ad), under] },
    ];
  } else {
    const nd = m.backNeckDrop;
    neck = [{ cubic: [pt(0, nd), pt(hx * 0.45, nd), pt(hx - 0.8, nd * 0.72), hps] }];
    const r = pt(m.racerX, midY);
    armhole = [
      { cubic: [sp, pt(sp.x - 0.8, sp.y + 3.5), pt(r.x + 0.6, r.y - 4.5), r] },
      { cubic: [r, pt(r.x - 0.6, r.y + 4.5), pt(cw - (cw - r.x) * 0.6, ad), under] },
    ];
  }
  // Right half, walking clockwise on screen from the centre neck point.
  return [
    { name: 'neck', pieces: neck },
    { name: 'shoulder', pieces: [{ line: [hps, sp] }], seam: true },
    { name: 'armhole', pieces: armhole },
    { name: 'side', pieces: [{ line: [under, sideBottom] }], seam: true },
    { name: 'hem', pieces: [{ cubic: [sideBottom, pt(cw - 3, sideBottom.y + 2.5), pt(cw * 0.45, L), pt(0, L)] }] },
  ];
}

const mirror = (p) => pt(-p.x, p.y);

// Build both panels sampled at roughly `spacing` cm along every edge. Seams are sampled with the
// same count on both panels so vertices pair up one-to-one.
export function buildSinglet(size = 'L', spacing = 1.5) {
  const m = measurements(size);
  const panels = {};
  for (const side of ['front', 'back']) {
    const edges = panelEdges(m, side);
    const right = [];
    const edgeRanges = {};
    for (const edge of edges) {
      const poly = densify(edge.pieces);
      const n = Math.max(2, Math.round(polylineLength(poly) / spacing));
      const samples = resample(poly, n);
      const start = right.length === 0 ? 0 : right.length - 1;
      if (right.length) samples.shift();
      right.push(...samples);
      edgeRanges[edge.name] = [start, right.length - 1];
    }
    // right: CF/CB neck point ... down to CF/CB hem point. Mirror for the left half.
    const left = right.slice(1, -1).reverse().map(mirror);
    // `outline` order: right half top->bottom, then left half bottom->top (closed loop).
    const outline = [...right, ...left];
    const leftStartIdx = right.length; // index of first left point (next to the hem centre)
    const nRight = right.length;
    const leftIndexOf = (i) => leftStartIdx + (nRight - 2 - i); // mirror of right index i (0<i<nRight-1)
    const seams = {};
    for (const edge of edges.filter((e) => e.seam)) {
      const [a, b] = edgeRanges[edge.name];
      const idxR = [], idxL = [];
      for (let i = a; i <= b; i++) {
        idxR.push(i);
        idxL.push(leftIndexOf(i));
      }
      // ordered from the neck/top end of the seam to the other end
      seams[edge.name + 'R'] = idxR;
      seams[edge.name + 'L'] = idxL;
    }
    panels[side] = { side, outline, seams, edgeRanges };
  }

  // The wearer's left side is the viewer's right on the front panel but the viewer's left on the
  // back panel (both are seen from outside), so front-R sews to back-L and vice versa.
  const seams = [
    { a: ['front', 'shoulderR'], b: ['back', 'shoulderL'] },
    { a: ['front', 'shoulderL'], b: ['back', 'shoulderR'] },
    { a: ['front', 'sideR'], b: ['back', 'sideL'] },
    { a: ['front', 'sideL'], b: ['back', 'sideR'] },
  ];

  const landmarks = {
    underarmY: m.armholeDepth,
    logo: { panel: 'front', x: 0, y: m.logoDrop, width: m.logoWidth, height: 1.1, text: 'MILER RUNNING' },
  };
  return { size, m, panels, seams, landmarks, layout: makeLayout(m) };
}

// Flat layout shared by the mat, the 3D texture and the exports: the two pieces side by side,
// joined along the wearer's left side seam, so the strip runs all the way round the body. The
// wearer's right side seam sits at both ends of the strip; art that crosses it wraps to the other
// end. Units are cm from the strip's top-left corner.
export function makeLayout(m) {
  const hc = m.halfChest;
  const margin = 4;
  const top = -3;
  const bottom = Math.ceil(m.length + 3);
  const x0 = margin + hc; // centre front
  const period = 4 * hc; // once round the body at the chest
  return {
    hc,
    period,
    top,
    x0,
    width: period + 2 * margin,
    height: bottom - top,
    centre(panel) {
      return x0 + (panel === 'front' ? 0 : 2 * hc);
    },
    toAtlas(panel, x, y) {
      return { x: this.centre(panel) + x, y: y - top };
    },
    // Which piece lies under an atlas point, wrapping round the right side seam.
    fromAtlas(ax, ay) {
      const s = ((((ax - x0 + hc) % period) + period) % period) - hc; // -hc .. 3hc
      return s < hc ? { panel: 'front', x: s, y: ay + top } : { panel: 'back', x: s - 2 * hc, y: ay + top };
    },
    // The same point expressed on whichever piece it actually lands on.
    locate(panel, x, y) {
      const a = this.toAtlas(panel, x, y);
      return this.fromAtlas(a.x, a.y);
    },
  };
}
