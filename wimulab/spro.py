"""Concordancia con SPRO (software oficial de WIMU): se importa el Excel/CSV exportado por SPRO, se emparejan sus
filas con las sesiones de WIMU Lab (por nombre de archivo, por jugador y fecha o por dispositivo y fecha) y se
comparan las variables equivalentes.

Para cada variable: n, medias, sesgo (WIMU Lab − SPRO) con IC 95 %, sesgo %, MAE, RMSE, MAPE (solo con valores de
referencia ≥ 1 % de la media, para no inflarlo con ceros), ICC(A,1) de acuerdo absoluto e ICC(C,1) de consistencia
(McGraw y Wong, 1996; magnitud según Koo y Li, 2016), CCC de Lin, r de Pearson y Bland–Altman (límites de acuerdo del
95 % con su IC y sesgo proporcional).
"""
from __future__ import annotations

import io
import json
import math
import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

from . import estadistica as E
from . import metricas as M

ARCHIVO = "spro_importacion.json"

# variable de WIMU Lab → palabras que suelen aparecer en la columna de SPRO (normalizadas, sin tildes)
PISTAS = {
    "duracion_min": ["duracion", "duration", "tiempo total", "time"],
    "distancia_m": ["distancia total", "distancia", "total distance", "distance"],
    "m_min": ["distancia/min", "distancia min", "m/min", "dist/min", "distance/min", "metros/min", "distancia relativa"],
    "v_max_kmh": ["velocidad max", "vel max", "max speed", "velocidad maxima", "vmax", "top speed"],
    "hsr_m": ["hsr", "alta velocidad", "high speed", "hs running", "distancia > 18", "dist >18"],
    "sprint_m": ["distancia sprint", "sprint distance", "dist sprint", "distancia > 21"],
    "n_sprints": ["n sprints", "sprints", "numero de sprints", "nº sprints"],
    "n_acel": ["aceleraciones", "accelerations", "acc >", "acel"],
    "n_decel": ["deceleraciones", "decelerations", "dec >", "decel"],
    "player_load": ["player load", "playerload", "carga del jugador", "pl"],
    "fc_media": ["fc media", "hr avg", "hr media", "frecuencia cardiaca media", "average hr", "fc med"],
    "fc_max": ["fc max", "hr max", "frecuencia cardiaca maxima", "max hr"],
    "impactos_5g": ["impactos", "impacts"],
}
CLAVES = {
    "archivo": ["archivo", "fichero", "file", "nombre del archivo", "session file"],
    "jugador": ["jugador", "player", "nombre", "deportista", "atleta", "athlete", "name"],
    "fecha": ["fecha", "date", "dia", "day"],
    "dispositivo": ["dispositivo", "device", "wimu", "id dispositivo"],
}


def _n(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9/<>%\s()]", " ", s)).strip()


def _leer_tabla(nombre: str, contenido: bytes) -> pd.DataFrame:
    if nombre.lower().endswith((".xlsx", ".xlsm", ".xls")):
        crudo = pd.read_excel(io.BytesIO(contenido), header=None, sheet_name=0)
    else:
        txt = contenido.decode("utf-8-sig", errors="replace")
        sep = ";" if txt.count(";") > txt.count(",") else ("\t" if txt.count("\t") > txt.count(",") else ",")
        crudo = pd.read_csv(io.StringIO(txt), header=None, sep=sep, dtype=str)
    crudo = crudo.dropna(how="all").dropna(axis=1, how="all").reset_index(drop=True)
    # fila de cabecera: la que tiene más celdas de texto entre las 15 primeras
    mejor, idx = -1, 0
    for i in range(min(15, len(crudo))):
        n = sum(1 for x in crudo.iloc[i] if isinstance(x, str) and re.search(r"[A-Za-zÁÉÍÓÚáéíóúñÑ]", x))
        if n > mejor:
            mejor, idx = n, i
    cab = [str(x).strip() if pd.notna(x) else f"Columna {k + 1}" for k, x in enumerate(crudo.iloc[idx])]
    vistos = {}
    for k, c in enumerate(cab):
        if c in vistos:
            vistos[c] += 1
            cab[k] = f"{c} ({vistos[c]})"
        else:
            vistos[c] = 1
    df = crudo.iloc[idx + 1:].copy()
    df.columns = cab
    return df.dropna(how="all").reset_index(drop=True)


def _num(x):
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return None
    if isinstance(x, (int, float, np.integer, np.floating)):
        return float(x)
    s = str(x).strip()
    m = re.fullmatch(r"(\d+):(\d{2})(?::(\d{2}))?", s)          # duraciones hh:mm(:ss) → min
    if m:
        h, mi, se = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
        return h * 60 + mi + se / 60 if m.group(3) else h + mi / 60
    s = s.replace(" ", "").replace(" ", "")
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s):
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def adivinar(columnas):
    norm = {c: _n(c) for c in columnas}
    claves = {}
    for k, pistas in CLAVES.items():
        claves[k] = next((c for p in pistas for c, n in norm.items() if n == p), None) or \
            next((c for p in pistas for c, n in norm.items() if n.startswith(p)), None)
    usadas = set(v for v in claves.values() if v)
    mapa = {}
    for exacto in (True, False):          # primero coincidencias exactas (evita «Distancia» → «Distancia/min»)
        for var, pistas in PISTAS.items():
            if var in mapa:
                continue
            for p in pistas:
                c = next((c for c, n in norm.items() if c not in usadas and (n == p or re.sub(r"\s*\(.*\)$", "", n) == p
                                                                              or (not exacto and n.startswith(p)))), None)
                if c:
                    mapa[var] = c
                    usadas.add(c)
                    break
    return claves, mapa


def importar(carpeta_datos, nombre, contenido):
    df = _leer_tabla(nombre, contenido)
    if df.empty:
        raise ValueError("La tabla está vacía")
    claves, mapa = adivinar(list(df.columns))
    d = dict(nombre=nombre, columnas=list(df.columns), filas=json.loads(df.astype(object).where(df.notna(), None).to_json(orient="records", force_ascii=False, default_handler=str)),
             claves=claves, mapa=mapa)
    Path(carpeta_datos).mkdir(parents=True, exist_ok=True)
    (Path(carpeta_datos) / ARCHIVO).write_text(json.dumps(d, ensure_ascii=False, default=str), encoding="utf-8")
    return resumen(d)


def cargar(carpeta_datos):
    try:
        return json.loads((Path(carpeta_datos) / ARCHIVO).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def guardar_mapa(carpeta_datos, claves, mapa):
    d = cargar(carpeta_datos)
    if not d:
        raise ValueError("Primero importe la exportación de SPRO")
    d["claves"], d["mapa"] = claves, {k: v for k, v in mapa.items() if v}
    (Path(carpeta_datos) / ARCHIVO).write_text(json.dumps(d, ensure_ascii=False, default=str), encoding="utf-8")
    return d


def resumen(d):
    if not d:
        return None
    return dict(nombre=d["nombre"], columnas=d["columnas"], n=len(d["filas"]), muestra=d["filas"][:8], claves=d["claves"], mapa=d["mapa"],
                variables=[dict(clave=v[0], nombre=M.etiqueta(v[0])) for v in M.VARIABLES])


# --------------------------------------------------------------------------- emparejamiento
def _fecha(x):
    if x is None:
        return None
    try:
        if isinstance(x, (int, float)) and 20000 < float(x) < 80000:       # número de serie de Excel
            return (pd.Timestamp("1899-12-30") + pd.Timedelta(days=float(x))).strftime("%Y-%m-%d")
        if isinstance(x, (int, float)) and float(x) > 1e11:                 # pandas → ms UNIX
            return pd.to_datetime(float(x), unit="ms").strftime("%Y-%m-%d")
        return pd.to_datetime(str(x), dayfirst=not re.match(r"\d{4}-", str(x))).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return None


def _tokens(s):
    return set(t for t in _n(s).split() if len(t) > 1)


def emparejar(d, sesiones):
    """Devuelve [(fila_spro, sesion, método)] y la lista de filas sin pareja."""
    cl = d.get("claves") or {}
    pares, sin = [], []
    usadas = set()
    for i, f in enumerate(d["filas"]):
        cand, metodo = None, ""
        arch = f.get(cl.get("archivo")) if cl.get("archivo") else None
        if arch:
            stem = _n(Path(str(arch)).stem)
            c = [s for s in sesiones if _n(Path(s["archivo"]).stem) == stem or stem in _n(s["archivo"])]
            if len(c) == 1:
                cand, metodo = c[0], "archivo"
        fe = _fecha(f.get(cl.get("fecha"))) if cl.get("fecha") else None
        if cand is None and fe and cl.get("jugador"):
            jt = _tokens(f.get(cl["jugador"]))
            c = [s for s in sesiones if (s.get("inicio") or "")[:10] == fe and jt and (jt <= _tokens(s["etiqueta_jugador"]) or _tokens(s["etiqueta_jugador"]) <= jt)]
            if len(c) == 1:
                cand, metodo = c[0], "jugador y fecha"
        if cand is None and fe and cl.get("dispositivo"):
            dv = re.sub(r"\D", "", str(f.get(cl["dispositivo"]) or ""))
            c = [s for s in sesiones if (s.get("inicio") or "")[:10] == fe and dv and re.sub(r"\D", "", s.get("dispositivo") or "") == dv]
            if len(c) == 1:
                cand, metodo = c[0], "dispositivo y fecha"
        if cand is None and fe:
            c = [s for s in sesiones if (s.get("inicio") or "")[:10] == fe]
            if len(c) == 1 and len([x for x in d["filas"] if _fecha(x.get(cl.get("fecha"))) == fe]) == 1:
                cand, metodo = c[0], "fecha (única sesión del día)"
        if cand is not None and cand["id"] not in usadas:
            usadas.add(cand["id"])
            pares.append((i, cand, metodo))
        else:
            sin.append(dict(fila=i + 1, texto=" · ".join(str(f.get(cl.get(k)) or "") for k in ("archivo", "jugador", "fecha", "dispositivo") if cl.get(k))))
    return pares, sin


# --------------------------------------------------------------------------- concordancia
def metricas_acuerdo(ref, nuevo, alfa=0.05):
    ref, nuevo = np.asarray(ref, float), np.asarray(nuevo, float)
    ok = np.isfinite(ref) & np.isfinite(nuevo)
    a, b = ref[ok], nuevo[ok]
    n = len(a)
    o = dict(n=n)
    if n < 3:
        return o
    d = b - a
    o.update(media_ref=float(a.mean()), de_ref=float(a.std(ddof=1)), media_nuevo=float(b.mean()), de_nuevo=float(b.std(ddof=1)),
             mae=float(np.abs(d).mean()), rmse=float(np.sqrt((d ** 2).mean())))
    val = np.abs(a) >= 0.01 * max(abs(a.mean()), 1e-9)
    o["mape"] = float(100 * np.mean(np.abs(d[val]) / np.abs(a[val]))) if val.sum() >= 3 else None
    o["mape_n"] = int(val.sum())
    ba = E.bland_altman(a, b, alfa)
    o.update(sesgo=ba["sesgo"], sesgo_ic=[ba["sesgo_ic_inf"], ba["sesgo_ic_sup"]], sesgo_pct=ba["sesgo_pct"], lim_inf=ba["lim_inf"],
             lim_sup=ba["lim_sup"], lim_inf_ic=list(ba["lim_inf_ic"]), lim_sup_ic=list(ba["lim_sup_ic"]), prop_pendiente=ba["prop_pendiente"],
             prop_p=ba["prop_p"], ccc=ba["ccc"])
    ic = E.icc_dos_vias(a, b, alfa)
    o.update(icc_a=ic.get("icc_a"), icc_a_ic=[ic.get("icc_a_inf"), ic.get("icc_a_sup")], icc_c=ic.get("icc_c"),
             icc_c_ic=[ic.get("icc_c_inf"), ic.get("icc_c_sup")], magnitud=E.magnitud_icc(ic.get("icc_a")))
    if np.ptp(a) > 0 and np.ptp(b) > 0:
        r, p = stats.pearsonr(a, b)
        o.update(r=float(r), r_p=float(p))
    tt = stats.ttest_rel(b, a)
    o.update(t_p=float(tt.pvalue))
    return o


def concordancia(d, sesiones, valores_wimu):
    """valores_wimu: {sid: kpis}. Devuelve los resultados por variable y la tabla de emparejamiento."""
    pares, sin = emparejar(d, sesiones)
    res = []
    for var, col in (d.get("mapa") or {}).items():
        if not col:
            continue
        a, b, pts = [], [], []
        for i, s, _ in pares:
            x = _num(d["filas"][i].get(col))
            y = (valores_wimu.get(s["id"]) or {}).get(var)
            if x is None or y is None:
                continue
            a.append(x)
            b.append(float(y))
            pts.append(dict(ref=x, nuevo=float(y), etiqueta=f"{s['etiqueta_jugador']} · {(s.get('inicio') or '')[:10]}"))
        m = metricas_acuerdo(a, b)
        res.append(dict(variable=var, nombre=M.etiqueta(var), columna=col, **{k: (None if isinstance(v, float) and not math.isfinite(v) else v) for k, v in m.items()},
                        puntos=pts))
    emp = [dict(fila=i + 1, sesion=s["archivo"], jugador=s["etiqueta_jugador"], fecha=(s.get("inicio") or "")[:16], metodo=m) for i, s, m in pares]
    return dict(resultados=res, emparejadas=emp, sin_pareja=sin, n_filas=len(d["filas"]))
