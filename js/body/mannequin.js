// The mannequin: Blender Studio's realistic male base mesh (CC0), scaled to a 183 cm runner with
// a 99 cm chest and baked by tools/bake_body.py into a display mesh plus signed distance grids
// around the torso, which the cloth drape collides with.

export async function loadBody(base = 'assets/body/runner') {
  const [meta, buf] = await Promise.all([
    fetch(base + '.json').then((r) => {
      if (!r.ok) throw new Error(`mannequin data missing (${r.status})`);
      return r.json();
    }),
    fetch(base + '.bin').then((r) => {
      if (!r.ok) throw new Error(`mannequin mesh missing (${r.status})`);
      return r.arrayBuffer();
    }),
  ]);
  const blob = (name, Type) => {
    const [offset, length] = meta.blobs[name];
    return new Type(buf, offset, length / Type.BYTES_PER_ELEMENT);
  };

  const q = blob('positions', Int16Array);
  const { positionMin: lo, positionSpan: span } = meta.mesh;
  const positions = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) positions[i] = lo[i % 3] + ((q[i] + 32768) / 65535) * span[i % 3];
  const indices = blob('indices', meta.mesh.indexType === 'uint16' ? Uint16Array : Uint32Array);

  const [nx, ny, nz] = meta.sdf.size;
  const grid = (name) => {
    const raw = blob(name, Int16Array);
    const data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i] * meta.sdf.scale;
    return { data, nx, ny, nz, min: meta.sdf.min, step: meta.sdf.step };
  };
  // `grid` is the body as displayed; `dressGrid` has the arms up, for sewing the shirt on
  return { mesh: { positions, indices, normals: null }, grid: grid('sdf'), dressGrid: grid('sdfDress'), measures: meta.measures, source: meta.source };
}

// Trilinear lookup with gradient. Writes [d, gx, gy, gz] into `out`. Outside the grid -> far away.
export function gridSample(g, px, py, pz, out) {
  const fx = (px - g.min[0]) / g.step, fy = (py - g.min[1]) / g.step, fz = (pz - g.min[2]) / g.step;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= g.nx - 1 || iy >= g.ny - 1 || iz >= g.nz - 1) {
    out[0] = 1e3;
    return out;
  }
  const tx = fx - ix, ty = fy - iy, tz = fz - iz;
  const { nx, ny, data } = g;
  const i000 = ix + nx * (iy + ny * iz);
  const sy = nx, sz = nx * ny;
  const c000 = data[i000], c100 = data[i000 + 1], c010 = data[i000 + sy], c110 = data[i000 + sy + 1];
  const c001 = data[i000 + sz], c101 = data[i000 + sz + 1], c011 = data[i000 + sy + sz], c111 = data[i000 + sy + sz + 1];
  const c00 = c000 + (c100 - c000) * tx, c10 = c010 + (c110 - c010) * tx;
  const c01 = c001 + (c101 - c001) * tx, c11 = c011 + (c111 - c011) * tx;
  const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
  out[0] = c0 + (c1 - c0) * tz;
  // analytic gradient of the trilinear interpolant
  const dx0 = (c100 - c000) * (1 - ty) + (c110 - c010) * ty;
  const dx1 = (c101 - c001) * (1 - ty) + (c111 - c011) * ty;
  out[1] = (dx0 + (dx1 - dx0) * tz) / g.step;
  out[2] = ((c10 - c00) * (1 - tz) + (c11 - c01) * tz) / g.step;
  out[3] = (c1 - c0) / g.step;
  return out;
}
