"""
Puntos anatómicos derivados de los face sets de las Human Base Meshes.

Ambos cuerpos (masculino/femenino) comparten topología y face sets, así que las
articulaciones se obtienen como centroides de las fronteras entre segmentos
(p. ej. codo = frontera antebrazo/brazo) y funcionan igual en los dos géneros.
Convención de Blender: el personaje mira a -Y; su lado izquierdo es +X (".L").
"""
from __future__ import annotations

from dataclasses import dataclass, field

import bpy
import numpy as np
from mathutils import Vector

from . import util

# Face sets por segmento (mismo id en ambos cuerpos). L = +X.
FS = {
    "torso": 1, "belly": 19, "pelvis": 18, "head": 17, "nose": 7, "mouth": 8, "lowerface": 22,
    "eye_region": {"L": 2, "R": 3}, "ear": {"L": 4, "R": 5},
    "hand": {"L": 9, "R": 10}, "forearm": {"L": 12, "R": 11}, "upperarm": {"L": 21, "R": 20},
    "thigh": {"L": 24, "R": 23}, "shin": {"L": 15, "R": 16}, "foot": {"L": 14, "R": 13},
    "toes_base": {"L": 25, "R": 26},
    # dedos: [base/metacarpo, proximal, medio, punta]; el pulgar: [metacarpo, proximal, distal, punta]
    "fingers": {
        "L": {"Thumb": (80, 81, 82, 83), "Index": (76, 77, 78, 79), "Middle": (72, 73, 74, 75),
              "Ring": (68, 69, 70, 71), "Little": (64, 65, 66, 67)},
        "R": {"Thumb": (84, 85, 86, 87), "Index": (88, 89, 90, 91), "Middle": (92, 93, 94, 95),
              "Ring": (96, 97, 98, 99), "Little": (100, 101, 102, 103)},
    },
}
TOE_SETS = {"L": tuple(range(46, 64)), "R": tuple(range(27, 46))}
SIDES = {"L": "Left", "R": "Right"}


@dataclass
class Anatomy:
    height: float
    joints: dict[str, Vector] = field(default_factory=dict)
    # referencias útiles para ropa/pelo/accesorios
    ref: dict[str, object] = field(default_factory=dict)


def _torso_mid_y(co: np.ndarray, fs_v: np.ndarray, z: float, back_bias: float = 0.62) -> float:
    """Y de la columna a la altura z: entre pecho y espalda, desplazada hacia la espalda."""
    band = (np.abs(co[:, 2] - z) < 0.012) & (np.abs(co[:, 0]) < 0.035) & fs_v
    pts = co[band]
    if len(pts) < 2:
        return float(co[fs_v][:, 1].mean())
    front, back = pts[:, 1].min(), pts[:, 1].max()
    return float(front + (back - front) * back_bias)


def compute(body: bpy.types.Object, eye_centers: dict[str, Vector]) -> Anatomy:
    me = body.data
    co = util.get_co(me)
    fs = util.get_face_sets(me)
    H = float(co[:, 2].max() - co[:, 2].min())
    an = Anatomy(height=H)
    J = an.joints

    def bc(a, b):
        a = a if isinstance(a, (tuple, list)) else (a,)
        b = b if isinstance(b, (tuple, list)) else (b,)
        return util.boundary_centroid(me, fs, a, b, co)

    def set_verts(sets):
        sets = sets if isinstance(sets, (tuple, list)) else (sets,)
        return co[util.verts_of_faces(me, np.isin(fs, list(sets)))]

    torso_mask = util.verts_of_faces(me, np.isin(fs, [FS["torso"], FS["belly"], FS["pelvis"]]))

    # ── Piernas ────────────────────────────────────────────────────────────
    for s in ("L", "R"):
        side = SIDES[s]
        hip = bc(FS["thigh"][s], FS["pelvis"])
        knee = bc(FS["thigh"][s], FS["shin"][s])
        ankle = bc(FS["shin"][s], FS["foot"][s])
        # el anillo de la ingle es diagonal: la cabeza del fémur está algo más arriba y hacia dentro
        hip = Vector((hip.x * 0.92, hip.y + 0.004, hip.z + 0.035 * H / 1.7))
        # la rodilla y el tobillo reales están algo por detrás del centro del anillo
        knee.y += 0.006
        toes = set_verts((FS["toes_base"][s],) + TOE_SETS[s])
        foot = set_verts(FS["foot"][s])
        ball = bc(FS["foot"][s], (FS["toes_base"][s],) + TOE_SETS[s])
        ball.z = max(ball.z, 0.02 * H / 1.7)
        toe_tip = Vector((ball.x, float(toes[:, 1].min()), ball.z))
        J[f"{side}UpperLeg"] = hip
        J[f"{side}LowerLeg"] = knee
        J[f"{side}Foot"] = ankle
        J[f"{side}Toes"] = ball
        J[f"{side}ToesEnd"] = toe_tip
        an.ref[f"{side}HeelY"] = float(foot[:, 1].max())

    # ── Columna ────────────────────────────────────────────────────────────
    hip_c = (J["LeftUpperLeg"] + J["RightUpperLeg"]) * 0.5
    neck_base = bc(FS["torso"], FS["head"])
    neck_base.x = 0.0
    hips_head = Vector((0.0, 0.0, hip_c.z + 0.02 * H / 1.7))
    hips_head.y = _torso_mid_y(co, torso_mask, hips_head.z, 0.55)
    J["Hips"] = hips_head
    for name, f in (("Spine", 0.13), ("Chest", 0.40), ("UpperChest", 0.66)):
        z = hips_head.z + (neck_base.z - hips_head.z) * f
        J[name] = Vector((0.0, _torso_mid_y(co, torso_mask, z), z))
    neck_base.y = _torso_mid_y(co, util.verts_of_faces(me, np.isin(fs, [FS["torso"], FS["head"]])), neck_base.z, 0.55)
    J["Neck"] = neck_base

    ears = {s: Vector(set_verts(FS["ear"][s]).mean(0)) for s in ("L", "R")}
    ear_c = (ears["L"] + ears["R"]) * 0.5
    head_verts = set_verts(FS["head"])
    head_top = float(head_verts[:, 2].max())
    J["Head"] = Vector((0.0, ear_c.y + 0.004, ear_c.z - 0.028 * H / 1.7))
    J["HeadTop"] = Vector((0.0, J["Head"].y, head_top))

    # Mandíbula: pivote bajo la oreja → barbilla
    lf = set_verts(FS["lowerface"])
    mid = lf[np.abs(lf[:, 0]) < 0.012]
    chin = Vector(mid[np.argmin(mid[:, 2])]) if len(mid) else Vector((0, ear_c.y - 0.1, ear_c.z - 0.1))
    J["Jaw"] = Vector((0.0, ear_c.y - 0.012, ear_c.z - 0.022 * H / 1.7))
    J["JawEnd"] = Vector((0.0, chin.y + 0.012, chin.z + 0.012))
    for s in ("L", "R"):
        J[f"{SIDES[s]}Eye"] = eye_centers[s].copy()

    # ── Brazos y manos ─────────────────────────────────────────────────────
    for s in ("L", "R"):
        side = SIDES[s]
        sgn = 1.0 if s == "L" else -1.0
        shoulder = bc(FS["upperarm"][s], FS["torso"])
        elbow = bc(FS["forearm"][s], FS["upperarm"][s])
        wrist = bc(FS["hand"][s], FS["forearm"][s])
        # la cabeza del húmero está por debajo y por dentro del anillo del hombro
        shoulder = shoulder + Vector((-sgn * 0.004, 0.004, -0.012 * H / 1.7))
        elbow.y += 0.006
        J[f"{side}UpperArm"] = shoulder
        J[f"{side}LowerArm"] = elbow
        J[f"{side}Hand"] = wrist
        J[f"{side}Shoulder"] = Vector((sgn * 0.022 * H / 1.7, neck_base.y - 0.012, neck_base.z - 0.028 * H / 1.7))
        fingers = FS["fingers"][s]
        for fname, (a, b, c, tip) in fingers.items():
            if fname == "Thumb":
                n0, n1, n2 = f"{side}ThumbMetacarpal", f"{side}ThumbProximal", f"{side}ThumbDistal"
            else:
                n0, n1, n2 = f"{side}{fname}Proximal", f"{side}{fname}Intermediate", f"{side}{fname}Distal"
            j0 = bc(FS["hand"][s], a)
            j1 = bc(a, b)
            j2 = bc(b, c)
            tipv = set_verts(tip).mean(0)
            d = Vector(tipv) - j2
            J[n0], J[n1], J[n2] = j0, j1, j2
            J[f"{n2}End"] = j2 + d * 1.15
        # normal del dorso de la mano (hacia fuera del cuerpo en pose A)
        mk = J[f"{side}MiddleProximal"]
        a_ = J[f"{side}IndexProximal"] - J[f"{side}LittleProximal"]
        b_ = mk - wrist
        n = a_.cross(b_).normalized()
        if n.x * sgn < 0:
            n = -n
        an.ref[f"{side}HandBack"] = n
        an.ref[f"{side}HandEnd"] = mk

    an.ref["ears"] = ears
    an.ref["ear_center"] = ear_c
    an.ref["head_top"] = head_top
    an.ref["chin"] = chin
    an.ref["neck_base"] = neck_base
    return an
