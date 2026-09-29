# LAST DAWN · Panel de personalización (Vista 3D ▸ barra lateral N ▸ pestaña "LAST DAWN").
# Autocontenido: los datos van en scene["ld_character_data"], así que funciona aunque el
# generador no esté instalado. Se registra al abrir el .blend (requiere "Auto Run Python Scripts").
import json

import bpy


def _data():
    raw = bpy.context.scene.get("ld_character_data")
    return json.loads(raw) if raw else None


def _srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _rgba(h):
    return tuple(_srgb_to_lin(((h >> s) & 255) / 255.0) for s in (16, 8, 0)) + (1.0,)


def _shade(h, k):
    def ch(v):
        return round(v + (255 - v) * k if k >= 0 else v * (1 + k))
    return (ch((h >> 16) & 255) << 16) | (ch((h >> 8) & 255) << 8) | ch(h & 255)


def _apply(rig):
    d = _data()
    if d is None or not rig.get("ld_gender"):
        return
    g = rig["ld_gender"]
    t = "M" if g == "male" else "F"
    a = {k: int(getattr(rig, f"ld_{k}_idx")) for k in ("skin", "hairStyle", "hairColor", "outfit", "accessory")}
    of = d["outfits"][a["outfit"]]
    acc = d["accessories"][a["accessory"]]["id"]
    style = d["hairStyles"][g][a["hairStyle"]]["id"]
    for obj in [o for o in rig.children_recursive if o.type == "MESH"]:
        slot, item, part = obj.get("ld_slot"), obj.get("ld_item"), obj.get("ld_part")
        vis = True
        if slot == "outfit":
            vis = item == of["id"]
        elif slot == "accessory":
            vis = item == acc
        elif slot == "hair":
            vis = item == style and not (part == "top" and acc in d["hatAccessories"])
        obj.hide_viewport = not vis
        obj.hide_render = not vis
    colors = {
        "Skin": d["skinTones"][a["skin"]]["color"], "Hair": d["hairColors"][a["hairColor"]]["color"],
        "Jacket": of["jacket"], "JacketShade": _shade(of["jacket"], -0.3), "Pants": of["pants"],
        "Accent": of["accent"], "Glove": of["glove"], "Boots": d["boots"].get(of["id"], d["bootsDefault"]),
    }
    for role, h in colors.items():
        mat = bpy.data.materials.get(f"LD_{t}_{role}")
        if mat is None:
            continue
        tint = mat.node_tree.nodes.get("Tint")
        if tint is not None:
            tint.outputs[0].default_value = _rgba(h)
        else:
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is not None:
                bsdf.inputs["Base Color"].default_value = _rgba(h)
        mat.diffuse_color = _rgba(h)


def _items(key):
    def f(self, context):
        d = _data()
        if d is None:
            return [("0", "-", "")]
        g = self.get("ld_gender", "male")
        table = d["hairStyles"][g] if key == "hairStyles" else d[key]
        return [(str(i), e["name"], "") for i, e in enumerate(table)]
    return f


def _preset_items(self, context):
    d = _data()
    if d is None:
        return [("-1", "-", "")]
    g = self.get("ld_gender", "male")
    return [("-1", "Personalizado", "")] + [(str(i), p["name"], p["tagline"]) for i, p in enumerate(d["presets"][g])]


def _on_change(self, context):
    _apply(self)


def _on_preset(self, context):
    i = int(self.ld_preset)
    d = _data()
    if i < 0 or d is None:
        return
    a = d["presets"][self["ld_gender"]][i]["appearance"]
    for k, v in a.items():
        setattr(self, f"ld_{k}_idx", str(v))
    _apply(self)


PROPS = {
    "ld_skin_idx": ("Piel", "skinTones"), "ld_hairStyle_idx": ("Peinado", "hairStyles"),
    "ld_hairColor_idx": ("Color de pelo", "hairColors"), "ld_outfit_idx": ("Conjunto", "outfits"),
    "ld_accessory_idx": ("Accesorio", "accessories"),
}


class LD_PT_customizer(bpy.types.Panel):
    bl_label = "Personaje"
    bl_idname = "LD_PT_customizer"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "LAST DAWN"

    def draw(self, context):
        lay = self.layout
        rigs = [o for o in context.scene.objects if o.type == "ARMATURE" and o.get("ld_gender")]
        if not rigs:
            lay.label(text="No hay personajes LAST DAWN en la escena")
            return
        for rig in rigs:
            box = lay.box()
            box.label(text=f"{rig.name}  ({'Masculino' if rig['ld_gender'] == 'male' else 'Femenino'})", icon="ARMATURE_DATA")
            box.prop(rig, "ld_preset", text="Preset")
            for p, (label, _k) in PROPS.items():
                box.prop(rig, p, text=label)


def register():
    bpy.types.Object.ld_preset = bpy.props.EnumProperty(name="Preset", items=_preset_items, update=_on_preset)
    for p, (label, key) in PROPS.items():
        setattr(bpy.types.Object, p, bpy.props.EnumProperty(name=label, items=_items(key), update=_on_change))
    bpy.utils.register_class(LD_PT_customizer)


def unregister():
    bpy.utils.unregister_class(LD_PT_customizer)
    for p in list(PROPS) + ["ld_preset"]:
        if hasattr(bpy.types.Object, p):
            delattr(bpy.types.Object, p)


if __name__ == "__main__":
    try:
        unregister()
    except Exception:
        pass
    register()
