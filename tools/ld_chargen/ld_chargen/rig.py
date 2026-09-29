"""
Esqueleto humanoide con los nombres EXACTOS de `SkeletonProfileHumanoid` de Godot 4,
de modo que el BoneMap del importador se rellena solo y cualquier animación humanoide
(Mixamo, Quaternius, UAL, capturas propias...) se retargetea sin tocar nada.
"""
from __future__ import annotations

import bpy
from mathutils import Vector

from . import util
from .anatomy import Anatomy

FINGERS = ("Thumb", "Index", "Middle", "Ring", "Little")


def _finger_chain(side: str, f: str) -> tuple[str, str, str]:
    if f == "Thumb":
        return (f"{side}ThumbMetacarpal", f"{side}ThumbProximal", f"{side}ThumbDistal")
    return (f"{side}{f}Proximal", f"{side}{f}Intermediate", f"{side}{f}Distal")


def bone_specs(an: Anatomy) -> list[tuple[str, Vector, Vector, str | None, bool, Vector]]:
    """(nombre, cabeza, cola, padre, deforma, eje de alineación del roll)."""
    J = an.joints
    fwd = Vector((0, -1, 0))
    up = Vector((0, 0, 1))
    specs = [
        ("Root", Vector((0, 0, 0)), Vector((0, 0, 0.12)), None, False, fwd),
        ("Hips", J["Hips"], J["Spine"], "Root", True, fwd),
        ("Spine", J["Spine"], J["Chest"], "Hips", True, fwd),
        ("Chest", J["Chest"], J["UpperChest"], "Spine", True, fwd),
        ("UpperChest", J["UpperChest"], J["Neck"], "Chest", True, fwd),
        ("Neck", J["Neck"], J["Head"], "UpperChest", True, fwd),
        ("Head", J["Head"], J["HeadTop"], "Neck", True, fwd),
        ("Jaw", J["Jaw"], J["JawEnd"], "Head", True, up),
    ]
    for side in ("Left", "Right"):
        eye = J[f"{side}Eye"]
        specs.append((f"{side}Eye", eye, eye + Vector((0, -0.025, 0)), "Head", False, up))
    for side in ("Left", "Right"):
        specs += [
            (f"{side}Shoulder", J[f"{side}Shoulder"], J[f"{side}UpperArm"], "UpperChest", True, fwd),
            (f"{side}UpperArm", J[f"{side}UpperArm"], J[f"{side}LowerArm"], f"{side}Shoulder", True, fwd),
            (f"{side}LowerArm", J[f"{side}LowerArm"], J[f"{side}Hand"], f"{side}UpperArm", True, fwd),
            (f"{side}Hand", J[f"{side}Hand"], an.ref[f"{side}HandEnd"], f"{side}LowerArm", True, an.ref[f"{side}HandBack"]),
        ]
        back = an.ref[f"{side}HandBack"]
        for f in FINGERS:
            a, b, c = _finger_chain(side, f)
            specs += [
                (a, J[a], J[b], f"{side}Hand", True, back),
                (b, J[b], J[c], a, True, back),
                (c, J[c], J[f"{c}End"], b, True, back),
            ]
        specs += [
            (f"{side}UpperLeg", J[f"{side}UpperLeg"], J[f"{side}LowerLeg"], "Hips", True, fwd),
            (f"{side}LowerLeg", J[f"{side}LowerLeg"], J[f"{side}Foot"], f"{side}UpperLeg", True, fwd),
            (f"{side}Foot", J[f"{side}Foot"], J[f"{side}Toes"], f"{side}LowerLeg", True, up),
            (f"{side}Toes", J[f"{side}Toes"], J[f"{side}ToesEnd"], f"{side}Foot", True, up),
        ]
    return specs


def build_armature(name: str, an: Anatomy, coll: bpy.types.Collection) -> bpy.types.Object:
    arm = bpy.data.armatures.new(name)
    arm.display_type = "OCTAHEDRAL"
    rig = bpy.data.objects.new(name, arm)
    coll.objects.link(rig)
    rig.show_in_front = True
    specs = bone_specs(an)
    with bpy.context.temp_override(active_object=rig, object=rig, selected_objects=[rig], selected_editable_objects=[rig]):
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        ebs = arm.edit_bones
        for bname, head, tail, parent, deform, roll_axis in specs:
            eb = ebs.new(bname)
            eb.head = head
            eb.tail = tail
            eb.use_deform = deform
            eb.align_roll(roll_axis)
        for bname, head, tail, parent, deform, roll_axis in specs:
            if parent:
                eb = ebs[bname]
                eb.parent = ebs[parent]
                # conecta sólo cuando la cabeza coincide con la cola del padre
                eb.use_connect = (ebs[parent].tail - eb.head).length < 1e-5
        bpy.ops.object.mode_set(mode="OBJECT")
    # Colecciones de huesos (organización en el editor)
    groups = {"Cuerpo": [], "Dedos": [], "Cara": []}
    for bname, *_ in specs:
        if any(f in bname for f in FINGERS):
            groups["Dedos"].append(bname)
        elif bname in ("Jaw", "LeftEye", "RightEye"):
            groups["Cara"].append(bname)
        else:
            groups["Cuerpo"].append(bname)
    for gname, bones in groups.items():
        bc = arm.collections.new(gname)
        for b in bones:
            bc.assign(arm.bones[b])
    return rig


def skin_auto(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    """Pesos automáticos (bone heat) sobre el cuerpo completo; ojos y raíz no deforman el cuerpo."""
    arm = rig.data
    no_body = ("Root", "LeftEye", "RightEye")
    for b in no_body:
        arm.bones[b].use_deform = False
    for vg in list(body.vertex_groups):
        body.vertex_groups.remove(vg)
    for m in list(body.modifiers):
        if m.type == "ARMATURE":
            body.modifiers.remove(m)
    util.deselect_all()
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    with bpy.context.temp_override(active_object=rig, object=rig, selected_objects=[body, rig], selected_editable_objects=[body, rig]):
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for b in ("LeftEye", "RightEye"):
        arm.bones[b].use_deform = True
    util.clean_empty_groups(body)


def missing_weights(body: bpy.types.Object) -> int:
    """Vértices sin ningún peso (deberían ser 0)."""
    return sum(1 for v in body.data.vertices if not any(g.weight > 1e-4 for g in v.groups))
