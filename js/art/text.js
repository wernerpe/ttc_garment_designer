// Text -> vector outlines with opentype.js, including text on an arc. Output is plain path data,
// so exported cut files never depend on fonts being installed.

import opentype from '../../vendor/opentype/opentype.module.js';
import { emptyBox, growBox } from './shapes.js';

export const FONTS = {
  graduate: { name: 'Graduate (varsity)', file: 'Graduate-Regular.ttf' },
  anton: { name: 'Anton (condensed)', file: 'Anton-Regular.ttf' },
  archivo: { name: 'Archivo Black', file: 'ArchivoBlack-Regular.ttf' },
  bebas: { name: 'Bebas Neue', file: 'BebasNeue-Regular.ttf' },
  rubikmono: { name: 'Rubik Mono One (wide)', file: 'RubikMonoOne-Regular.ttf' },
  kaushan: { name: 'Kaushan Script', file: 'KaushanScript-Regular.ttf' },
  robotomono: { name: 'Roboto Mono', file: 'RobotoMono-Regular.ttf' },
  robotomonobold: { name: 'Roboto Mono Bold', file: 'RobotoMono-Bold.ttf' },
};

const loaded = {};

export async function loadFonts(base = 'assets/fonts/') {
  await Promise.all(
    Object.entries(FONTS).map(async ([key, info]) => {
      const res = await fetch(base + info.file);
      if (!res.ok) throw new Error(`Font ${info.file} failed to load (${res.status})`);
      loaded[key] = opentype.parse(await res.arrayBuffer());
    }),
  );
  return loaded;
}

export const font = (key) => loaded[key] || loaded.archivo;

const f = (n) => +n.toFixed(2);

// Serialise opentype path commands through a point transform, growing `box` as we go.
function commandsToD(commands, tf, box) {
  let d = '';
  for (const c of commands) {
    if (c.type === 'Z') {
      d += 'Z';
      continue;
    }
    const [x, y] = tf(c.x, c.y);
    growBox(box, x, y);
    if (c.type === 'M' || c.type === 'L') d += `${c.type}${f(x)} ${f(y)}`;
    else if (c.type === 'Q') {
      const [x1, y1] = tf(c.x1, c.y1);
      d += `Q${f(x1)} ${f(y1)} ${f(x)} ${f(y)}`;
    } else if (c.type === 'C') {
      const [x1, y1] = tf(c.x1, c.y1);
      const [x2, y2] = tf(c.x2, c.y2);
      d += `C${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)}`;
    }
  }
  return d;
}

// Lay out one line: returns glyph placements along a straight baseline (units of `size`).
function layoutLine(fnt, text, size, spacing) {
  const glyphs = fnt.stringToGlyphs(text);
  const scale = size / fnt.unitsPerEm;
  const out = [];
  let x = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const adv = (g.advanceWidth || 0) * scale;
    out.push({ glyph: g, x, adv });
    x += adv + (spacing / 1000) * size;
    if (i < glyphs.length - 1) x += fnt.getKerningValue(g, glyphs[i + 1]) * scale;
  }
  const width = x - (glyphs.length ? (spacing / 1000) * size : 0);
  return { glyphs: out, width };
}

// Text art: one compound path per line. `arc` bends the text (degrees of sweep, + arches up,
// - smiles down). Lines are centred.
export function textArt({ text = 'TEXT', font: key = 'graduate', spacing = 40, arc = 0, lineHeight = 1.1 }) {
  const fnt = font(key);
  const size = 100;
  const lines = String(text).split('\n');
  const paths = [];
  const box = emptyBox();
  const capH = (fnt.tables.os2?.sCapHeight || fnt.ascender * 0.7) * (size / fnt.unitsPerEm);
  lines.forEach((line, li) => {
    const { glyphs, width } = layoutLine(fnt, line, size, spacing);
    const baseY = li * size * lineHeight;
    const lineBox = emptyBox();
    let d = '';
    const sweep = (arc * Math.PI) / 180;
    if (Math.abs(sweep) < 1e-3) {
      for (const g of glyphs) {
        const p = g.glyph.getPath(0, 0, size);
        d += commandsToD(p.commands, (x, y) => [x + g.x - width / 2, y + baseY], lineBox);
      }
    } else {
      // Radius chosen so the line's width spans `sweep` radians at the text's mid-height.
      const R = width / Math.abs(sweep);
      const dir = Math.sign(sweep);
      // arch: centre below the text; smile: centre above
      const rMid = R;
      const cy = baseY - capH / 2 + dir * rMid;
      for (const g of glyphs) {
        const mid = g.x + g.adv / 2 - width / 2;
        const theta = mid / rMid; // angle from vertical
        const p = g.glyph.getPath(-g.adv / 2, 0, size);
        const cos = Math.cos(theta), sin = Math.sin(theta);
        d += commandsToD(
          p.commands,
          (x, y) => {
            // glyph-local: x along baseline, y down. Place on circle, rotate to follow it.
            const lx = x, ly = y + capH / 2 - dir * rMid; // relative to circle centre
            const rx = lx * cos - ly * sin * dir;
            const ry = lx * sin * dir + ly * cos;
            return [rx, ry + cy];
          },
          lineBox,
        );
      }
    }
    if (d) {
      paths.push({ d, fill: 'color', rule: 'nonzero' });
      growBox(box, lineBox[0], lineBox[1], lineBox[2], lineBox[3]);
    }
  });
  if (!paths.length) return { paths: [], viewBox: [0, 0, 1, 1] };
  return { paths, viewBox: [box[0], box[1], box[2] - box[0], box[3] - box[1]] };
}

// Glyphs around a circle centred on (0, 0), used by badges. `at` is an angle offset in radians:
// for top text it is measured clockwise from 12 o'clock, for `bottom` text (which reads
// left-to-right along the lower arc with letter tops toward the centre) from 6 o'clock.
export function textOnCircle(builder, { text, font: key, size, radius, at = 0, bottom = false, spacing = 80, fill = 'color' }) {
  const fnt = font(key);
  const { glyphs, width } = layoutLine(fnt, text, size, spacing);
  const box = emptyBox();
  let d = '';
  for (const g of glyphs) {
    const s = g.x + g.adv / 2 - width / 2; // arc length from the text centre
    const a = bottom ? at - s / radius : at + s / radius;
    const cos = Math.cos(a), sin = Math.sin(a);
    const p = g.glyph.getPath(-g.adv / 2, 0, size);
    d += commandsToD(p.commands, (x, y) => {
      const ly = bottom ? y + radius : y - radius;
      return [x * cos - ly * sin, x * sin + ly * cos];
    }, box);
  }
  builder.add(d, box, fill, 'nonzero');
  return builder;
}
