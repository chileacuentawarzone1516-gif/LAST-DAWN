# LAST DAWN — Reglas operativas para Claude Code

Este archivo define las reglas permanentes de trabajo sobre el proyecto. Son obligatorias en todas las sesiones y tienen prioridad sobre cualquier suposición. Si una tarea entra en conflicto con estas reglas, detenerse y preguntar.

## Contexto del proyecto

| Campo | Valor |
|---|---|
| Proyecto | LAST DAWN |
| Género | Survival Horror / Zombie |
| Motor | Unreal Engine 5.8.3 (Launcher), `EngineAssociation` = `5.8` |
| Instalación del motor | `C:\Program Files\Epic Games\UE_5.8` |
| Tipo | C++ / Unreal Engine |
| Archivo de proyecto | `LastDawn.uproject` |
| Módulo C++ | `LastDawn` (Runtime) — targets `LastDawn` (Game) y `LastDawnEditor` (Editor) |
| Plataformas | Windows (actual) + Android (futura, no configurada) |
| Ruta oficial | `C:\Users\SASUKE\Documents\Unreal Projects\Last Dawn` |

Estado base verificado tras la migración desde OneDrive: el proyecto compila, abre `Content/FirstPerson/Lvl_FirstPerson.umap`, y Play, movimiento y cámara/ratón funcionan.

El contenido actual procede de la plantilla First Person de UE 5.8 (variantes `FirstPerson`, `Variant_Horror`, `Variant_Shooter`). No reorganizar ni eliminar nada de la plantilla sin una tarea aprobada.

## 1. Working directory

- La ruta oficial del proyecto es `C:\Users\SASUKE\Documents\Unreal Projects\Last Dawn`.
- La copia `C:\Users\SASUKE\OneDrive\Documentos\Unreal Projects\LastDawn` es un **respaldo**: nunca es el proyecto activo y debe permanecer intacta hasta nueva autorización. No leerla para trabajar, no escribir en ella, no ejecutar Git en ella.
- Antes de cualquier operación que pueda modificar archivos, verificar el working directory real. Si la sesión no está en la ruta oficial, usar rutas absolutas a la ruta oficial o detenerse y avisar.
- La ruta contiene un espacio (`Last Dawn`): entrecomillar siempre las rutas en comandos.

## 2. Git

Git se usa para versionar el proyecto. Ninguna operación Git que modifique el repositorio, el historial o un remoto se ejecuta por iniciativa propia.

Requieren **autorización explícita del usuario en la tarea actual**:

- `git init`
- `git add`
- `git commit`
- `git push`
- `git pull`
- `git fetch`
- crear o eliminar ramas
- `merge`
- `rebase`
- `squash`
- `amend`
- force push
- `reset` destructivo
- `checkout` / `restore` destructivo
- `git clean`
- `git rm`
- `git mv`
- `git stash`
- `git tag`
- `git remote`
- `git config`
- `git lfs install`
- `git lfs migrate`
- `git lfs lock`
- `git lfs unlock`

Operaciones de **solo lectura**, que pueden usarse en auditorías cuando la tarea las requiera, siempre sin modificar archivos ni el estado del repositorio:

- `git status`
- `git diff`
- `git log`
- `git show`
- `git check-ignore`
- `git check-attr`
- `git ls-files`
- `git lfs ls-files`

Una autorización vale solo para la operación y la tarea en que se dio; no se extiende a operaciones posteriores.

## 3. Unreal Engine

- No modificar la instalación del motor (`C:\Program Files\Epic Games\UE_5.8`).
- No cambiar la versión del motor ni `EngineAssociation` sin autorización.
- No modificar archivos generados para "resolver" un problema sin determinar primero su origen.

## 4. Archivos generados

No se versionan ni se modifican deliberadamente como parte del código fuente:

- `Binaries/`
- `Intermediate/`
- `Saved/`
- `DerivedDataCache/`
- `.vs/`
- Soluciones y proyectos generados de Visual Studio (`*.sln`, `*.slnx`, `*.vcxproj*`)

Se regeneran con el flujo correspondiente de Unreal (por ejemplo, *Generate Visual Studio project files* sobre `LastDawn.uproject`, o recompilación desde el editor / UnrealBuildTool).

## 5. Content

- Los assets `.uasset` y los mapas `.umap` son parte real del proyecto.
- Nunca mover, renombrar ni borrar assets (`.uasset`) ni mapas (`.umap`) sin autorización explícita.
- Cuando una operación autorizada implique mover, renombrar o borrar `.uasset`/`.umap`, debe realizarse mediante Unreal Editor o mediante un procedimiento específico de Unreal que preserve referencias y dependencias (redirectores).
- No usar el sistema de archivos ni Git para reorganizar directamente assets de Unreal, salvo que una tarea específica lo autorice y defina el procedimiento.
- Claude Code no edita `.uasset` ni `.umap` directamente: son binarios. Los cambios en Blueprints, mapas y assets se describen como pasos para realizar en el editor.
- Los mapas existentes usan **One File Per Actor**. Cada mapa debe mantenerse sincronizado con sus carpetas:
  - `Content/__ExternalActors__/<ruta del mapa>/`
  - `Content/__ExternalObjects__/<ruta del mapa>/`
- Nunca separar, mover ni eliminar arbitrariamente esos archivos. Un mapa y sus actores/objetos externos se tratan como una unidad (también al versionar: van juntos en el mismo commit, incluidas las eliminaciones).

## 6. C++ / Blueprints / Config

- **C++**: lógica estructural, sistemas, arquitectura y comportamiento reutilizable.
- **Blueprints**: composición y configuración visual cuando sea apropiado (asignar assets, ajustar valores, presentación).
- No convertir automáticamente lógica existente entre C++ y Blueprint.
- No modificar `Config/` para solucionar problemas de código sin justificarlo y sin autorización.
- La configuración local por usuario va en `Config/User*.ini`, que está ignorado por Git.

## 7. Android

- Android es una plataforma **futura** y **no está configurada** actualmente. No asumir lo contrario.
- No instalar SDK, NDK, JDK ni Android Studio, ni ejecutar `SetupAndroid.bat`, ni configurar Android de forma automática.
- Cuando llegue la fase Android: verificar primero los requisitos oficiales de Unreal Engine 5.8.3 y ejecutar la configuración de manera controlada, fase por fase, con autorización.
- Los overrides locales de Android (por ejemplo, el token de AndroidFileServer) se harán en `Config/UserEngine.ini`, no en `Config/DefaultEngine.ini`.

## 8. Blender

- Blender se usa para preparar assets 3D.
- No modificar los archivos originales de Blender sin autorización.
- No mover ni reemplazar assets del proyecto por versiones exportadas desde Blender sin una tarea explícita de migración y verificación.

## 9. Calidad y validación

Flujo obligatorio para cualquier cambio autorizado:

```
AUDIT → PLAN → APPROVAL → IMPLEMENT → TEST → VERIFY → DOCUMENT → NEXT PHASE
```

No mezclar fases. No pasar a la siguiente sin cerrar la actual.

Después de cambios de código:

- compilar;
- verificar errores y advertencias nuevas;
- ejecutar las pruebas relevantes;
- revisar que no haya modificaciones no relacionadas.

Compilación:

- Para una compilación normal mediante `Build.bat` / UnrealBuildTool, **Unreal Editor debe estar cerrado**.
- Si se necesita compilar con el Editor abierto, usar explícitamente **Live Coding** o el mecanismo de Unreal apropiado para esa situación.
- No asumir que una compilación con el Editor abierto y Live Coding desactivado es una compilación limpia.

Referencia documental de compilación del editor (Editor cerrado; ejecutarla solo cuando la tarea lo requiera):

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" LastDawnEditor Win64 Development -Project="C:\Users\SASUKE\Documents\Unreal Projects\Last Dawn\LastDawn.uproject" -WaitMutex
```

Después de cambios de assets:

- verificar referencias;
- comprobar que los mapas siguen cargando;
- comprobar que no hay assets rotos.

Quién verifica qué:

- **Claude puede verificar directamente**: compilación; errores de compilador; archivos; configuración; tests automatizados disponibles; commandlets únicamente cuando estén autorizados; resultados de herramientas que realmente haya ejecutado.
- **El usuario debe realizar o confirmar**: abrir Unreal Editor; abrir mapas; Play In Editor (PIE); movimiento; cámara; interacción; comportamiento visual; pruebas funcionales que requieran interacción manual con el Editor.
- Claude nunca afirma que una prueba manual de Unreal fue realizada si no la ejecutó mediante una herramienta que realmente permita hacerlo.
- Una prueba que no fue ejecutada se reporta como **NO VERIFICADA**.
- Compilar correctamente no equivale a verificar que el juego funciona.

Informar siempre el resultado real (incluidos errores). No dar por verificado algo que no se ha comprobado.

## 10. Cambios mínimos

- No realizar refactors, reorganizaciones, limpiezas ni mejoras no solicitadas.
- No tocar archivos no relacionados con la tarea actual.
- Si aparece un problema fuera del alcance, reportarlo y detenerse.

## 11. Documentación

- Las decisiones importantes deben documentarse.
- No inventar requisitos ni asumir decisiones que todavía no han sido aprobadas.

## 12. Seguridad

- No exponer ni copiar secretos o credenciales en respuestas, commits ni documentación.
- No modificar valores de configuración sensibles sin una justificación clara y autorización.
- El `SecurityToken` de `[/Script/AndroidFileServerEditor.AndroidFileServerRuntimeSettings]` en `Config/DefaultEngine.ini` debe mantenerse **sin cambios** hasta que exista una tarea explícita y autorizada para revisar la configuración Android / Android File Server:
  - no eliminarlo;
  - no vaciarlo;
  - no regenerarlo;
  - no reproducir su valor en documentación, respuestas, commits ni logs.

  Es el valor público de la plantilla de Unreal, no una credencial.
- Nunca versionar keystores ni archivos de firma de Android (`*.keystore`, `*.jks`, `Build/Android/*.properties`).

## 13. Git LFS

- El proyecto usa Git LFS para los formatos binarios definidos en `.gitattributes` (incluidos `*.uasset` y `*.umap`).
- No cambiar `.gitattributes`, `.gitignore` ni el esquema LFS sin autorización.
- No activar `lockable` todavía.

## 14. Regla fundamental

Si una operación puede:

- borrar;
- mover;
- renombrar;
- sobrescribir;
- instalar;
- publicar;
- subir;
- descargar;
- modificar Git;
- modificar assets;
- modificar configuración estructural;

**detenerse y solicitar autorización explícita** si esa operación no está específicamente autorizada por la tarea actual.

## Formato de informe

Al cerrar cada tarea, informar con:

- `ESTADO`: TODO CORRECTO / CORRECTO CON OBSERVACIONES / HAY ERRORES / NO VALIDABLE
- `SEVERIDAD`: BAJA / MEDIA / ALTA / CRÍTICA
- `CONFIRMADO` / `PENDIENTE` / `NO VERIFICADO`
- Archivos creados o modificados, y confirmación de que no hubo otros cambios.
