// Tiny vector toolkit: shapes become SVG path strings so the same data feeds the canvas
// (Path2D), the 3D texture and the exported cut files.

const f = (n) => +n.toFixed(2);

export function polyPath(points) {
  return 'M' + points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}

export function circlePath(cx, cy, r) {
  return ellipsePath(cx, cy, r, r);
}

export function ellipsePath(cx, cy, rx, ry) {
  return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
}

// Counter-wound circle, for holes that must also work with the nonzero fill rule.
export function circleHolePath(cx, cy, r) {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}Z`;
}

// Stadium / capsule between two points.
export function capsulePath([ax, ay], [bx, by], r) {
  const dx = bx - ax, dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * r, ny = (dx / l) * r;
  return `M${f(ax + nx)} ${f(ay + ny)}L${f(bx + nx)} ${f(by + ny)}A${f(r)} ${f(r)} 0 0 0 ${f(bx - nx)} ${f(by - ny)}L${f(ax - nx)} ${f(ay - ny)}A${f(r)} ${f(r)} 0 0 0 ${f(ax + nx)} ${f(ay + ny)}Z`;
}

export function hexPoints(cx, cy, r, rot = 0) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = rot + (Math.PI / 3) * i + Math.PI / 6;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// Sutherland–Hodgman: clip `subject` by a convex polygon `clip` (both [[x, y], ...]).
export function clipConvex(subject, clip) {
  let out = subject;
  const area = clip.reduce((s, p, i) => {
    const q = clip[(i + 1) % clip.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const inside = (p, a, b) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * Math.sign(area) >= 0;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pin = inside(p, a, b), qin = inside(q, a, b);
      if (pin) out.push(p);
      if (pin !== qin) {
        const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1];
        const x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4) || 1e-9;
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
        out.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
      }
    }
  }
  return out;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// Bounding-box bookkeeping so artwork knows its own extent without parsing path strings.
export function emptyBox() {
  return [Infinity, Infinity, -Infinity, -Infinity];
}

export function growBox(box, x0, y0, x1 = x0, y1 = y0) {
  if (x0 < box[0]) box[0] = x0;
  if (y0 < box[1]) box[1] = y0;
  if (x1 > box[2]) box[2] = x1;
  if (y1 > box[3]) box[3] = y1;
  return box;
}

// Collects shapes for one piece of artwork. `fill` is 'color' (main colour), 'color2'
// (accent) or a literal CSS colour; `rule` is the canvas/SVG fill rule.
export class ArtBuilder {
  constructor() {
    this.paths = [];
    this.box = emptyBox();
  }
  add(d, box, fill = 'color', rule = 'nonzero') {
    this.paths.push({ d, fill, rule });
    growBox(this.box, box[0], box[1], box[2], box[3]);
    return this;
  }
  poly(points, fill, rule) {
    const b = emptyBox();
    for (const [x, y] of points) growBox(b, x, y);
    return this.add(polyPath(points), b, fill, rule);
  }
  circle(cx, cy, r, fill, rule) {
    return this.add(circlePath(cx, cy, r), [cx - r, cy - r, cx + r, cy + r], fill, rule);
  }
  ellipse(cx, cy, rx, ry, fill, rule) {
    return this.add(ellipsePath(cx, cy, rx, ry), [cx - rx, cy - ry, cx + rx, cy + ry], fill, rule);
  }
  capsule(a, b, r, fill, rule) {
    return this.add(capsulePath(a, b, r), [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r], fill, rule);
  }
  // Group several subpaths into one compound path (evenodd makes inner rings into holes).
  compound(parts, fill, rule = 'evenodd') {
    const b = emptyBox();
    for (const p of parts) growBox(b, p.box[0], p.box[1], p.box[2], p.box[3]);
    return this.add(parts.map((p) => p.d).join(''), b, fill, rule);
  }
  build(padding = 0) {
    const [x0, y0, x1, y1] = this.box;
    return { paths: this.paths, viewBox: [x0 - padding, y0 - padding, x1 - x0 + 2 * padding, y1 - y0 + 2 * padding] };
  }
}

export const sub = {
  poly(points) {
    const b = emptyBox();
    for (const [x, y] of points) growBox(b, x, y);
    return { d: polyPath(points), box: b };
  },
  circle(cx, cy, r) {
    return { d: circlePath(cx, cy, r), box: [cx - r, cy - r, cx + r, cy + r] };
  },
  ellipse(cx, cy, rx, ry) {
    return { d: ellipsePath(cx, cy, rx, ry), box: [cx - rx, cy - ry, cx + rx, cy + ry] };
  },
};
