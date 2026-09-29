"""
Equipo propio de cada conjunto (mismos ids que `outfits` del juego). Se superpone a la
ropa base; los colores salen del conjunto (Jacket / Accent / ...), así que un mismo
modelo sirve para cualquier combinación que el jugador elija.
"""
from __future__ import annotations

import math

import bpy
import numpy as np
from mathutils import Vector

from . import util
from .anatomy import FS
from .parts import Ctx, bvh_of, oriented_box, path_on_surface, ring_around


def _band(ctx, bvh, a, b, t, width, mat, offset=0.003, thick=0.003, n=24, name="band"):
    # extremidades: descarta impactos lejos del eje; tronco (n >= 32): sin límite
    pts, nrs = ring_around(ctx, bvh, a, b, t, offset, n, None if n >= 32 else 0.085 * ctx.k)
    r = util.ribbon(pts, nrs, width, thickness=thick, name=name, coll=ctx.coll, closed=True)
    util.set_material(r, mat)
    return r


def _strap(ctx, bvh, pts, width, mat, offset=0.004, thick=0.004, name="strap", back=False):
    pts = [Vector((q[0], 0.0, q[2])) for q in pts]
    p, n = path_on_surface(ctx, bvh, pts, (0, -1, 0) if back else (0, 1, 0), offset)
    r = util.ribbon(p, n, width, thickness=thick, name=name, coll=ctx.coll)
    util.set_material(r, mat)
    return r


def _diag(a: Vector, b: Vector, n=14):
    return [a + (b - a) * t for t in np.linspace(0, 1, n)]


def _neck_tube(ctx, z_off, offset, radius, flatten, mat, name):
    nb = ctx.an.ref["neck_base"]
    pts, nrs = [], []
    for i in range(28):
        a = 2 * math.pi * i / 28
        d = Vector((math.sin(a), -math.cos(a), 0))
        z = nb.z + z_off - 0.012 * ctx.k * (1 + math.cos(a)) / 2
        hit = ctx.surf.ray(Vector((0, nb.y, z)) + d * 0.4, -d, 0.6)
        if hit[0] is None:
            continue
        pts.append(hit[0] + hit[1] * offset)
        nrs.append(hit[1])
    t = util.tube(pts + pts[:1], radius, 12, flatten, ups=nrs + nrs[:1], name=name, coll=ctx.coll, cap_start=False, cap_end=False)
    util.set_material(t, mat)
    return t


def build(ctx: Ctx, outfit_id: str, jacket: bpy.types.Object, pants: bpy.types.Object):
    J, k, M = ctx.an.joints, ctx.k, ctx.mats
    jb, pb = bvh_of(jacket), bvh_of(pants)
    # tronco sin brazos: evita que bandas y correas "salten" a los brazos en pose A
    tb = bvh_of(jacket, abs(J["LeftUpperArm"].x) * 0.95)
    parts = []
    front_y = -0.4
    if outfit_id == "militar":
        mask = ctx.sets(FS["torso"], FS["belly"]) & (ctx.cen[:, 2] > J["Spine"].z - 0.03 * k)
        mask &= ~((ctx.fs == FS["torso"]) & (ctx.cen[:, 2] > ctx.an.ref["neck_base"].z - 0.03 * k))
        mask &= np.abs(ctx.cen[:, 0]) < abs(J["LeftUpperArm"].x) * 0.78
        vest = ctx.shell("vest", mask, 0.036, iters=14, min_offset=0.03, passes=3)
        util.extrude_boundary_inward(vest, 0.012)
        util.set_material(vest, M["Accent"])
        vb = bvh_of(vest)
        parts.append(vest)
        for x in (-0.075, 0.0, 0.075):
            hit = vb.ray_cast(Vector((x * k, front_y, J["Spine"].z + 0.035 * k)), Vector((0, 1, 0)), 1.0)
            if hit[0] is not None:
                pouch = oriented_box(ctx, hit[0], hit[1], (0, 0, 1), (0.062 * k, 0.03, 0.1 * k), "mag", 0.005)
                util.set_material(pouch, M["Accent"])
                parts.append(pouch)
        for z in (J["Chest"].z + 0.02 * k, J["Chest"].z + 0.06 * k):
            pts = [Vector((x, 0, z)) for x in np.linspace(-0.12 * k, 0.12 * k, 12)]
            parts.append(_strap(ctx, vb, pts, 0.012, M["Gear"], 0.002, 0.002, "web"))
    elif outfit_id == "urbano":
        nb = ctx.an.ref["neck_base"]
        pts, nrs = [], []
        for a in np.linspace(math.radians(70), math.radians(290), 18):
            d = Vector((math.sin(a), -math.cos(a), 0))
            z = nb.z + 0.0 * k - 0.02 * k * math.sin((a - math.radians(70)) / math.radians(220) * math.pi)
            hit = jb.ray_cast(Vector((0, nb.y, z)) + d * 0.4, -d, 0.6)
            if hit[0] is None:
                continue
            pts.append(hit[0] + hit[1] * 0.02 + Vector((0, 0.012, 0)))
            nrs.append(hit[1])
        hood = util.tube(pts, 0.045 * k, 12, 0.45, ups=nrs, name="hood", coll=ctx.coll)
        util.set_material(hood, M["Jacket"])
        parts.append(hood)
        for sx in (1, -1):
            top = Vector((sx * 0.035 * k, nb.y - 0.06 * k, nb.z - 0.005))
            hit = jb.ray_cast(top + Vector((0, -0.3, 0)), Vector((0, 1, 0)), 0.6)
            p0 = hit[0] + hit[1] * 0.006 if hit[0] is not None else top
            cord = [p0 + Vector((0, -0.004 * t, -0.13 * k * t)) for t in np.linspace(0, 1, 6)]
            c = util.tube(cord, 0.003, 6, name="cord", coll=ctx.coll)
            util.set_material(c, M["Accent"])
            tip = util.cylinder(cord[-1], (0, 0, 1), 0.0045, 0.018, 8, name="aglet", coll=ctx.coll)
            util.set_material(tip, M["Metal"])
            parts += [c, tip]
        for side in ("Left", "Right"):
            for t in (0.3, 0.42):
                parts.append(_band(ctx, jb, J[f"{side}UpperArm"], J[f"{side}LowerArm"], t, 0.012, M["Accent"]))
    elif outfit_id == "sanitario":
        for side, sx in (("Left", 1), ("Right", -1)):
            a, b = J[f"{side}UpperArm"], J[f"{side}LowerArm"]
            parts.append(_band(ctx, jb, a, b, 0.42, 0.065 * k, M["Accent"], 0.004, 0.004))
            c = a + (b - a) * 0.42
            out = Vector((sx, 0, 0))
            hit = jb.ray_cast(c + out * 0.3, -out, 0.5)
            if hit[0] is not None:
                axis = (b - a).normalized()
                for size in ((0.042 * k, 0.004, 0.014 * k), (0.014 * k, 0.004, 0.042 * k)):
                    cr = oriented_box(ctx, hit[0] + hit[1] * 0.008, hit[1], axis, size, "cross", 0.001)
                    util.set_material(cr, M["Fur"])
                    parts.append(cr)
        hit = jb.ray_cast(Vector((0.095 * k, front_y, J["UpperChest"].z + 0.045 * k)), Vector((0, 1, 0)), 1.0)
        if hit[0] is not None:
            for size in ((0.05 * k, 0.004, 0.016 * k), (0.016 * k, 0.004, 0.05 * k)):
                cr = oriented_box(ctx, hit[0], hit[1], (0, 0, 1), size, "cross", 0.001)
                util.set_material(cr, M["Accent"])
                parts.append(cr)
        hit = pb.ray_cast(Vector((-0.11 * k, front_y, J["Hips"].z + 0.02 * k)), Vector((0.4, 1, 0)), 1.0)
        if hit[0] is not None:
            bag = oriented_box(ctx, hit[0], hit[1], (0, 0, 1), (0.1 * k, 0.045, 0.075 * k), "medbag", 0.008)
            util.set_material(bag, M["Accent"])
            parts.append(bag)
    elif outfit_id == "obrero":
        spine_a, spine_b = J["Hips"], J["Neck"]
        for t in (0.42, 0.6):
            parts.append(_band(ctx, tb, spine_a, spine_b, t, 0.045 * k, M["Accent"], 0.003, 0.003, 32))
        for side in ("Left", "Right"):
            parts.append(_band(ctx, jb, J[f"{side}UpperArm"], J[f"{side}LowerArm"], 0.6, 0.04 * k, M["Accent"]))
            parts.append(_band(ctx, pb, J[f"{side}LowerLeg"], J[f"{side}Foot"], 0.28, 0.045 * k, M["Accent"]))
        for sx in (1, -1):
            hit = pb.ray_cast(Vector((sx * 0.16 * k, -0.2, J["Hips"].z)), Vector((-sx * 0.3, 1, 0)), 1.0)
            if hit[0] is not None:
                pouch = oriented_box(ctx, hit[0], hit[1], (0, 0, 1), (0.08 * k, 0.04, 0.09 * k), "tool", 0.006)
                util.set_material(pouch, M["Gear"])
                parts.append(pouch)
    elif outfit_id == "sigilo":
        sh = {s: J[f"{s}UpperArm"] for s in ("Left", "Right")}
        hip = J["Hips"]
        for sgn, side in ((1, "Left"), (-1, "Right")):
            a = Vector((sh[side].x * 0.6, 0, sh[side].z + 0.02))
            b = Vector((-sgn * 0.13 * k, 0, hip.z + 0.03))
            parts.append(_strap(ctx, tb, _diag(a, b), 0.032 * k, M["Gear"], 0.004, 0.004))
            parts.append(_strap(ctx, tb, _diag(a, b), 0.032 * k, M["Gear"], 0.004, 0.004, back=True))
            parts.append(_strap(ctx, tb, _diag(a, b), 0.005 * k, M["Accent"], 0.0085, 0.0015, "led"))
        hit = jb.ray_cast(Vector((0, front_y, (sh["Left"].z + hip.z) / 2 + 0.03)), Vector((0, 1, 0)), 1.0)
        if hit[0] is not None:
            plate = oriented_box(ctx, hit[0] + hit[1] * 0.004, hit[1], (0, 0, 1), (0.07 * k, 0.012, 0.07 * k), "plate", 0.006)
            util.set_material(plate, M["Gear"])
            led = oriented_box(ctx, hit[0] + hit[1] * 0.016, hit[1], (0, 0, 1), (0.04 * k, 0.003, 0.008 * k), "led", 0.001)
            util.set_material(led, M["Accent"])
            parts += [plate, led]
        for side in ("Left", "Right"):
            for t in (0.25, 0.75):
                parts.append(_band(ctx, jb, J[f"{side}LowerArm"], J[f"{side}Hand"], t, 0.006, M["Accent"], 0.002, 0.002))
    elif outfit_id == "desierto":
        parts.append(_neck_tube(ctx, 0.028 * ctx.k, 0.032, 0.03 * k, 0.6, M["Accent"], "shemagh"))
        parts.append(_neck_tube(ctx, 0.0, 0.045, 0.028 * k, 0.55, M["Accent"], "shemagh2"))
        a = Vector((J["LeftUpperArm"].x * 0.55, 0, J["LeftUpperArm"].z + 0.03))
        b = Vector((-0.13 * k, 0, J["Hips"].z + 0.01))
        pts = _diag(a, b, 16)
        parts.append(_strap(ctx, tb, pts, 0.045 * k, M["Boots"], 0.004, 0.004, "bandolier"))
        pp, nn = path_on_surface(ctx, tb, pts[3:14:2], (0, 1, 0), 0.01)
        tang = (b - a).normalized()
        for p, n in zip(pp, nn):
            sh = oriented_box(ctx, p, n, tang.cross(n).normalized(), (0.012, 0.012, 0.035 * k), "shell", 0.003)
            util.set_material(sh, M["Metal"])
            parts.append(sh)
    elif outfit_id == "artico":
        parts.append(_neck_tube(ctx, 0.04 * ctx.k, 0.03, 0.034 * k, 0.75, M["Fur"], "fur"))
        for side in ("Left", "Right"):
            for t in (0.35, 0.47):
                parts.append(_band(ctx, jb, J[f"{side}UpperArm"], J[f"{side}LowerArm"], t, 0.02 * k, M["Accent"]))
        parts.append(_band(ctx, tb, J["Hips"], J["Neck"], 0.64, 0.03 * k, M["Accent"], 0.003, 0.003, 32))
    elif outfit_id == "carmesi":
        for side, sx in (("Left", 1), ("Right", -1)):
            s = J[f"{side}UpperArm"]
            hit = jb.ray_cast(s + Vector((0, 0, 0.3)), Vector((0, 0, -1)), 0.5)
            if hit[0] is not None:
                ep = oriented_box(ctx, hit[0], hit[1], Vector((sx, 0, 0)), (0.075 * k, 0.012, 0.11 * k), "epaulette", 0.006)
                util.set_material(ep, M["Accent"])
                parts.append(ep)
                for i in range(5):
                    f = util.tube([hit[0] + Vector((sx * 0.055 * k, (i - 2) * 0.012, 0.004)),
                                   hit[0] + Vector((sx * 0.064 * k, (i - 2) * 0.012, -0.035 * k))], 0.0028, 6,
                                  name="fringe", coll=ctx.coll)
                    util.set_material(f, M["Accent"])
                    parts.append(f)
            parts.append(_band(ctx, jb, J[f"{side}LowerArm"], J[f"{side}Hand"], 0.78, 0.012, M["Accent"]))
        a = Vector((J["LeftUpperArm"].x * 0.55, 0, J["LeftUpperArm"].z + 0.02))
        b = Vector((-0.12 * k, 0, J["Hips"].z + 0.02))
        parts.append(_strap(ctx, tb, _diag(a, b, 16), 0.05 * k, M["Accent"], 0.005, 0.003, "sash"))
    else:
        raise ValueError(outfit_id)
    obj = util.join_objects(parts, ctx.name(f"Outfit_{outfit_id}"))
    return ctx.finish(obj, None, slot="outfit", item=outfit_id)
