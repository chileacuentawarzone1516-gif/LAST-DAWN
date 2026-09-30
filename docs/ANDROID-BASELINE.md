# Línea base Android — v0.1.5 (BETA)

Protocolo para medir LAST DAWN en un **Android físico** con la instrumentación pasiva (`?perf=1`). Aquí sólo hay
procedimiento: **ningún resultado** se ha medido todavía. Objetivo aprobado: el **máximo FPS sostenible** por
dispositivo (sin FPS universal, sin limitador y sin objetivo fijo de 30/60/90/120).

## Dispositivo de referencia

| Dispositivo | Papel | Estado |
| --- | --- | --- |
| Redmi Note 8 Pro | **Primer dispositivo físico de referencia Android** | Pendiente de medir |

Sus resultados **no se extrapolan** a gama baja, media o alta, ni a Android en general. La matriz de categorías queda
pendiente hasta disponer de más dispositivos reales.

Ficha a rellenar (salida de `adb`, no por especificación): fabricante, modelo, Android y SDK, versión de Chrome y de
Android System WebView, RAM (`/proc/meminfo`), `wm size`, `wm density`, frecuencias de pantalla soportadas y la
configurada, cadena de GPU (`__perf.snapshot().webgl`), calidad inicial elegida.

## Preparación (equipo anfitrión, p. ej. la HP OMEN)

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm preview            # build de producción en :4173 con las cabeceras de producción
adb devices -l
adb reverse tcp:4173 tcp:4173         # el móvil abre http://localhost:4173 → contexto seguro
```

Abrir `http://localhost:4173/?perf=1` en Chrome del móvil (**nunca** con `?qa=1` para medir FPS). DevTools remoto:
`chrome://inspect/#devices` en el anfitrión, **sólo** en ventanas cortas o al final (su sobrecarga contamina el frame time).

Condiciones (si falta alguna, la medición no vale; PLAN §19): 10 min de reposo previo; batería > 50 % y carga
anotada y sin cambiar; ahorro de batería desactivado; brillo fijo; notificaciones silenciadas; apps de fondo
cerradas; versión de Chrome y frecuencia de pantalla configurada anotadas.

## Durante la medición

```bash
adb shell dumpsys thermalservice                 # estado térmico (Android 10+), cada minuto
adb shell dumpsys battery | grep -i temperature  # décimas de °C
adb shell ps -A | grep -i chrome                 # procesos de Chrome (navegador / renderer / GPU)
adb shell dumpsys meminfo <PID>                  # memoria por proceso, en el título tras cada partida
adb shell dumpsys display | grep -iE "refreshRate|mode|fps"
```

En la consola remota: `__perf.mark('relé-horda')` al entrar en cada escena, `__perf.resetFrames()` tras el
calentamiento, y al terminar `copy(JSON.stringify(__perf.snapshot({ raw: true })))` o `__perf.download()`.

## Qué NO dice la instrumentación

- **«rAF observed cadence»** no es la frecuencia física de la pantalla: contrastarla con `dumpsys display` y, si se
  puede, Perfetto (`android.surfaceflinger.frametimeline`, Android 12+) u «Mostrar frecuencia de actualización».
- `heapMB` (`performance.memory`) está cuantizado y no es la memoria real del proceso ni de la GPU.
- Las estimaciones de texturas no son memoria de GPU real.
- El FPS de la emulación (`pnpm qa:mobile`) o de SwiftShader no es rendimiento de Android.

## Artefactos

Datos pesados (trazas, heaps, dumps, JSON en bruto, capturas) en `qa-output/baseline-0.1.5/` (ignorado por git). El
informe resumido de la línea base se redactará después como documento ligero aparte.
