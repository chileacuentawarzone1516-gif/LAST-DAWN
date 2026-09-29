# LAST DAWN — Arquitectura

FPS de extracción con zombis, un jugador, 100 % en el navegador. Three.js + TypeScript + Vite + pnpm.
Sin backend, sin cuentas, **sin assets descargados**: modelos, texturas y sonidos se generan por código.

## Reglas de diseño (resumen jugable)

- Distrito industrial 400×400 m en cuarentena, **hora azul**. Norte = −Z. Eje Y arriba. Metros y segundos.
- Zonas de amenaza creciente (de sur a norte): **Perímetro Sur (1) → Polígono de Almacenes (2) → Refinería y Patio de
  Contenedores (3) → Complejo de Investigación (4)**. Más amenaza = infectados más duros (`THREAT_SCALE`) y mejor botín.
- Contratos (cada uno paga **una sola vez**):
  1. **Restaurar el relé** — mantener E 3 s en el transmisor y permanecer 55 s dentro del círculo marcado mientras los
     infectados convergen (horda `relay`). Salir del círculo hace decaer el progreso.
  2. **Eliminar al Warden** — élite blindado en el complejo. Primero se destruye el casco (los impactos en la cabeza
     dañan sólo el casco), luego se apunta a la cabeza (×3.5). El cuerpo está blindado (×0.22).
  3. **Extracción** — la radio del LZ sólo funciona con el relé restaurado. Mantener E 4 s → llega el helicóptero en 40 s
     mientras dura la **horda final** → aterriza → ventana de 45 s para abordar (mantener E 2.5 s cerca).
- Reglas de partida: a los **7:30** se extiende una oleada de contaminación desde el complejo (radio creciente, daño por
  segundo, el blindaje no protege); a los **12:00** el distrito se sella. **Se pierde** si mueres, si el distrito se
  sella antes de llamar a la extracción, o si el helicóptero se va sin ti.
- Economía: dinero por contratos y botín; jaulas de suministro (4, una por zona) y banco de armería (LZ) para comprar con
  las teclas **1-6**. Datos de catálogo en `SHOP`.
- Controles: WASD, ratón, clic izq. disparar, clic der. apuntar, R recargar, Shift correr, Espacio saltar, C agacharse
  (toggle), E interactuar (mantener donde se indique), 1/2 o rueda cambiar arma, G granada, Q placa de armadura,
  M mapa táctico, Esc pausa.

## Estructura

```
src/config.ts            balance y datos de mapa (ÚNICA fuente de números)
src/core/                contrato: tipos, eventos, estado, contexto, entrada, interacción, utilidades
src/rules/               reglas PURAS (sin three.js) → testeables con vitest
src/engine/              renderer, cielo/luz, post, materiales y texturas procedurales, fx
src/world/               distrito procedural, colisiones, navegación, contaminación visual
src/player/, src/weapons/ controlador FPS, armas, granadas, viewmodel
src/enemies/             infectados, IA, Warden, director de spawns
src/missions/            contratos, economía, botín, helicóptero, reglas de partida
src/ui/                  HUD, menús, tienda, mapa táctico
src/audio/               sintetizador WebAudio, SFX, ambiente, música adaptativa
src/game/Game.ts         orquestador (bucle, flujo title/playing/paused/ended)
src/game/qa.ts           window.__qa (sólo con ?qa=1)
src/dev/                 stubs de módulos + harness de previews
dev/*.html + dev/*.ts    página de preview por módulo
scripts/qa/              scripts de QA con Chrome headless
tests/                   tests vitest (además de tests junto a src/rules)
```

## Contrato entre módulos

- **Todo se comunica por `GameContext` (`src/core/context.ts`), `RunState` (`src/core/state.ts`) y el bus de eventos
  (`src/core/events.ts`).** Un módulo NO importa de otro módulo de juego (sólo de `core/`, `config`, `rules/`,
  `engine/geometry helpers` si existen y `three`).
- Cada módulo exporta su factoría en `src/<módulo>/index.ts`: `createWorld(ctx)`, `createPlayer(ctx)`, `createEnemies(ctx)`,
  `createMissions(ctx)`, `createUi(ctx)`, `createAudio(ctx)`; el motor exporta `createEngine(opts)`. **Las firmas y las
  interfaces de `core/context.ts` no se cambian**; se pueden AÑADIR miembros opcionales o campos nuevos de estado en la
  sección propia si hace falta (avisar en el informe final).
- Orden de construcción: `world → ui → audio` (persistentes) y `player → enemies → missions` (por partida, se recrean al
  reiniciar). En la factoría sólo puedes usar módulos ya construidos; el resto está disponible en `update()`.
- Orden de `update(dt)` por frame: interactions, player, enemies, missions, world, fx, ui, audio.
- **Estado**: `ctx.state` es estable (se reinicia in-place). Los módulos persistentes NO cachean sub-objetos de
  `ctx.state`. Sólo el dueño escribe cada sección: player → `state.player.{pos,yaw,hp,armor,alive,slots (munición),…}`;
  rules/economy y missions → dinero, compras, misiones, partida; ui → `state.ui`.
- **Eventos**: payloads planos (`Vec3 = {x,y,z}`); nunca guardes referencias. `audio`, `fx` y `ui` reaccionan a eventos; los
  módulos de juego emiten y no llaman a audio. Los módulos por partida usan `ctx.bus.scope()` y cancelan en `dispose()`.
- **Reglas puras**: `src/rules/*.ts` no importan three.js ni DOM; reciben/devuelven datos planos. Toda la lógica de
  balance importante (daño, armadura, contratos, economía, contaminación, director, botín) vive ahí y tiene tests.
- **Colisión**: XZ con círculo vs AABB/cilindros (`world.moveCircle`, `groundHeight`, `raycast`). Y: sólo alturas de
  superficie pisables (cajas, plataformas, escaleras bajas).
- **Viewmodel**: el arma va en `ctx.viewScene` (la `viewCamera` está fija en el origen mirando −Z; el arma se coloca
  con offset relativo a ella). El motor la dibuja tras la escena con el depth limpio.
- **Rendimiento (objetivo 60 FPS)**: geometría estática fusionada o instanciada, materiales compartidos, sin `new` en el
  bucle caliente, pools para partículas/proyectiles/decals, luces dinámicas mínimas (pool en `fx.flash`), sombras sólo de
  la luna siguiendo al jugador, límite de infectados vivos (`DIRECTOR.maxAlive`).
- **Sin dependencias nuevas**: sólo `three` (más `three/addons`), `vite`, `vitest`, `typescript`, `playwright-core`.

## Flujo de trabajo por módulo

1. Implementa dentro de tus directorios (los ficheros de otros módulos son de sólo lectura).
2. Crea tu preview `dev/<módulo>.html` + `dev/<módulo>.ts` usando `createDevGame({ use: ['<módulo>'] })`
   (`src/dev/harness.ts`); los demás módulos son stubs (`src/dev/stubs.ts`). Puedes pasar `overrides` con mocks propios.
3. Comprueba en Chrome headless (`scripts/qa/lib.mjs`: `launchBrowser`, `openPage`, `startServer`) con `?qa=1`:
   sin `pageerror` ni `console.error`, y captura de pantalla (guárdala en `qa-output/<módulo>/`).
4. `pnpm typecheck` debe pasar para tus ficheros (otros módulos pueden estar a medias: filtra con `| grep "src/<módulo>"`).
5. Tests de reglas con vitest en `tests/<módulo>.*.test.ts` para todo lo que esté en `src/rules/` que te pertenece.
6. No instales paquetes, no toques `package.json`, `tsconfig.json`, `vite.config.ts`, `core/`, `Game.ts` ni ficheros ajenos.
   Si necesitas un cambio en el contrato, hazlo mínimo/aditivo y descríbelo en tu informe.
7. Puerto de vite dedicado por agente (`pnpm exec vite --port <P> --strictPort`; ver tu brief); apágalo al terminar.

## Propiedad de ficheros

| Módulo | Ficheros |
| --- | --- |
| motor/render | `src/engine/**`, `dev/engine.*` |
| mundo | `src/world/**`, `dev/world.*`, `tests/world.*.test.ts` |
| jugador y armas | `src/player/**`, `src/weapons/**`, `src/rules/combat.ts`, `src/rules/weapons.ts`, `dev/player.*`, `tests/player.*` |
| enemigos e IA | `src/enemies/**`, `src/rules/enemies.ts`, `src/rules/director.ts`, `dev/enemies.*`, `tests/enemies.*` |
| misiones y economía | `src/missions/**`, `src/rules/{match,missions,economy,loot}.ts`, `dev/missions.*`, `tests/missions.*` |
| HUD y UI | `src/ui/**`, `src/rules/markers.ts`, `dev/hud.*`, `tests/ui.*` |
| audio | `src/audio/**`, `dev/audio.*` |
| QA | `scripts/qa/**`, `tests/qa.*`, `docs/QA.md` |
| lead | `src/core/**`, `src/config.ts` (los agentes sólo añaden en su sección), `src/game/**`, `src/dev/**`, docs raíz |
