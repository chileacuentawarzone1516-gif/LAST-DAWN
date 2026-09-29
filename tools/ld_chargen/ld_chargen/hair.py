"""
Peinados (6 por género, mismos ids que el juego) + cejas.

Cada peinado = casquete (shell sobre el cuero cabelludo) + mechones (tubos aplanados
que crecen sobre la superficie con gravedad y colisión contra el cuerpo).
Lo que sobresale por encima de la línea de una gorra va en una pieza aparte `_Top`
que el personalizador oculta cuando el accesorio es gorra o gorro.
"""
from __future__ import annotations

import math
import random

import bpy
import numpy as np
from mathutils import Vector

from . import util
from .parts import Ctx, head_frame, line_mask


# ─────────────────────────────────────────────────────────────────────────────
# Base
# ─────────────────────────────────────────────────────────────────────────────
def scalp_mask(ctx: Ctx, drop: float = 0.0) -> np.ndarray:
    k = ctx.k
    eye_z = ctx.an.joints["LeftEye"].z
    ear_c = ctx.an.ref["ear_center"]
    ear_top = ear_c.z + 0.028 * k
    return line_mask(ctx, [0, 35, 75, 110, 150, 180],
                     [eye_z + 0.058 * k - drop, eye_z + 0.042 * k - drop, ear_top - drop,
                      ear_c.z - 0.02 * k - drop, ear_c.z - 0.05 * k - drop, ear_c.z - 0.056 * k - drop])


def shell(ctx: Ctx, name: str, thickness: float, drop: float = 0.0) -> bpy.types.Object:
    obj = ctx.shell(name, scalp_mask(ctx, drop), thickness, iters=5, min_offset=thickness * 0.85, passes=2)
    util.extrude_boundary_inward(obj, thickness + 0.002)
    util.set_material(obj, ctx.mats["Hair"])
    return obj


def _tangent(v: Vector, n: Vector) -> Vector:
    t = v - n * v.dot(n)
    return t.normalized() if t.length > 1e-6 else v.normalized()


def grow(ctx: Ctx, root: Vector, normal: Vector, direction: Vector, length: float, segs: int = 8,
         gravity: float = 0.0, clearance: float = 0.012, stiff: float = 0.85, low_clear: float = 0.04,
         hug: float = 0.0, target: Vector | None = None):
    """Polilínea de un mechón: sigue la dirección (o va hacia `target`), cae con la gravedad,
    se pega al cráneo durante la fracción `hug` de su longitud y nunca atraviesa el cuerpo."""
    neck_z = ctx.an.ref["neck_base"].z + 0.05 * ctx.k
    pts, ups = [root.copy()], [normal.copy()]
    d = _tangent(direction, normal)
    p = root.copy()
    step = length / segs
    nor = normal
    for i in range(segs):
        hugging = (i + 1) / segs <= hug + 1e-6
        if target is not None:
            to = target - p
            if to.length < step * 0.6:
                break
            d = _tangent(to, nor) if hugging else to.normalized()
        d = (d * stiff + Vector((0, 0, -1)) * gravity * (i + 1) / segs).normalized()
        if hugging:
            d = _tangent(d, nor)
        p = p + d * step
        loc, nor, _ = ctx.surf.nearest(p)
        clear = clearance if p.z > neck_z else low_clear
        dist = (p - loc).dot(nor)
        if hugging or dist < clear:
            p = loc + nor * clear
            d = _tangent(d, nor)
        pts.append(p.copy())
        ups.append(nor.copy())
    if len(pts) < 3:
        mid = (pts[0] + pts[-1]) * 0.5
        pts.insert(1, mid)
        ups.insert(1, ups[0])
    return pts, ups


def strand_mesh(ctx: Ctx, strands, r0: float, flatten: float = 0.45, sides: int = 6, name: str = "strands"):
    objs = []
    for pts, ups in strands:
        n = len(pts)
        radii = [r0 * (1.0 - 0.85 * (i / (n - 1)) ** 1.4) for i in range(n)]
        objs.append(util.tube(pts, radii, sides=sides, flatten=flatten, ups=ups, name=name, coll=ctx.coll,
                              cap_start=False, cap_end=True))
    return util.join_objects(objs, name) if objs else None


def roots_from(obj: bpy.types.Object, pred, count: int, seed: int, inset: float = 0.003):
    me = obj.data
    co, nr = util.get_co(me), util.get_vnormals(me)
    idx = [i for i in range(len(co)) if pred(Vector(co[i]), Vector(nr[i]))]
    rnd = random.Random(seed)
    rnd.shuffle(idx)
    out = []
    for i in idx[:count]:
        n = Vector(nr[i])
        jitter = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.003
        out.append((Vector(co[i]) - n * inset + jitter, n))
    return out


def hair_weights(ctx: Ctx, obj: bpy.types.Object) -> None:
    """Head arriba; por debajo de la nuca mezcla progresiva con UpperChest (melenas largas)."""
    for vg in list(obj.vertex_groups):
        obj.vertex_groups.remove(vg)
    head = obj.vertex_groups.new(name="Head")
    chest = obj.vertex_groups.new(name="UpperChest")
    z0 = ctx.an.ref["neck_base"].z + 0.06 * ctx.k
    for v in obj.data.vertices:
        w = min(max((z0 - v.co.z) / 0.18, 0.0), 0.75)
        head.add([v.index], 1.0 - w, "REPLACE")
        if w > 0:
            chest.add([v.index], w, "REPLACE")


def _finish(ctx: Ctx, obj, style: str, part: str):
    if obj is None:
        return None
    util.set_material(obj, ctx.mats["Hair"])
    obj.data.shade_smooth()
    hair_weights(ctx, obj)
    util.add_armature(obj, ctx.rig)
    util.link_only(obj, ctx.coll)
    util.tag(obj, ld_slot="hair", ld_item=style, ld_part=part)
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="UVMap")
    return obj


def _assemble(ctx: Ctx, style: str, main: list, top: list):
    base = f"Hair_{style}"
    out = [_finish(ctx, util.join_objects([o for o in main if o], ctx.name(base)), style, "main")]
    top = [o for o in top if o]
    if top:
        out.append(_finish(ctx, util.join_objects(top, ctx.name(base + "_Top")), style, "top"))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Estilos
# ─────────────────────────────────────────────────────────────────────────────
def _cap_z(ctx: Ctx) -> float:
    """Altura a partir de la cual algo queda dentro de una gorra/gorro."""
    return ctx.an.joints["LeftEye"].z + 0.07 * ctx.k


def _flow_down(C):
    def f(p, n):
        radial = Vector((p.x - C.x, p.y - C.y, 0))
        return (radial.normalized() * 0.12 if radial.length > 1e-6 else Vector()) + Vector((0, 0, -1))
    return f


def build_style(ctx: Ctx, style: str):
    k = ctx.k
    C, az = head_frame(ctx)
    eye_z = ctx.an.joints["LeftEye"].z
    chin_z = ctx.an.ref["chin"].z
    neck_z = ctx.an.ref["neck_base"].z
    cap_z = _cap_z(ctx)
    name = ctx.name(f"Hair_{style}")
    rnd = random.Random(hash(style) & 0xFFFF)

    def strands_from(roots, dir_fn, len_fn, gravity, clearance, segs=8, stiff=0.85, hug=0.0, target=None):
        out = []
        for p, n in roots:
            L = len_fn(p) * rnd.uniform(0.88, 1.1)
            if L <= 0.005:
                continue
            out.append(grow(ctx, p, n, dir_fn(p, n), L, segs, gravity, clearance, stiff, hug=hug, target=target))
        return out

    front = lambda p: az(p) < 40
    if style == "rapado":
        return _assemble(ctx, style, [shell(ctx, name, 0.0028)], [])

    if style == "corto":
        sh = shell(ctx, name, 0.009)
        roots = roots_from(sh, lambda p, n: p.z > eye_z + 0.075 * k, 90, 1)
        st = strands_from(roots, lambda p, n: Vector((0, -0.5, 0.35)) + Vector((rnd.uniform(-.3, .3), 0, 0)),
                          lambda p: 0.05 * k, 0.05, 0.0105, 5, hug=0.7)
        return _assemble(ctx, style, [sh], [strand_mesh(ctx, st, 0.0095, 0.45, name="top")])

    if style == "peinado":
        sh = shell(ctx, name, 0.011)
        roots = roots_from(sh, lambda p, n: p.z > eye_z + 0.05 * k and (p.y - C.y) < 0.03, 110, 2)
        st = strands_from(roots, lambda p, n: Vector((0, 1, 0.1)), lambda p: 0.11 * k, 0.08, 0.0125, 7, hug=1.0)
        return _assemble(ctx, style, [sh, strand_mesh(ctx, st, 0.0085, 0.4, name="sw")], [])

    if style == "rizado":
        sh = shell(ctx, name, 0.013)
        me = sh.data
        co, nr = util.get_co(me), util.get_vnormals(me)
        idx = list(range(len(co)))
        rnd.shuffle(idx)
        low, high = [], []
        for i in idx[:220]:
            p, n = Vector(co[i]), Vector(nr[i])
            if n.z < -0.2:
                continue
            r = rnd.uniform(0.0085, 0.0125) * k
            s = util.uv_sphere(p + n * r * 0.35, r, 8, 6, (1, 1, 0.85), name="curl", coll=ctx.coll)
            (high if p.z > cap_z - 0.01 else low).append(s)
        return _assemble(ctx, style, [sh] + low, high)

    def long_dir(p, n):
        # raya al medio: lo de delante se aparta hacia los lados y atrás, el resto cae
        side = 1.0 if p.x >= 0 else -1.0
        if az(p) < 70:
            return Vector((side * 0.9, 0.35, -0.6))
        return _flow_down(C)(p, n)

    if style == "melena":
        sh = shell(ctx, name, 0.010)
        target = neck_z - 0.03 * k
        roots = roots_from(sh, lambda p, n: True, 240, 3)
        st = strands_from(roots, long_dir, lambda p: min(max(p.z - target, 0.02), 0.30 * k), 0.3, 0.012, 11, hug=0.55)
        return _assemble(ctx, style, [sh, strand_mesh(ctx, st, 0.0165, 0.3, name="m")], [])

    if style == "mohicano":
        sh = shell(ctx, name, 0.0025)
        crest = []
        ys = np.linspace(-0.02, 0.11, 30) * k
        for i, y in enumerate(ys):
            o = Vector((0, C.y + y, C.z + 0.3))
            hit = ctx.surf.ray(o, (0, 0, -1), 1.0)
            if hit[0] is None:
                continue
            p, n = hit[0], hit[1]
            if p.z < eye_z + 0.06 * k:
                continue
            h = (0.075 + 0.03 * math.sin(math.pi * i / (len(ys) - 1))) * k
            for sx in (-0.006, 0.006):
                q = p + Vector((sx, 0, 0))
                pts, ups = grow(ctx, q, n, Vector((0, 0.35, 1.0)), h, 5, 0.0, 0.004, 0.95)
                crest.append((pts, [Vector((1, 0, 0))] * len(pts)))
        return _assemble(ctx, style, [sh], [strand_mesh(ctx, crest, 0.012, 0.3, name="crest")])

    # ── femeninos ─────────────────────────────────────────────────────────
    if style == "pixie":
        sh = shell(ctx, name, 0.009)
        roots = roots_from(sh, lambda p, n: p.z > eye_z + 0.04 * k, 130, 4)
        st = strands_from(roots, lambda p, n: Vector((0.8, -0.35 if p.y < C.y else 0.3, -0.1)),
                          lambda p: 0.075 * k, 0.12, 0.011, 6, hug=0.8)
        fr = roots_from(sh, lambda p, n: az(p) < 35 and p.z < eye_z + 0.085 * k, 18, 5)
        fringe = strands_from(fr, lambda p, n: Vector((0.6, -0.3, -1)), lambda p: 0.075 * k, 0.1, 0.009, 6, hug=0.6)
        return _assemble(ctx, style, [sh, strand_mesh(ctx, st + fringe, 0.009, 0.4, name="px")], [])

    if style in ("media", "larga"):
        sh = shell(ctx, name, 0.010)
        target = (chin_z - 0.01 * k) if style == "media" else (neck_z - 0.24 * k)
        maxlen = 0.2 * k if style == "media" else 0.46 * k
        roots = roots_from(sh, lambda p, n: az(p) > 30 or p.z > eye_z + 0.1 * k, 260, 6)
        st = strands_from(roots, long_dir, lambda p: min(max(p.z - target, 0.03), maxlen), 0.35, 0.012, 13, hug=0.5)
        # flequillo ladeado, corto y pegado a la frente (no tapa los ojos)
        fr = roots_from(sh, lambda p, n: az(p) <= 30, 20, 7)
        fringe = strands_from(fr, lambda p, n: Vector((1.0, 0.1, -0.35)), lambda p: 0.085 * k, 0.05, 0.009, 7, hug=1.0)
        return _assemble(ctx, style, [sh, strand_mesh(ctx, st + fringe, 0.0165, 0.3, name="lg")], [])

    if style in ("coleta", "mono", "trenzas"):
        sh = shell(ctx, name, 0.0065)
        if style == "coleta":
            T = C + Vector((0, 0.095 * k, 0.045 * k))
        elif style == "mono":
            T = C + Vector((0, 0.1 * k, -0.005 * k))
        else:
            T = C + Vector((0, 0.08 * k, -0.02 * k))
        roots = roots_from(sh, lambda p, n: True, 170, 8)
        # recogido: mechones pegados que van hacia el punto de recogida (o raya al medio en trenzas)
        ear_c = ctx.an.ref["ear_center"]
        if style == "trenzas":
            st = []
            for sx in (1, -1):
                B = Vector((sx * 0.062 * k, ear_c.y + 0.035 * k, ear_c.z - 0.035 * k))
                side_roots = [r for r in roots if (r[0].x >= 0) == (sx > 0)]
                st += strands_from(side_roots, lambda p, n: B - p, lambda p: min((B - p).length, 0.2 * k), 0.0, 0.0075, 7, 0.95, hug=1.0, target=B)
        else:
            st = strands_from(roots, lambda p, n: T - p, lambda p: min((T - p).length, 0.2 * k), 0.0, 0.0075, 7, 0.95, hug=1.0, target=T)
        main = [sh, strand_mesh(ctx, st, 0.0075, 0.35, name="pull")]
        acc = []
        if style == "coleta":
            n_ = (T - C).normalized()
            tail_roots = [(T + Vector((rnd.uniform(-.012, .012), 0, rnd.uniform(-.012, .012))), n_) for _ in range(46)]
            tail = strands_from(tail_roots, lambda p, n: Vector((0, 0.6, -0.4)), lambda p: 0.30 * k, 0.55, 0.016, 10, 0.8)
            main.append(strand_mesh(ctx, tail, 0.012, 0.6, name="tail"))
            tie = util.tube([T + Vector((0, 0.004, 0)), T + Vector((0, 0.022, -0.008))], 0.017, 10, 1.0, name="tie", coll=ctx.coll)
            acc.append(tie)
        elif style == "mono":
            bun = util.uv_sphere(T + Vector((0, 0.03, 0.005)) * 1.0, 0.04 * k, 14, 10, (1.0, 0.8, 0.9), name="bun", coll=ctx.coll)
            wrap = []
            for j in range(3):
                pts = []
                for a in np.linspace(0, 2 * math.pi * 1.1, 18):
                    rr = (0.036 - j * 0.009) * k
                    pts.append(T + Vector((0, 0.03 + 0.012 * j, 0.005)) + Vector((math.cos(a + j), 0, math.sin(a + j))) * rr
                               + Vector((0, 0.03 * math.sin(a * 0.5) * 0.3, 0)))
                wrap.append((pts, [Vector((0, 1, 0))] * len(pts)))
            main += [bun, strand_mesh(ctx, wrap, 0.01, 0.5, name="wrap")]
            tie = util.tube([T + Vector((0, 0.0, 0)), T + Vector((0, 0.012, 0))], 0.024 * k, 12, 1.0, name="tie", coll=ctx.coll)
            acc.append(tie)
        else:
            for sx in (1, -1):
                B = Vector((sx * 0.062 * k, ear_c.y + 0.035 * k, ear_c.z - 0.035 * k))
                n_ = Vector((sx, 0.3, 0)).normalized()
                pts, ups = grow(ctx, B, n_, Vector((sx * 0.25, -0.7, -1)), 0.34 * k, 12, 0.3, 0.02, 0.8, 0.045)
                segs = []
                for i in range(len(pts) - 1):
                    a, b = pts[i], pts[i + 1]
                    mid = (a + b) * 0.5
                    r = (0.017 - 0.006 * i / len(pts)) * k
                    tang = (b - a).normalized()
                    tilt = (1 if i % 2 else -1) * 0.45
                    side = tang.cross(ups[i]).normalized()
                    axis = (tang + side * tilt).normalized()
                    rot = axis.to_track_quat("Z", "Y").to_matrix()
                    segs.append(util.uv_sphere(mid, r, 10, 7, (0.8, 0.62, 1.25), name="braid", coll=ctx.coll, rot=rot))
                main += segs
                end = pts[-1]
                tie = util.tube([end + Vector((0, 0, 0.008)), end - Vector((0, 0, 0.006))], 0.009 * k, 10, 1.0, name="tie", coll=ctx.coll)
                acc.append(tie)
                tuft = [grow(ctx, end, n_, Vector((0, -0.2, -1)), 0.05 * k, 4, 0.2, 0.02, 0.9, 0.045)]
                main.append(strand_mesh(ctx, tuft, 0.01, 0.6, name="tuft"))
        objs = _assemble(ctx, style, main, [])
        if acc:
            tie = util.join_objects(acc, ctx.name(f"Hair_{style}_Tie"))
            util.set_material(tie, ctx.mats["Accent"])
            tie.data.shade_smooth()
            hair_weights(ctx, tie)
            util.add_armature(tie, ctx.rig)
            util.link_only(tie, ctx.coll)
            util.tag(tie, ld_slot="hair", ld_item=style, ld_part="tie")
            tie.data.uv_layers.new(name="UVMap")
            objs.append(tie)
        return objs
    raise ValueError(f"Peinado desconocido: {style}")


def brows(ctx: Ctx) -> bpy.types.Object:
    k = ctx.k
    male = ctx.gender == "male"
    pieces = []
    for side, sgn in (("Left", 1), ("Right", -1)):
        e = ctx.an.joints[f"{side}Eye"]
        pts, nrs, widths = [], [], []
        for i, t in enumerate(np.linspace(0, 1, 9)):
            x = e.x + sgn * (-0.013 + 0.043 * t) * k
            z = e.z + (0.019 + 0.009 * math.sin(math.pi * min(t * 1.15, 1.0)) - 0.004 * t) * k
            hit = ctx.surf.ray((x, e.y - 0.3, z), (0, 1, 0), 0.6)
            if hit[0] is None:
                continue
            pts.append(hit[0] + hit[1] * 0.0012)
            nrs.append(hit[1])
            w0, w1 = (0.0085, 0.0035) if male else (0.0055, 0.0022)
            widths.append((w0 + (w1 - w0) * t) * k)
        r = util.ribbon(pts, nrs, widths, thickness=0.0008, name="brow", coll=ctx.coll)
        pieces.append(r)
    obj = util.join_objects(pieces, ctx.name("Brows"))
    util.set_material(obj, ctx.mats["Hair"])
    obj.data.shade_smooth()
    util.rigid_weights(obj, "Head")
    util.add_armature(obj, ctx.rig)
    util.link_only(obj, ctx.coll)
    util.tag(obj, ld_slot="base", ld_part="brows")
    obj.data.uv_layers.new(name="UVMap")
    return obj
