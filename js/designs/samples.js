// Sample design pack: deliberately plain placeholder artwork so a fresh clone has something to
// play with. Your own motifs and starting layout go in js/designs/local/index.js (git-ignored),
// which uses the same shape as this file and takes precedence when present.
//
// A motif is { name, colors (1 or 2), build(seed) -> { paths, viewBox } }. Paths fill with
// 'color' (main colour), 'color2' (accent) or a literal colour. Optional: `width` (starting
// width in cm when added from the tray), `generative`
// (build uses the seed; the inspector gets a "New pattern" button) and `pair` (the tray adds one
// down each side seam).

import { ArtBuilder, sub } from '../art/shapes.js';
import { textOnCircle, font } from '../art/text.js';

function stripes() {
  const b = new ArtBuilder();
  for (let i = 0; i < 3; i++) b.poly([[0, i * 14], [400, i * 14], [400, i * 14 + 6], [0, i * 14 + 6]], i === 1 ? 'color2' : 'color');
  return b.build(0);
}

function starPoints(cx, cy, r, inner = 0.45, n = 5) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 ? r * inner : r;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  });
}

function star() {
  return new ArtBuilder().poly(starPoints(0, 0, 50)).build(1);
}

function badge() {
  const b = new ArtBuilder();
  b.compound([sub.circle(0, 0, 100), sub.circle(0, 0, 94)], 'color');
  b.compound([sub.circle(0, 0, 66), sub.circle(0, 0, 62.5)], 'color');
  const cap = (size) => ((font('archivo').tables.os2?.sCapHeight || 700) / font('archivo').unitsPerEm) * size;
  textOnCircle(b, { text: 'YOUR CLUB NAME', font: 'archivo', size: 17, radius: 80 - cap(17) / 2, spacing: 90 });
  textOnCircle(b, { text: 'SAMPLE', font: 'archivo', size: 15, radius: 80 + cap(15) / 2, bottom: true, spacing: 160 });
  b.poly(starPoints(0, 2, 40), 'color2');
  return b.build(1);
}

const white = '#f4f4f1', green = '#4f9a5b', silver = '#aeb2b5';

export default {
  name: 'Samples',
  motifs: {
    badge: { name: 'Club badge', colors: 2, build: badge },
    star: { name: 'Star', colors: 1, build: star },
    lanes: { name: 'Lane stripes', colors: 2, build: stripes, width: 40 },
  },
  // positioned for a size L Miler Base Singlet: x = cm from the centre line, y = cm below HPS
  defaultDesigns: () => [
    { kind: 'text', name: 'Chest arch', text: 'YOUR CLUB', font: 'graduate', spacing: 60, arc: 24, panel: 'front', x: 0, y: 18.6, w: 25, rot: 0, color: white, finish: 'matte' },
    { kind: 'text', name: 'Chest sub-line', text: 'RUN CLUB', font: 'graduate', spacing: 260, arc: 0, panel: 'front', x: 0, y: 24.1, w: 13, rot: 0, color: white, finish: 'matte' },
    // wraps round the wearer's left side, from the front onto the back
    { kind: 'motif', name: 'Side stripes', motif: 'lanes', panel: 'front', x: 27, y: 42, w: 36, rot: 0, color: white, color2: green, finish: 'matte' },
    { kind: 'motif', name: 'Back badge', motif: 'badge', panel: 'back', x: 0, y: 19.5, w: 16.5, rot: 0, color: white, color2: green, finish: 'matte' },
    { kind: 'text', name: 'Back text', text: 'BACK PRINT\nGOES HERE', font: 'anton', spacing: 30, arc: 0, lineHeight: 1.08, panel: 'back', x: 0, y: 50, w: 18, rot: 0, color: silver, finish: 'reflective' },
  ],
};
