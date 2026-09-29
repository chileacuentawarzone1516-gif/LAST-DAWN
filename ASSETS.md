# ASSETS

**Todo el juego se genera por código, con una única excepción documentada: los dos modelos de personaje
(`public/models/characters/*.glb`)**, aportados por el autor del proyecto (ver «Modelos de personaje»). No hay
imágenes, fuentes, sonidos, música ni vídeos externos, ni se descarga nada de terceros en tiempo de ejecución.
Los modelos 3D del mundo, los infectados, las armas, las texturas y todo el audio siguen siendo procedurales.

| Tipo | Cómo se genera | Dónde |
| --- | --- | --- |
| **Modelos 3D** (distrito, edificios, props, vehículos, armas, infectados, Warden, helicóptero, pickups; y el personaje de respaldo) | Primitivas de Three.js (cajas, cilindros, esferas, extrusiones) compuestas y fusionadas por código; variación con RNG determinista con semilla | `src/world/`, `src/weapons/`, `src/enemies/models.ts`, `src/missions/` |
| **Texturas y materiales** (asfalto, ladrillo, chapa, óxido, contenedores, laboratorio, piel, tela, blindaje, emisivos…) | `CanvasTexture`/`DataTexture` con ruido de valor/fbm y patrones procedurales, generadas de forma perezosa | `src/engine/materials.ts` |
| **Cielo, niebla, luz de la hora azul** | Shader propio de cúpula (gradiente, estrellas, luna, bruma) + luces de Three.js | `src/engine/` |
| **Efectos visuales** (chispas, sangre, ácido, explosiones, humo, trazadores, decals) | Partículas y quads con shaders propios y pools | `src/engine/fx.ts` |
| **Interfaz** (HUD, menús, mapa táctico, iconos) | HTML/CSS + SVG inline + canvas 2D. Tipografía del sistema (sin fuentes web) | `src/ui/` |
| **Audio** (disparos, pasos, voces de infectados, ambiente, música adaptativa, helicóptero, radio) | Síntesis con WebAudio (osciladores, ruido filtrado, FM, formantes, convolución con IR generada) | `src/audio/` |
| **Favicon** | SVG en línea dentro de `index.html` | `index.html` |

## Modelos de personaje

| Fichero | Tamaño | Contenido |
| --- | --- | --- |
| `public/models/characters/LD_Character_Male.glb` | 7,8 MB | Personaje masculino: cuerpo, esqueleto de 56 huesos y todas las piezas (6 peinados, 8 conjuntos, 5 accesorios) |
| `public/models/characters/LD_Character_Female.glb` | 11 MB | Ídem, femenino |

- **Origen y licencia** (según el README del paquete original): cuerpos base de *Human Base Meshes* de Blender
  Studio (**CC0**, dominio público); ropa, pelo, accesorios, rig, texturas y código de generación creados para
  LAST DAWN y de uso libre en el juego.
- Se cargan **bajo demanda** (sólo el género activo, sólo en la pantalla de personalización) y el juego conserva un
  personaje procedural de respaldo si la descarga falla o el ahorro de datos está activo.
- `tools/ld_chargen/` contiene el generador (Python/Blender) para regenerarlos o ampliarlos; `tests/fixtures/ld_character_data.json`
  son las tablas que exporta y `tests/character.assets.test.ts` verifica que coinciden con `CHARACTER` (`src/config.ts`).
- Vista de referencia de los 12 presets: [`docs/personajes-presets.png`](docs/personajes-presets.png).

## Dependencias de ejecución

| Paquete | Uso | Licencia |
| --- | --- | --- |
| [three](https://github.com/mrdoob/three.js) | Render WebGL 2 y utilidades (`three/addons`) | MIT |

Dependencias de desarrollo (no se distribuyen en el build): `typescript`, `vite`, `vitest`, `@types/three`,
`@types/node` y `playwright-core` (sólo para los scripts de QA con el Chromium instalado en el sistema; no se
descarga ningún navegador).

## Licencia del proyecto

MIT — ver [LICENSE](LICENSE). Todo el contenido generado por código (modelos, texturas, sonidos) forma parte
del código fuente y se distribuye bajo la misma licencia.
