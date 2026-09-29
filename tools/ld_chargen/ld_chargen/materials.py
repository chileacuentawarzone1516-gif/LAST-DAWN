"""
Biblioteca de materiales por rol. Nombre estable `LD_<G>_<Rol>` (G = M/F): el
personalizador de Godot identifica el rol por el sufijo y recolorea sólo los tintables.
Todos son Principled BSDF sencillos → exportan limpios a glTF (baseColorFactor ×
baseColorTexture, roughness, metallic, emissive).
"""
from __future__ import annotations

import os

import bpy

from . import config as C
from . import util


def mat_name(gender: str, role: str) -> str:
    return f"LD_{C.TAG[gender]}_{role}"


def _principled(mat: bpy.types.Material):
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return bsdf


def _new(name: str, color: int, rough: float, metal: float = 0.0, emission: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = _principled(mat)
    bsdf.inputs["Base Color"].default_value = util.hex_rgba(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = util.hex_rgba(color)
        bsdf.inputs["Emission Strength"].default_value = emission
    mat.diffuse_color = util.hex_rgba(color)
    return mat


def build_library(gender: str) -> dict[str, bpy.types.Material]:
    lib: dict[str, bpy.types.Material] = {}
    for role in C.TINTABLE_ROLES:
        m = _new(mat_name(gender, role), C.TINT_DEFAULT[role], C.TINT_ROUGHNESS[role])
        m["ld_role"] = role
        m["ld_tintable"] = True
        lib[role] = m
    for role, (color, rough, metal, emi) in C.FIXED_MATERIALS.items():
        m = _new(mat_name(gender, role), color, rough, metal, emi)
        m["ld_role"] = role
        m["ld_tintable"] = False
        lib[role] = m
    # la piel admite algo de subsuperficie en Blender (no se exporta; en Godot se activa en el material)
    skin = _principled(lib["Skin"])
    skin.inputs["Subsurface Weight"].default_value = 0.12
    skin.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
    return lib


def set_color(mat: bpy.types.Material, hex_color: int) -> None:
    """Cambia el color de un material tintable. Si tiene textura de detalle, el color va en el
    nodo RGB 'Tint' (factor que multiplica a la textura, igual que albedo_color en Godot)."""
    rgba = util.hex_rgba(hex_color)
    nt = mat.node_tree
    tint = nt.nodes.get("Tint")
    if tint is not None:
        tint.outputs[0].default_value = rgba
    else:
        _principled(mat).inputs["Base Color"].default_value = rgba
    mat.diffuse_color = rgba


def attach_skin_textures(mat: bpy.types.Material, albedo_path: str, normal_path: str | None) -> None:
    """Base Color = textura_detalle × Tint (el exportador glTF lo convierte en
    baseColorTexture + baseColorFactor) y mapa de normales opcional."""
    nt = mat.node_tree
    bsdf = _principled(mat)
    for n in list(nt.nodes):
        if n.name in ("SkinAlbedo", "Tint", "TintMix", "SkinNormal", "SkinNormalMap"):
            nt.nodes.remove(n)
    tint_color = bsdf.inputs["Base Color"].default_value[:]
    img = bpy.data.images.load(albedo_path, check_existing=True)
    img.colorspace_settings.name = "sRGB"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "SkinAlbedo"
    tex.image = img
    tex.location = (-700, 300)
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.name = "Tint"
    rgb.outputs[0].default_value = tint_color
    rgb.location = (-700, 520)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.name = "TintMix"
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.location = (-400, 380)
    nt.links.new(tex.outputs["Color"], mix.inputs[6])
    nt.links.new(rgb.outputs[0], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    if normal_path and os.path.exists(normal_path):
        nimg = bpy.data.images.load(normal_path, check_existing=True)
        nimg.colorspace_settings.name = "Non-Color"
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.name = "SkinNormal"
        ntex.image = nimg
        ntex.location = (-700, -100)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.name = "SkinNormalMap"
        nmap.location = (-400, -100)
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])


def get_library(gender: str) -> dict[str, bpy.types.Material]:
    roles = list(C.TINTABLE_ROLES) + list(C.FIXED_MATERIALS)
    lib = {r: bpy.data.materials.get(mat_name(gender, r)) for r in roles}
    if any(m is None for m in lib.values()):
        return build_library(gender)
    return lib
