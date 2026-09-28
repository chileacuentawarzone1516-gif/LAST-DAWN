# ASSETS

**Este proyecto no incluye ni descarga ningún asset externo.** No hay imágenes, modelos 3D, fuentes,
sonidos, música, vídeos ni texturas en el repositorio ni en tiempo de ejecución. Todo se genera por código en
el navegador del jugador, lo que además elimina cualquier duda de licencias de terceros.

| Tipo | Cómo se genera | Dónde |
| --- | --- | --- |
| **Modelos 3D** (distrito, edificios, props, vehículos, armas, infectados, Warden, helicóptero, pickups) | Primitivas de Three.js (cajas, cilindros, esferas, extrusiones) compuestas y fusionadas por código; variación con RNG determinista con semilla | `src/world/`, `src/weapons/`, `src/enemies/models.ts`, `src/missions/` |
| **Texturas y materiales** (asfalto, ladrillo, chapa, óxido, contenedores, laboratorio, piel, tela, blindaje, emisivos…) | `CanvasTexture`/`DataTexture` con ruido de valor/fbm y patrones procedurales, generadas de forma perezosa | `src/engine/materials.ts` |
| **Cielo, niebla, luz de la hora azul** | Shader propio de cúpula (gradiente, estrellas, luna, bruma) + luces de Three.js | `src/engine/` |
| **Efectos visuales** (chispas, sangre, ácido, explosiones, humo, trazadores, decals) | Partículas y quads con shaders propios y pools | `src/engine/fx.ts` |
| **Interfaz** (HUD, menús, mapa táctico, iconos) | HTML/CSS + SVG inline + canvas 2D. Tipografía del sistema (sin fuentes web) | `src/ui/` |
| **Audio** (disparos, pasos, voces de infectados, ambiente, música adaptativa, helicóptero, radio) | Síntesis con WebAudio (osciladores, ruido filtrado, FM, formantes, convolución con IR generada) | `src/audio/` |
| **Favicon** | SVG en línea dentro de `index.html` | `index.html` |

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
