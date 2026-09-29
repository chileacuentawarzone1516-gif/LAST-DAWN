"""
Orquestador del generador de personajes de LAST DAWN.

Uso desde Blender (Scripting o consola):
    exec(open(r"<carpeta>/source/build_characters.py").read())

Las etapas son idempotentes: cada una borra y regenera lo suyo.
"""
from __future__ import annotations

import bpy

from . import anatomy, body, config as C, materials, rig as rigmod, util

SOURCE_COLL = "_LD_Source"


def char_coll_name(gender: str) -> str:
    return f"LD_{'Male' if gender == 'male' else 'Female'}"


def rig_name(gender: str) -> str:
    return f"LD_{C.TAG[gender]}_Rig"


def stage_base(genders=C.GENDERS) -> dict:
    """Cuerpo, ojos, materiales, esqueleto y pesos automáticos."""
    report = {}
    src = util.ensure_collection(SOURCE_COLL)
    for g in genders:
        t = C.TAG[g]
        util.remove_collection_recursive(char_coll_name(g))
        for o in list(src.objects):
            if o.name.startswith(f"_LD_{t}_"):
                util.remove_object(o)
        coll = util.ensure_collection(char_coll_name(g))
        mats = materials.build_library(g)
        low, high, eye_c, eye_r = body.import_body(g, coll, src)
        high.hide_viewport = True
        high.hide_render = True
        util.set_material(low, mats["Skin"])
        an = anatomy.compute(low, eye_c)
        rig = rigmod.build_armature(rig_name(g), an, coll)
        rigmod.skin_auto(low, rig)
        for side, s in (("Left", "L"), ("Right", "R")):
            eye = body.build_eye(eye_c[s], eye_r, f"LD_{t}_Eye.{s}", coll, mats)
            util.rigid_weights(eye, f"{side}Eye")
            util.add_armature(eye, rig)
            util.tag(eye, ld_slot="base", ld_part="eye")
            eye["ld_center"] = list(eye_c[s])
            eye["ld_radius"] = eye_r
        util.add_armature(low, rig)
        util.tag(low, ld_slot="base", ld_part="body")
        report[g] = {
            "height": round(an.height, 3),
            "bones": len(rig.data.bones),
            "unweighted_verts": rigmod.missing_weights(low),
            "eye_radius": round(eye_r, 4),
        }
    return report


def objects(gender: str) -> dict:
    t = C.TAG[gender]
    get = bpy.data.objects.get
    return {
        "rig": get(rig_name(gender)),
        "body": get(f"LD_{t}_Body"),
        "ref": get(f"_LD_{t}_BodyRef"),
        "high": get(f"_LD_{t}_BodyHigh"),
        "eye_L": get(f"LD_{t}_Eye.L"),
        "eye_R": get(f"LD_{t}_Eye.R"),
        "coll": bpy.data.collections.get(char_coll_name(gender)),
    }


def get_anatomy(gender: str) -> anatomy.Anatomy:
    ob = objects(gender)
    src = ob["ref"] or ob["body"]
    from mathutils import Vector
    eyes = {"L": Vector(ob["eye_L"]["ld_center"]), "R": Vector(ob["eye_R"]["ld_center"])}
    an = anatomy.compute(src, eyes)
    an.ref["eye_radius"] = float(ob["eye_L"]["ld_radius"])
    return an


def stage_skin(genders=C.GENDERS, size: int = 2048) -> dict:
    """Separa la piel visible, conserva el cuerpo completo como referencia y hornea texturas."""
    from . import bake

    report = {}
    src = util.ensure_collection(SOURCE_COLL)
    for g in genders:
        t = C.TAG[g]
        ob = objects(g)
        low, high = ob["body"], ob["high"]
        if ob["ref"] is None:
            ref = util.duplicate_object(low, f"_LD_{t}_BodyRef", src)
            ref.hide_viewport = True
            ref.hide_render = True
        an = get_anatomy(g)
        mask = body.visible_face_mask(low, an.ref["neck_base"], 0.075)
        if mask.sum() < len(low.data.polygons):
            util.keep_faces(low, mask)
            bake.repack_uv(low)
        skin = bpy.data.materials[materials.mat_name(g, "Skin")]
        albedo, normal = bake.bake_skin(g, low, high, skin, size)
        materials.attach_skin_textures(skin, albedo, normal)
        util.remove_object(high)
        report[g] = {"skin_faces": len(low.data.polygons), "albedo": albedo, "normal": normal}
    return report


def make_ctx(gender: str):
    from .parts import Ctx
    ob = objects(gender)
    return Ctx(gender, ob["rig"], ob["ref"], get_anatomy(gender), materials.get_library(gender), ob["coll"])


def _clear_prefix(gender: str, prefix: str) -> None:
    for o in list(bpy.data.objects):
        if o.name.startswith(f"LD_{C.TAG[gender]}_{prefix}"):
            util.remove_object(o)


def stage_clothes(genders=C.GENDERS) -> dict:
    from . import clothing
    report = {}
    for g in genders:
        _clear_prefix(g, "Outfit_Base")
        ctx = make_ctx(g)
        objs = clothing.build_all(ctx)
        report[g] = {o.name: len(o.data.polygons) for o in objs}
    return report


def stage_parts(genders=C.GENDERS) -> dict:
    """Peinados, cejas, accesorios y equipo de cada conjunto."""
    from . import accessories, gear, hair
    report = {}
    for g in genders:
        for pre in ("Hair_", "Brows", "Acc_", "Outfit_"):
            if pre == "Outfit_":
                for o in list(bpy.data.objects):
                    if o.name.startswith(f"LD_{C.TAG[g]}_Outfit_") and "_Base_" not in o.name:
                        util.remove_object(o)
            else:
                _clear_prefix(g, pre)
        ctx = make_ctx(g)
        made, errors = [], {}
        made.append(hair.brows(ctx).name)
        for st in C.HAIR_STYLES[g]:
            try:
                made += [o.name for o in hair.build_style(ctx, st["id"]) if o]
            except Exception as e:  # noqa: BLE001 - se informa y se sigue con el resto
                import traceback
                errors[st["id"]] = traceback.format_exc()[-600:]
        for acc in C.ACCESSORIES:
            if acc["id"] == "none":
                continue
            try:
                made.append(accessories.BUILDERS[acc["id"]](ctx).name)
            except Exception:
                import traceback
                errors[acc["id"]] = traceback.format_exc()[-600:]
        jacket = bpy.data.objects[ctx.name("Outfit_Base_Jacket")]
        pants = bpy.data.objects[ctx.name("Outfit_Base_Pants")]
        for of in C.OUTFITS:
            try:
                made.append(gear.build(ctx, of["id"], jacket, pants).name)
            except Exception:
                import traceback
                errors[of["id"]] = traceback.format_exc()[-600:]
        report[g] = {"made": len(made), "errors": errors}
    return report


def render_presets(genders=C.GENDERS, size=(420, 620), yaw: float = -22.0, tag: str = "") -> list[str]:
    """Render de cada preset (verificación y miniaturas para el ZIP)."""
    import os
    from mathutils import Vector
    from . import customizer, preview
    preview.setup_studio()
    out = []
    for g in genders:
        for other in C.GENDERS:
            bpy.data.collections[char_coll_name(other)].hide_render = other != g
        rig = objects(g)["rig"]
        loc = rig.location.copy()
        rig.location = (0, 0, 0)
        for i, p in enumerate(C.PRESETS[g]):
            customizer.apply_preset(g, i)
            preview.frame_camera(Vector((0, 0, 0.93 if g == "male" else 0.88)), 1.95, yaw_deg=yaw, pitch_deg=3, lens=60)
            path = os.path.join(C.RENDER_DIR, f"{C.TAG[g]}_{i}_{p['name']}{tag}.png")
            preview.render(path, size)
            out.append(path)
        rig.location = loc
    for other in C.GENDERS:
        bpy.data.collections[char_coll_name(other)].hide_render = False
    return out


def render_heads(genders=C.GENDERS, tag: str = "", yaw: float = -30.0) -> list[str]:
    import os
    from mathutils import Vector
    from . import customizer, preview
    preview.setup_studio()
    out = []
    for g in genders:
        for other in C.GENDERS:
            bpy.data.collections[char_coll_name(other)].hide_render = other != g
        rig = objects(g)["rig"]
        loc = rig.location.copy()
        rig.location = (0, 0, 0)
        h = get_anatomy(g).joints["Head"]
        for i, p in enumerate(C.PRESETS[g]):
            customizer.apply_preset(g, i)
            preview.frame_camera(Vector((0, h.y, h.z + 0.02)), 0.42, yaw_deg=yaw, pitch_deg=2, lens=85)
            path = os.path.join(C.RENDER_DIR, f"H{C.TAG[g]}_{i}{tag}.png")
            preview.render(path, (300, 330))
            out.append(path)
        rig.location = loc
    for other in C.GENDERS:
        bpy.data.collections[char_coll_name(other)].hide_render = False
    return out


def stage_finalize() -> dict:
    """Deja la escena presentable: personajes separados, preset por defecto y fuentes ocultas."""
    from . import customizer
    for g in C.GENDERS:
        rig = objects(g)["rig"]
        rig["ld_gender"] = g
        rig.location = (C.DISPLAY_OFFSET_X[g], 0, 0)
        for b in rig.pose.bones:
            b.rotation_mode = "QUATERNION"
            b.rotation_quaternion = (1, 0, 0, 0)
            b.location = (0, 0, 0)
            b.scale = (1, 1, 1)
        customizer.apply_preset(g, 0)
    lc = bpy.context.view_layer.layer_collection.children
    if SOURCE_COLL in lc:
        lc[SOURCE_COLL].exclude = True
    for name in (char_coll_name(g) for g in C.GENDERS):
        if name in lc:
            lc[name].exclude = False
            lc[name].hide_viewport = False
    return {"ok": True}


def stage_export() -> dict:
    import os
    from . import export
    rep = {
        "json": export.write_json(os.path.join(C.GODOT_DIR, "ld_character_data.json")),
        "gd": export.write_gdscript_data(os.path.join(C.GODOT_DIR, "ld_character_data.gd")),
    }
    for g in C.GENDERS:
        rep[g] = export.export_glb(g, os.path.join(C.EXPORT_DIR, export.GLB_NAME[g]))
    export.install_panel()
    for g in C.GENDERS:
        rig = objects(g)["rig"]
        try:
            rig.ld_preset = "0"
        except Exception:  # noqa: BLE001 - el panel es opcional
            pass
    bpy.ops.file.pack_all()
    blend = os.path.join(C.ROOT, "LD_Characters.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    rep["blend"] = blend
    return rep


def run_all() -> dict:
    return {
        "base": stage_base(),
        "skin": stage_skin(),
        "clothes": stage_clothes(),
        "parts": stage_parts(),
        "finalize": stage_finalize(),
        "export": stage_export(),
    }
