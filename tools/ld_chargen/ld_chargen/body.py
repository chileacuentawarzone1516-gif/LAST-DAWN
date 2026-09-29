"""
Cuerpos base: importación de las Human Base Meshes (CC0), normalización de escala,
ojos propios (pupila/iris/esclerótica como materiales separados) y región visible.
"""
from __future__ import annotations

import math

import bpy
import numpy as np
from mathutils import Vector

from . import config as C
from . import util
from .anatomy import FS

HEAD_SETS = (FS["head"], FS["nose"], FS["mouth"], FS["lowerface"],
             FS["eye_region"]["L"], FS["eye_region"]["R"], FS["ear"]["L"], FS["ear"]["R"])


def import_body(gender: str, coll: bpy.types.Collection, source_coll: bpy.types.Collection):
    """Devuelve (cuerpo_low, cuerpo_high_multires, centros_de_ojo, radio_de_ojo)."""
    t = C.TAG[gender]
    names = list(C.BODY_SOURCE[gender])
    with bpy.data.libraries.load(C.BASE_MESH_BLEND, link=False) as (_src, dst):
        dst.objects = names
    body, eye_l, eye_r = dst.objects
    for o in (body, eye_l, eye_r):
        source_coll.objects.link(o)
    bpy.context.view_layer.update()

    origin = body.matrix_world.translation.copy()
    co = util.get_co(body.data)
    zmin, zmax = float(co[:, 2].min()), float(co[:, 2].max())
    s = C.BODY_HEIGHT[gender] / (zmax - zmin)

    def to_final(p: Vector) -> Vector:
        q = p - origin
        return Vector((q.x * s, q.y * s, (q.z - zmin) * s))

    eye_centers, eye_radius = {}, 0.0
    for side, eo in (("L", eye_l), ("R", eye_r)):
        bb = [eo.matrix_world @ Vector(c) for c in eo.bound_box]
        c = sum(bb, Vector()) / 8.0
        eye_centers[side] = to_final(c)
        eye_radius = max(eye_radius, max(eo.dimensions) * 0.5 * s)
    # si los ojos vienen desordenados (L debe estar en +X), corrige
    if eye_centers["L"].x < eye_centers["R"].x:
        eye_centers["L"], eye_centers["R"] = eye_centers["R"], eye_centers["L"]
    util.remove_object(eye_l)
    util.remove_object(eye_r)

    # HIGH: el original con multires, sólo recolocado (fuente de horneado)
    high = body
    high.name = f"_LD_{t}_BodyHigh"
    # world = location + s * local  ==  (x*s, y*s, (z - zmin)*s)
    high.parent = None
    high.rotation_euler = (0, 0, 0)
    high.location = (0.0, 0.0, -zmin * s)
    high.scale = (s, s, s)
    for m in high.modifiers:
        if m.type == "MULTIRES":
            m.render_levels = m.total_levels
            m.levels = 0
            m.sculpt_levels = m.total_levels

    # LOW: nivel base, con escala aplicada, en el origen del personaje
    low = high.copy()
    low.data = high.data.copy()
    low.name = f"LD_{t}_Body"
    low.data.name = f"LD_{t}_Body"
    coll.objects.link(low)
    for m in list(low.modifiers):
        if m.type == "MULTIRES":
            m.levels = 0
            util.apply_modifier(low, m.name)
    low.location = (0, 0, 0)
    low.scale = (1, 1, 1)
    lco = util.get_co(low.data)
    lco = np.column_stack((lco[:, 0] * s, lco[:, 1] * s, (lco[:, 2] - zmin) * s))
    util.set_co(low.data, lco)
    low.data.shade_smooth()
    # limpia atributos de selección/esculpido que no aportan nada al juego (se conservan face sets)
    for aname in (".sculpt_mask", "custom_normal"):
        a = low.data.attributes.get(aname)
        if a is not None:
            low.data.attributes.remove(a)
    return low, high, eye_centers, eye_radius


def build_eye(center: Vector, radius: float, name: str, coll, mats: dict) -> bpy.types.Object:
    """Globo ocular con polos en el eje de mirada (-Y) y anillos exactos de pupila/iris."""
    ring_deg = [0, 4.5, 8.5, 12, 17, 23, 29, 33, 42, 55, 70, 90, 110, 130, 150, 165, 180]
    segs = 24
    verts, faces, fmat = [], [], []
    for deg in ring_deg[1:-1]:
        a = math.radians(deg)
        # la córnea abomba ligeramente la zona del iris
        bulge = 1.0 + (0.045 * math.cos(a / math.radians(29) * math.pi / 2) if deg <= 29 else 0.0)
        r = radius * bulge
        for k in range(segs):
            phi = 2 * math.pi * k / segs
            x = math.sin(a) * math.cos(phi)
            z = math.sin(a) * math.sin(phi)
            y = -math.cos(a)
            verts.append(center + Vector((x, y, z)) * r)
    nr = len(ring_deg) - 2
    front = len(verts)
    verts.append(center + Vector((0, -radius * 1.045, 0)))
    back = len(verts)
    verts.append(center + Vector((0, radius, 0)))

    def mat_for(deg_hi: float) -> int:
        return 0 if deg_hi <= 8.5 else (1 if deg_hi <= 29 else 2)

    for k in range(segs):
        faces.append((front, (k + 1) % segs, k))
        fmat.append(mat_for(ring_deg[1]))
    for r in range(nr - 1):
        for k in range(segs):
            a = r * segs + k
            b = r * segs + (k + 1) % segs
            faces.append((a, b, b + segs, a + segs))
            fmat.append(mat_for(ring_deg[r + 2]))
    base = (nr - 1) * segs
    for k in range(segs):
        faces.append((back, base + k, base + (k + 1) % segs))
        fmat.append(2)
    obj = util.new_mesh_object(name, verts, faces, coll)
    for key in ("Pupil", "Iris", "Sclera"):
        obj.data.materials.append(mats[key])
    obj.data.polygons.foreach_set("material_index", np.asarray(fmat, dtype=np.int32))
    return obj


def visible_face_mask(body: bpy.types.Object, neck_base: Vector, collar_margin: float) -> np.ndarray:
    """Caras de piel que quedan a la vista con la ropa puesta: cabeza, cuello y una franja
    bajo el cuello de la chaqueta (para que nunca se vea un hueco)."""
    me = body.data
    fs = util.get_face_sets(me)
    cen = util.face_centers(me)
    head = np.isin(fs, HEAD_SETS)
    collar = (fs == FS["torso"]) & (cen[:, 2] > neck_base.z - collar_margin)
    return head | collar
