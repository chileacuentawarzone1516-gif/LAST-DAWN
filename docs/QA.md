# QA — LAST DAWN

Infraestructura de calidad: scripts con Chrome headless (`scripts/qa/`) y tests estáticos (`tests/qa.*.test.ts`).
Todo es determinista y sin dependencias nuevas (playwright-core + vite + vitest).

## Ejecutar

| Comando | Qué hace |
| --- | --- |
| `pnpm qa` | typecheck + tests + build + smoke + previews + playthrough (secuencial) |
| `pnpm qa:smoke` | arranque de producción: WebGL2, cero errores, lienzo no en blanco, 10 s simulados, aviso sin WebGL2 |
| `pnpm qa:previews` | recorre `dev/*.html?qa=1`, exige cero errores y captura cada una |
| `pnpm qa:perf` | drawCalls/triángulos vs `RENDER.budget`, coste de `update()`, fugas entre partidas |
| `pnpm qa:playthrough` | bot determinista: escenarios A–F sobre las reglas |
| `node scripts/qa/depcheck.mjs` | dependencias declaradas vs imports reales |
| `pnpm test -- tests/qa.contract.test.ts` | contrato estático del repositorio |
| `pnpm qa:mobile` | perfil táctil emulado (v0.1.5): controles, multitáctil, HUD, orientación, audio, ciclo de vida |
| `pnpm qa:instrumentation` | la instrumentación `?perf=1` es no intrusiva y registra métricas (v0.1.5) |
| `pnpm qa:baseline` | ejecuta cada suite por separado y guarda logs + entorno en `qa-output/baseline-0.1.5/` |

`qa:mobile`, `qa:instrumentation` y `qa:baseline` no forman parte de `pnpm qa` (decisión pendiente del PLAN v0.1.5).

Código de salida ≠ 0 si algo falla. Cada aserción imprime `PASS`/`FAIL`; `WARN` es informativo, `SKIP` = no ejecutable hoy.
Salida en `qa-output/` (ignorado por git): `smoke/`, `previews/`, `perf/`, `playthrough/`, `dist/` (build aislado).

## Requisitos

- Node ≥ 22.18 (los scripts importan `src/config.ts` directamente con type-stripping) y `pnpm install` hecho.
- Un Chromium/Chrome/Edge. Se busca en este orden: `CHROME_PATH`, `/opt/pw-browsers` (Playwright), rutas típicas de Linux,
  macOS (`/Applications/...`) y Windows (`Program Files`, `LOCALAPPDATA`). En Windows/macOS basta con Chrome o Edge instalado,
  o `CHROME_PATH=...`.
- Puerto 5208 (QA). Cambiar con `--port=N`. Los scripts arrancan y **siempre** cierran servidor y navegador (grupo de procesos
  propio, limpieza ante señales y watchdog global).
- Sin GPU: el navegador usa SwiftShader (WebGL2 por software). Un solo navegador a la vez.

## Servidor y build

`smoke`, `perf` y `playthrough` sirven **producción**: `vite build` aislado en `qa-output/dist` (no pisa `dist/` ni exige que los
tipos de otros módulos estén limpios) + `vite preview`. Se reutiliza `dist/` o `qa-output/dist` si son más nuevos que `src/`.
Flags: `--dev` (vite dev), `--rebuild`, `--pnpm-build` (`pnpm build` = tsc + vite). `previews` usa siempre vite dev.

## Qué comprueba cada script

**smoke** — WebGL2 real; `#boot` retirado; API `window.__qa` completa; bucle rAF activo; lienzo no en blanco (`readPixels` en la
misma tarea que `render()`); `start()`; reloj avanza (bucle real y `step(10)`); sin NaN/Infinity (`state`, jugador, cámara);
jugador en `MAP.spawn` y sincronizado con `state.player.pos`; captura; cero `pageerror`/`console.error`/`requestfailed`;
fallo del renderer (tarjeta «No se pudo iniciar») y Chromium sin WebGL2 (`--disable-gpu --disable-webgl`: aviso amistoso, sin
excepciones).

**previews** — descubre `dev/*.html` (excepto `index.html`), avisa de las enlazadas y ausentes (`--require-all` las exige), deja
correr `--seconds` (4) + 3 s simulados, exige cero errores, `__qa`, estado finito y lienzo no en blanco (`--allow-blank=audio`).
Reintenta una vez (vite re-optimiza dependencias en la 1.ª carga). `--dev-dir=<carpeta>` sirve para autopruebas.

**perf** — en spawn, armería, relé, puerta del complejo, patio del Warden y LZ (4 orientaciones, peor caso): `engine.stats` y
`renderer.info` frente a `RENDER.budget` (**FAIL** si se supera), geometrías/texturas/programas/objetos/luces, tiempo de
`update()` (media/p95/máx; **informativo**, `--update-ms`, `--strict-update`) y una fila de estrés con `DIRECTOR.maxAlive`
infectados. Fugas: `--cycles=3` × (start → `--cycle-s=60` → restart); compara los dos últimos ciclos (inicio y fin) en
geometrías, texturas, programas, objetos de escena/viewmodel y **listeners del bus** (`bus.handlers`). Umbrales:
`--leak-geom --leak-tex --leak-prog --leak-objects --leak-listeners`. `--inject-leak` inyecta una fuga y debe terminar en FAIL
(autoprueba del detector).

**playthrough** (`--only=A,B1,…`, `--strict`, `--force`, `--seeds`, `--loot-n`):
- **A** victoria: relé (E 3 s → activado; progreso; decae fuera del círculo; completa y paga `reward`), Warden (casco →
  `warden:helmetBroken`, multiplicadores, muerte, pago único), extracción (bloqueada sin relé, `callHoldS`, `etaS`, aterrizaje,
  abordar, `won/extracted`, dinero); **A2** relé en 55 s exactos.
- **B** derrotas: B1 muerte, B2 sellado (+ avisos 60/30/10), B3 `heli_left`, B4 llamada antes de las 12:00 y victoria después.
- **C** contaminación a los 7:30: avisos únicos, radio creciente, daño sólo dentro y el blindaje no protege.
- **D** economía: teclas 1-6 en jaula y armería (fondos, tope, poseída), abrir/cerrar con E y por distancia.
- **E** reinicio: identidad de `ctx.state`, estado == primera partida, sin residuos, listeners estables, reinicio tras muerte y vía título.
- **F** botín: dinero por baja z1<z2<z3<z4 y ≈ `bounty × THREAT_SCALE.loot`, con `Math.random` sembrado.

Los escenarios cuyos módulos siguen siendo stub se muestran como `SKIP — módulo real no presente (stub): <módulos>`
(`--strict` los convierte en fallo: úsalo con el juego integrado; `--force` los ejecuta igualmente para depurar el bot).
El stub se detecta por el marcador `PROVISIONAL` o el import de `dev/stubs` en `src/<módulo>/`.

**depcheck** — FAIL: import sin declarar, dependencia fuera de la lista permitida, subruta `three/addons/*` inexistente.
WARN: declarada sin uso (`--strict` = FAIL).

**tests/qa.contract.test.ts** — (a) fronteras de módulo (lista blanca `BOUNDARY_ALLOW`: `player→weapons`, `engine/geometry*`;
los re-exports de `dev/stubs` sólo valen mientras el fichero contenga `PROVISIONAL`); (b) `core/` y `rules/` sin three ni DOM
(excepción: `core/input.ts`, el adaptador de entrada; `import type` de three en `context.ts`); (c) sin `console.log`;
(d) invariantes de `config.ts` (pesos, precios, armas, tienda, THREAT_SCALE, mezclas, hordas, temporizadores, mapa y zonas);
(e) cobertura de eventos y (f) ficheros huérfanos — **informativos** mientras haya stubs; (g) sin assets ni red.
Endurecer (e)/(f): `QA_STRICT=1 pnpm test` (se endurecen solos cuando no queda `PROVISIONAL` en `src/`; `QA_STRICT=0` lo relaja).
Justificar excepciones en `EVENT_ALLOW` / `ORPHAN_ALLOW`.

## Interpretar resultados

- `FAIL` en playthrough con módulos reales = incumplimiento del contrato: el detalle indica valor medido y esperado.
- `WARN` = interpretación no explícita en el contrato (`R.soft`) o dato informativo; revisar, no bloquea.
- Errores de arranque (`window.__qa no apareció; errores de arranque: …`) fallan rápido con la traza del navegador.
- `qa.snapshot()` convierte NaN/Infinity en `null` (JSON): los scripts usan `bot.scanAll()` sobre el estado real.

## Limitaciones

- SwiftShader no mide FPS reales: el objetivo de 60 FPS se valida con drawCalls, triángulos y tiempo de `update()`.
  `render ms` en perf es orientativo. Con CPU compartida, el tiempo de `update()` es ruidoso (por eso es informativo).
- El bucle rAF se congela durante los scripts: el tiempo sólo avanza con `bot.step()` (dt fijo 1/30 s).
- `__qa.step(s, 0)` no termina (bucle con dt=0 en `Game.step`); los scripts nunca lo usan.
- Los escenarios asumen: interactuables en `MAP.relay`/`MAP.lz.radio`/jaulas/armería, ETA/ventana de `MISSIONS`, motivos de
  denegación `funds|full|owned` y que la tienda se cierra con E. Ajustar el escenario si el contrato cambia.

## Instrumentación pasiva (`?perf=1`) — v0.1.5

Mide el rendimiento **sin cambiar el juego**. Sólo se carga con `?perf=1` (chunk aparte, import dinámico en
`src/main.ts`); sin ese parámetro no se descarga ni se ejecuta nada. Código: `src/game/perf.ts` (navegador) y
`src/game/perfStats.ts` (estadísticas puras, `tests/perf.stats.test.ts`).

- **No toca** el bucle del juego, `requestAnimationFrame`, el paso de simulación, la calidad, la resolución
  dinámica, el render ni el audio: observa con su propio callback de rAF.
- **Sin `?qa=1`** para medir en un dispositivo real: `?qa=1` activa `preserveDrawingBuffer` y desactiva el
  escalado adaptativo, así que el informe con `?qa=1&perf=1` sale marcado `validForDeviceFps: false`.
- Distinguible: `html[data-perf="1"]` y un distintivo «PERF» sin interacción en el borde izquierdo.
- Registra: frame time (buffer de ≈ 262 000 intervalos), ventanas de 5 s con FPS derivado, p50/p95/p99, frames
  > 2 × mediana, pausas > 100/250 ms y rachas de stutter; muestra por ventana de calidad, `resolutionScale`,
  pixel ratio, draw calls, recursos de GPU y `performance.memory` (clase C); arranque (navegación, construcción
  del juego, generación del mundo por fases, título interactivo, primer frame, peor frame de los 5 s iniciales de
  cada partida); cargas del GLB de personaje; ciclo de vida (visibilidad, pagehide/pageshow, freeze/resume,
  blur/focus, pantalla completa, orientación, tamaño, pérdida/restauración de contexto, estado del audio, flujo);
  errores clasificados (aplicación / externo / desconocido; recursos, promesas y CSP); datos del dispositivo y de WebGL.
- La cadencia derivada de rAF se etiqueta **«rAF observed cadence»**: NO es la frecuencia física de la pantalla.
- API en consola: `__perf.mark('escena')`, `__perf.summary(desdeMs, hastaMs)`, `__perf.snapshot({ raw: true })`,
  `__perf.download()` (JSON), `__perf.resetFrames()` (tras el calentamiento).
- La sobrecarga propia (µs por frame) va en el informe; no se declara «cero sobrecarga».

## QA móvil (`pnpm qa:mobile`) — v0.1.5

Emulación de Chromium (`isMobile`, `hasTouch`, DPR, viewport) con `?touch=1&qa=1&q=low` en perfiles 16:9, 20:9,
19,5:9, tableta 16:10 y 4:3 y una aproximación del Redmi Note 8 Pro (por especificación, a confirmar con `adb`).
Toques reales por CDP (`Input.dispatchTouchEvent`): joystick, mirada, botones, multitáctil (3 dedos), interactuar,
mapa, pausa, ajustes (zurdo), vertical, áreas seguras (`Emulation.setSafeAreaInsetsOverride`), vibración (espía),
desbloqueo de audio con la política de autoplay real y pantalla completa (sin `?qa=1`, porque con `qa` no se pide).
Los solapes botón táctil ↔ HUD y los botones < 48 px se informan como WARN/INFO (criterio aún no aprobado).
**No mide rendimiento**: FPS, frame time y memoria de la emulación no son datos de Android real.

## Baseline v0.1.5 (`pnpm qa:baseline`)

`pnpm qa:baseline --label=windows-omen` ejecuta typecheck, test, build y las 6 suites de navegador **por separado**
(`--with-new` añade `qa:mobile` y `qa:instrumentation`), registra Node, pnpm, commit, estado de git, SO y Chromium, y
guarda `env.json`, un `.log` por suite, `summary.json` y `summary.md` en `qa-output/baseline-0.1.5/<label>-<fecha>/`.
No corrige nada: una suite que falla se registra y se continúa. Protocolo del dispositivo Android físico:
[ANDROID-BASELINE.md](ANDROID-BASELINE.md).

## Añadir un escenario

En `scripts/qa/playthrough.mjs`:

```js
await scenario('G', 'título', ['player', 'missions'], async (bot) => {
  await bot.start();                       // partida nueva (bucle congelado)
  await bot.teleport(MAP.relay.x, MAP.relay.z);
  await bot.hold('interact', 3);           // mantener E 3 s simulados
  const s = await bot.snap();
  R.check('relé activado', s.missions.relay.activated, `status=${s.missions.relay.status}`);
});
```

`bot` (scripts/qa/game.mjs): `step`, `stepUntil(maxS, 'expresión con q, ctx, s')`, `hold/holdUntil/tap`, `teleport`, `digit`,
`input`, `snap`, `count/events/mark` (registro de todos los eventos del bus), `run((ctx, q, arg) => …, arg)` para acciones
avanzadas sobre `game.ctx` (la función se serializa: no puede capturar variables de Node), `scanAll`, `busListeners`,
`sceneStats`, `canvasStats`, `screenshot`. `R.check` = aserción dura, `R.soft` = blanda, `R.skip` = no ejecutable.
El segundo argumento de `scenario` lista los módulos reales necesarios (degradación automática a SKIP).
