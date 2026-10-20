"""Capa de servicio: registro + lectura + métricas, con cachés en memoria y tareas en segundo plano."""
from __future__ import annotations

import hashlib
import json
import threading
import traceback
from collections import OrderedDict
from pathlib import Path

import pandas as pd

from . import config as C
from . import externos as EXT
from . import metricas as M
from . import qul
from .registro import Registro

VERSION_CALCULO = 5
CLAVES_PROCESADO = ("fuente_distancia", "v_max_valida", "sat_min", "pdop_max", "suavizado_v_s", "zonas_velocidad", "umbral_hsr",
                    "umbral_sprint", "sprint_min_s", "zonas_aceleracion", "umbral_acel", "umbral_acel_alta", "acel_min_s",
                    "zonas_acelt", "umbrales_impacto", "zonas_fc", "fcmax_defecto", "ventanas_wcs")

STATE = dict(cfg=C.load(), reg=None, job=dict(activo=False, tipo="", fraccion=0, mensaje="", resultado=None, error=""))
_PREP: OrderedDict = OrderedDict()
_PLOCK = threading.Lock()


def cfg():
    return STATE["cfg"]


def reg() -> Registro:
    if STATE["reg"] is None or STATE["reg"].base != Path(cfg()["carpeta_datos"]):
        STATE["reg"] = Registro(cfg()["carpeta_datos"])
    return STATE["reg"]


def recargar_cfg(nueva: dict):
    c = dict(cfg())
    c.update({k: v for k, v in nueva.items() if k in C.DEFAULTS})
    C.save(c)
    STATE["cfg"] = c
    with _PLOCK:
        _PREP.clear()
    return c


# --------------------------------------------------------------------------- lectura con caché
def prep(sid) -> tuple[M.Prep, qul.Registro]:
    r = reg()
    s = r.sesion(sid)
    f = r.ruta(s)
    clave = (str(f), f.stat().st_mtime, json.dumps({k: cfg()[k] for k in CLAVES_PROCESADO}, default=str),
             json.dumps(EXT.firma(s), default=str))
    with _PLOCK:
        if clave in _PREP:
            _PREP.move_to_end(clave)
            return _PREP[clave]
    rq = qul.leer(f, r.cache)
    EXT.aplicar(rq, s, r)              # FC de otro dispositivo vinculada a la sesión (si la hay)
    p = M.Prep(rq, cfg())
    fu = rq.meta.get("fc_fuente")
    if fu:
        p.avisos.append(f"FC importada de «{fu['archivo']}» ({fu['formato']}, desfase {fu['desfase_s']:+g} s)"
                        + (", en lugar del pulsómetro del WIMU." if fu.get("sustituye_wimu") else "."))
        if p.hr is not None and p.t1 > p.t0:
            cob = 100 * float(p.hr["dt"].sum()) / (p.t1 - p.t0)
            if cob < 85:
                p.avisos.append(f"La FC importada cubre el {cob:.0f} % de la duración de la sesión: las variables de FC "
                                "(media, zonas, TRIMP) describen solo ese tramo.")
    if rq.meta.get("fc_externa_error"):
        p.avisos.append(rq.meta["fc_externa_error"])
    with _PLOCK:
        _PREP[clave] = (p, rq)
        while len(_PREP) > 6:
            _PREP.popitem(last=False)
    return p, rq


def fcmax_de(s):
    j = reg().jugador(s.get("jugador"))
    return M._num(j.get("fcmax")) if j else None


def firma(s):
    f = reg().ruta(s)
    try:
        st = f.stat()
        base = f"{st.st_size}|{int(st.st_mtime)}"
    except OSError:
        base = "falta"
    txt = json.dumps(dict(v=VERSION_CALCULO, f=base, r=s.get("recorte"), fc=fcmax_de(s), c={k: cfg()[k] for k in CLAVES_PROCESADO},
                          x=EXT.firma(s)),
                     default=str, sort_keys=True)
    return hashlib.sha1(txt.encode()).hexdigest()[:16]


def _recorte(s):
    r = s.get("recorte") or [None, None]
    return (r[0], r[1]) if (r[0] is not None or r[1] is not None) else None


def calcular_kpis(sid, forzar=False):
    r = reg()
    s = r.sesion(sid)
    fm = firma(s)
    if not forzar and s.get("firma") == fm and s.get("kpis"):
        return s["kpis"]
    p, rq = prep(sid)
    res = M.resumen(p, *_ventana(p, _recorte(s)), cfg(), fcmax_de(s))
    k = {kk: (round(v, 4) if isinstance(v, float) else v) for kk, v in res.items()}
    meta = rq.meta
    s.update(kpis=k, firma=fm, inicio=meta.get("inicio") or s.get("inicio"), dispositivo=meta.get("dispositivo") or s.get("dispositivo"),
             duracion_total_min=round((p.t1 - p.t0) / 60, 2), avisos=p.avisos,
             senales=[x for x in ("gps", "acc", "hr") if getattr(p, x) is not None])
    return k


def _ventana(p, recorte):
    a, b = p.t0, p.t1
    if recorte:
        ra, rb = recorte
        a = p.t0 + max(0.0, M._num(ra, 0) or 0)
        if M._num(rb):
            b = min(p.t1, p.t0 + M._num(rb))
    return a, b


def analisis_sesion(sid):
    r = reg()
    s = r.sesion(sid)
    p, rq = prep(sid)
    out = M.analizar(p, cfg(), _recorte(s), fcmax_de(s), s.get("segmentos"))
    calcular_kpis(sid)
    r.guardar()
    j = r.jugador(s.get("jugador"))
    out.update(sesion={**s, "jugador_nombre": j["nombre"] if j else ""}, jugador=j, meta=rq.meta, inventario=rq.inventario,
               variables=[dict(clave=v[0], nombre=v[1], unidad=v[2], dec=v[3], grupo=v[4]) for v in M.VARIABLES],
               externos=EXT.resumen(r, s, rq.meta), hora_utc=EXT.rango_utc(rq.meta),
               fc_wimu=any(x.get("sensor") == "HRM" or "HEART" in str(x.get("magnitud", "")).upper() for x in rq.inventario))
    return out


# --------------------------------------------------------------------------- otros dispositivos vinculados a una sesión
def _wimu_tiene_fc(sid):
    _, rq = prep(sid)
    return any(x.get("sensor") == "HRM" or "HEART" in str(x.get("magnitud", "")).upper() for x in rq.inventario)


def externo_anadir(sid, nombre, contenido):
    p, rq = prep(sid)
    e = EXT.anadir(reg(), sid, rq.meta, nombre, contenido, _wimu_tiene_fc(sid), p.gps)
    _invalidar(sid)
    return e


def externo_editar(sid, archivo, datos):
    e = EXT.editar(reg(), sid, archivo, datos)
    _invalidar(sid)
    return e


def externo_borrar(sid, archivo):
    EXT.borrar(reg(), sid, archivo)
    _invalidar(sid)


def _invalidar(sid):
    """Recalcula los indicadores de la sesión con la nueva fuente de FC."""
    try:
        calcular_kpis(sid, forzar=True)
    finally:
        reg().guardar()


# --------------------------------------------------------------------------- tareas
def tarea(tipo, fn):
    job = STATE["job"]
    if job["activo"]:
        raise RuntimeError(f"Hay una tarea en curso: {job['tipo']}")
    job.update(activo=True, tipo=tipo, fraccion=0, mensaje="Iniciando…", resultado=None, error="")

    def run():
        try:
            res = fn(lambda f, m: job.update(fraccion=round(f, 3), mensaje=m))
            job.update(resultado=res, fraccion=1, mensaje="Completado")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            job.update(error=str(e), mensaje="Error")
        finally:
            job["activo"] = False

    threading.Thread(target=run, daemon=True).start()
    return job


def actualizar(progreso, forzar=False):
    r = reg()
    progreso(0.01, "Buscando archivos .qul / .qui…")
    nuevos, faltan = r.escanear()
    pend = [s["id"] for s in r.sesiones(incluir_faltan=False) if forzar or s.get("firma") != firma(r.sesion(s["id"])) or not s.get("kpis")]
    errores = []
    for i, sid in enumerate(pend):
        s = r.sesion(sid)
        progreso(0.05 + 0.93 * i / max(len(pend), 1), f"Leyendo {s['archivo']} ({i + 1}/{len(pend)})")
        try:
            calcular_kpis(sid, forzar)
            s.pop("error", None)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            s["error"] = str(e)
            errores.append(f"{s['archivo']}: {e}")
        if i % 5 == 4:
            r.guardar()
    r.guardar()
    return dict(nuevos=len(nuevos), faltan=len(faltan), calculadas=len(pend), errores=errores)


# --------------------------------------------------------------------------- tabla de datos para el análisis
def tabla(filtro=None, con_excluidas=False) -> pd.DataFrame:
    """Una fila por sesión con sus variables (las sesiones sin calcular se calculan)."""
    filtro = filtro or {}
    filas = []
    for s in reg().sesiones(incluir_faltan=False):
        if s.get("excluida") and not con_excluidas:
            continue
        if filtro.get("tipos") and s.get("tipo") not in filtro["tipos"]:
            continue
        if filtro.get("jugadores") and (s.get("jugador") or "") not in filtro["jugadores"]:
            continue
        if filtro.get("tareas") and (s.get("tarea") or "") not in filtro["tareas"]:
            continue
        ini = (s.get("inicio") or "")[:10]
        if filtro.get("desde") and ini and ini < filtro["desde"]:
            continue
        if filtro.get("hasta") and ini and ini > filtro["hasta"]:
            continue
        if filtro.get("ids") and s["id"] not in filtro["ids"]:
            continue
        k = s.get("kpis")
        if not k or s.get("firma") != firma(reg().sesion(s["id"])):
            try:
                k = calcular_kpis(s["id"])
            except Exception:  # noqa: BLE001
                continue
        periodo = filtro.get("periodo", "sesion")
        if periodo != "sesion":
            try:
                p, _ = prep(s["id"])
                segmentos = s.get("segmentos") or []
                def es_tiempo(seg, numero):
                    nombre = str(seg.get("nombre", "")).strip().lower()
                    return nombre in (("1.ª parte", "1ª parte", "primera parte", "primer tiempo", "1er tiempo", "1º tiempo")
                                      if numero == 1 else
                                      ("2.ª parte", "2ª parte", "segunda parte", "segundo tiempo", "2do tiempo", "2º tiempo"))
                if periodo == "primero":
                    elegidos = [sg for sg in segmentos if es_tiempo(sg, 1)]
                elif periodo == "segundo":
                    elegidos = [sg for sg in segmentos if es_tiempo(sg, 2)]
                elif periodo == "partido":
                    elegidos = [sg for sg in segmentos if es_tiempo(sg, 1) or es_tiempo(sg, 2)]
                    if not any(es_tiempo(x, 1) for x in elegidos) or not any(es_tiempo(x, 2) for x in elegidos):
                        continue
                elif periodo == "selecciones":
                    elegidos = list(segmentos)
                else:
                    nombre_buscado = str(filtro.get("nombre_periodo") or "").strip().casefold()
                    elegidos = [sg for sg in segmentos if nombre_buscado and
                                str(sg.get("nombre", "")).strip().casefold() == nombre_buscado]
                if not elegidos:
                    continue
                ventanas = sorted((max(p.t0, p.t0 + float(sg["desde"])),
                                   min(p.t1, p.t0 + float(sg["hasta"]))) for sg in elegidos)
                if any(b <= a for a, b in ventanas) or any(ventanas[i][0] < ventanas[i-1][1] for i in range(1, len(ventanas))):
                    continue
                parciales = [M.resumen(p, a, b, cfg(), fcmax_de(s)) for a, b in ventanas]
                if len(parciales) == 1:
                    k = parciales[0]
                else:
                    # Sumar extensivas y ponderar intensivas. No se cuenta el descanso.
                    import math
                    sumas = {"duracion_min", "distancia_m", "distancia_vel_m", "distancia_disp_m",
                             "tiempo_mov_min", "hsr_m", "sprint_m", "n_sprints", "n_hsr",
                             "n_acel", "n_decel", "n_acel_alta", "n_decel_alta",
                             "player_load", "trimp", "t_fc_alta_min"}
                    k = {}
                    for clave in set().union(*(v.keys() for v in parciales)):
                        valores = [(v.get(clave), v.get("duracion_min", 0)) for v in parciales]
                        validos = [(float(x), float(w)) for x, w in valores
                                   if isinstance(x, (int, float)) and math.isfinite(x)]
                        if not validos:
                            k[clave] = next((v.get(clave) for v in parciales if v.get(clave) is not None), None)
                        elif clave in sumas or clave.startswith("impactos_"):
                            k[clave] = sum(x for x, _ in validos)
                        elif clave.endswith("_max") or clave in ("v_max_kmh", "fc_max", "acel_max"):
                            k[clave] = max(x for x, _ in validos)
                        elif clave in ("fc_min", "decel_max"):
                            k[clave] = min(x for x, _ in validos)
                        else:
                            total = sum(w for _, w in validos)
                            k[clave] = sum(x*w for x, w in validos)/total if total else None
                    dur = k.get("duracion_min") or 0
                    if dur:
                        for numerador, ratio in (("distancia_m", "m_min"), ("player_load", "pl_min")):
                            if k.get(numerador) is not None:
                                k[ratio] = k[numerador] / dur
                        if k.get("n_acel") is not None and k.get("n_decel") is not None:
                            k["acel_min"] = (k["n_acel"] + k["n_decel"]) / dur
                    if k.get("distancia_m") and k.get("player_load") is not None:
                        k["pl_por_m"] = k["player_load"] / k["distancia_m"]
            except (ValueError, KeyError, TypeError, OSError):
                continue
        filas.append(dict(id=s["id"], archivo=s["archivo"], fecha=ini, inicio=s.get("inicio"), jugador_id=s.get("jugador") or f"dev:{s.get('dispositivo')}",
                          jugador=s["etiqueta_jugador"], posicion=s.get("posicion") or "", grupo=s.get("grupo") or "", tipo=s.get("tipo") or "",
                          tarea=s.get("tarea") or "", dispositivo=s.get("dispositivo") or "", **k))
    reg().guardar()
    return pd.DataFrame(filas)
