"""
Contexto compartido por los generadores de piezas (ropa, pelo, accesorios, equipo)
y el cierre común de cada pieza: pesos, armature, material, metadatos y colección.

Convención de nombres de las piezas (el personalizador de Godot se basa en ella):
    LD_<G>_Body / LD_<G>_Eye.L/R                 base (siempre visibles)
    LD_<G>_Outfit_Base_<Jacket|Pants|Boots|Gloves> ropa común (siempre visible)
    LD_<G>_Outfit_<outfitId>                      equipo propio de cada conjunto
    LD_<G>_Hair_<styleId>[_Top]                   peinado (+ parte que se oculta bajo gorras)
    LD_<G>_Acc_<accessoryId>                      accesorio
"""
from __future__ import annotations

from dataclasses import dataclass, field

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import config as C
from . import util
from .anatomy import FS, Anatomy


@dataclass
class Ctx:
    gender: str
    rig: bpy.types.Object
    ref: bpy.types.Object
    an: Anatomy
    mats: dict
    coll: bpy.types.Collection
    surf: util.Surface = field(init=False)
    fs: np.ndarray = field(init=False)
    cen: np.ndarray = field(init=False)
    k: float = field(init=False)

    def __post_init__(self):
        self.surf = util.Surface(self.ref)
        self.fs = util.get_face_sets(self.ref.data)
        self.cen = util.face_centers(self.ref.data)
        self.k = self.an.height / 1.78

    @property
    def t(self) -> str:
        return C.TAG[self.gender]

    def name(self, suffix: str) -> str:
        return f"LD_{self.t}_{suffix}"

    def sets(self, *ids) -> np.ndarray:
        flat = []
        for i in ids:
            if isinstance(i, dict):
                flat += list(i.values())
            elif isinstance(i, (tuple, list)):
                flat += list(i)
            else:
                flat.append(i)
        return np.isin(self.fs, flat)

    def shell(self, name: str, mask: np.ndarray, offset, iters: int = 8, min_offset=None,
              factor: float = 0.5, passes: int = 3) -> bpy.types.Object:
        obj = util.subset_copy(self.ref, mask, name, self.coll)
        for vg in list(obj.vertex_groups):
            obj.vertex_groups.remove(vg)
        util.offset_shell(obj, offset, self.surf, iters, factor, min_offset, passes)
        return obj

    def finish(self, obj: bpy.types.Object, mat=None, *, slot: str, item: str, part: str = "main",
               rigid: str | None = None, sharp: float | None = None) -> bpy.types.Object:
        if mat is not None:
            util.set_material(obj, mat)
        if sharp is None:
            obj.data.shade_smooth()
        else:
            util.smooth_normals_sharp(obj, sharp)
        if rigid:
            util.rigid_weights(obj, rigid)
        else:
            util.transfer_weights(obj, self.ref)
        util.add_armature(obj, self.rig)
        util.link_only(obj, self.coll)
        util.tag(obj, ld_slot=slot, ld_item=item, ld_part=part)
        # para el UV del glTF: toda pieza necesita al menos una capa
        if not obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap")
        return obj

    # ── utilidades de colocación ────────────────────────────────────────────
    def on_surface(self, target_bvh, origin, direction, offset: float = 0.0):
        hit = target_bvh.ray_cast(Vector(origin), Vector(direction).normalized(), 2.0)
        if hit[0] is None:
            loc, nor, _ = self.surf.nearest(origin)
            return loc + nor * offset, nor
        return hit[0] + hit[1] * offset, hit[1]


def bvh_of(obj: bpy.types.Object, max_abs_x: float | None = None):
    """BVH de una pieza. `max_abs_x` limita a las caras del tronco (sin brazos en pose A)."""
    from mathutils.bvhtree import BVHTree
    me = obj.data
    co = util.get_co(me)
    faces = util.face_vertex_lists(me)
    if max_abs_x is not None:
        faces = [f for f in faces if all(abs(co[i][0]) < max_abs_x for i in f)]
    return BVHTree.FromPolygons([tuple(v) for v in co], faces, all_triangles=False)


def oriented_box(ctx: Ctx, center: Vector, normal: Vector, up: Vector, size, name: str, bevel: float = 0.003):
    """Caja apoyada en una superficie: Y local = normal, Z local ≈ `up`."""
    n = Vector(normal).normalized()
    z = (Vector(up) - n * Vector(up).dot(n)).normalized()
    x = z.cross(n).normalized()
    R = Matrix((x, n, z)).transposed()
    c = Vector(center) + n * size[1] * 0.5
    return util.box(c, size, R.to_4x4(), name=name, coll=ctx.coll, bevel=bevel)


def ring_points(obj: bpy.types.Object, loop: list[int]):
    me = obj.data
    co = util.get_co(me)
    nr = util.get_vnormals(me)
    return [Vector(co[i]) for i in loop], [Vector(nr[i]) for i in loop]


def ring_around(ctx: Ctx, target_bvh, a: Vector, b: Vector, t: float, offset: float, n: int = 24,
                max_r: float | None = None):
    """Anillo sobre una superficie alrededor del eje a→b (para bandas en brazos, piernas, torso)."""
    import math
    axis = (b - a).normalized()
    c = a + (b - a) * t
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.8 else Vector((0, -1, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    pts, nrs = [], []
    for i in range(n):
        ang = 2 * math.pi * i / n
        d = u * math.cos(ang) + v * math.sin(ang)
        hit = target_bvh.ray_cast(c + d * 0.4, -d, 0.6)
        if hit[0] is None:
            continue
        if max_r is not None and (hit[0] - c).length > max_r:
            continue  # el rayo chocó con otra parte (torso/cadera), no con la extremidad
        pts.append(hit[0] + hit[1] * offset)
        nrs.append(hit[1])
    return pts, nrs


def path_on_surface(ctx: Ctx, target_bvh, pts, direction, offset: float):
    """Proyecta puntos sobre una superficie lanzando rayos en `direction`."""
    out_p, out_n = [], []
    for p in pts:
        hit = target_bvh.ray_cast(Vector(p) - Vector(direction).normalized() * 0.4, Vector(direction), 0.8)
        if hit[0] is None:
            loc, nor, _ = ctx.surf.nearest(p)
            out_p.append(loc + nor * (offset + 0.02))
            out_n.append(nor)
        else:
            out_p.append(hit[0] + hit[1] * offset)
            out_n.append(hit[1])
    return out_p, out_n


def head_frame(ctx: Ctx):
    """Centro de la cabeza y funciones de acimut (0° = frente, ±180° = nuca)."""
    import math
    ear_c = ctx.an.ref["ear_center"]
    C = Vector((0.0, ear_c.y + 0.004, ear_c.z + 0.035 * ctx.k))

    def azimuth(p) -> float:
        return abs(math.degrees(math.atan2(p[0] - C.x, -(p[1] - C.y))))
    return C, azimuth


def line_mask(ctx: Ctx, table_deg, table_z) -> np.ndarray:
    """Caras de la cabeza por encima de una línea (pelo, gorra...) definida por acimut."""
    C, _ = head_frame(ctx)
    cen = ctx.cen
    az = np.degrees(np.abs(np.arctan2(cen[:, 0] - C.x, -(cen[:, 1] - C.y))))
    zmin = np.interp(az, table_deg, table_z)
    return (ctx.fs == FS["head"]) & (cen[:, 2] > zmin)
