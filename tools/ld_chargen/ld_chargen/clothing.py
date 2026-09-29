"""
Ropa común a todos los conjuntos (chaqueta, pantalón, botas, guantes).
Las prendas se derivan de la superficie del cuerpo (misma topología en ambos géneros),
se inflan, se les quita el detalle anatómico y nunca atraviesan el cuerpo.
El color lo pone el conjunto (outfit) en runtime: Jacket / JacketShade / Pants / Glove / Boots.
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from . import util
from .anatomy import FS, TOE_SETS
from .parts import Ctx, bvh_of, oriented_box, ring_points


def _top_loop(obj):
    co = util.get_co(obj.data)
    loops = util.boundary_loops(obj.data)
    return max(loops, key=lambda l: co[l][:, 2].mean()), loops


def _collar(ctx: Ctx, obj, loop: list[int]) -> list[int]:
    """Cuello alzado: dos extrusiones del borde superior, separadas del cuello."""
    k = ctx.k
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    ring = [bm.verts[i] for i in loop]
    edges = [e for e in bm.edges if e.is_boundary and e.verts[0] in ring and e.verts[1] in ring]
    top_ring = ring
    for step, (dz, grow) in enumerate(((0.028 * k, 0.004), (0.02 * k, 0.006))):
        res = bmesh.ops.extrude_edge_only(bm, edges=edges)
        new_v = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
        edges = [g for g in res["geom"] if isinstance(g, bmesh.types.BMEdge) and g.is_boundary]
        for v in new_v:
            p = v.co + Vector((0, 0, dz))
            loc, nor, _ = ctx.surf.nearest(p)
            d = (p - loc).dot(nor)
            want = 0.012 + grow
            if d < want:
                p = loc + nor * want
            v.co = p
        top_ring = new_v
    bm.verts.index_update()
    idx = [v.index for v in top_ring]
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return idx


def jacket(ctx: Ctx) -> bpy.types.Object:
    J, k = ctx.an.joints, ctx.k
    hem_z = J["Hips"].z - 0.10 * k
    top_z = ctx.an.ref["neck_base"].z - 0.01 * k
    mask = ctx.sets(FS["torso"], FS["belly"], FS["pelvis"], FS["upperarm"], FS["forearm"])
    mask &= ctx.cen[:, 2] > hem_z
    mask &= ~((ctx.fs == FS["torso"]) & (ctx.cen[:, 2] > top_z))
    obj = ctx.shell(ctx.name("Outfit_Base_Jacket"), mask, 0.016, iters=8, min_offset=0.012)
    util.set_material(obj, ctx.mats["Jacket"])
    loop, _ = _top_loop(obj)
    _collar(ctx, obj, loop)
    util.extrude_boundary_inward(obj, 0.007)
    pieces = [obj]
    jb = bvh_of(obj)
    mats = ctx.mats

    # borde superior del cuello con vivo de color de acento
    co = util.get_co(obj.data)
    top, loops = _top_loop(obj)
    pts, nrs = ring_points(obj, top)
    piping = util.ribbon(pts, nrs, 0.006, thickness=0.003, name="piping", coll=ctx.coll, closed=True)
    util.set_material(piping, mats["Accent"])
    pieces.append(piping)

    # bajo y puños: bandas en tono oscuro
    for lp in loops:
        if lp is top:
            continue
        pts, nrs = ring_points(obj, lp)
        pts = [p + Vector((0, 0, 0.016)) if abs(n.z) < 0.7 else p for p, n in zip(pts, nrs)]
        is_hem = np.mean([p.z for p in pts]) < J["Spine"].z
        band = util.ribbon([p + n * 0.002 for p, n in zip(pts, nrs)], nrs, 0.032 if is_hem else 0.026,
                           thickness=0.003, name="band", coll=ctx.coll, closed=True)
        util.set_material(band, mats["JacketShade"])
        pieces.append(band)

    # cremallera: solapa + diente metálico por el centro del pecho
    zs = np.linspace(hem_z + 0.012, top_z + 0.04 * k, 26)
    pts, nrs = [], []
    for z in zs:
        hit = jb.ray_cast(Vector((0, -1.0, z)), Vector((0, 1, 0)), 2.0)
        if hit[0] is None or hit[1].y > -0.2:  # sin chaqueta delante (encima del cuello): se corta
            continue
        pts.append(hit[0] + hit[1] * 0.0015)
        nrs.append(hit[1])
    flap = util.ribbon(pts, nrs, 0.03, thickness=0.003, name="flap", coll=ctx.coll)
    util.set_material(flap, mats["JacketShade"])
    zip_ = util.ribbon([p + n * 0.0035 for p, n in zip(pts, nrs)], nrs, 0.007, thickness=0.002, name="zip", coll=ctx.coll)
    util.set_material(zip_, mats["Metal"])
    pieces += [flap, zip_]

    # bolsillos de pecho con solapa
    zc = J["UpperChest"].z - 0.035 * k
    for sx in (1, -1):
        p, n = ctx.on_surface(jb, (sx * 0.095 * k, -1.0, zc), (0, 1, 0), 0.0)
        body_ = oriented_box(ctx, p, n, (0, 0, 1), (0.105 * k, 0.012, 0.12 * k), "pocket", 0.004)
        flap_ = oriented_box(ctx, p + n * 0.012 + Vector((0, 0, 0.045 * k)), n, (0, 0, 1), (0.112 * k, 0.006, 0.035 * k), "pflap", 0.002)
        util.set_material(body_, mats["Jacket"])
        util.set_material(flap_, mats["JacketShade"])
        pieces += [body_, flap_]

    obj = util.join_objects(pieces, ctx.name("Outfit_Base_Jacket"))
    return ctx.finish(obj, None, slot="outfit_base", item="jacket")


def pants(ctx: Ctx) -> bpy.types.Object:
    J, k = ctx.an.joints, ctx.k
    waist_z = J["Hips"].z + 0.06 * k
    boot_top = 0.27 * k
    mask = ctx.sets(FS["pelvis"], FS["belly"], FS["thigh"], FS["shin"])
    mask &= (ctx.cen[:, 2] < waist_z) & (ctx.cen[:, 2] > boot_top - 0.035)
    obj = ctx.shell(ctx.name("Outfit_Base_Pants"), mask, 0.010, iters=6, min_offset=0.007)
    util.set_material(obj, ctx.mats["Pants"])
    top, loops = _top_loop(obj)
    util.extrude_boundary_inward(obj, 0.006)
    pb = bvh_of(obj)
    pieces = [obj]
    # cinturón
    pts, nrs = ring_points(obj, top)
    pts = [p - Vector((0, 0, 0.022 * k)) + n * 0.003 for p, n in zip(pts, nrs)]
    belt = util.ribbon(pts, nrs, 0.042 * k, thickness=0.004, name="belt", coll=ctx.coll, closed=True)
    util.set_material(belt, ctx.mats["Boots"])
    top_z = float(np.mean([q.z for q in pts]))
    p, n = ctx.on_surface(pb, (0, -1.0, top_z), (0, 1, 0), 0.007)
    buckle = oriented_box(ctx, p, n, (0, 0, 1), (0.055 * k, 0.008, 0.045 * k), "buckle", 0.003)
    util.set_material(buckle, ctx.mats["Metal"])
    pieces += [belt, buckle]
    # bolsillos cargo en el exterior del muslo
    zc = (J["LeftUpperLeg"].z + J["LeftLowerLeg"].z) * 0.5 - 0.02 * k
    for side in ("Left", "Right"):
        sx = 1 if side == "Left" else -1
        p, n = ctx.on_surface(pb, (sx * 1.0, J[f"{side}UpperLeg"].y, zc), (-sx, 0, 0), 0.0)
        pk = oriented_box(ctx, p, n, (0, 0, 1), (0.12 * k, 0.018, 0.15 * k), "cargo", 0.005)
        fl = oriented_box(ctx, p + n * 0.018 + Vector((0, 0, 0.06 * k)), n, (0, 0, 1), (0.128 * k, 0.007, 0.04 * k), "cflap", 0.002)
        util.set_material(pk, ctx.mats["Pants"])
        util.set_material(fl, ctx.mats["Pants"])
        pieces += [pk, fl]
    obj = util.join_objects(pieces, ctx.name("Outfit_Base_Pants"))
    return ctx.finish(obj, None, slot="outfit_base", item="pants")


def _superellipse_ring(cx, cz, ax, az, y, n=16, p=2.6, zmin=None, axis="y"):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        x = cx + ax * math.copysign(abs(c) ** (2 / p), c)
        z = cz + az * math.copysign(abs(s) ** (2 / p), s)
        if zmin is not None:
            z = max(z, zmin)
        pts.append(Vector((x, y, z)) if axis == "y" else Vector((x, z, y)))
    return pts


def _loft(rings, cap_start=True, cap_end=False):
    verts, faces = [], []
    n = len(rings[0])
    for r in rings:
        verts += r
    for i in range(len(rings) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_start:
        c = len(verts)
        verts.append(sum(rings[0], Vector()) / n)
        faces += [(c, (j + 1) % n, j) for j in range(n)]
    if cap_end:
        c = len(verts)
        verts.append(sum(rings[-1], Vector()) / n)
        base = (len(rings) - 1) * n
        faces += [(c, base + j, base + (j + 1) % n) for j in range(n)]
    return verts, faces


def boots(ctx: Ctx) -> bpy.types.Object:
    k = ctx.k
    co = ctx.surf.co
    me = ctx.ref.data
    boot_top = 0.27 * k
    sole_h = 0.02 * k
    pieces = []
    for s, side in (("L", "Left"), ("R", "Right")):
        foot_mask = util.verts_of_faces(me, ctx.sets(FS["foot"][s], FS["toes_base"][s], TOE_SETS[s]))
        fv = co[foot_mask]
        shin_mask = util.verts_of_faces(me, ctx.sets(FS["shin"][s], FS["foot"][s]))
        sv = co[shin_mask]
        # pie: cortes a lo largo de Y (puntera → talón)
        y0, y1 = fv[:, 1].min() - 0.012, fv[:, 1].max() + 0.01
        rings = []
        for yi in np.linspace(y0, y1, 16):
            slab = fv[np.abs(fv[:, 1] - np.clip(yi, fv[:, 1].min() + 0.006, fv[:, 1].max() - 0.006)) < 0.012]
            x0, x1 = slab[:, 0].min() - 0.009, slab[:, 0].max() + 0.009
            ztop = min(slab[:, 2].max() + 0.012, 0.13 * k)
            cz = (ztop + sole_h * 0.6) * 0.5
            rings.append(_superellipse_ring((x0 + x1) / 2, cz, (x1 - x0) / 2, (ztop - sole_h * 0.6) / 2, yi, zmin=sole_h * 0.6))
        # redondea puntera y talón
        for idx, f in ((0, 0.45), (1, 0.85), (-1, 0.55), (-2, 0.9)):
            c = sum(rings[idx], Vector()) / len(rings[idx])
            rings[idx] = [c + (p - c) * f for p in rings[idx]]
        v, f = _loft(rings, cap_start=True, cap_end=True)
        foot_obj = util.new_mesh_object(f"boot_foot_{s}", v, f, ctx.coll)
        # caña: cortes horizontales
        srings = []
        for zi in np.linspace(0.075 * k, boot_top, 9):
            slab = sv[np.abs(sv[:, 2] - zi) < 0.012]
            cx, cy = (slab[:, 0].min() + slab[:, 0].max()) / 2, (slab[:, 1].min() + slab[:, 1].max()) / 2
            t = (zi - 0.075 * k) / (boot_top - 0.075 * k)
            off = 0.011 + 0.008 * t
            ax, ay = (slab[:, 0].max() - slab[:, 0].min()) / 2 + off, (slab[:, 1].max() - slab[:, 1].min()) / 2 + off
            ring = []
            for i in range(16):
                a = 2 * math.pi * i / 16
                ring.append(Vector((cx + ax * math.cos(a), cy + ay * math.sin(a), zi)))
            srings.append(ring)
        v, f = _loft(srings, cap_start=False, cap_end=False)
        shaft = util.new_mesh_object(f"boot_shaft_{s}", v, f, ctx.coll)
        util.extrude_boundary_inward(shaft, 0.008)
        for o in (foot_obj, shaft):
            util.set_material(o, ctx.mats["Boots"])
        # suela: contorno de la huella extruido
        outline_l, outline_r = [], []
        for yi in np.linspace(y0 + 0.004, y1 - 0.002, 14):
            slab = fv[np.abs(fv[:, 1] - np.clip(yi, fv[:, 1].min() + 0.006, fv[:, 1].max() - 0.006)) < 0.012]
            outline_l.append(Vector((slab[:, 0].min() - 0.013, yi, 0)))
            outline_r.append(Vector((slab[:, 0].max() + 0.013, yi, 0)))
        outline = outline_l + list(reversed(outline_r))
        n = len(outline)
        verts = [p.copy() for p in outline] + [p + Vector((0, 0, sole_h)) for p in outline]
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        sole = util.new_mesh_object(f"sole_{s}", verts, faces, ctx.coll, smooth=False)
        util.set_material(sole, ctx.mats["Sole"])
        # correa del tobillo con hebilla
        zi = 0.14 * k
        slab = sv[np.abs(sv[:, 2] - zi) < 0.012]
        cx, cy = (slab[:, 0].min() + slab[:, 0].max()) / 2, (slab[:, 1].min() + slab[:, 1].max()) / 2
        ax, ay = (slab[:, 0].max() - slab[:, 0].min()) / 2 + 0.024, (slab[:, 1].max() - slab[:, 1].min()) / 2 + 0.024
        pts = [Vector((cx + ax * math.cos(a), cy + ay * math.sin(a), zi)) for a in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
        nrs = [Vector((math.cos(a), math.sin(a), 0)) for a in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
        strap = util.ribbon(pts, nrs, 0.024 * k, thickness=0.003, name="strap", coll=ctx.coll, closed=True)
        util.set_material(strap, ctx.mats["Gear"])
        sgn = 1 if s == "L" else -1
        bk = util.box(Vector((cx + sgn * (ax + 0.003), cy, zi)), (0.006, 0.022, 0.026), name="bk", coll=ctx.coll, bevel=0.002)
        util.set_material(bk, ctx.mats["Metal"])
        pieces += [foot_obj, shaft, sole, strap, bk]
    obj = util.join_objects(pieces, ctx.name("Outfit_Base_Boots"))
    return ctx.finish(obj, None, slot="outfit_base", item="boots", sharp=60)


def gloves(ctx: Ctx) -> bpy.types.Object:
    J, k = ctx.an.joints, ctx.k
    fingers = []
    for s in ("L", "R"):
        for seq in FS["fingers"][s].values():
            fingers += list(seq)
    mask = ctx.sets(FS["hand"], fingers)
    for side, s in (("Left", "L"), ("Right", "R")):
        w = J[f"{side}Hand"]
        near = np.linalg.norm(ctx.cen - np.asarray(w), axis=1) < 0.055 * k
        mask |= (ctx.fs == FS["forearm"][s]) & near
    obj = util.subset_copy(ctx.ref, mask, ctx.name("Outfit_Base_Gloves"), ctx.coll)
    co = util.get_co(obj.data)
    # puño más holgado que el resto del guante
    d = np.minimum(np.linalg.norm(co - np.asarray(J["LeftHand"]), axis=1), np.linalg.norm(co - np.asarray(J["RightHand"]), axis=1))
    off = np.where(d < 0.05 * k, 0.0026 + np.clip(0.05 * k - d, 0, None) * 0.12, 0.0026)
    util.offset_shell(obj, off, ctx.surf, smooth_iters=2, smooth_factor=0.35, min_offset=off * 0.8, passes=2)
    util.extrude_boundary_inward(obj, 0.004)
    util.set_material(obj, ctx.mats["Glove"])
    pieces = [obj]
    # protector de nudillos
    for side in ("Left", "Right"):
        kn = (J[f"{side}IndexProximal"] + J[f"{side}MiddleProximal"] + J[f"{side}RingProximal"] + J[f"{side}LittleProximal"]) / 4
        back = ctx.an.ref[f"{side}HandBack"]
        along = (kn - J[f"{side}Hand"]).normalized()
        loc, nor, _ = ctx.surf.nearest(kn + back * 0.03 - along * 0.012)
        pad = oriented_box(ctx, loc + nor * 0.004, nor, along, (0.058 * k, 0.007, 0.03 * k), "knuckle", 0.003)
        util.set_material(pad, ctx.mats["Gear"])
        pieces.append(pad)
    obj = util.join_objects(pieces, ctx.name("Outfit_Base_Gloves"))
    return ctx.finish(obj, None, slot="outfit_base", item="gloves")


def build_all(ctx: Ctx) -> list[bpy.types.Object]:
    return [jacket(ctx), pants(ctx), boots(ctx), gloves(ctx)]
