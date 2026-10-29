// Paints the texture atlas the 3D shirt wears: fabric colour, Miler's own reflective logo and
// every visible design on the joined front+back strip, so prints flow across the side seams.
// A second canvas carries the finish (roughness in G, metalness in B) so vinyl reads differently
// from the mesh fabric.

import { COLORS } from './garments/singlet.js';
import { drawDesign, fillFinish, FABRIC_FINISH } from './art/render.js';

export function panelPath(garment, side) {
  const p = new Path2D();
  garment.panels[side].outline.forEach((q, i) => {
    const a = garment.layout.toAtlas(side, q.x, q.y);
    if (i) p.lineTo(a.x, a.y);
    else p.moveTo(a.x, a.y);
  });
  p.closePath();
  return p;
}

export function milerLogo(garment) {
  const l = garment.landmarks.logo;
  return { kind: 'text', text: l.text, font: 'archivo', spacing: 60, arc: 0, panel: l.panel, x: l.x, y: l.y, w: l.width, rot: 0, color: '#5b5d5f', finish: 'reflective' };
}

export class Compositor {
  constructor(pxPerCm = 16) {
    this.k = pxPerCm;
    this.color = document.createElement('canvas');
    this.finish = document.createElement('canvas');
  }

  // Size the canvases for a garment's layout; returns true when they changed size.
  setLayout(layout) {
    const w = Math.round(layout.width * this.k), h = Math.round(layout.height * this.k);
    if (this.color.width === w && this.color.height === h) return false;
    for (const c of [this.color, this.finish]) {
      c.width = w;
      c.height = h;
    }
    return true;
  }

  render(state, garment) {
    const k = this.k;
    const { layout } = garment;
    const fabric = COLORS[state.garment.color] || COLORS.Black;
    const c = this.color.getContext('2d');
    const f = this.finish.getContext('2d');
    for (const ctx of [c, f]) ctx.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = fabric;
    c.fillRect(0, 0, layout.width, layout.height);
    fillFinish(f, FABRIC_FINISH);
    f.fillRect(0, 0, layout.width, layout.height);

    // Nothing is clipped: only the parts of the atlas inside the pieces end up on the shirt, and
    // leaving art unclipped keeps texture filtering seamless across the joins.
    const items = [milerLogo(garment), ...state.designs.filter((d) => d.visible)];
    for (const d of items) {
      drawDesign(c, d, layout, 'color', k);
      drawDesign(f, d, layout, 'finish', k);
    }
  }
}
