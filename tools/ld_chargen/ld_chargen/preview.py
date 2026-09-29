"""
Estudio de previsualización (cámara + luces) y renders de verificación con EEVEE.
"""
from __future__ import annotations

import math
import os

import bpy
from mathutils import Vector

from . import util

STUDIO = "_LD_Studio"


def setup_studio() -> None:
    scene = bpy.context.scene
    coll = util.ensure_collection(STUDIO)
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.eevee.taa_render_samples = 32
        scene.eevee.use_shadows = True
    except AttributeError:
        pass
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = scene.world or bpy.data.worlds.new("LD_World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.012, 0.016, 0.026, 1)
        bg.inputs["Strength"].default_value = 1.0

    def light(name, kind, energy, loc, rot, size=1.0, color=(1, 1, 1)):
        lo = bpy.data.objects.get(name)
        if lo is None:
            ld = bpy.data.lights.new(name, kind)
            lo = bpy.data.objects.new(name, ld)
            coll.objects.link(lo)
        lo.data.energy = energy
        lo.data.color = color
        if kind == "AREA":
            lo.data.size = size
        lo.location = loc
        lo.rotation_euler = rot
        return lo

    light("LD_Key", "AREA", 420, (-1.6, -2.4, 2.6), (math.radians(55), 0, math.radians(-33)), 1.6, (1.0, 0.96, 0.9))
    light("LD_Fill", "AREA", 160, (2.2, -2.0, 1.5), (math.radians(70), 0, math.radians(47)), 2.2, (0.85, 0.9, 1.0))
    light("LD_Rim", "AREA", 380, (0.4, 2.6, 2.4), (math.radians(-55), 0, math.radians(172)), 1.4, (0.7, 0.95, 1.0))
    cam = bpy.data.objects.get("LD_PreviewCam")
    if cam is None:
        cam = bpy.data.objects.new("LD_PreviewCam", bpy.data.cameras.new("LD_PreviewCam"))
        coll.objects.link(cam)
    scene.camera = cam


def frame_camera(target: Vector, height: float, yaw_deg: float = 0.0, pitch_deg: float = 4.0, lens: float = 70.0) -> None:
    cam = bpy.data.objects["LD_PreviewCam"]
    cam.data.lens = lens
    cam.data.sensor_fit = "VERTICAL"
    fov = 2 * math.atan(cam.data.sensor_height / (2 * lens))
    dist = (height * 0.5 * 1.12) / math.tan(fov / 2)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.location = target + d * dist
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = dist * 4


def render(path: str, res=(900, 1200)) -> str:
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    return path


def only_visible(objs) -> dict:
    """Oculta en render todo salvo `objs` (y el estudio). Devuelve el estado para restaurar."""
    keep = set(o.name for o in objs)
    state = {}
    for o in bpy.context.scene.objects:
        if o.type in ("LIGHT", "CAMERA"):
            continue
        state[o.name] = o.hide_render
        o.hide_render = o.name not in keep
    return state


def restore(state: dict) -> None:
    for name, hidden in state.items():
        o = bpy.data.objects.get(name)
        if o is not None:
            o.hide_render = hidden
