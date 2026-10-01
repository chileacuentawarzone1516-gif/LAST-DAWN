# LAST DAWN

LAST DAWN es un juego de **survival horror** con temática de zombis desarrollado en **Unreal Engine 5.8.3** con **C++**.

- **Plataforma actual:** Windows.
- **Plataforma objetivo futura:** Android. Todavía **no** está configurada en este proyecto.

## Estado actual

El proyecto se encuentra en una **fase inicial de desarrollo**. La base actual deriva de la plantilla **First Person** de Unreal Engine 5.8 (incluidas sus variantes `FirstPerson`, `Variant_Horror` y `Variant_Shooter`). Todavía no contiene gameplay propio de LAST DAWN.

La procedencia del contenido de Unreal se detalla en [NOTICE.md](NOTICE.md).

## Requisitos

- **Unreal Engine 5.8.3**
- **Visual Studio** con los componentes indicados en [`.vsconfig`](.vsconfig) (desarrollo de juegos con C++, MSVC, Windows SDK).
- **Git** y **Git LFS** — obligatorio: los assets de Unreal (`.uasset`, `.umap`) y otros binarios se almacenan con Git LFS según [`.gitattributes`](.gitattributes).

## Clonar el repositorio

```bash
git lfs install
git clone https://github.com/chileacuentawarzone1516-gif/LAST-DAWN.git
```

Después de clonar, comprueba que los assets se descargaron (no deben quedar punteros LFS):

```bash
git lfs ls-files
git lfs fsck
```

Para abrir el proyecto: genera los archivos de Visual Studio desde `LastDawn.uproject` (*Generate Visual Studio project files*) y ábrelo con Unreal Engine 5.8.3.

## Estructura del repositorio

| Ruta | Contenido |
|---|---|
| `LastDawn.uproject` | Descriptor del proyecto Unreal |
| `Source/` | Código C++ (módulo `LastDawn`, targets `LastDawn` y `LastDawnEditor`) |
| `Config/` | Configuración del proyecto (`Default*.ini`) |
| `Content/` | Assets de Unreal (Git LFS). Los mapas usan *One File Per Actor* (`Content/__ExternalActors__/`, `Content/__ExternalObjects__/`) |
| `docs/` | Documentación técnica del repositorio |
| `CLAUDE.md` | Reglas operativas para el trabajo asistido con Claude Code |
| `NOTICE.md` | Procedencia del contenido y atribuciones |

Las carpetas generadas por Unreal (`Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/`) no se versionan.

## Ramas

| Rama | Propósito |
|---|---|
| `main` | Proyecto Unreal principal. |
| `legacy-web` | Implementación web anterior de LAST DAWN, preservada como historial. No forma parte del proyecto Unreal. |
| `migration/unreal-main` | Referencia que conserva el punto de migración del proyecto Unreal. |

## Aviso para clones antiguos

Hasta septiembre de 2026, `main` contenía una implementación web del juego. `main` ahora contiene el proyecto Unreal, cuya historia es **independiente** de la anterior.

Si tienes un clon basado en la antigua historia web, **no** hagas `pull` ni intentes mezclar la nueva `main` sobre él. Para el proyecto Unreal, haz un clon nuevo. Para la implementación web anterior, usa la rama `legacy-web`.

Más detalles en [docs/MIGRATION.md](docs/MIGRATION.md).
