# Migración del repositorio: implementación web → Unreal Engine

Resumen técnico de la migración de la rama `main` desde la implementación web anterior de LAST DAWN al proyecto Unreal Engine 5.8.3.

- **Fecha:** 2026-09-30

## Estado al completar la migración

| Rama | Commit | Función |
|---|---|---|
| `main` | `1b0ee52c121814b88ed6a97dd0993cae98e9545f` | Proyecto Unreal principal. |
| `legacy-web` | `42f55ae611951b4f3c4467e582b41f77487de1b6` | Implementación web anterior, preservada íntegra (último estado de la antigua `main`). |
| `migration/unreal-main` | `1b0ee52c121814b88ed6a97dd0993cae98e9545f` | Conserva la referencia del punto de migración del proyecto Unreal. |

## Cómo se hizo

- La historia web y la historia Unreal son **independientes**: no comparten ningún commit. **No se realizó ningún merge** entre ellas.
- Antes de cambiar `main`, la historia web se preservó en `legacy-web`.
- El proyecto Unreal se publicó primero en `migration/unreal-main`, junto con sus objetos Git LFS, y se verificó de forma independiente.
- Por último, `main` se actualizó al commit Unreal mediante `git push --force-with-lease`, condicionado a que `main` siguiera apuntando al commit web esperado.

## Git LFS

- **542** objetos LFS
- **155,386,993** bytes
- **539** archivos `.uasset` y **3** archivos `.umap`

## Verificación independiente

Desde un clon nuevo e independiente de `migration/unreal-main`:

- 542/542 objetos LFS descargados desde GitHub.
- 542/542 con SHA-256 correcto (coincide con su OID).
- Comparación byte a byte contra el backup físico: 542/542 idénticos.
- `git lfs fsck`: OK.
- `git fsck --full`: OK.

El árbol del commit verificado coincide con el del proyecto local de origen.

## Recomendaciones para clones existentes

- Los clones creados antes de la migración contienen la historia web. **No hagas `pull`** de la nueva `main` sobre ellos: Git rechazará la fusión (*"refusing to merge unrelated histories"*) o, si se fuerza, mezclaría historias que deben permanecer separadas.
- Para el proyecto Unreal, haz un **clon nuevo** con Git LFS instalado.
- Para la implementación web anterior, trabaja sobre la rama `legacy-web`.
- Un `git fetch` sin restricciones descarga todas las ramas (incluida `legacy-web`). Si solo necesitas el proyecto Unreal, limita el fetch o el clon a `main`, por ejemplo con `git clone --single-branch --branch main`.
