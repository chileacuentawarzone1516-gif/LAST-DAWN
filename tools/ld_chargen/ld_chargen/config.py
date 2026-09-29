"""
Datos de personalización y constantes de construcción.

La parte `CHARACTER` es un espejo 1:1 de `CHARACTER` en `LAST-DAWN/src/config.ts`
(mismos ids, mismo orden, mismos colores), de modo que un perfil guardado por el juego
(`{skin, hairStyle, hairColor, outfit, accessory}` como índices) se aplica tal cual a
estos modelos. Si cambias la tabla del juego, cambia también esta (o regenera con el
exportador de JSON y compara).
"""
from __future__ import annotations

import os

# ─────────────────────────────────────────────────────────────────────────────
# Rutas
# ─────────────────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE_DIR = os.path.join(ROOT, "source")
TEXTURE_DIR = os.path.join(SOURCE_DIR, "textures")
EXPORT_DIR = os.path.join(ROOT, "export")
RENDER_DIR = os.path.join(ROOT, "renders")
GODOT_DIR = os.path.join(ROOT, "godot")
BASE_MESH_BLEND = os.path.join(
    ROOT, "_downloads", "human_base_meshes", "human-base-meshes-bundle-v1.4.1", "human_base_meshes_bundle.blend"
)

# ─────────────────────────────────────────────────────────────────────────────
# Cuerpos base (Human Base Meshes de Blender Studio, CC0). Misma topología en ambos.
# ─────────────────────────────────────────────────────────────────────────────
GENDERS = ("male", "female")
TAG = {"male": "M", "female": "F"}
BODY_SOURCE = {
    "male": ("GEO-body_male_realistic", "GEO-body_male_realistic.eye.L", "GEO-body_male_realistic.eye.R"),
    "female": ("GEO-body_female_realistic", "GEO-body_female_realistic.eye.L", "GEO-body_female_realistic.eye.R"),
}
# Altura final del cuerpo desnudo (m). El jugador del juego mide 1.8 con ojos a 1.7.
BODY_HEIGHT = {"male": 1.78, "female": 1.68}
# Separación en X en la escena de Blender (sólo presentación; se exporta en el origen).
DISPLAY_OFFSET_X = {"male": -0.55, "female": 0.55}

# ─────────────────────────────────────────────────────────────────────────────
# Espejo de CHARACTER (src/config.ts)
# ─────────────────────────────────────────────────────────────────────────────
SKIN_TONES = [
    {"id": "clara", "name": "Clara", "color": 0xF1CFB0},
    {"id": "trigueña", "name": "Trigueña", "color": 0xDCAE86},
    {"id": "canela", "name": "Canela", "color": 0xC08A5C},
    {"id": "morena", "name": "Morena", "color": 0x96623D},
    {"id": "oscura", "name": "Oscura", "color": 0x6B4229},
    {"id": "ebano", "name": "Ébano", "color": 0x452B1F},
]
HAIR_COLORS = [
    {"id": "negro", "name": "Negro", "color": 0x15110F},
    {"id": "castano-oscuro", "name": "Castaño oscuro", "color": 0x3A271B},
    {"id": "castano", "name": "Castaño", "color": 0x5B3A22},
    {"id": "rubio", "name": "Rubio", "color": 0xC9A25A},
    {"id": "pelirrojo", "name": "Pelirrojo", "color": 0x9A3F1E},
    {"id": "gris", "name": "Gris", "color": 0x8C8F94},
    {"id": "blanco", "name": "Blanco", "color": 0xD8DADE},
    {"id": "verde", "name": "Verde señal", "color": 0x2FBF8A},
]
HAIR_STYLES = {
    "male": [
        {"id": "rapado", "name": "Rapado"},
        {"id": "corto", "name": "Corto"},
        {"id": "peinado", "name": "Peinado atrás"},
        {"id": "rizado", "name": "Rizado"},
        {"id": "melena", "name": "Melena"},
        {"id": "mohicano", "name": "Mohicano"},
    ],
    "female": [
        {"id": "pixie", "name": "Corte pixie"},
        {"id": "media", "name": "Media melena"},
        {"id": "larga", "name": "Larga"},
        {"id": "coleta", "name": "Coleta"},
        {"id": "trenzas", "name": "Trenzas"},
        {"id": "mono", "name": "Moño"},
    ],
}
OUTFITS = [
    {"id": "militar", "name": "Militar", "jacket": 0x4A5236, "pants": 0x33382A, "accent": 0x8A7A4A, "glove": 0x22241F},
    {"id": "urbano", "name": "Urbano", "jacket": 0x2B3442, "pants": 0x1E232B, "accent": 0xD0D6DE, "glove": 0x15181C},
    {"id": "sanitario", "name": "Sanitario", "jacket": 0xD9DDE2, "pants": 0x8FA3B4, "accent": 0xD93A3A, "glove": 0x2B3A4A},
    {"id": "obrero", "name": "Obrero", "jacket": 0xC9791A, "pants": 0x2C3038, "accent": 0xE8E04A, "glove": 0x3B342A},
    {"id": "sigilo", "name": "Sigilo", "jacket": 0x15181D, "pants": 0x101216, "accent": 0x3FE0B0, "glove": 0x0B0C0E},
    {"id": "desierto", "name": "Desierto", "jacket": 0x9A8360, "pants": 0x6F5F45, "accent": 0x3A2F20, "glove": 0x4A3F2C},
    {"id": "artico", "name": "Ártico", "jacket": 0xC8D2DC, "pants": 0x5E6B78, "accent": 0x3B82C4, "glove": 0x2A3540},
    {"id": "carmesi", "name": "Carmesí", "jacket": 0x6D1F26, "pants": 0x25181A, "accent": 0xE0B34A, "glove": 0x1A1113},
]
ACCESSORIES = [
    {"id": "none", "name": "Ninguno"},
    {"id": "cap", "name": "Gorra"},
    {"id": "beanie", "name": "Gorro"},
    {"id": "goggles", "name": "Gafas tácticas"},
    {"id": "bandana", "name": "Pañuelo"},
    {"id": "headset", "name": "Auriculares"},
]
PRESETS = {
    "male": [
        {"name": "Veterano", "tagline": "Ex-militar curtido", "appearance": {"skin": 1, "hairStyle": 0, "hairColor": 5, "outfit": 0, "accessory": 0}},
        {"name": "Rastreador", "tagline": "Habla poco, dispara mejor", "appearance": {"skin": 3, "hairStyle": 3, "hairColor": 0, "outfit": 5, "accessory": 3}},
        {"name": "Técnico", "tagline": "Arregla lo que otros rompen", "appearance": {"skin": 0, "hairStyle": 2, "hairColor": 2, "outfit": 3, "accessory": 1}},
        {"name": "Médico", "tagline": "Juró no hacer daño… a los vivos", "appearance": {"skin": 2, "hairStyle": 1, "hairColor": 1, "outfit": 2, "accessory": 5}},
        {"name": "Fantasma", "tagline": "Entra y sale sin dejar rastro", "appearance": {"skin": 4, "hairStyle": 5, "hairColor": 7, "outfit": 4, "accessory": 4}},
        {"name": "Polar", "tagline": "Llegó desde la base ártica", "appearance": {"skin": 5, "hairStyle": 4, "hairColor": 6, "outfit": 6, "accessory": 2}},
    ],
    "female": [
        {"name": "Capitana", "tagline": "Lidera desde el frente", "appearance": {"skin": 1, "hairStyle": 3, "hairColor": 2, "outfit": 0, "accessory": 0}},
        {"name": "Exploradora", "tagline": "Conoce cada callejón", "appearance": {"skin": 3, "hairStyle": 4, "hairColor": 0, "outfit": 5, "accessory": 3}},
        {"name": "Ingeniera", "tagline": "Un soplete y un plan", "appearance": {"skin": 2, "hairStyle": 5, "hairColor": 4, "outfit": 3, "accessory": 1}},
        {"name": "Doctora", "tagline": "Cura primero, pregunta después", "appearance": {"skin": 0, "hairStyle": 1, "hairColor": 3, "outfit": 2, "accessory": 5}},
        {"name": "Sombra", "tagline": "Invisible hasta que es tarde", "appearance": {"skin": 4, "hairStyle": 0, "hairColor": 7, "outfit": 4, "accessory": 4}},
        {"name": "Ventisca", "tagline": "Fría, precisa, implacable", "appearance": {"skin": 5, "hairStyle": 2, "hairColor": 6, "outfit": 6, "accessory": 2}},
    ],
}

# Accesorios que tapan la parte superior del pelo (se ocultan las piezas `*_Top`).
HAT_ACCESSORIES = ("cap", "beanie")

# ─────────────────────────────────────────────────────────────────────────────
# Materiales por rol. Los tintables se recolorean en runtime (Godot) según el perfil;
# los fijos llevan su color aquí. Nombre final del material: f"LD_{role}".
# ─────────────────────────────────────────────────────────────────────────────
TINTABLE_ROLES = ("Skin", "Hair", "Jacket", "JacketShade", "Pants", "Accent", "Glove", "Boots")
FIXED_MATERIALS = {
    # role: (color, roughness, metallic, emission_strength)
    "Sclera": (0xE9E4DC, 0.25, 0.0, 0.0),
    "Iris": (0x4A3526, 0.2, 0.0, 0.0),
    "Pupil": (0x050506, 0.1, 0.0, 0.0),
    "Gear": (0x1B2027, 0.55, 0.0, 0.0),
    "Metal": (0x8E949B, 0.35, 1.0, 0.0),
    "Lens": (0x3FE0B0, 0.08, 0.2, 1.6),
    "Fur": (0xE6E2DA, 0.95, 0.0, 0.0),
    "Sole": (0x151515, 0.8, 0.0, 0.0),
}
# Rugosidad de los tintables.
TINT_ROUGHNESS = {
    "Skin": 0.52, "Hair": 0.48, "Jacket": 0.82, "JacketShade": 0.85, "Pants": 0.86,
    "Accent": 0.6, "Glove": 0.7, "Boots": 0.55,
}
# Color por defecto en Blender (se sustituye al aplicar un preset).
TINT_DEFAULT = {
    "Skin": 0xDCAE86, "Hair": 0x3A271B, "Jacket": 0x4A5236, "JacketShade": 0x343A26,
    "Pants": 0x33382A, "Accent": 0x8A7A4A, "Glove": 0x22241F, "Boots": 0x2A2622,
}
