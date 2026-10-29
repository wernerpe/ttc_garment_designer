"""Bake the mannequin used by the app from Blender Studio's Human Base Meshes bundle (CC0).

Produces assets/body/runner.json + runner.bin: a display mesh (int16 positions, uint16/uint32
indices) and a signed distance grid around the torso that the cloth drape collides with.

    curl -LO https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip
    unzip human-base-meshes-bundle-v1.4.1.zip
    blender -b --factory-startup --disable-autoexec \
        human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend \
        --python tools/bake_body.py -- assets/body [--measure-only]

Units out: centimetres, y up, +z forward, +x = the mannequin's left.
"""

import json
import math
import os
import struct
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["assets/body"]
OUT_DIR = ARGS[0]
MEASURE_ONLY = "--measure-only" in ARGS

BODY = "GEO-body_male_realistic"
EYES = ["GEO-body_male_realistic.eye.L", "GEO-body_male_realistic.eye.R"]
COLLECTION = "Body Male - Realistic"
MULTIRES_LEVEL = 1
TARGET_HEIGHT = 183.0  # cm; a 6 ft runner who wears size L
TARGET_CHEST = 99.0  # cm around the chest, ~9 cm less than the size L singlet
ARM_RAISE = 12.0  # degrees; opens the armpits so the singlet's armholes clear the arms
DRESSING_RAISE = 55.0  # extra degrees for the collision pose used while the seams are sewn
SDF_STEP = 1.0  # cm


def link_collection():
    coll = bpy.data.collections[COLLECTION]
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    bpy.context.view_layer.update()


def evaluated_triangles(name, level):
    ob = bpy.data.objects[name]
    for m in ob.modifiers:
        if m.type == "MULTIRES":
            m.levels = level
            m.render_levels = level
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(ob.matrix_world)
    # the source mesh's face winding isn't consistent; make every face point outward
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.verts.index_update()
    verts = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    tris = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int64)
    bm.free()
    ev.to_mesh_clear()
    return verts, tris


def to_app(v):
    # Blender: z up, character faces -y, metres  ->  app: y up, faces +z, centimetres
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1) * 100.0


def hull_perimeter(pts):
    pts = sorted(map(tuple, pts))
    if len(pts) < 3:
        return 0.0

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return sum(math.dist(hull[i], hull[(i + 1) % len(hull)]) for i in range(len(hull)))


def section(verts, tris, y, max_abs_x):
    """Points where the mesh crosses the plane at height y, as (x, z), limited to the torso."""
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    out = []
    for p, q in ((a, b), (b, c), (c, a)):
        s = (p[:, 1] - y) * (q[:, 1] - y) < 0
        t = (y - p[s, 1]) / (q[s, 1] - p[s, 1])
        pts = p[s] + (q[s] - p[s]) * t[:, None]
        out.append(pts[:, [0, 2]])
    pts = np.concatenate(out)
    return pts[np.abs(pts[:, 0]) < max_abs_x]


def girth(verts, tris, y, max_abs_x=22.0):
    return hull_perimeter(section(verts, tris, y, max_abs_x))


def torso_girth(verts, tris, y):
    """Girth of the torso alone at height y, or None where the arms touch the body."""
    sec = section(verts, tris, y, 80.0)
    limits = []
    for side in (1, -1):
        xs = np.sort(sec[:, 0][sec[:, 0] * side > 10] * side)
        gaps = np.nonzero(np.diff(xs) > 1.5)[0]
        if not len(gaps):
            return None
        limits.append(xs[gaps[0]] + 0.5)
    return hull_perimeter(sec[np.abs(sec[:, 0]) < min(limits)])


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def raise_arms(v, degrees, pivot=(17.0, 141.0)):
    """Swing both arms outward around the shoulder, blending into the torso near the armpit."""
    out = v.copy()
    for side in (1, -1):
        rx = v[:, 0] * side - pivot[0]
        ry = v[:, 1] - pivot[1]
        # below the elbows only the forearms and hands (well out from the hips and legs) move,
        # and nothing below fingertip height (the feet turn out past the hands' x)
        legs_clear = np.where(v[:, 1] >= 100, 1.0, smoothstep(23, 27, v[:, 0] * side) * smoothstep(55, 62, v[:, 1]))
        w = smoothstep(1.5, 6.5, rx) * (v[:, 0] * side > 0) * legs_clear
        a = np.radians(degrees) * w
        nx = rx * np.cos(a) - ry * np.sin(a)
        ny = rx * np.sin(a) + ry * np.cos(a)
        m = w > 0
        out[m, 0] = (nx[m] + pivot[0]) * side
        out[m, 1] = ny[m] + pivot[1]
    return out


def signed_distance_grid(bvh, gmin, n):
    """Distance to the nearest surface, negative inside.

    The sign comes from the outward face normal at the nearest point. (Counting ray crossings
    is unreliable here: the sculpt has overlapping shells that flip the parity.)"""
    sdf = np.zeros((n[2], n[1], n[0]), dtype=np.float32)
    ys = gmin[1] + np.arange(n[1]) * SDF_STEP
    for iz in range(n[2]):
        z = gmin[2] + iz * SDF_STEP
        for ix in range(n[0]):
            x = gmin[0] + ix * SDF_STEP
            for iy, y in enumerate(ys):
                p = Vector((x, y, z))
                loc, normal, _, dist = bvh.find_nearest(p)
                sdf[iz, iy, ix] = -dist if (p - loc).dot(normal) < 0 else dist
    return sdf


def main():
    link_collection()
    body_v, body_t = evaluated_triangles(BODY, MULTIRES_LEVEL)
    body_v = to_app(body_v)
    eye_parts = [evaluated_triangles(n, 0) for n in EYES]

    # stand on the floor, centred left/right and front/back
    lo = body_v[:, 1].min()
    shift = np.array([
        -(body_v[:, 0].min() + body_v[:, 0].max()) / 2,
        -lo,
        -(body_v[:, 2].min() + body_v[:, 2].max()) / 2,
    ])
    body_v += shift
    height = body_v[:, 1].max()
    scale = TARGET_HEIGHT / height
    body_v *= scale

    body_v = raise_arms(body_v, ARM_RAISE)

    # chest: just below the armpits, torso only
    chest_y = max(y for y in np.arange(110, 140, 0.5) if torso_girth(body_v, body_t, y)) - 1.0
    chest = torso_girth(body_v, body_t, chest_y)
    print(f"raw height {height:.1f} cm, scale {scale:.3f}, chest at y={chest_y:.1f}: {chest:.1f} cm")
    girth_scale = TARGET_CHEST / chest
    body_v[:, 0] *= girth_scale
    body_v[:, 2] *= girth_scale

    # centre the chest section front/back on z = 0
    sec = section(body_v, body_t, chest_y, 18.0)
    zc = (sec[:, 1].min() + sec[:, 1].max()) / 2
    body_v[:, 2] -= zc

    measures = {
        "height": float(body_v[:, 1].max()),
        "chestHeight": float(chest_y),
        "chest": torso_girth(body_v, body_t, chest_y),
        "waist": min(torso_girth(body_v, body_t, y) or 1e9 for y in np.arange(100, 118, 1.0)),
        "hips": max(torso_girth(body_v, body_t, y) or 0 for y in np.arange(86, 100, 1.0)),
        "girthScale": girth_scale,
    }
    print("measures", {k: round(v, 1) for k, v in measures.items()})

    # high point shoulder: top surface a little out from the neck
    bvh = BVHTree.FromPolygons([Vector(v) for v in body_v], body_t.tolist())
    tops = []
    for sx in (-1, 1):
        hit = bvh.ray_cast(Vector((sx * 10.5, 250.0, -1.0)), Vector((0, -1, 0)))
        if hit[0] is not None:
            tops.append(hit[0].y)
    measures["shoulderTop"] = float(sum(tops) / len(tops)) if tops else 150.0
    print("shoulder top at x=±10.5:", round(measures["shoulderTop"], 1))
    if MEASURE_ONLY:
        return

    # display mesh: body + eyes, same transform
    all_v = [body_v]
    all_t = [body_t]
    offset = len(body_v)
    for ev, et in eye_parts:
        ev = to_app(ev) + shift
        ev *= scale
        ev[:, 0] *= girth_scale
        ev[:, 2] *= girth_scale
        ev[:, 2] -= zc
        all_v.append(ev)
        all_t.append(et + offset)
        offset += len(ev)
    V = np.concatenate(all_v)
    T = np.concatenate(all_t)

    # signed distance grids around the torso: the display pose, and a "dressing" pose with the
    # arms swung up out of the way so the side seams can be sewn shut before the arms come down
    top = measures["shoulderTop"] + 14
    gmin = np.array([-38.0, 60.0, -24.0])
    gmax = np.array([38.0, math.ceil(top), 26.0])
    n = (np.ceil((gmax - gmin) / SDF_STEP) + 1).astype(int)
    print("sdf grid", n.tolist(), int(np.prod(n)), "cells")
    sdf = signed_distance_grid(bvh, gmin, n)
    dress_v = raise_arms(body_v, DRESSING_RAISE, pivot=(16.0, 141.0))
    dress_bvh = BVHTree.FromPolygons([Vector(v) for v in dress_v], body_t.tolist())
    sdf_dress = signed_distance_grid(dress_bvh, gmin, n)

    os.makedirs(OUT_DIR, exist_ok=True)
    pos_min = V.min(axis=0)
    pos_span = V.max(axis=0) - pos_min
    q = np.round((V - pos_min) / pos_span * 65535 - 32768).astype(np.int16)
    idx_type = np.uint16 if len(V) < 65536 else np.uint32
    blobs = [
        ("positions", q.tobytes()),
        ("indices", T.astype(idx_type).tobytes()),
        ("sdf", np.clip(np.round(sdf * 100), -32768, 32767).astype(np.int16).tobytes()),
        ("sdfDress", np.clip(np.round(sdf_dress * 100), -32768, 32767).astype(np.int16).tobytes()),
    ]
    meta = {
        "source": "Blender Studio Human Base Meshes v1.4.1, 'Body Male - Realistic' by Dan Ulrich (CC0)",
        "units": "cm, y up, +z forward",
        "measures": measures,
        "mesh": {
            "vertices": int(len(V)),
            "triangles": int(len(T)),
            "indexType": "uint16" if idx_type == np.uint16 else "uint32",
            "positionMin": pos_min.tolist(),
            "positionSpan": pos_span.tolist(),
        },
        "sdf": {"min": gmin.tolist(), "step": SDF_STEP, "size": n.tolist(), "scale": 0.01},
        "blobs": {},
    }
    data = b""
    for name, blob in blobs:
        pad = (-len(data)) % 4
        data += b"\0" * pad
        meta["blobs"][name] = [len(data), len(blob)]
        data += blob
    with open(os.path.join(OUT_DIR, "runner.bin"), "wb") as f:
        f.write(data)
    with open(os.path.join(OUT_DIR, "runner.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("wrote", len(data), "bytes;", len(V), "verts;", len(T), "tris")


if __name__ == "__main__":
    main()
