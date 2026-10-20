"""Datos de otros dispositivos vinculados a una sesión WIMU (v1.2.0).

Caso típico: el WIMU registra GPS y acelerómetro, pero la banda de FC no se emparejó (el .qul no trae pulsómetro) y la FC
está en el reloj o en la aplicación de la banda (Polar, Garmin, Suunto…). Se importa ese archivo (FIT, GPX, TCX o CSV),
se alinea por hora UTC con la sesión y su FC pasa a usarse en el análisis, las zonas, el TRIMP y los informes.

· El archivo original no se modifica: se guarda una copia en <carpeta de datos>/.wimulab_externos/<id de sesión>/.
· La alineación usa la hora absoluta de ambos registros más un desfase manual (s) para corregir relojes desajustados.
  Antes de aplicar un desfase conviene averiguar su origen (relojes, zona horaria, inicio real de la captura).
· Si el archivo externo también tiene velocidad GPS, se estima el desfase que mejor alinea su velocidad con la del WIMU
  (correlación cruzada) y se muestra como sugerencia; nunca se aplica automáticamente.
"""
from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import comparador as COMP
from . import qul
from .registro import LOCK

CARPETA = ".wimulab_externos"
MAX_BYTES = 60_000_000
_CACHE: dict = {}
_CLOCK = threading.Lock()


def carpeta(reg, sid) -> Path:
    return reg.base / CARPETA / sid


def zona(meta):
    """Zona horaria de la sesión (TIMEO del .qul, p. ej. +0200) para interpretar horas sin zona del archivo externo."""
    off = qul._desfase(meta.get("desfase") or "")
    return timezone(off) if off is not None else None


def rango_utc(meta):
    """(inicio, fin) de la sesión en UNIX s, o None si el archivo WIMU no tiene hora absoluta."""
    b = meta.get("base_unix")
    if b is None:
        return None
    return float(b) + float(meta.get("t0") or 0), float(b) + float(meta.get("t1") or 0)


def filas(reg, sid, e, meta):
    """Registros del archivo externo (con caché en memoria)."""
    f = carpeta(reg, sid) / e["archivo"]
    st = f.stat()
    clave = (str(f), st.st_mtime, st.st_size, str(meta.get("desfase")), meta.get("base_unix"))
    with _CLOCK:
        if clave in _CACHE:
            return _CACHE[clave]
    r = rango_utc(meta)
    datos, _ = COMP.leer_info(e.get("original") or e["archivo"], f.read_bytes(), zona(meta), r[0] if r else None)
    with _CLOCK:
        if len(_CACHE) > 20:
            _CACHE.clear()
        _CACHE[clave] = datos
    return datos


def _solape(meta, ini, fin, desfase):
    r = rango_utc(meta)
    if not r:
        return None
    a, b = max(r[0], ini + desfase), min(r[1], fin + desfase)
    dur = max(r[1] - r[0], 1e-9)
    return dict(segundos=max(0.0, b - a), pct_sesion=100 * max(0.0, b - a) / dur)


def _sugerir_desfase(meta, ini, fin, p_gps, datos):
    """Propuesta de desfase (s): 1) zona horaria (horas enteras) si no hay solape; 2) correlación de velocidades."""
    r = rango_utc(meta)
    if not r:
        return None
    sol = _solape(meta, ini, fin, 0)
    if sol and sol["segundos"] == 0:
        dif = (r[0] - ini) / 3600
        for h in sorted((h for h in range(-14, 15) if h), key=lambda h: (abs(h - dif), abs(h))):
            s2 = _solape(meta, ini, fin, h * 3600)
            if s2 and s2["segundos"] > 0:
                return dict(desfase_s=float(h * 3600), motivo=f"No hay solape con la sesión; desplazando {h:+d} h coincide. "
                                                              "Suele deberse a una hora guardada sin zona horaria (UTC frente a hora local).")
    if p_gps is None:
        return None
    sp = [(x["time"], x["speed"]) for x in datos if x.get("speed") is not None]
    if len(sp) < 120:
        return None
    te, ve = np.array(sp, float).T
    tw = p_gps["t"] + float(meta["base_unix"])
    vw = np.nan_to_num(p_gps["v"])
    lo, hi = max(te[0], tw[0]) - 300, min(te[-1], tw[-1]) + 300
    if hi - lo < 300:
        return None
    grid = np.arange(lo, hi, 1.0)
    a = np.interp(grid, tw, vw, left=np.nan, right=np.nan)
    b = np.interp(grid, te, ve, left=np.nan, right=np.nan)
    best, bc = 0, -1.0
    for lag in range(-300, 301):
        bb = np.roll(b, lag)
        ok = np.isfinite(a) & np.isfinite(bb)
        if lag > 0:
            ok[:lag] = False
        elif lag < 0:
            ok[lag:] = False
        if ok.sum() < 120 or np.std(a[ok]) == 0 or np.std(bb[ok]) == 0:
            continue
        c = float(np.corrcoef(a[ok], bb[ok])[0, 1])
        if c > bc:
            bc, best = c, lag
    if bc < 0.5 or best == 0:
        return None
    return dict(desfase_s=float(best), motivo=f"La velocidad del archivo se alinea mejor con la del WIMU desplazándola {best:+d} s "
                                              f"(r = {bc:.2f}). Compruebe antes el origen de la diferencia.")


def anadir(reg, sid, meta, nombre, contenido, wimu_tiene_fc, p_gps=None):
    nombre = Path(nombre).name
    if not re.search(r"\.(fit|gpx|tcx|csv|txt)$", nombre, re.I):
        raise ValueError("Formato no compatible: use FIT, GPX, TCX o CSV.")
    if len(contenido) > MAX_BYTES:
        raise ValueError("Archivo demasiado grande (máximo 60 MB).")
    if rango_utc(meta) is None:
        raise ValueError("El archivo WIMU no tiene hora absoluta (sin sincronización ni GPS): no se puede alinear otro dispositivo.")
    r = rango_utc(meta)
    datos, info = COMP.leer_info(nombre, contenido, zona(meta), r[0])
    d = carpeta(reg, sid)
    d.mkdir(parents=True, exist_ok=True)
    base, ext = Path(nombre).stem, Path(nombre).suffix.lower()
    guardado, k = f"{base}{ext}", 1
    while (d / guardado).exists():
        k += 1
        guardado = f"{base}_{k}{ext}"
    (d / guardado).write_bytes(contenido)
    sug = _sugerir_desfase(meta, info["inicio"], info["fin"], p_gps, datos)
    e = dict(archivo=guardado, original=nombre, formato=info["formato"], dispositivo=info.get("dispositivo") or "",
             variables=info["variables"], gps=info["gps"], inicio=info["inicio"], fin=info["fin"], n=len(datos),
             relativo=bool(info.get("relativo")), avisos=info["avisos"], desfase_s=0.0,
             usar_fc=("hr" in info["variables"]) and not wimu_tiene_fc, sugerencia=sug,
             alta=datetime.now().isoformat(timespec="seconds"))
    with LOCK:
        s = reg.sesion(sid)
        lst = [x for x in (s.get("externos") or []) if x.get("archivo") != guardado]
        if any(x.get("usar_fc") for x in lst):
            e["usar_fc"] = False                        # se respeta la fuente de FC ya elegida (una sola)
        lst.append(e)
        s["externos"] = lst
    reg.guardar()
    return e


def editar(reg, sid, archivo, datos):
    with LOCK:
        s = reg.sesion(sid)
        lst = s.get("externos") or []
        e = next((x for x in lst if x.get("archivo") == archivo), None)
        if e is None:
            raise KeyError("Archivo externo no encontrado")
        if "desfase_s" in datos:
            v = float(str(datos["desfase_s"]).replace(",", ".") or 0)
            if not -86400 <= v <= 86400:
                raise ValueError("Desfase fuera de rango (±24 h)")
            e["desfase_s"] = round(v, 2)
        if "usar_fc" in datos:
            e["usar_fc"] = bool(datos["usar_fc"]) and "hr" in (e.get("variables") or [])
            if e["usar_fc"]:
                for x in lst:
                    if x is not e:
                        x["usar_fc"] = False
    reg.guardar()
    return e


def borrar(reg, sid, archivo):
    with LOCK:
        s = reg.sesion(sid)
        s["externos"] = [x for x in (s.get("externos") or []) if x.get("archivo") != archivo]
    f = carpeta(reg, sid) / Path(archivo).name
    try:
        f.unlink()
    except OSError:
        pass
    reg.guardar()


def firma(s):
    """Parte de la firma de cálculo que depende de los archivos externos."""
    return [(e.get("archivo"), e.get("desfase_s"), bool(e.get("usar_fc"))) for e in (s.get("externos") or [])]


def aplicar(rq, s, reg):
    """Sustituye/añade la señal de FC del registro WIMU con la del archivo externo marcado «usar_fc»."""
    e = next((x for x in (s.get("externos") or []) if x.get("usar_fc")), None)
    if e is None or rango_utc(rq.meta) is None:
        return
    try:
        datos = filas(reg, s["id"], e, rq.meta)
    except Exception as ex:  # noqa: BLE001
        rq.meta["fc_externa_error"] = f"No se pudo leer «{e.get('original')}»: {ex}"
        return
    hr = [(x["time"], x["hr"]) for x in datos if x.get("hr") is not None]
    if len(hr) < 11:
        return
    t, v = np.array(hr, float).T
    t = t + float(e.get("desfase_s") or 0) - float(rq.meta["base_unix"])        # → segundos del reloj del WIMU
    orden = np.argsort(t, kind="stable")
    t, v = t[orden], v[orden]
    keep = np.r_[True, np.diff(t) > 0]
    # solo el tramo que coincide con el registro WIMU (no alarga la duración de la sesión)
    a, b = float(rq.meta.get("t0") or 0), float(rq.meta.get("t1") or 0)
    if b > a:
        keep &= (t >= a) & (t <= b)
    if keep.sum() < 11:
        rq.meta["fc_externa_error"] = (f"La FC de «{e.get('original')}» no coincide en el tiempo con la sesión WIMU "
                                       "(revise la hora del archivo o el desfase).")
        return
    tenia = rq.tiene("hr")
    rq.senales["hr"] = dict(t=t[keep], cols=["hr"], v=v[keep][:, None])
    rq.meta["fc_fuente"] = dict(archivo=e.get("original"), formato=e.get("formato"), desfase_s=e.get("desfase_s") or 0,
                                sustituye_wimu=tenia)


def resumen(reg, s, meta):
    """Lista para la interfaz, con el solape recalculado con el desfase actual."""
    out = []
    for e in s.get("externos") or []:
        x = dict(e)
        x["solape"] = _solape(meta, e["inicio"], e["fin"], float(e.get("desfase_s") or 0))
        x["existe"] = (carpeta(reg, s["id"]) / e["archivo"]).exists()
        out.append(x)
    return out
