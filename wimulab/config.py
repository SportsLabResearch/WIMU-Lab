"""Rutas y parámetros de WIMU Lab.

· Programa:       carpeta descomprimida (se puede sustituir en cada actualización).
· Datos:          carpeta con los .qul/.qui (por defecto Documentos\\WIMU_Lab\\Datos); dentro se guardan el registro de
                  sesiones y jugadores (wimulab_registro.json) y la caché de lectura (.wimulab_cache).
· Resultados:     Documentos\\WIMU_Lab\\Resultados, una carpeta por día (AAAA_MM_DD) con informes, Excel y figuras.
· Configuración:  %APPDATA%\\WIMU_Lab\\configuracion.json (fuera del programa: no se pierde al actualizar).
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent          # …\app
ROOT = APP_DIR.parent                                       # carpeta del programa
CONFIG_DIR = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "WIMU_Lab"
CONFIG_FILE = CONFIG_DIR / "configuracion.json"
_DOCS = Path.home() / "Documents"
BASE_DATOS = (_DOCS if _DOCS.exists() else Path.home()) / "WIMU_Lab"      # fuera del programa: no se pierde al actualizar

DEFAULTS = {
    "carpeta_datos": str(BASE_DATOS / "Datos"),
    "carpeta_resultados": str(BASE_DATOS / "Resultados"),
    "titulo": "Análisis de la carga externa e interna con WIMU PRO",
    "autor": "",
    "institucion": "",
    # procesamiento
    "fuente_distancia": "velocidad",       # velocidad (∫ velocidad Doppler del GPS) | dispositivo (canal DIST)
    "v_max_valida": 40.0,                  # km/h; por encima = artefacto
    "sat_min": 4,                          # satélites mínimos para aceptar la muestra GPS
    "pdop_max": 5.0,
    "suavizado_v_s": 0.5,                  # media móvil de la velocidad (s)
    # zonas
    "zonas_velocidad": [6, 12, 18, 21, 24],             # km/h
    "umbral_hsr": 18.0,                                  # km/h (alta velocidad)
    "umbral_sprint": 21.0,                               # km/h
    "sprint_min_s": 1.0,
    "zonas_aceleracion": [-3, -2, -1, 1, 2, 3],         # m/s²
    "umbral_acel": 2.0,
    "umbral_acel_alta": 3.0,
    "acel_min_s": 0.5,
    "zonas_acelt": [1, 2, 3, 4, 5],                      # g
    "umbrales_impacto": [3, 5, 8],                       # g
    "zonas_fc": [60, 70, 80, 90],                        # % FCmáx
    "fcmax_defecto": "",                                 # vacío = máxima observada del jugador
    "ventanas_wcs": [1, 3, 5],                           # min (escenarios más exigentes)
    # estadística
    "alfa": 0.05,
    "decimal": ",",
}


def load() -> dict:
    cfg = dict(DEFAULTS)
    try:
        cfg.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
    except Exception:  # noqa: BLE001
        pass
    return cfg


def save(cfg: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps({k: cfg[k] for k in DEFAULTS if k in cfg}, ensure_ascii=False, indent=2), encoding="utf-8")


def carpeta_dia(cfg) -> Path:
    d = Path(cfg["carpeta_resultados"]) / datetime.now().strftime("%Y_%m_%d")
    d.mkdir(parents=True, exist_ok=True)
    return d
