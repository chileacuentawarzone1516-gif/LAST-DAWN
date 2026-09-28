# DEAD SIGNAL: EXCLUSION ZONE

FPS de extracción con zombis para **un jugador**, en el navegador. Distrito industrial en cuarentena a la **hora
azul**, tres contratos, una horda final y un helicóptero que no espera. Three.js + TypeScript + Vite + pnpm.

- **Sin backend, sin cuentas y sin assets descargados**: modelos, texturas y sonidos se generan por código
  (procedural; audio con WebAudio). Ver [ASSETS.md](ASSETS.md).
- WebGL 2 + Pointer Lock. Escritorio (Chrome/Edge/Firefox/Safari) con teclado y ratón.

## Inicio rápido

Requisitos: **Node ≥ 22.12** y **pnpm ≥ 10**.

**Windows (PowerShell)**

```powershell
node -v                      # debe ser 22.12 o superior
npm install -g pnpm          # una sola vez; si "pnpm" no se reconoce, cierra y reabre PowerShell
git clone -b claude/funny-ritchie-frs1eb https://github.com/chileacuentawarzone1516-gif/LAST-DAWN.git
cd LAST-DAWN
pnpm install
pnpm dev                     # http://localhost:5173
```

**Linux / macOS**

```bash
corepack enable   # o: npm i -g pnpm
pnpm install
pnpm dev          # http://localhost:5173
```

Haz clic en **Iniciar operación** (activa el bloqueo del puntero; `Esc` pausa). Parámetros de URL útiles:
`?q=low|medium|high` (calidad gráfica; por defecto `high`, con escalado dinámico de resolución) y `?qa=1`
(modo de pruebas: sin pointer lock y con `window.__qa`, ver [docs/QA.md](docs/QA.md)).

## Cómo se juega

**Objetivo:** cobrar los contratos que puedas y salir con vida.

| Contrato | Recompensa | Cómo |
| --- | --- | --- |
| **1 · Restaurar el relé** | $3.000 | Mantén **E** 3 s en el transmisor y permanece **55 s** dentro del círculo marcado mientras los infectados convergen. Si sales, el progreso decae. |
| **2 · Eliminar al Warden** | $7.500 | Élite blindado del complejo. **Primero destruye el casco** (los disparos a la cabeza dañan sólo el casco) y **luego apunta a la cabeza** (×3,5). El cuerpo está blindado (×0,22). Es opcional. |
| **3 · Extracción** | $5.000 | En la radio del LZ (mantén **E** 4 s; requiere el relé restaurado) llama al helicóptero. Llega en 40 s: sobrevive a la **horda final**, y abórdalo (mantén **E** 2,5 s) en los 45 s que espera. |

**Reglas de partida**

- **7:30** — se extiende una oleada de **contaminación** desde el complejo (daño por segundo creciente con la profundidad;
  el blindaje no protege).
- **12:00** — el distrito se **sella**.
- **Pierdes** si mueres, si el distrito se sella antes de llamar a la extracción, o si el helicóptero se va sin ti.
  Llamar a la extracción *antes* del sellado te salva de esa derrota.
- Cada contrato paga **una sola vez**.

**Zonas de amenaza creciente** (sur → norte): Perímetro Sur (1) → Polígono de Almacenes (2) → Refinería y Patio de
Contenedores (3) → **Complejo de Investigación (4)**. Más amenaza = infectados más duros y **mejor botín**.

**Infectados:** Infectado (caminante), Corredor, Bruto (embiste y empuja), Escupidor (ácido a distancia) y el Warden
(embestida, pisotón, refuerzos y furia al perder el casco).

**Economía:** dinero por contratos y botín. La **armería** (LZ) vende armas y la mochila táctica; las **4 jaulas de
suministro** (una por zona) venden munición, granadas, placas, botiquín y kit de blindaje. Con la tienda abierta, las
teclas **1-6** compran. Se cierra con **E** o alejándote.

### Controles

| Acción | Tecla |
| --- | --- |
| Mover / Mirar | `W A S D` / ratón |
| Disparar / Apuntar | clic izquierdo / clic derecho |
| Recargar | `R` |
| Correr | `Shift` |
| Saltar / Agacharse (toggle) | `Espacio` / `C` |
| Interactuar (mantener donde se indique) | `E` |
| Cambiar arma | `1` `2` o rueda del ratón |
| Granada de fragmentación | `G` |
| Placa de armadura | `Q` |
| Mapa táctico | `M` |
| Comprar (con la tienda abierta) | `1`-`6` |
| Pausa | `Esc` |

## Arquitectura

Documento completo: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
src/config.ts       balance y datos del mapa (única fuente de números de juego)
src/core/           contrato: tipos, eventos tipados, estado, contexto, entrada, interacción
src/rules/          reglas PURAS (sin three.js): combate, armas, enemigos, director, misiones, economía, botín, mapa…
src/engine/         renderer, cielo, post-proceso, materiales/texturas procedurales, efectos (pools)
src/world/          distrito procedural, colisiones, malla de navegación, contaminación visual
src/player/, src/weapons/   controlador FPS, 7 armas, granadas, placas, viewmodel
src/enemies/        infectados (instanciados), IA con campo de flujo, Warden, director de spawns y hordas
src/missions/       contratos, economía, botín, helicóptero
src/ui/             HUD, menús, tienda, mapa táctico
src/audio/          sintetizador WebAudio, SFX, ambiente, música adaptativa
src/game/           orquestador (Game) y API de QA
dev/                una página de preview por módulo
scripts/qa/         scripts de QA con Chrome headless
tests/              tests unitarios (vitest)
```

Principios: módulos aislados que sólo conocen `core/`, `config` y `rules/` (lo verifica un test); comunicación por bus de
eventos y por un `RunState` de datos planos; reglas de balance puras y testeadas; módulos por partida que se recrean al
reiniciar sin fugas.

### Balance

Todo el balance está en [`src/config.ts`](src/config.ts): armas (`WEAPONS`), enemigos (`ENEMIES`, `WARDEN`,
`THREAT_SCALE`, `SPAWN_MIX`), director y hordas (`DIRECTOR`, `HORDES`), tiempos (`TIMERS`, `CONTAMINATION`), contratos
(`MISSIONS`), tiendas y botín (`SHOP`, `ECONOMY`, `LOOT`), jugador (`PLAYER`), granada (`GRENADE`), render
(`RENDER`) y mapa (`MAP`). Un test comprueba sus invariantes.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Servidor de desarrollo (`/` = juego, `/dev/` = previews por módulo) |
| `pnpm build` / `pnpm preview` | Build de producción (tras `tsc --noEmit`) y servidor del build en :4173 |
| `pnpm typecheck` | TypeScript estricto |
| `pnpm test` | Tests unitarios de reglas y contrato (vitest) |
| `pnpm qa` | Typecheck + tests + build + smoke + previews + partida completa con bot |
| `pnpm qa:smoke` · `qa:previews` · `qa:playthrough` · `node scripts/qa/perf.mjs` | Cada barrido por separado |

Los scripts de QA usan Chrome/Chromium headless (`CHROME_PATH` para indicar el ejecutable; en Windows buscan
Chrome/Edge en `Program Files`). Detalle en [docs/QA.md](docs/QA.md).

**Páginas de preview** (`pnpm dev` → `http://localhost:5173/dev/`): `engine`, `world`, `player`, `enemies`, `missions`,
`hud`, `audio`. Cada una arranca un módulo real y stubs del resto, con botones de depuración.

## Estado de verificación

Verificado en este entorno (Chromium headless con render por software):

- `pnpm typecheck` y `pnpm build` sin errores; **356 tests** en verde.
- Partida completa por las reglas reales con un bot (relé → Warden → extracción, las tres derrotas, contaminación,
  economía, reinicio y botín): **135/135** aserciones.
- Smoke (32), previews de los 7 módulos (28) y rendimiento/fugas (35): sin errores de consola, **≈300 draw calls y
  ≈160k triángulos** en la escena típica (≤363 y ≈175k en el complejo), 49 infectados a la vez con ≈0,4 ms de update
  medio, y **sin fugas** al reiniciar partidas.

**Límites conocidos (honestidad sobre lo no medido):**

- El contenedor no tiene GPU: **los 60 FPS no se han medido** en hardware real. Se valida con presupuestos de draw
  calls/triángulos y tiempo de update; el juego incluye escalado dinámico de resolución y presets `low|medium|high`.
- **El audio se validó por métricas** (141 sonidos sin silencio, NaN ni saturación), pero nadie lo ha escuchado:
  timbres y mezcla pueden necesitar retoques de oído.
- Probado sólo con Chromium. Firefox y Safari no se han ejecutado (se usan APIs estándar y `webkitAudioContext` como
  alternativa).
- Los scripts de QA en Windows/macOS no se han ejecutado (sólo Linux).
- El balance (dificultad, economía) está razonado con simulaciones, pero no afinado con partidas humanas.

## Licencia

[MIT](LICENSE).
