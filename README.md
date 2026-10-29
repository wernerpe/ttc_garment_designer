# TTC singlet lab

Design heat-transfer prints for the Tortoise Track Club running singlet. On the right, you place artwork on the flat pattern. On the left, the same pattern is sewn and draped onto a 3D runner, so every print shows up where it will actually sit on the body.

The front and back pieces are laid out joined at the side seam, as one strip that runs all the way round the body. Artwork can cross a side seam and wrap from the front onto the back.

The current garment is the [Miler Running Base Running Singlet](https://milerrunning.com/products/base-running-singlet?variant=28922773766204), in black, size L.

## Run it

There's nothing to install and no build step. All dependencies are vendored in `vendor/`. You only need a static file server, because browsers won't load ES modules from `file://`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

`npx serve` or any other static server works too.

While you're editing the code, use `python3 tools/serve.py` instead. It's the same server with browser caching turned off, so changes show up on a normal reload.

To let someone on the same network try it, run `python3 tools/serve.py 8000 0.0.0.0` and share `http://<this machine's hostname>:8000`. To share it more widely, push the folder to GitHub Pages.

## What you can do

- **Add artwork from the tray under the pattern.** Click a tile to add it to the side of the shirt you're looking at, or drag it onto the pattern or straight onto the 3D shirt. Image files can be dropped onto the pattern.
- **Remove or copy artwork.** Use the toolbar that appears above the selected print (Duplicate, Mirror, Delete), the bin icon in the print list, or the Delete key. An Undo button shows after every delete.
- **Place prints on the cutting mat.** Drag to move, drag a corner to scale, drag a side handle to stretch in one direction, and use the round handle to rotate (it snaps to 15°; hold Alt for free rotation). The link button between Width and Height switches "keep proportions" on or off, and **Reset proportions** undoes a stretch. Prints snap to the centre line and onto the side seams. Arrow keys nudge by 1 mm, or 1 cm with Shift. Scroll to zoom, drag empty mat to pan, and double-click to fit.
- **Wrap round the side.** Drag a print across a side seam and it carries on onto the other piece. The right side seam sits at both ends of the strip, so art leaving one end comes back in at the other.
- **Edit on the 3D shirt.** Click a print on the shirt to select it, then drag to slide it over the fabric, including round the sides. Use the camera buttons for the front, side, back and ¾ views, or turn on the turntable.
- **Kinds of artwork.** Text is converted to vector outlines (eight OFL fonts including Roboto Mono, with letter spacing and arcs). There's also a small library of sample motifs (club badge, star, lane stripes), and you can add your own in a private design pack (see below). You can also upload SVG, PNG, JPEG or WebP. Uploads can stay full colour for DTF, or become a single colour for vinyl.
- **Pick the material.** Choose matte, gloss, reflective, metallic foil or DTF. Each renders with its own sheen in 3D.
- **See the guides.** These are the 2 cm safe zone along the neck, armholes, shoulders and hem, Miler's own reflective chest logo, and the underarm and centre lines. Prints get flagged when they run off the shirt or into the safe zone. You also get a note when a print wraps across a side seam or outgrows a 38 × 38 cm press.
- **Export:**
  - A placement sheet: a printable page listing each print's size and position, measured from the HPS and centre line, plus pressing notes.
  - Mirrored cut files: one SVG laid out for a 12" mat, with one group per vinyl colour.
  - Both pattern pieces with their art as a 1:1 SVG.
  - A 300 dpi PNG per print, for DTF or screen-print orders.
- **Save your work.** Projects autosave in the browser. Use Save and Open for a portable JSON file, and Undo/Redo with Ctrl+Z and Ctrl+Shift+Z.

A fresh copy starts with placeholder samples:
- "YOUR CLUB / RUN CLUB" across the chest
- lane stripes wrapping round the left side seam
- a sample badge high on the back
- placeholder text in reflective vinyl lower on the back

## Your own designs

The club's real artwork isn't in this repository. It lives in a private design pack, `js/designs/local/index.js`, which is git-ignored. When that file is present, the app loads it and adds its motifs to the tray. Its layout becomes the one a fresh session starts with. Without it, the app uses `js/designs/samples.js`.

To make your own pack, copy `samples.js` to `js/designs/local/index.js`, fix the import paths (one folder deeper), and replace the motifs and layout. A motif is a function that returns vector paths, and the comment at the top of `samples.js` describes the format. Motifs can be:
- **generated from a seed**, which gives the inspector a **New pattern** button
- **marked as a pair**, so the tray drops one down each side seam, sized from the underarm to the hem

Saved projects only reference motifs by name. A project opened on a copy without the pack shows a dashed placeholder box where each missing motif would be.

## Measurements

From Miler's size guide (inches; chest is the full circumference, length is HPS to the bottom of the curved hem):

| | S | M | L | XL |
|---|---|---|---|---|
| Chest | 37½ | 40 | **42½** | 45 |
| Length | 27 | 27½ | **28** | 28¾ |

Size L therefore gives each pattern piece a 54.0 cm width at the underarm and a 71.1 cm length.

Everything else (neck width 19 cm, front/back neck drop 13 / 5.5 cm, strap 6 cm, HPS to underarm 26 cm, racer back, 5.5 cm shirttail rise, logo about 30 cm below the HPS) is estimated. Miler's product photos are ghost-mannequin shots, not flat lays, so those numbers can't be measured off them exactly. **Lay your shirt flat, measure, and correct the `DETAILS` table in `js/garments/singlet.js`.** The pattern, drape, guides and exports all regenerate from it.

## How it works

1. **Pattern** (`js/garments/singlet.js`): the front and back pieces are built from bezier curves driven by the measurement table, then graded across sizes. Coordinates are in cm, from the centre line and the HPS line.
2. **Mannequin** (`assets/body/`, loaded by `js/body/mannequin.js`): Blender Studio's *Human Base Meshes* "Body Male – Realistic" by Dan Ulrich (CC0). It's scaled to a 183 cm runner with a 99 cm chest, 82 cm waist and 103 cm hips, with the arms opened slightly so the armholes clear. `tools/bake_body.py` produces it, together with two signed-distance collision grids around the torso: one for the pose you see, and one with the arms raised for dressing. Instructions for regenerating it are at the top of that script.
3. **Drape** (`js/sim/drape.js`): the pieces are triangulated in 2D and wrapped loosely round the body, with the arms up out of the way. The shoulder and side seams are then pulled shut. A small position-based cloth simulation settles the shirt under gravity while the arms come down into the armholes. The 2D pattern coordinates become the mesh UVs.
4. **One texture for both views** (`js/compose.js`): designs are painted onto the joined strip, plus a second map for roughness and metalness. Each design is also drawn one circumference to either side, which is what makes art wrap. Because the mesh UVs are the strip coordinates, the flat view and the 3D view can't disagree.
5. **Rendering** (`js/view3d.js`): a studio rig of warm key, cool fill and two rims, with neutral tone mapping so garment colours stay true. The fabric has a sheen layer and a knit normal map, and ambient occlusion is added on non-touch devices.
6. **Art** (`js/art/`): text is converted to paths with opentype.js, motifs are drawn in code, and everything renders through one function. That function feeds the mat, the 3D texture and the exports.

To add another garment, write a new pattern module that returns the same shape as `buildSinglet()`: panels with outlines, named seams that pair up, and landmarks. The rest of the pipeline is garment-agnostic.

## Layout

```
index.html            app shell (import map points three.js at vendor/)
css/app.css
js/main.js            wiring and boot
js/garments/          pattern definitions and measurements
js/body/              mannequin loader
js/sim/               virtual sewing and draping
js/geometry/          curves and polygon helpers
js/art/               text, motif registry, shared renderer
js/designs/           design packs: samples.js (public) and local/ (private, git-ignored)
js/editor.js          cutting-mat editor
js/view3d.js          three.js studio
js/ui.js              inspector panel
js/export.js          sheet, cut files, SVG and PNG export
assets/body/          baked mannequin mesh + collision grids (CC0, see above)
assets/fonts/         OFL fonts (see assets/fonts/README.md)
tools/bake_body.py    Blender script that bakes assets/body
tools/serve.py        static server with caching off (optionally on all interfaces)
vendor/               three.js r170 (MIT), opentype.js 1.3.4 (MIT), delaunator 5 (ISC)
```
