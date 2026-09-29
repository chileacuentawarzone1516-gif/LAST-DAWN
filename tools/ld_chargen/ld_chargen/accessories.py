"""
Accesorios de cabeza/cuello (mismos ids que el juego): cap, beanie, goggles, bandana, headset.
Colores como en los retratos del juego: gorra = Jacket (visera JacketShade, botón Accent),
gorro = JacketShade con vuelta y pompón Accent, pañuelo = Accent, gafas/auriculares fijos.
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from . import util
from .parts import Ctx, head_frame, line_mask, oriented_box


def _hat_mask(ctx: Ctx, drop: float = 0.0):
    k = ctx.k
    eye_z = ctx.an.joints["LeftEye"].z
    ear_c = ctx.an.ref["ear_center"]
    return line_mask(ctx, [0, 40, 80, 110, 180],
                     [eye_z + 0.045 * k - drop, eye_z + 0.04 * k - drop, ear_c.z + 0.032 * k - drop,
                      ear_c.z + 0.005 * k - drop, ear_c.z - 0.012 * k - drop])


def _head_piece(ctx: Ctx, obj, item: str):
    obj.data.shade_smooth()
    util.rigid_weights(obj, "Head")
    util.add_armature(obj, ctx.rig)
    util.link_only(obj, ctx.coll)
    util.tag(obj, ld_slot="accessory", ld_item=item, ld_part="main")
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="UVMap")
    return obj


def _crown(ctx: Ctx, name: str, drop: float, offset: float, dome: float):
    obj = ctx.shell(name, _hat_mask(ctx, drop), offset, iters=10, min_offset=offset * 0.9, passes=3)
    # un poco más de volumen hacia la coronilla
    co = util.get_co(obj.data)
    nr = util.get_vnormals(obj.data)
    z0, z1 = co[:, 2].min(), co[:, 2].max()
    t = np.clip((co[:, 2] - z0) / max(z1 - z0, 1e-6), 0, 1)
    co += nr * (dome * t ** 1.5)[:, None]
    util.set_co(obj.data, co)
    util.extrude_boundary_inward(obj, 0.012)
    return obj


def cap(ctx: Ctx):
    k = ctx.k
    C, az = head_frame(ctx)
    crown = _crown(ctx, ctx.name("Acc_cap"), 0.0, 0.024, 0.006)
    util.set_material(crown, ctx.mats["Jacket"])
    co = util.get_co(crown.data)
    loops = util.boundary_loops(crown.data)
    rim = max(loops, key=len)  # el borde de la gorra (ignora micro-agujeros de la malla)
    front = [i for i in rim if az(co[i]) < 62]
    front.sort(key=lambda i: math.atan2(co[i][0] - C.x, -(co[i][1] - C.y)))
    inner, outer = [], []
    for i in front:
        p = Vector(co[i])
        a = math.radians(az(p))
        radial = Vector((p.x - C.x, p.y - C.y, 0)).normalized()
        reach = (0.07 * math.cos(a) ** 1.3) * k + 0.004
        inner.append(p + Vector((0, 0, -0.002)))
        outer.append(p + radial * reach + Vector((0, 0, -0.012 * math.cos(a))))
    verts, faces = [], []
    n = len(inner)
    for j in range(n):
        verts += [inner[j], outer[j], inner[j] + Vector((0, 0, 0.005)), outer[j] + Vector((0, 0, 0.004))]
    for j in range(n - 1):
        a, b = 4 * j, 4 * (j + 1)
        faces += [(a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3), (a + 1, a + 3, b + 3, b + 1)]
    brim = util.new_mesh_object("brim", verts, faces, ctx.coll)
    util.set_material(brim, ctx.mats["JacketShade"])
    top = Vector(co[np.argmax(co[:, 2])])
    button = util.uv_sphere(top, 0.007, 10, 6, (1, 1, 0.5), name="btn", coll=ctx.coll)
    util.set_material(button, ctx.mats["Accent"])
    obj = util.join_objects([crown, brim, button], ctx.name("Acc_cap"))
    return _head_piece(ctx, obj, "cap")


def beanie(ctx: Ctx):
    k = ctx.k
    body = _crown(ctx, ctx.name("Acc_beanie"), 0.012 * k, 0.024, 0.02)
    util.set_material(body, ctx.mats["JacketShade"])
    co = util.get_co(body.data)
    # vuelta del gorro: banda de punto en color de acento alrededor del borde
    eye_z = ctx.an.joints["LeftEye"].z
    pts, nrs = _head_ring(ctx, eye_z + 0.052 * k, eye_z + 0.012 * k, 0.03)
    cuff = util.ribbon(pts, nrs, 0.042 * k, thickness=0.009, name="cuff", coll=ctx.coll, closed=True)
    util.set_material(cuff, ctx.mats["Accent"])
    top = Vector(co[np.argmax(co[:, 2])])
    pom = util.uv_sphere(top + Vector((0, 0, 0.018)), 0.026 * k, 12, 8, name="pom", coll=ctx.coll)
    util.set_material(pom, ctx.mats["Accent"])
    obj = util.join_objects([body, cuff, pom], ctx.name("Acc_beanie"))
    return _head_piece(ctx, obj, "beanie")


def _head_ring(ctx: Ctx, z_front: float, z_back: float, offset: float, n: int = 32):
    C, _ = head_frame(ctx)
    pts, nrs = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        d = Vector((math.sin(a), -math.cos(a), 0))
        z = z_front + (z_back - z_front) * (1 - math.cos(a)) / 2
        o = Vector((C.x, C.y, z)) + d * 0.4
        hit = ctx.surf.ray(o, -d, 0.6)
        if hit[0] is None:
            continue
        pts.append(hit[0] + hit[1] * offset)
        nrs.append(hit[1])
    return pts, nrs


def goggles(ctx: Ctx):
    k = ctx.k
    eye_z = ctx.an.joints["LeftEye"].z
    zf = eye_z + 0.052 * k
    pts, nrs = _head_ring(ctx, zf, zf - 0.03 * k, 0.019)
    strap = util.ribbon(pts, nrs, 0.026 * k, thickness=0.003, name="strap", coll=ctx.coll, closed=True)
    util.set_material(strap, ctx.mats["Gear"])
    parts = [strap]
    for sx in (1, -1):
        x = sx * 0.034 * k
        hit = ctx.surf.ray((x, -0.5, zf), (0, 1, 0), 1.0)
        p, n = hit[0], hit[1]
        n = (n + Vector((0, -0.6, 0))).normalized()
        frame = oriented_box(ctx, p + n * 0.016, n, (0, 0, 1), (0.05 * k, 0.02, 0.034 * k), "gframe", 0.006)
        util.set_material(frame, ctx.mats["Gear"])
        lens = oriented_box(ctx, p + n * 0.034, n, (0, 0, 1), (0.041 * k, 0.004, 0.026 * k), "lens", 0.004)
        util.set_material(lens, ctx.mats["Lens"])
        parts += [frame, lens]
    bridge = util.tube([Vector((0.012 * k, -0.2, zf)), Vector((-0.012 * k, -0.2, zf))], 0.004, 6, name="br", coll=ctx.coll)
    hit = ctx.surf.ray((0, -0.5, zf), (0, 1, 0), 1.0)
    bridge.location = (0, hit[0].y - 0.024 + 0.2, 0)
    bridge.data.transform(bridge.matrix_basis)
    bridge.matrix_basis.identity()
    util.set_material(bridge, ctx.mats["Gear"])
    parts.append(bridge)
    obj = util.join_objects(parts, ctx.name("Acc_goggles"))
    return _head_piece(ctx, obj, "goggles")


def headset(ctx: Ctx):
    k = ctx.k
    C, _ = head_frame(ctx)
    ear_c = ctx.an.ref["ear_center"]
    ears = ctx.an.ref["ears"]
    pts, nrs = [], []
    for a in np.linspace(-1.35, 1.35, 21):
        d = Vector((math.sin(a), 0.08, math.cos(a))).normalized()
        o = Vector((0, ear_c.y + 0.01, ear_c.z)) + d * 0.4
        hit = ctx.surf.ray(o, -d, 0.6)
        if hit[0] is None:
            continue
        pts.append(hit[0] + hit[1] * 0.027)
        nrs.append(hit[1])
    band = util.tube(pts, 0.007, 8, 0.45, ups=nrs, name="band", coll=ctx.coll)
    util.set_material(band, ctx.mats["Gear"])
    parts = [band]
    for s, sx in (("L", 1), ("R", -1)):
        e = ears[s]
        c = Vector((e.x + sx * 0.02, e.y, e.z))
        cup = util.cylinder(c, (1, 0, 0), 0.036 * k, 0.026, 20, name="cup", coll=ctx.coll, bevel=0.005)
        util.set_material(cup, ctx.mats["Gear"])
        pad = util.cylinder(c - Vector((sx * 0.015, 0, 0)), (1, 0, 0), 0.034 * k, 0.012, 20, name="pad", coll=ctx.coll)
        util.set_material(pad, ctx.mats["Sole"])
        parts += [cup, pad]
        if s == "L":
            mouth_z = ctx.an.ref["chin"].z + 0.045 * k
            p0 = c + Vector((sx * 0.012, -0.02, -0.015))
            p3 = Vector((0.028 * k, ctx.an.ref["chin"].y - 0.005, mouth_z))
            ctrl = [p0, p0 + Vector((0.01, -0.05, -0.03)), p3 + Vector((0.03, 0.02, -0.01)), p3]
            path = []
            for t in np.linspace(0, 1, 12):
                a_, b_, c_, d_ = ctrl
                path.append(a_ * (1 - t) ** 3 + b_ * 3 * t * (1 - t) ** 2 + c_ * 3 * t * t * (1 - t) + d_ * t ** 3)
            boom = util.tube(path, 0.0032, 6, name="boom", coll=ctx.coll)
            util.set_material(boom, ctx.mats["Gear"])
            mic = util.uv_sphere(p3, 0.008, 10, 6, (1.3, 1, 1), name="mic", coll=ctx.coll)
            util.set_material(mic, ctx.mats["Sole"])
            parts += [boom, mic]
    obj = util.join_objects(parts, ctx.name("Acc_headset"))
    return _head_piece(ctx, obj, "headset")


def bandana(ctx: Ctx):
    """Pañuelo anudado al cuello con pico sobre el pecho."""
    k = ctx.k
    nb = ctx.an.ref["neck_base"]
    C = Vector((0, nb.y, nb.z))
    pts, nrs = [], []
    for i in range(28):
        a = 2 * math.pi * i / 28
        d = Vector((math.sin(a), -math.cos(a), 0))
        z = nb.z + 0.03 * k - 0.012 * k * (1 + math.cos(a)) / 2
        hit = ctx.surf.ray(Vector((0, nb.y, z)) + d * 0.4, -d, 0.6)
        if hit[0] is None:
            continue
        pts.append(hit[0] + hit[1] * 0.034)
        nrs.append(hit[1])
    band = util.tube(pts + pts[:1], 0.022 * k, 10, 0.45, ups=nrs + nrs[:1], name="band", coll=ctx.coll,
                     cap_start=False, cap_end=False)
    front = pts[0]
    tip = Vector((0, front.y + 0.012, front.z - 0.1 * k))
    hit = ctx.surf.ray(tip + Vector((0, -0.4, 0)), (0, 1, 0), 0.6)
    if hit[0] is not None:
        tip = hit[0] + hit[1] * 0.036
    left = front + Vector((0.07 * k, 0.012, -0.004))
    right = front + Vector((-0.07 * k, 0.012, -0.004))
    thick = Vector((0, 0.006, 0))
    verts = [left, right, tip, left + thick, right + thick, tip + thick]
    faces = [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)]
    flap = util.new_mesh_object("flap", verts, faces, ctx.coll)
    knot = util.uv_sphere(pts[len(pts) // 2] + Vector((0, 0.012, 0)), 0.02 * k, 10, 8, name="knot", coll=ctx.coll)
    obj = util.join_objects([band, flap, knot], ctx.name("Acc_bandana"))
    return ctx.finish(obj, ctx.mats["Accent"], slot="accessory", item="bandana")


BUILDERS = {"cap": cap, "beanie": beanie, "goggles": goggles, "bandana": bandana, "headset": headset}
