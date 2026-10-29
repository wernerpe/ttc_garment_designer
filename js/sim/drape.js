// Virtual sewing + draping of flat pattern panels onto the mannequin, Marvelous-Designer style but
// tiny: panels are triangulated in 2D, wrapped loosely around the body, seams are pulled shut and
// the cloth settles under gravity with position-based dynamics (small substeps, one Gauss-Seidel
// pass each) against the mannequin's SDF grid. The 2D pattern coordinates ride along as UVs, which
// is what lets the flat editor and the 3D view share one texture.

import Delaunator from '../../vendor/delaunator/delaunator.js';
import { pointInPolygon, distToPolygon, bounds } from '../geometry/curves.js';
import { gridSample } from '../body/mannequin.js';

function triangulatePanel(outline, spacing) {
  const pts = outline.map((p) => [p.x, p.y]);
  const b = bounds(outline);
  const dy = spacing * Math.sqrt(3) / 2;
  let row = 0;
  for (let y = b.minY + dy * 0.5; y < b.maxY; y += dy, row++) {
    for (let x = b.minX + (row % 2 ? spacing / 2 : 0); x < b.maxX; x += spacing) {
      const p = { x, y };
      if (pointInPolygon(p, outline) && distToPolygon(p, outline) > spacing * 0.6) pts.push([x, y]);
    }
  }
  const del = Delaunator.from(pts);
  const tris = [];
  const t = del.triangles;
  for (let i = 0; i < t.length; i += 3) {
    const a = pts[t[i]], bb = pts[t[i + 1]], c = pts[t[i + 2]];
    const cen = { x: (a[0] + bb[0] + c[0]) / 3, y: (a[1] + bb[1] + c[1]) / 3 };
    if (!pointInPolygon(cen, outline)) continue;
    // drop slivers that bridge across the boundary
    const cross = (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) < spacing * spacing * 0.02) continue;
    // orient so the 2D cross product is negative: that makes the outside of the shirt the front face
    if (cross > 0) tris.push(t[i], t[i + 2], t[i + 1]);
    else tris.push(t[i], t[i + 1], t[i + 2]);
  }
  return { pts, tris };
}

// Arc-length parametrised ellipse (x = a sin θ, z = b cos θ), θ = 0 at the front.
function ellipseWalker(a, b) {
  const N = 2048;
  const s = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const t0 = ((i - 1) / N) * Math.PI * 2, t1 = (i / N) * Math.PI * 2;
    s[i] = s[i - 1] + Math.hypot(a * (Math.sin(t1) - Math.sin(t0)), b * (Math.cos(t1) - Math.cos(t0)));
  }
  const C = s[N];
  return {
    C,
    at(arc) {
      let u = ((arc % C) + C) % C;
      let lo = 0, hi = N;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (s[mid] < u) lo = mid; else hi = mid;
      }
      const f = (u - s[lo]) / (s[hi] - s[lo] || 1);
      const th = ((lo + f) / N) * Math.PI * 2;
      return [a * Math.sin(th), b * Math.cos(th)];
    },
  };
}

export function buildCloth(garment, spacing = 1.5) {
  const panelOrder = ['front', 'back'];
  const panels = [];
  const uv2d = []; // pattern coords
  const indices = [];
  const panelOf = [];
  let offset = 0;
  for (const side of panelOrder) {
    const p = garment.panels[side];
    const { pts, tris } = triangulatePanel(p.outline, spacing);
    for (const q of pts) {
      uv2d.push(q[0], q[1]);
      panelOf.push(side === 'front' ? 0 : 1);
    }
    for (const i of tris) indices.push(i + offset);
    panels.push({ side, offset, count: pts.length, triStart: indices.length - tris.length, triCount: tris.length / 3 });
    offset += pts.length;
  }
  const n = offset;
  const pidx = (side, local) => garment.panels[side] && panels.find((q) => q.side === side).offset + local;

  const seamPairs = [];
  for (const s of garment.seams) {
    const A = garment.panels[s.a[0]].seams[s.a[1]];
    const B = garment.panels[s.b[0]].seams[s.b[1]];
    if (A.length !== B.length) throw new Error(`seam length mismatch ${s.a} ${s.b}`);
    for (let i = 0; i < A.length; i++) seamPairs.push(pidx(s.a[0], A[i]), pidx(s.b[0], B[i]));
  }

  // unique edges + bending pairs (opposite vertices of adjacent triangles)
  const edgeMap = new Map();
  const stretch = [];
  const bend = [];
  const key = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)], c = indices[t + ((e + 2) % 3)];
      const k = key(a, b);
      const other = edgeMap.get(k);
      if (other === undefined) {
        edgeMap.set(k, c);
        stretch.push(a, b);
      } else if (other >= 0) {
        bend.push(other, c);
        edgeMap.set(k, -1);
      }
    }
  }
  const rest = (list) => {
    const r = new Float32Array(list.length / 2);
    for (let i = 0; i < list.length; i += 2) {
      const a = list[i], b = list[i + 1];
      r[i / 2] = Math.hypot(uv2d[2 * a] - uv2d[2 * b], uv2d[2 * a + 1] - uv2d[2 * b + 1]);
    }
    return r;
  };

  return {
    n,
    panels,
    uv2d: new Float32Array(uv2d),
    panelOf: new Uint8Array(panelOf),
    indices: new Uint32Array(indices),
    stretch: new Uint32Array(stretch),
    stretchRest: rest(stretch),
    bend: new Uint32Array(bend),
    bendRest: rest(bend),
    seamPairs: new Uint32Array(seamPairs),
  };
}

// Wrap the panels around an elliptical cylinder clear of the body: as wide as the garment's chest
// but deeper front to back, so the pieces start outside the chest, shoulder blades and seat with
// open side seams that the sewing step then pulls shut.
export function initialPositions(cloth, garment, topY = 158, zCenter = 0, depth = 1.4) {
  const circ = garment.m.halfChest * 4;
  // pick a, b with aspect 1.46 whose perimeter matches the chest circumference
  let a = 20, b = 13.7;
  for (let i = 0; i < 30; i++) {
    const per = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const k = circ / per;
    a *= k; b *= k;
  }
  const walk = ellipseWalker(a, b * depth);
  const pos = new Float32Array(cloth.n * 3);
  for (let i = 0; i < cloth.n; i++) {
    const x = cloth.uv2d[2 * i], y = cloth.uv2d[2 * i + 1];
    // front: +x on the pattern runs toward the mannequin's left (+X); back is seen from behind so
    // its +x runs toward the mannequin's right, i.e. further around past centre back.
    const arc = cloth.panelOf[i] === 0 ? x : walk.C / 2 + x;
    const [X, Z] = walk.at(arc);
    pos[3 * i] = X;
    pos[3 * i + 1] = topY - y;
    pos[3 * i + 2] = Z + zCenter;
  }
  return pos;
}

// `grids` is { grid, dressGrid }: the shirt is sewn on against dressGrid (arms raised out of the
// way), then the collision body blends to grid, lowering the arms into the armholes.
export function createDrape(cloth, grids, pos, opts = {}) {
  const o = {
    frames: 260,
    substeps: 14,
    sewFrames: 90,
    armsDown: [110, 170], // frames over which the arms come down
    dt: 1 / 60,
    gravity: -981,
    thickness: 0.45,
    friction: 0.55,
    bendStiffness: 0.08,
    damping: 0.995,
    ...opts,
  };
  const n = cloth.n;
  const prev = new Float32Array(pos);
  const seamStart = new Float32Array(cloth.seamPairs.length / 2);
  for (let i = 0; i < cloth.seamPairs.length; i += 2) {
    const a = cloth.seamPairs[i] * 3, b = cloth.seamPairs[i + 1] * 3;
    seamStart[i / 2] = Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
  }
  const s = new Float32Array(4);
  const s2 = new Float32Array(4);
  let frame = 0;
  let armBlend = 0; // 0 = dressing pose, 1 = display pose

  function project(list, restArr, k, compressK = k) {
    for (let i = 0, j = 0; i < list.length; i += 2, j++) {
      const a = list[i] * 3, b = list[i + 1] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      const r = restArr[j];
      const kk = d > r ? k : compressK;
      const f = ((d - r) / d) * 0.5 * kk;
      pos[a] += dx * f; pos[a + 1] += dy * f; pos[a + 2] += dz * f;
      pos[b] -= dx * f; pos[b + 1] -= dy * f; pos[b + 2] -= dz * f;
    }
  }

  function collide() {
    const th = o.thickness;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (armBlend >= 1) gridSample(grids.grid, pos[k], pos[k + 1], pos[k + 2], s);
      else {
        gridSample(grids.dressGrid, pos[k], pos[k + 1], pos[k + 2], s);
        if (armBlend > 0) {
          gridSample(grids.grid, pos[k], pos[k + 1], pos[k + 2], s2);
          for (let c = 0; c < 4; c++) s[c] += (s2[c] - s[c]) * armBlend;
        }
      }
      if (s[0] >= th) continue;
      let gx = s[1], gy = s[2], gz = s[3];
      const gl = Math.hypot(gx, gy, gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      const push = th - s[0];
      pos[k] += gx * push; pos[k + 1] += gy * push; pos[k + 2] += gz * push;
      // friction: bleed off tangential motion since the last substep
      const vx = pos[k] - prev[k], vy = pos[k + 1] - prev[k + 1], vz = pos[k + 2] - prev[k + 2];
      const vn = vx * gx + vy * gy + vz * gz;
      const tx = vx - vn * gx, ty = vy - vn * gy, tz = vz - vn * gz;
      prev[k] += tx * o.friction; prev[k + 1] += ty * o.friction; prev[k + 2] += tz * o.friction;
    }
  }

  const seamRest = new Float32Array(seamStart.length);
  function substep(h, damping, gravityScale) {
    const g = o.gravity * gravityScale * h * h;
    for (let k = 0; k < n * 3; k += 3) {
      const vx = (pos[k] - prev[k]) * damping, vy = (pos[k + 1] - prev[k + 1]) * damping, vz = (pos[k + 2] - prev[k + 2]) * damping;
      prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
      pos[k] += vx; pos[k + 1] += vy + g; pos[k + 2] += vz;
    }
    project(cloth.seamPairs, seamRest, 1);
    project(cloth.stretch, cloth.stretchRest, 1, 0.6);
    project(cloth.bend, cloth.bendRest, o.bendStiffness, o.bendStiffness * 0.5);
    collide();
  }

  return {
    get progress() { return frame / o.frames; },
    get done() { return frame >= o.frames; },
    positions: pos,
    step(frames = 1) {
      for (let f = 0; f < frames && frame < o.frames; f++, frame++) {
        const sew = Math.min(1, frame / o.sewFrames);
        const ease = 1 - (1 - sew) * (1 - sew);
        for (let i = 0; i < seamRest.length; i++) seamRest[i] = seamStart[i] * (1 - ease);
        // heavier damping as we approach the end so the cloth comes to rest
        const [a0, a1] = o.armsDown;
        armBlend = Math.min(1, Math.max(0, (frame - a0) / (a1 - a0)));
        const settle = frame / o.frames;
        const damping = o.damping - 0.04 * settle * settle;
        // float while the seams close, then let gravity seat the shirt on the shoulders
        const gravityScale = Math.min(1, Math.max(0, (frame - o.sewFrames * 0.8) / 30));
        const h = o.dt / o.substeps;
        for (let sstep = 0; sstep < o.substeps; sstep++) substep(h, damping, gravityScale);
      }
      return frame >= o.frames;
    },
    // weld seams (both sides of a seam end up at the same point)
    finish() {
      const sp = cloth.seamPairs;
      for (let i = 0; i < sp.length; i += 2) {
        const a = sp[i] * 3, b = sp[i + 1] * 3;
        for (let c = 0; c < 3; c++) {
          const m = (pos[a + c] + pos[b + c]) / 2;
          pos[a + c] = m; pos[b + c] = m;
        }
      }
      return pos;
    },
  };
}

// Vertex normals with seam pairs sharing the averaged normal, so seams shade smoothly.
export function clothNormals(cloth, pos, out = new Float32Array(pos.length)) {
  out.fill(0);
  const I = cloth.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { out[v] += nx; out[v + 1] += ny; out[v + 2] += nz; }
  }
  const sp = cloth.seamPairs;
  for (let i = 0; i < sp.length; i += 2) {
    const a = sp[i] * 3, b = sp[i + 1] * 3;
    for (let c = 0; c < 3; c++) {
      const m = out[a + c] + out[b + c];
      out[a + c] = m; out[b + c] = m;
    }
  }
  for (let k = 0; k < out.length; k += 3) {
    const l = Math.hypot(out[k], out[k + 1], out[k + 2]) || 1;
    out[k] /= l; out[k + 1] /= l; out[k + 2] /= l;
  }
  return out;
}
