// Small 2D geometry helpers. Points are {x, y} in centimetres.

export const pt = (x, y) => ({ x, y });

export function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return pt(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y);
}

// A path is a list of pieces: { line: [a, b] } or { cubic: [p0, p1, p2, p3] }.
// densify() turns it into a fine polyline that resample() can walk by arc length.
export function densify(pieces, steps = 64) {
  const out = [];
  for (const piece of pieces) {
    if (piece.line) {
      const [a, b] = piece.line;
      if (!out.length) out.push(a);
      out.push(b);
    } else {
      const [p0, p1, p2, p3] = piece.cubic;
      if (!out.length) out.push(p0);
      for (let i = 1; i <= steps; i++) out.push(cubic(p0, p1, p2, p3, i / steps));
    }
  }
  return out;
}

export function polylineLength(poly) {
  let len = 0;
  for (let i = 1; i < poly.length; i++) len += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
  return len;
}

// Resample a polyline into `n` equal-length intervals (n + 1 points, endpoints kept).
export function resample(poly, n) {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = (total * k) / n;
    while (j < poly.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[j]) / seg));
    out.push(pt(poly[j].x + (poly[j + 1].x - poly[j].x) * t, poly[j].y + (poly[j + 1].y - poly[j].y) * t));
  }
  return out;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function distToPolygon(p, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(p, poly[j], poly[i]));
  return d;
}

export function bounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Inset a closed polygon by `d` (positive = inwards) by offsetting along vertex normals.
// Good enough for display of a safe zone on smooth outlines; not a general offsetter.
export function insetPolygon(poly, d) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area > 0 ? 1 : -1;
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    // left normal of the tangent points inwards for counter-clockwise (area > 0) polygons in y-down space
    return pt(p.x - ty * d * sign, p.y + tx * d * sign);
  });
}
