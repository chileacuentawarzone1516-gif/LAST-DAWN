"""
Punto de entrada del generador. Ejecutar dentro de Blender:

    exec(open(r"C:/Users/SASUKE/Documents/LAST-DAWN-Personajes/source/build_characters.py", encoding="utf-8").read())

Recarga el paquete `ld_chargen` desde disco en cada ejecución (útil al iterar).
"""
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else r"C:\Users\SASUKE\Documents\LAST-DAWN-Personajes\source"
if _here not in sys.path:
    sys.path.insert(0, _here)
for _m in [m for m in sys.modules if m == "ld_chargen" or m.startswith("ld_chargen.")]:
    del sys.modules[_m]

from ld_chargen import build  # noqa: E402

if __name__ == "__main__" or "LD_RUN_ALL" in globals():
    print(build.run_all())
