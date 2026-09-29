"""
Utilidades geométricas y de escena compartidas por todos los generadores.

Todo trabaja sobre datos (bmesh / numpy / mathutils) en lugar de operadores de la UI,
salvo donde Blender no ofrece alternativa (aplicar modificadores, pesos automáticos),
que se ejecutan con `temp_override` para no depender del estado de la interfaz.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


# ─────────────────────────────────────────────────────────────────────────────
# Color
# ─────────────────────────────────────────────────────────────────────────────
def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(hex_color: int) -> tuple[float, float, float]:
    """0xRRGGBB (sRGB) → tupla lineal (lo que esperan las propiedades de color de Blender)."""
    r, g, b = (hex_color >> 16) & 255, (hex_color >> 8) & 255, hex_color & 255
    return tuple(srgb_to_linear(v / 255.0) for v in (r, g, b))  # type: ignore[return-value]


def hex_rgba(hex_color: int, alpha: float = 1.0) -> tuple[float, float, float, float]:
    return (*hex_rgb(hex_color), alpha)


def shade_hex(hex_color: int, k: float) -> int:
    """Mismo algoritmo que `shadeColor` de src/ui/portrait.ts (aclara k>0, oscurece k<0)."""
    f = max(-1.0, min(1.0, k))

    def ch(v: int) -> int:
        return round(v + (255 - v) * f if f >= 0 else v * (1 + f))

    r, g, b = (hex_color >> 16) & 255, (hex_color >> 8) & 255, hex_color & 255
    return (ch(r) << 16) | (ch(g) << 8) | ch(b)


# ─────────────────────────────────────────────────────────────────────────────
# Escena
# ─────────────────────────────────────────────────────────────────────────────
def ensure_collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if coll.name not in parent.children:
        parent.children.link(coll)
    return coll


def deselect_all() -> None:
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)


def link_only(obj: bpy.types.Object, coll: bpy.types.Collection) -> None:
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def remove_object(obj: bpy.types.Object | None) -> None:
    if obj is None:
        return
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if data is not None and getattr(data, "users", 1) == 0:
        if isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
        elif isinstance(data, bpy.types.Armature):
            bpy.data.armatures.remove(data)
        elif isinstance(data, bpy.types.Curve):
            bpy.data.curves.remove(data)


def remove_collection_recursive(name: str) -> None:
    coll = bpy.data.collections.get(name)
    if coll is None:
        return
    for child in list(coll.children):
        remove_collection_recursive(child.name)
    for obj in list(coll.objects):
        remove_object(obj)
    bpy.data.collections.remove(coll)


def new_mesh_object(name: str, verts, faces, coll: bpy.types.Collection, smooth: bool = True) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    if smooth:
        me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    return obj


def apply_modifier(obj: bpy.types.Object, mod_name: str) -> None:
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.modifier_apply(modifier=mod_name)


def join_objects(objs: Sequence[bpy.types.Object], name: str | None = None) -> bpy.types.Object:
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        if name:
            objs[0].name = name
            objs[0].data.name = name
        return objs[0]
    target = objs[0]
    with bpy.context.temp_override(
        object=target, active_object=target, selected_objects=list(objs), selected_editable_objects=list(objs)
    ):
        bpy.ops.object.join()
    if name:
        target.name = name
        target.data.name = name
    return target


# ─────────────────────────────────────────────────────────────────────────────
# Arrays numpy ⇄ mesh
# ─────────────────────────────────────────────────────────────────────────────
def get_co(me: bpy.types.Mesh) -> np.ndarray:
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def set_co(me: bpy.types.Mesh, co: np.ndarray) -> None:
    me.vertices.foreach_set("co", np.ascontiguousarray(co, dtype=np.float64).ravel())
    me.update()


def get_vnormals(me: bpy.types.Mesh) -> np.ndarray:
    n = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertex_normals.foreach_get("vector", n)
    return n.reshape(-1, 3)


def get_face_sets(me: bpy.types.Mesh) -> np.ndarray:
    attr = me.attributes.get(".sculpt_face_set")
    fs = np.zeros(len(me.polygons), dtype=np.int32)
    if attr is not None:
        attr.data.foreach_get("value", fs)
    return fs


def face_centers(me: bpy.types.Mesh) -> np.ndarray:
    c = np.empty(len(me.polygons) * 3, dtype=np.float64)
    me.polygons.foreach_get("center", c)
    return c.reshape(-1, 3)


def face_normals(me: bpy.types.Mesh) -> np.ndarray:
    n = np.empty(len(me.polygons) * 3, dtype=np.float64)
    me.polygons.foreach_get("normal", n)
    return n.reshape(-1, 3)


def face_vertex_lists(me: bpy.types.Mesh) -> list[tuple[int, ...]]:
    return [tuple(p.vertices) for p in me.polygons]


def verts_of_faces(me: bpy.types.Mesh, face_mask: np.ndarray) -> np.ndarray:
    out = np.zeros(len(me.vertices), dtype=bool)
    for i in np.flatnonzero(face_mask):
        out[list(me.polygons[int(i)].vertices)] = True
    return out


def boundary_centroid(me: bpy.types.Mesh, fs: np.ndarray, sets_a: Iterable[int], sets_b: Iterable[int], co=None) -> Vector:
    """Centroide de los vértices compartidos entre dos grupos de face sets (el 'anillo' de la articulación)."""
    co = get_co(me) if co is None else co
    va = verts_of_faces(me, np.isin(fs, list(sets_a)))
    vb = verts_of_faces(me, np.isin(fs, list(sets_b)))
    shared = va & vb
    if not shared.any():
        raise ValueError(f"Sin frontera entre face sets {list(sets_a)} y {list(sets_b)}")
    return Vector(co[shared].mean(0))


def vertex_adjacency(me: bpy.types.Mesh) -> list[np.ndarray]:
    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    nbrs: list[list[int]] = [[] for _ in range(len(me.vertices))]
    for a, b in ev:
        nbrs[a].append(b)
        nbrs[b].append(a)
    return [np.asarray(n, dtype=np.int64) for n in nbrs]


def boundary_vertex_mask(me: bpy.types.Mesh) -> np.ndarray:
    bm = bmesh.new()
    bm.from_mesh(me)
    mask = np.zeros(len(bm.verts), dtype=bool)
    for e in bm.edges:
        if e.is_boundary:
            mask[e.verts[0].index] = True
            mask[e.verts[1].index] = True
    bm.free()
    return mask


def laplacian_smooth(co: np.ndarray, nbrs: list[np.ndarray], iters: int, factor: float, pinned: np.ndarray | None = None) -> np.ndarray:
    co = co.copy()
    n = len(co)
    # Matriz dispersa implícita: promedios por índices.
    lens = np.array([len(x) for x in nbrs])
    flat = np.concatenate([x for x in nbrs if len(x)]) if n else np.zeros(0, dtype=np.int64)
    owners = np.repeat(np.arange(n), lens)
    free = np.ones(n, dtype=bool) if pinned is None else ~pinned
    free &= lens > 0
    for _ in range(iters):
        acc = np.zeros_like(co)
        np.add.at(acc, owners, co[flat])
        avg = acc / np.maximum(lens, 1)[:, None]
        co[free] += (avg[free] - co[free]) * factor
    return co


# ─────────────────────────────────────────────────────────────────────────────
# Subconjuntos de malla
# ─────────────────────────────────────────────────────────────────────────────
def duplicate_object(obj: bpy.types.Object, name: str, coll: bpy.types.Collection) -> bpy.types.Object:
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name
    new.data.name = name
    new.modifiers.clear()
    new.parent = None
    coll.objects.link(new)
    return new


def keep_faces(obj: bpy.types.Object, face_mask: np.ndarray) -> None:
    """Borra de `obj` las caras que no están en la máscara (y los vértices sueltos)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    doomed = [f for f in bm.faces if not face_mask[f.index]]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def subset_copy(src: bpy.types.Object, face_mask: np.ndarray, name: str, coll: bpy.types.Collection) -> bpy.types.Object:
    obj = duplicate_object(src, name, coll)
    keep_faces(obj, face_mask)
    return obj


# ─────────────────────────────────────────────────────────────────────────────
# Superficies y colisiones
# ─────────────────────────────────────────────────────────────────────────────
class Surface:
    """BVH + normales de un objeto de referencia (el cuerpo) en coordenadas locales."""

    def __init__(self, obj: bpy.types.Object):
        me = obj.data
        co = get_co(me)
        self.co = co
        self.faces = face_vertex_lists(me)
        self.bvh = BVHTree.FromPolygons([tuple(v) for v in co], self.faces, all_triangles=False)

    def nearest(self, p) -> tuple[Vector, Vector, float]:
        loc, nor, _idx, dist = self.bvh.find_nearest(Vector(p))
        return loc, nor, dist

    def signed_distance(self, p) -> float:
        loc, nor, dist = self.nearest(p)
        return (Vector(p) - loc).dot(nor)

    def push_out(self, pts: np.ndarray, min_dist: float) -> np.ndarray:
        out = pts.copy()
        for i, p in enumerate(pts):
            loc, nor, _ = self.nearest(p)
            if loc is None:
                continue
            d = (Vector(p) - loc).dot(nor)
            if d < min_dist:
                out[i] = np.asarray(loc + nor * min_dist)
        return out

    def project(self, p, offset: float = 0.0) -> tuple[Vector, Vector]:
        loc, nor, _ = self.nearest(p)
        return loc + nor * offset, nor

    def ray(self, origin, direction, dist: float = 10.0):
        return self.bvh.ray_cast(Vector(origin), Vector(direction).normalized(), dist)


def offset_shell(
    obj: bpy.types.Object,
    offset: float | np.ndarray,
    body: Surface,
    smooth_iters: int = 12,
    smooth_factor: float = 0.5,
    min_offset: float | None = None,
    passes: int = 3,
    pin_boundary: bool = False,
) -> None:
    """Infla una copia de la región del cuerpo: desplaza por normal, suaviza la anatomía
    y garantiza una distancia mínima al cuerpo (sin atravesarlo)."""
    me = obj.data
    co = get_co(me)
    nrm = get_vnormals(me)
    off = np.broadcast_to(np.asarray(offset, dtype=np.float64), (len(co),)).copy()
    co = co + nrm * off[:, None]
    nbrs = vertex_adjacency(me)
    pinned = boundary_vertex_mask(me) if pin_boundary else None
    min_off = off * 0.8 if min_offset is None else np.broadcast_to(min_offset, (len(co),))
    for _ in range(passes):
        co = laplacian_smooth(co, nbrs, smooth_iters, smooth_factor, pinned)
        for i, p in enumerate(co):
            loc, nor, _ = body.nearest(p)
            d = (Vector(p) - loc).dot(nor)
            m = float(min_off[i])
            if d < m:
                co[i] = np.asarray(loc + nor * m)
    set_co(me, co)


def extrude_boundary_inward(obj: bpy.types.Object, depth: float, shrink: float = 0.0) -> None:
    """Da grosor visual a los bordes abiertos (bajos, puños, cuellos) sin duplicar toda la malla."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    edges = [e for e in bm.edges if e.is_boundary]
    if not edges:
        bm.free()
        return
    res = bmesh.ops.extrude_edge_only(bm, edges=edges)
    new_verts = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in new_verts:
        # la normal del vértice original (vecino por la arista extruida)
        src = next((e.other_vert(v) for e in v.link_edges if not e.other_vert(v) in new_verts), None)
        n = src.normal if src is not None else Vector((0, 0, 0))
        v.co = v.co - n * depth
        if shrink:
            v.co = v.co - n * shrink
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


# ─────────────────────────────────────────────────────────────────────────────
# Primitivas paramétricas (tiras, tubos, cajas)
# ─────────────────────────────────────────────────────────────────────────────
def _frames(points: Sequence[Vector], ups: Sequence[Vector] | None):
    """Marcos (tangente, lateral, normal) a lo largo de una polilínea."""
    n = len(points)
    tans = []
    for i in range(n):
        a = points[max(i - 1, 0)]
        b = points[min(i + 1, n - 1)]
        t = (b - a)
        tans.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
    frames = []
    prev_side = None
    for i, t in enumerate(tans):
        up = ups[i] if ups is not None else None
        if up is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((0, -1, 0))
            if prev_side is not None:
                # transporte paralelo aproximado para evitar giros bruscos
                up = t.cross(prev_side)
        side = up.cross(t)
        if side.length < 1e-9:
            side = Vector((1, 0, 0))
        side.normalize()
        nor = t.cross(side).normalized()
        frames.append((t, side, nor))
        prev_side = side
    return frames


def ribbon(points, normals, widths, thickness: float = 0.0, name: str = "Ribbon", coll=None, closed: bool = False):
    """Tira sobre una superficie: cada punto con su normal de superficie y anchura."""
    pts = [Vector(p) for p in points]
    nrs = [Vector(n).normalized() for n in normals]
    n = len(pts)
    verts, faces = [], []
    for i in range(n):
        a = pts[(i - 1) % n] if closed else pts[max(i - 1, 0)]
        b = pts[(i + 1) % n] if closed else pts[min(i + 1, n - 1)]
        t = (b - a).normalized()
        side = nrs[i].cross(t).normalized()
        w = widths[i] if hasattr(widths, "__len__") else widths
        verts.append(pts[i] - side * w * 0.5)
        verts.append(pts[i] + side * w * 0.5)
    segs = n if closed else n - 1
    for i in range(segs):
        j = (i + 1) % n
        faces.append((2 * i, 2 * i + 1, 2 * j + 1, 2 * j))
    if thickness > 0:
        base = len(verts)
        for i in range(n):
            verts.append(verts[2 * i] + nrs[i] * thickness)
            verts.append(verts[2 * i + 1] + nrs[i] * thickness)
        top = [(a + base, d + base, c + base, b + base) for (a, b, c, d) in faces]
        faces = [tuple(reversed(f)) for f in faces] + [tuple(reversed(f)) for f in top]
        for i in range(segs):
            j = (i + 1) % n
            faces.append((2 * i, 2 * j, base + 2 * j, base + 2 * i))
            faces.append((2 * i + 1, base + 2 * i + 1, base + 2 * j + 1, 2 * j + 1))
        if not closed:
            faces.append((0, base + 0, base + 1, 1))
            k = n - 1
            faces.append((2 * k, 2 * k + 1, base + 2 * k + 1, base + 2 * k))
    return new_mesh_object(name, verts, faces, coll or bpy.context.scene.collection)


def tube(points, radii, sides: int = 8, flatten: float = 1.0, ups=None, name: str = "Tube", coll=None,
         cap_start: bool = True, cap_end: bool = True, twist: float = 0.0):
    """Tubo afilable a lo largo de una polilínea. `flatten` < 1 aplana la sección (mechones)."""
    pts = [Vector(p) for p in points]
    frames = _frames(pts, ups)
    verts, faces = [], []
    n = len(pts)
    for i, (p, (t, side, nor)) in enumerate(zip(pts, frames)):
        r = radii[i] if hasattr(radii, "__len__") else radii
        tw = twist * i / max(n - 1, 1)
        for k in range(sides):
            a = 2 * math.pi * k / sides + tw
            verts.append(p + side * math.cos(a) * r + nor * math.sin(a) * r * flatten)
    for i in range(n - 1):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if cap_start:
        c = len(verts)
        verts.append(pts[0])
        for k in range(sides):
            faces.append((c, (k + 1) % sides, k))
    if cap_end:
        c = len(verts)
        verts.append(pts[-1])
        base = (n - 1) * sides
        for k in range(sides):
            faces.append((c, base + k, base + (k + 1) % sides))
    return new_mesh_object(name, verts, faces, coll or bpy.context.scene.collection)


def box(center, size, rot: Matrix | None = None, name: str = "Box", coll=None, bevel: float = 0.0):
    sx, sy, sz = (s * 0.5 for s in size)
    corners = [Vector((x, y, z)) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)]
    R = rot.to_3x3() if rot is not None else Matrix.Identity(3)
    verts = [Vector(center) + R @ c for c in corners]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = new_mesh_object(name, verts, faces, coll or bpy.context.scene.collection, smooth=False)
    if bevel > 0:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.shade_smooth()
        obj.data.set_sharp_from_angle(angle=math.radians(40))
    return obj


def cylinder(center, axis, radius: float, depth: float, sides: int = 16, name: str = "Cyl", coll=None, bevel: float = 0.0):
    axis = Vector(axis).normalized()
    R = axis.to_track_quat("Z", "Y").to_matrix()
    verts, faces = [], []
    for z in (-depth / 2, depth / 2):
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append(Vector(center) + R @ Vector((math.cos(a) * radius, math.sin(a) * radius, z)))
    for k in range(sides):
        faces.append((k, (k + 1) % sides, sides + (k + 1) % sides, sides + k))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple(range(sides, 2 * sides)))
    obj = new_mesh_object(name, verts, faces, coll or bpy.context.scene.collection, smooth=False)
    if bevel > 0:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        rim = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
        bmesh.ops.bevel(bm, geom=rim, offset=bevel, segments=2, affect="EDGES", profile=0.5)
        bm.to_mesh(obj.data)
        bm.free()
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=math.radians(35))
    return obj


def uv_sphere(center, radius, segs: int = 12, rings: int = 8, scale=(1, 1, 1), name: str = "Sphere", coll=None, rot: Matrix | None = None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    S = Matrix.Diagonal((*scale, 1.0))
    R = rot.to_4x4() if rot is not None else Matrix.Identity(4)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ R @ S, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


# ─────────────────────────────────────────────────────────────────────────────
# Pesos y materiales
# ─────────────────────────────────────────────────────────────────────────────
_WEIGHT_CACHE: dict = {}


def _weight_source(src: bpy.types.Object):
    key = (src.name, len(src.data.vertices), len(src.vertex_groups))
    hit = _WEIGHT_CACHE.get(key)
    if hit is not None:
        return hit
    me = src.data
    co = get_co(me)
    me.calc_loop_triangles()
    tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", tris)
    tris = tris.reshape(-1, 3)
    names = [vg.name for vg in src.vertex_groups]
    W = np.zeros((len(co), len(names)), dtype=np.float32)
    for v in me.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    bvh = BVHTree.FromPolygons([tuple(p) for p in co], [tuple(t) for t in tris], all_triangles=True)
    data = (co, tris, W, names, bvh)
    _WEIGHT_CACHE.clear()
    _WEIGHT_CACHE[key] = data
    return data


def transfer_weights(dst: bpy.types.Object, src: bpy.types.Object, max_influences: int = 4) -> None:
    """Copia los pesos del cuerpo a una pieza: punto más cercano del cuerpo + interpolación
    baricéntrica de los pesos de su triángulo (determinista, no depende de la visibilidad)."""
    co_s, tris, W, names, bvh = _weight_source(src)
    for vg in list(dst.vertex_groups):
        dst.vertex_groups.remove(vg)
    groups = [dst.vertex_groups.new(name=n) for n in names]
    bm = bmesh.new()
    bm.from_mesh(dst.data)
    deform = bm.verts.layers.deform.verify()
    for v in bm.verts:
        loc, _nor, ti, _d = bvh.find_nearest(v.co)
        if loc is None:
            continue
        a, b, c = (Vector(co_s[i]) for i in tris[ti])
        # baricéntricas de loc en el triángulo
        v0, v1, v2 = b - a, c - a, loc - a
        d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
        d20, d21 = v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01 or 1e-12
        wb = (d11 * d20 - d01 * d21) / den
        wc = (d00 * d21 - d01 * d20) / den
        wa = 1.0 - wb - wc
        w = W[tris[ti][0]] * wa + W[tris[ti][1]] * wb + W[tris[ti][2]] * wc
        w = np.clip(w, 0, None)
        top = np.argsort(w)[::-1][:max_influences]
        tot = float(w[top].sum())
        if tot <= 1e-6:
            continue
        dv = v[deform]
        for gi in top:
            if w[gi] / tot > 0.01:
                dv[int(gi)] = float(w[gi] / tot)
    bm.to_mesh(dst.data)
    bm.free()
    clean_empty_groups(dst)


def rigid_weights(obj: bpy.types.Object, bone: str) -> None:
    for vg in list(obj.vertex_groups):
        obj.vertex_groups.remove(vg)
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")


def clean_empty_groups(obj: bpy.types.Object, eps: float = 1e-4) -> None:
    used = set()
    for v in obj.data.vertices:
        for g in v.groups:
            if g.weight > eps:
                used.add(g.group)
    # por nombre: al borrar un grupo se reindexan los siguientes
    doomed = [vg.name for vg in obj.vertex_groups if vg.index not in used]
    for name in doomed:
        obj.vertex_groups.remove(obj.vertex_groups[name])


def add_armature(obj: bpy.types.Object, rig: bpy.types.Object) -> None:
    for m in list(obj.modifiers):
        if m.type == "ARMATURE":
            obj.modifiers.remove(m)
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    # toda la geometría se genera en espacio de personaje (origen del rig)
    obj.parent = rig
    obj.matrix_parent_inverse.identity()
    obj.matrix_basis.identity()


def set_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def material_index(obj: bpy.types.Object, mat: bpy.types.Material) -> int:
    mats = obj.data.materials
    for i, m in enumerate(mats):
        if m == mat:
            return i
    mats.append(mat)
    return len(mats) - 1


def assign_faces_material(obj: bpy.types.Object, face_mask: np.ndarray, mat: bpy.types.Material) -> None:
    idx = material_index(obj, mat)
    mi = np.zeros(len(obj.data.polygons), dtype=np.int32)
    obj.data.polygons.foreach_get("material_index", mi)
    mi[face_mask] = idx
    obj.data.polygons.foreach_set("material_index", mi)


def tag(obj: bpy.types.Object, **props) -> None:
    """Metadatos que viajan al glTF como `extras` y que usa el personalizador."""
    for k, v in props.items():
        obj[k] = v


def boundary_loops(me: bpy.types.Mesh) -> list[list[int]]:
    """Bucles de vértices de los bordes abiertos (ordenados)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    adj: dict[int, list[int]] = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts[0].index, e.verts[1].index
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
    bm.free()
    seen: set[int] = set()
    loops = []
    for start in adj:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        prev, cur = None, start
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            seen.add(cur)
        loops.append(loop)
    return loops


def smooth_normals_sharp(obj: bpy.types.Object, angle_deg: float = 50.0) -> None:
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=math.radians(angle_deg))
