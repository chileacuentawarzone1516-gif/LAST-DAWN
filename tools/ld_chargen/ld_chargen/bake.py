"""
Piel: separación de la región visible, UV propia (0-1) y horneado con Cycles de
  · normal map desde el multires esculpido (nivel 3) → detalle realista con malla ligera;
  · textura de detalle (labios, mejillas, párpados, oclusión) en escala casi blanca
    que se multiplica por el tono de piel elegido (albedo_color en Godot).
"""
from __future__ import annotations

import os

import bpy
import numpy as np

from . import config as C
from . import util
from .anatomy import FS


def _use_gpu() -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for t in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
            try:
                prefs.compute_device_type = t
                prefs.refresh_devices()
                devs = [d for d in prefs.devices if d.type == t]
                if devs:
                    for d in devs:
                        d.use = True
                    scene.cycles.device = "GPU"
                    return
            except TypeError:
                continue
    except Exception:
        pass
    scene.cycles.device = "CPU"


def repack_uv(obj: bpy.types.Object, uv_name: str = "UVSkin", margin: float = 0.006) -> None:
    """Nueva capa UV (primera, la que usa el material) con las islas originales
    reempaquetadas en el tile 0-1."""
    me = obj.data
    src = me.uv_layers.get("UVMap")
    new = me.uv_layers.get(uv_name) or me.uv_layers.new(name=uv_name)
    if src is not None:
        buf = np.empty(len(me.loops) * 2, dtype=np.float32)
        src.data.foreach_get("uv", buf)
        new.data.foreach_set("uv", buf)
    me.uv_layers.active = new
    new.active_render = True
    util.deselect_all()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, margin=margin)
        bpy.ops.object.mode_set(mode="OBJECT")
    # (las referencias a capas UV quedan invalidadas tras pasar por modo edición)
    new = me.uv_layers[uv_name]
    src = me.uv_layers.get("UVMap")
    # normaliza al tile 0-1 por si el empaquetado respetó el AABB original
    buf = np.empty(len(me.loops) * 2, dtype=np.float64)
    new.data.foreach_get("uv", buf)
    uv = buf.reshape(-1, 2)
    mn, mx = uv.min(0), uv.max(0)
    span = float((mx - mn).max())
    uv = (uv - mn) / span * (1 - 2 * margin) + margin
    new.data.foreach_set("uv", uv.ravel())
    # el UV original ya no sirve (UDIM del cuerpo completo)
    if src is not None:
        me.uv_layers.remove(src)
    me.uv_layers[uv_name].name = "UVMap"


def _detail_colors(obj: bpy.types.Object, gender: str) -> None:
    """Color por vértice (multiplicador del tono de piel)."""
    me = obj.data
    fs = util.get_face_sets(me)
    n = len(me.vertices)
    col = np.ones((n, 4), dtype=np.float32)

    def tint(sets, rgb, strength=1.0):
        mask = util.verts_of_faces(me, np.isin(fs, sets))
        col[mask, :3] = col[mask, :3] * (1 - strength) + np.asarray(rgb, dtype=np.float32) * strength

    tint([FS["nose"]], (0.97, 0.9, 0.88), 0.7)
    tint([FS["ear"]["L"], FS["ear"]["R"]], (0.96, 0.88, 0.86), 0.8)
    tint([FS["eye_region"]["L"], FS["eye_region"]["R"]], (0.9, 0.84, 0.84), 0.8)
    lips = (0.74, 0.5, 0.5) if gender == "female" else (0.82, 0.62, 0.6)
    tint([FS["mouth"]], lips, 1.0)
    attr = me.color_attributes.get("SkinDetail") or me.color_attributes.new("SkinDetail", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", col.ravel())
    # suaviza los bordes del tinte de labios con un par de pasadas laplacianas sobre el color
    nbrs = util.vertex_adjacency(me)
    rgb = util.laplacian_smooth(col[:, :3].astype(np.float64), nbrs, 2, 0.5)
    col[:, :3] = rgb
    attr.data.foreach_set("color", col.ravel())
    me.color_attributes.active_color = attr


def _bake_image(name: str, size: int, non_color: bool) -> bpy.types.Image:
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def _with_bake_node(mat: bpy.types.Material, img: bpy.types.Image):
    nt = mat.node_tree
    node = nt.nodes.new("ShaderNodeTexImage")
    node.name = "_BakeTarget"
    node.image = img
    nt.nodes.active = node
    return node


def bake_skin(gender: str, low: bpy.types.Object, high: bpy.types.Object, skin_mat: bpy.types.Material,
              size: int = 2048) -> tuple[str, str]:
    t = C.TAG[gender]
    os.makedirs(C.TEXTURE_DIR, exist_ok=True)
    normal_path = os.path.join(C.TEXTURE_DIR, f"LD_{t}_Skin_Normal.png")
    albedo_path = os.path.join(C.TEXTURE_DIR, f"LD_{t}_Skin_Detail.png")
    scene = bpy.context.scene
    prev_engine = scene.render.engine
    _use_gpu()
    scene.cycles.samples = 16
    bake = scene.render.bake
    bake.margin = 12
    bake.use_clear = True

    # 1) normal desde el multires
    high.hide_viewport = False
    high.hide_set(False)
    high.hide_render = False
    img_n = _bake_image(f"LD_{t}_Skin_Normal", size, non_color=True)
    node = _with_bake_node(skin_mat, img_n)
    util.deselect_all()
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    with bpy.context.temp_override(active_object=low, object=low, selected_objects=[high, low],
                                   selected_editable_objects=[high, low]):
        bpy.ops.object.bake(type="NORMAL", use_selected_to_active=True, cage_extrusion=0.006,
                            max_ray_distance=0.015, normal_space="TANGENT", margin=12)
    img_n.filepath_raw = normal_path
    img_n.file_format = "PNG"
    img_n.save()
    skin_mat.node_tree.nodes.remove(node)
    high.hide_viewport = True
    high.hide_render = True

    # 2) detalle de color: color por vértice → emisión → textura
    _detail_colors(low, gender)
    tmp = bpy.data.materials.new("_LD_BakeEmit")
    tmp.use_nodes = True
    nt = tmp.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "SkinDetail"
    nt.links.new(ca.outputs["Color"], emi.inputs["Color"])
    nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
    img_a = _bake_image(f"LD_{t}_Skin_Detail", size // 2, non_color=False)
    _with_bake_node(tmp, img_a)
    saved = list(low.data.materials)
    low.data.materials.clear()
    low.data.materials.append(tmp)
    util.deselect_all()
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    scene.cycles.samples = 4
    with bpy.context.temp_override(active_object=low, object=low, selected_objects=[low], selected_editable_objects=[low]):
        bpy.ops.object.bake(type="EMIT", use_selected_to_active=False, margin=12)
    img_a.filepath_raw = albedo_path
    img_a.file_format = "PNG"
    img_a.save()
    low.data.materials.clear()
    for m in saved:
        low.data.materials.append(m)
    bpy.data.materials.remove(tmp)
    ca_attr = low.data.color_attributes.get("SkinDetail")
    if ca_attr is not None:
        low.data.color_attributes.remove(ca_attr)
    scene.render.engine = prev_engine
    return albedo_path, normal_path
