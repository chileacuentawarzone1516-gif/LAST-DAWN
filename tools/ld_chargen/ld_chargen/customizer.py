"""
Aplicación de una apariencia `{skin, hairStyle, hairColor, outfit, accessory}` (índices,
igual que el perfil del juego) sobre un personaje en Blender: visibilidad de piezas y
colores de los materiales tintables. El script de Godot implementa exactamente la misma
lógica (ver godot/ld_character.gd).
"""
from __future__ import annotations

import bpy

from . import config as C
from . import materials, util

# Botas: el juego no define su color; se deriva del conjunto (cuero oscuro por defecto).
BOOTS = {"desierto": 0x6B5234, "artico": 0x3A4450, "sanitario": 0x2B3A4A, "obrero": 0x3B2E22}
BOOTS_DEFAULT = 0x2A2622


def clamp_appearance(gender: str, a: dict) -> dict:
    def ci(v, n):
        try:
            v = int(v)
        except (TypeError, ValueError):
            v = 0
        return min(max(v, 0), n - 1)
    return {
        "skin": ci(a.get("skin"), len(C.SKIN_TONES)),
        "hairStyle": ci(a.get("hairStyle"), len(C.HAIR_STYLES[gender])),
        "hairColor": ci(a.get("hairColor"), len(C.HAIR_COLORS)),
        "outfit": ci(a.get("outfit"), len(C.OUTFITS)),
        "accessory": ci(a.get("accessory"), len(C.ACCESSORIES)),
    }


def resolve_colors(gender: str, a: dict) -> dict:
    a = clamp_appearance(gender, a)
    of = C.OUTFITS[a["outfit"]]
    return {
        "Skin": C.SKIN_TONES[a["skin"]]["color"],
        "Hair": C.HAIR_COLORS[a["hairColor"]]["color"],
        "Jacket": of["jacket"],
        "JacketShade": util.shade_hex(of["jacket"], -0.3),
        "Pants": of["pants"],
        "Accent": of["accent"],
        "Glove": of["glove"],
        "Boots": BOOTS.get(of["id"], BOOTS_DEFAULT),
    }


def is_visible(obj: bpy.types.Object, gender: str, a: dict) -> bool:
    slot = obj.get("ld_slot")
    item = obj.get("ld_item")
    part = obj.get("ld_part")
    if slot in ("base", "outfit_base"):
        return True
    if slot == "outfit":
        return item == C.OUTFITS[a["outfit"]]["id"]
    if slot == "accessory":
        return item == C.ACCESSORIES[a["accessory"]]["id"]
    if slot == "hair":
        if item != C.HAIR_STYLES[gender][a["hairStyle"]]["id"]:
            return False
        return not (part == "top" and C.ACCESSORIES[a["accessory"]]["id"] in C.HAT_ACCESSORIES)
    return True


def apply(gender: str, appearance: dict) -> dict:
    a = clamp_appearance(gender, appearance)
    coll = bpy.data.collections.get(f"LD_{'Male' if gender == 'male' else 'Female'}")
    bpy.context.view_layer.update()
    for obj in [o for o in coll.all_objects]:  # copiar: cambiar la visibilidad invalida el iterador
        if obj is None or obj.type != "MESH":
            continue
        vis = is_visible(obj, gender, a)
        obj.hide_viewport = not vis
        obj.hide_render = not vis
    for role, hexc in resolve_colors(gender, a).items():
        mat = bpy.data.materials.get(materials.mat_name(gender, role))
        if mat is not None:
            materials.set_color(mat, hexc)
    bpy.context.view_layer.update()
    rig = bpy.data.objects.get(f"LD_{C.TAG[gender]}_Rig")
    if rig is not None:
        for key, v in a.items():
            rig[f"ld_{key}"] = v
    return a


def apply_preset(gender: str, index: int) -> dict:
    presets = C.PRESETS[gender]
    p = presets[min(max(int(index), 0), len(presets) - 1)]
    a = apply(gender, p["appearance"])
    rig = bpy.data.objects.get(f"LD_{C.TAG[gender]}_Rig")
    if rig is not None:
        rig["ld_preset"] = p["name"]
    return a
