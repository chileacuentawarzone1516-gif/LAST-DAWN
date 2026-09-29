"""
Exportación: GLB por género (esqueleto + todas las piezas), datos de personalización
(JSON + GDScript generado desde config.py para que nunca se desincronicen) y el .blend.
"""
from __future__ import annotations

import json
import os

import bpy

from . import config as C
from . import customizer, util

GLB_NAME = {"male": "LD_Character_Male.glb", "female": "LD_Character_Female.glb"}


def character_data() -> dict:
    return {
        "version": 1,
        "skinTones": C.SKIN_TONES,
        "hairColors": C.HAIR_COLORS,
        "hairStyles": C.HAIR_STYLES,
        "outfits": C.OUTFITS,
        "accessories": C.ACCESSORIES,
        "presets": C.PRESETS,
        "hatAccessories": list(C.HAT_ACCESSORIES),
        "boots": customizer.BOOTS,
        "bootsDefault": customizer.BOOTS_DEFAULT,
        "tintableRoles": list(C.TINTABLE_ROLES),
    }


def write_json(path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(character_data(), f, ensure_ascii=False, indent=2)
    return path


def _gd_value(v, indent: int = 0) -> str:
    pad = "\t" * indent
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = [f'{pad}\t"{k}": {_gd_value(x, indent + 1)}' for k, x in v.items()]
        return "{\n" + ",\n".join(items) + f",\n{pad}}}"
    if isinstance(v, (list, tuple)):
        if not v:
            return "[]"
        if all(isinstance(x, (int, float, str)) for x in v):
            return "[" + ", ".join(_gd_value(x) for x in v) + "]"
        items = [f"{pad}\t{_gd_value(x, indent + 1)}" for x in v]
        return "[\n" + ",\n".join(items) + f",\n{pad}]"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return f"0x{v:06X}" if v > 0xFFFF else str(v)
    if isinstance(v, float):
        return repr(v)
    return json.dumps(v, ensure_ascii=False)


def write_gdscript_data(path: str) -> str:
    d = character_data()
    lines = [
        "# GENERADO por source/ld_chargen/export.py a partir de config.py (espejo de src/config.ts).",
        "# No editar a mano: regenera con el generador de Blender para mantener la sincronía.",
        "class_name LDCharacterData",
        "extends RefCounted",
        "",
    ]
    for key in ("skinTones", "hairColors", "hairStyles", "outfits", "accessories", "presets"):
        const = "".join("_" + c if c.isupper() else c for c in key).upper()
        lines.append(f"const {const} := {_gd_value(d[key])}")
        lines.append("")
    lines.append(f"const HAT_ACCESSORIES: Array[String] = {_gd_value(d['hatAccessories'])}")
    lines.append(f"const BOOTS := {_gd_value(d['boots'])}")
    lines.append(f"const BOOTS_DEFAULT := 0x{d['bootsDefault']:06X}")
    lines.append(f"const TINTABLE_ROLES: Array[String] = {_gd_value(d['tintableRoles'])}")
    lines.append("")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    return path


def export_glb(gender: str, path: str) -> dict:
    coll = bpy.data.collections[f"LD_{'Male' if gender == 'male' else 'Female'}"]
    rig = bpy.data.objects[f"LD_{C.TAG[gender]}_Rig"]
    saved_loc = rig.location.copy()
    rig.location = (0, 0, 0)
    meshes = [o for o in coll.all_objects if o.type == "MESH"]
    state = {o.name: (o.hide_viewport, o.hide_render, o.hide_get()) for o in meshes}
    for o in meshes:
        o.hide_viewport = False
        o.hide_render = False
        o.hide_set(False)
    util.deselect_all()
    for o in meshes + [rig]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(
        filepath=path, export_format="GLB", use_selection=True, export_extras=True, export_yup=True,
        export_apply=False, export_skins=True, export_animations=False, export_morph=False,
        export_materials="EXPORT", export_image_format="AUTO", export_texcoords=True, export_normals=True,
    )
    with bpy.context.temp_override(active_object=rig, selected_objects=meshes + [rig]):
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:
            for k in ("export_image_format", "export_texcoords", "export_normals"):
                kwargs.pop(k, None)
            bpy.ops.export_scene.gltf(**kwargs)
    for o in meshes:
        hv, hr, hs = state[o.name]
        o.hide_viewport, o.hide_render = hv, hr
        o.hide_set(hs)
    rig.location = saved_loc
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    return {"path": path, "bytes": os.path.getsize(path), "meshes": len(meshes), "triangles_all_parts": tris}


def install_panel() -> None:
    """Guarda el panel de personalización dentro del .blend (se registra al abrirlo)."""
    here = os.path.dirname(os.path.abspath(__file__))
    src = open(os.path.join(here, "blender_panel.py"), encoding="utf-8").read()
    txt = bpy.data.texts.get("ld_customizer_panel.py") or bpy.data.texts.new("ld_customizer_panel.py")
    txt.clear()
    txt.write(src)
    txt.use_module = True
    bpy.context.scene["ld_character_data"] = json.dumps(character_data(), ensure_ascii=False)
    ns: dict = {"__name__": "__main__"}
    exec(compile(src, "ld_customizer_panel.py", "exec"), ns)
