// Motif registry. Design packs (js/designs/) register their motifs at startup; everything else
// looks motifs up here by key.

import { ArtBuilder } from './shapes.js';

export const MOTIFS = {};
const cache = new Map();

export function registerMotifs(defs) {
  Object.assign(MOTIFS, defs);
  cache.clear();
}

// A dashed box stands in for a motif this copy of the app doesn't have (say, a project saved
// with a private design pack and opened without it), so the layout still opens.
function missing() {
  const b = new ArtBuilder();
  for (let i = 0; i < 8; i++) {
    const x = i * 25;
    b.poly([[x, 0], [x + 15, 0], [x + 15, 3], [x, 3]]);
    b.poly([[x, 97], [x + 15, 97], [x + 15, 100], [x, 100]]);
  }
  for (let i = 0; i < 4; i++) {
    const y = i * 25;
    b.poly([[0, y], [3, y], [3, y + 15], [0, y + 15]]);
    b.poly([[197, y], [200, y], [200, y + 15], [197, y + 15]]);
  }
  return b.build(0);
}

export function motifArt(key, seed = 1) {
  const id = `${key}|${seed}`;
  if (!cache.has(id)) {
    if (cache.size > 60) cache.clear();
    cache.set(id, MOTIFS[key] ? MOTIFS[key].build(seed) : missing());
  }
  return cache.get(id);
}
