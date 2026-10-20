"""Variables de carga externa e interna a partir de un Registro de WIMU.

Procesado (documentado en el informe técnico):
  · GPS 10 Hz: se descartan las muestras con menos satélites que «sat_min», PDOP > «pdop_max» o velocidad > «v_max_valida»;
    los huecos ≤ 1 s se interpolan; la velocidad se suaviza con media móvil centrada («suavizado_v_s»).
  · Distancia: ∫ velocidad Doppler · dt (no se integra a través de huecos > 2 s) o suma del canal DIST del dispositivo;
    se calculan las dos y se usa la elegida en Ajustes.
  · Aceleración (m/s²): derivada de la velocidad suavizada a 1 s. Esfuerzos: aceleración ≥ umbral durante ≥ «acel_min_s».
  · Sprints: velocidad ≥ «umbral_sprint» durante ≥ «sprint_min_s». HSR: distancia a ≥ «umbral_hsr».
  · Acelerómetro 100 Hz: AcelT = módulo |a| (g); Player Load = Σ √(Δx²+Δy²+Δz²) / 100; impactos = picos de |a| por
    encima de cada umbral separados ≥ 0,25 s.
  · FC: se filtran valores fuera de 30–230 lpm y saltos > 25 lpm/s; tiempo ponderado (huecos > 5 s sin contar);
    %FCmáx con la FCmáx del jugador (registro), la de Ajustes o la máxima observada; TRIMP de Edwards.
  · Escenarios más exigentes (WCS): máximo móvil de la distancia, HSR y Player Load en ventanas de 1, 3 y 5 min.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

R_TIERRA = 6371000.0


def _num(x, d=None):
    try:
        return float(str(x).replace(",", "."))
    except (TypeError, ValueError):
        return d


def lista(x):
    if isinstance(x, (list, tuple)):
        return [float(v) for v in x]
    import re
    return [float(v.replace(",", ".")) for v in re.findall(r"-?\d+(?:[.,]\d+)?", str(x))]


def _f(x):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else float(x)


def _media_movil(v, k):
    if k <= 1:
        return np.array(v, dtype=float)
    return pd.Series(v).rolling(int(k), center=True, min_periods=1).mean().to_numpy(copy=True)


def _haversine(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    a = np.sin(np.diff(la) / 2) ** 2 + np.cos(la[:-1]) * np.cos(la[1:]) * np.sin(np.diff(lo) / 2) ** 2
    return 2 * R_TIERRA * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _eventos(mask, t, dur_min, sep_min=0.0):
    """Intervalos [i0, i1] donde mask es cierto durante ≥ dur_min s (se unen los separados < sep_min s)."""
    if not len(mask):
        return []
    m = np.r_[False, mask, False].astype(np.int8)
    d = np.diff(m)
    ini, fin = np.where(d == 1)[0], np.where(d == -1)[0] - 1
    out = []
    for a, b in zip(ini, fin):
        if out and sep_min and t[a] - t[out[-1][1]] < sep_min:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return [(a, b) for a, b in out if t[b] - t[a] >= dur_min - 1e-9]


def _zonas(bordes_int, abierto_abajo=True):
    b = [-np.inf] + list(bordes_int) + [np.inf]
    return b


def _etq(lims, u, dec=0, primero=None):
    b = [-np.inf] + list(lims) + [np.inf]
    out = []
    for a, z in zip(b[:-1], b[1:]):
        fa = f"{a:.{dec}f}" if np.isfinite(a) else None
        fz = f"{z:.{dec}f}" if np.isfinite(z) else None
        if fa is None:
            out.append(primero or f"< {fz} {u}")
        elif fz is None:
            out.append(f"≥ {fa} {u}")
        else:
            out.append(f"{fa}–{fz} {u}")
    return out


# =========================================================================== preparación (una vez por sesión)
class Prep:
    """Señales limpias en la base de tiempo del dispositivo (s)."""

    def __init__(self, reg, cfg):
        self.meta = reg.meta
        self.t0 = float(reg.meta.get("t0") or 0)
        self.t1 = float(reg.meta.get("t1") or 0)
        self.avisos = []
        self.calidad = {}
        self.gps = self.acc = self.hr = None
        if reg.tiene("gps"):
            self._prep_gps(reg, cfg)
        else:
            self.avisos.append("No hay GPS: no se calculan distancia, velocidad ni aceleraciones.")
        if reg.tiene("acc"):
            self._prep_acc(reg)
        else:
            self.avisos.append("No hay acelerómetro: no se calculan AcelT, Player Load ni impactos.")
        if reg.tiene("hr"):
            self._prep_hr(reg)
        else:
            self.avisos.append("No hay pulsómetro: no se calcula la frecuencia cardiaca.")
        fins = [x["t"][-1] for x in (self.gps, self.acc, self.hr) if x is not None and len(x["t"])]
        inis = [x["t"][0] for x in (self.gps, self.acc, self.hr) if x is not None and len(x["t"])]
        if inis:
            self.t0, self.t1 = float(min(inis)), float(max(fins))

    # ------------------------------------------------------------- GPS
    def _prep_gps(self, reg, cfg):
        t = reg.t("gps").astype(float)
        cols = reg.senales["gps"]["cols"]
        g = lambda c: reg.col("gps", c) if c in cols else np.full(len(t), np.nan)  # noqa: E731
        lat, lon, sp, sat, pdop, dist = g("lat"), g("lon"), g("speed"), g("sat"), g("pdop"), g("dist")
        v = sp / 3.6                                                        # SPEED en km/h → m/s
        sat_min, pdop_max, vmax = _num(cfg["sat_min"], 4), _num(cfg["pdop_max"], 5), _num(cfg["v_max_valida"], 40) / 3.6
        pos_ok = np.isfinite(lat) & np.isfinite(lon) & (np.abs(lat) > 1e-6) & (np.abs(lon) > 1e-6)
        mala_sat = np.isfinite(sat) & (sat < sat_min)
        mal_pdop = np.isfinite(pdop) & (pdop > pdop_max)
        mala_v = ~np.isfinite(v) | (v < 0) | (v > vmax)
        valido = pos_ok & ~mala_sat & ~mal_pdop & ~mala_v
        vv = np.where(valido, v, np.nan)
        # interpolación de huecos cortos (≤ 1 s)
        s = pd.Series(vv, index=t)
        fs = 1 / np.median(np.diff(t)) if len(t) > 1 else 10
        vi = s.interpolate(method="index", limit=int(round(fs)), limit_area="inside").to_numpy()
        k = max(1, int(round(_num(cfg["suavizado_v_s"], .5) * fs)))
        vs = _media_movil(np.nan_to_num(vi, nan=0.0), k)
        vs[~np.isfinite(vi)] = np.nan
        v1 = _media_movil(np.nan_to_num(vi, nan=0.0), max(1, int(round(fs))))  # para la aceleración
        a = np.array(np.gradient(v1, t) if len(t) > 2 else np.zeros_like(v1), dtype=float)
        a[~np.isfinite(vi)] = np.nan
        a = np.clip(a, -10, 10)
        dt = np.diff(t, append=t[-1])
        dt = np.where((dt > 0) & (dt <= 2.0), dt, 0.0)
        d_vel = np.nan_to_num(vs) * dt
        d_dev = np.where(np.isfinite(dist) & (dist >= 0) & (dist < vmax * 2.5), dist, 0.0)
        d_dev = np.r_[d_dev[1:], 0.0]                                   # DIST es el tramo hasta la muestra actual
        huecos = np.diff(t)
        self.gps = dict(t=t, lat=np.where(pos_ok, lat, np.nan), lon=np.where(pos_ok, lon, np.nan), v=vs, a=a, dt=dt,
                        d_vel=d_vel, d_dev=d_dev, sat=sat, pdop=pdop, valido=valido, fs=fs)
        n = len(t)
        self.calidad["gps"] = dict(
            muestras=int(n), hz=round(float(fs), 1), validas_pct=100 * valido.mean(),
            sat_media=_f(np.nanmean(sat)), sat_min=_f(np.nanmin(sat)), pct_sat_bajo=100 * mala_sat.mean(),
            pdop_medio=_f(np.nanmean(pdop)), pdop_p95=_f(np.nanpercentile(pdop, 95)) if np.isfinite(pdop).any() else None,
            pct_pdop_alto=100 * mal_pdop.mean(), artefactos_v=int((np.isfinite(v) & (v > vmax)).sum()),
            huecos_05s=int((huecos > 0.5).sum()), huecos_2s=int((huecos > 2).sum()), hueco_max_s=_f(huecos.max()) if len(huecos) else None,
            dist_haversine=_f(np.nansum(_haversine(lat[pos_ok], lon[pos_ok]))) if pos_ok.sum() > 2 else None)
        if valido.mean() < .9:
            self.avisos.append(f"GPS: solo el {100 * valido.mean():.0f} % de las muestras es válido (satélites, PDOP o velocidad imposible).")

    # ------------------------------------------------------------- acelerómetro
    def _prep_acc(self, reg):
        t = reg.t("acc").astype(float)
        xyz = reg.senales["acc"]["v"].astype(float)
        mod = np.linalg.norm(xyz, axis=1)
        dpl = np.r_[0.0, np.sqrt((np.diff(xyz, axis=0) ** 2).sum(axis=1))] / 100.0
        dt = np.diff(t, append=t[-1])
        dt = np.where((dt > 0) & (dt <= 0.5), dt, 0.0)
        fs = 1 / np.median(np.diff(t)) if len(t) > 1 else 100
        dpl = np.where(dt > 0, dpl, 0) * (100.0 / fs if fs else 1)        # normalizado a 100 Hz
        self.acc = dict(t=t, mod=mod, dpl=dpl, dt=dt, fs=fs)
        hu = np.diff(t)
        self.calidad["acc"] = dict(muestras=int(len(t)), hz=round(float(fs), 1), huecos_01s=int((hu > 0.1).sum()),
                                   saturadas=int((np.abs(xyz) >= 15.9).any(axis=1).sum()), mod_mediana=_f(np.median(mod)))

    # ------------------------------------------------------------- pulsómetro
    def _prep_hr(self, reg):
        t = reg.t("hr").astype(float)
        hr = reg.col("hr", "hr").astype(float)
        ok = np.isfinite(hr) & (hr >= 30) & (hr <= 230)
        t2, hr2 = t[ok], hr[ok]
        if len(t2) > 2:   # saltos fisiológicamente imposibles
            sl = np.abs(np.diff(hr2)) / np.maximum(np.diff(t2), .2)
            malo = np.r_[False, sl > 25]
            t2, hr2 = t2[~malo], hr2[~malo]
        dt = np.diff(t2, append=t2[-1] if len(t2) else 0)
        dt = np.where((dt > 0) & (dt <= 5), dt, 0.0)
        rr = reg.col("hr", "rr") if "rr" in reg.senales["hr"]["cols"] else None
        self.hr = dict(t=t2, hr=hr2, dt=dt, t_rr=t, rr=rr)
        hu = np.diff(t2)
        dur = (t2[-1] - t2[0]) if len(t2) > 1 else 0
        self.calidad["hr"] = dict(muestras=int(len(t2)), descartadas=int((~ok).sum() + (len(t[ok]) - len(t2))),
                                  huecos_5s=int((hu > 5).sum()), hueco_max_s=_f(hu.max()) if len(hu) else None,
                                  cobertura_pct=100 * dt.sum() / dur if dur else 0)
        if self.calidad["hr"]["cobertura_pct"] < 85:
            self.avisos.append(f"FC: la señal cubre el {self.calidad['hr']['cobertura_pct']:.0f} % del registro (pérdidas de la banda).")


# =========================================================================== variables de una ventana
def _sel(x, a, b):
    t = x["t"]
    return slice(int(np.searchsorted(t, a, "left")), int(np.searchsorted(t, b, "right")))


def resumen(p: Prep, a, b, cfg, fcmax=None):
    """Variables principales entre los instantes a y b (s del dispositivo)."""
    o = dict(duracion_min=(b - a) / 60)
    dur_min = max((b - a) / 60, 1e-9)
    if p.gps is not None:
        g = p.gps
        s = _sel(g, a, b)
        t, v, ac, dt = g["t"][s], g["v"][s], g["a"][s], g["dt"][s]
        d_vel, d_dev = g["d_vel"][s], g["d_dev"][s]
        dist = d_vel if cfg.get("fuente_distancia", "velocidad") == "velocidad" else d_dev
        kmh = v * 3.6
        o.update(distancia_m=float(dist.sum()), distancia_vel_m=float(d_vel.sum()), distancia_disp_m=float(d_dev.sum()))
        o["m_min"] = o["distancia_m"] / dur_min
        o["v_max_kmh"] = _f(np.nanmax(kmh)) if np.isfinite(kmh).any() else None
        mov = np.isfinite(kmh) & (kmh > 1)
        o["v_media_mov_kmh"] = _f((dist[mov].sum() / dt[mov].sum()) * 3.6) if dt[mov].sum() else None
        o["tiempo_mov_min"] = float(dt[mov].sum() / 60)
        hsr, spr = _num(cfg["umbral_hsr"], 18), _num(cfg["umbral_sprint"], 21)
        o["hsr_m"] = float(dist[np.nan_to_num(kmh) >= hsr].sum())
        o["sprint_m"] = float(dist[np.nan_to_num(kmh) >= spr].sum())
        ev = _eventos(np.nan_to_num(kmh) >= spr, t, _num(cfg["sprint_min_s"], 1), 1.0)
        o["n_sprints"] = len(ev)
        o["n_hsr"] = len(_eventos(np.nan_to_num(kmh) >= hsr, t, 1.0, 1.0))
        ua, ua2, dm = _num(cfg["umbral_acel"], 2), _num(cfg["umbral_acel_alta"], 3), _num(cfg["acel_min_s"], .5)
        acn = np.nan_to_num(ac)
        o["n_acel"] = len(_eventos(acn >= ua, t, dm))
        o["n_decel"] = len(_eventos(acn <= -ua, t, dm))
        o["n_acel_alta"] = len(_eventos(acn >= ua2, t, dm))
        o["n_decel_alta"] = len(_eventos(acn <= -ua2, t, dm))
        o["acel_max"] = _f(np.nanmax(ac)) if np.isfinite(ac).any() else None
        o["decel_max"] = _f(np.nanmin(ac)) if np.isfinite(ac).any() else None
        o["acel_min"] = (o["n_acel"] + o["n_decel"]) / dur_min
    if p.acc is not None:
        x = p.acc
        s = _sel(x, a, b)
        mod, dpl, t = x["mod"][s], x["dpl"][s], x["t"][s]
        o["player_load"] = float(dpl.sum())
        o["pl_min"] = o["player_load"] / dur_min
        o["acelt_media"] = _f(mod.mean()) if len(mod) else None
        o["acelt_p95"] = _f(np.percentile(mod, 95)) if len(mod) else None
        o["acelt_max"] = _f(mod.max()) if len(mod) else None
        for u in lista(cfg["umbrales_impacto"]):
            o[f"impactos_{u:g}g"] = len(_eventos(mod >= u, t, 0.0, 0.25))
    if p.hr is not None:
        h = p.hr
        s = _sel(h, a, b)
        hr, dt = h["hr"][s], h["dt"][s]
        if len(hr) > 5 and dt.sum() > 0:
            ref, fuente = _fcmax(p, cfg, fcmax)
            pct = 100 * hr / ref
            o.update(fc_media=float(np.average(hr, weights=dt)), fc_max=float(hr.max()), fc_min=float(hr.min()), fcmax_ref=ref,
                     fcmax_fuente=fuente, pct_fcmax_media=float(np.average(pct, weights=dt)))
            o["trimp"] = float(sum(dt[(pct >= lo) & (pct < hi)].sum() / 60 * w
                                   for lo, hi, w in ((50, 60, 1), (60, 70, 2), (70, 80, 3), (80, 90, 4), (90, 1e9, 5))))
            zf = lista(cfg["zonas_fc"])
            o["t_fc_alta_min"] = float(dt[pct >= (zf[-2] if len(zf) > 1 else 80)].sum() / 60)
            o["cobertura_fc_pct"] = float(100 * dt.sum() / max(b - a, 1e-9))
            rr = h.get("rr")
            if rr is not None:
                s2 = _sel(dict(t=h["t_rr"]), a, b)
                r_ = rr[s2]
                r_ = r_[np.isfinite(r_) & (r_ > 250) & (r_ < 2000)]
                if len(r_) > 20:
                    d = np.diff(r_)
                    d = d[np.abs(d) < 0.2 * r_[:-1]]
                    o["rmssd_ms"] = _f(np.sqrt(np.mean(d ** 2))) if len(d) > 10 else None
    if o.get("player_load") is not None and o.get("distancia_m"):
        o["pl_por_m"] = o["player_load"] / o["distancia_m"]
    return o


def _fcmax(p, cfg, fcmax):
    if fcmax:
        return float(fcmax), "jugador"
    if _num(cfg.get("fcmax_defecto")):
        return float(_num(cfg["fcmax_defecto"])), "ajustes"
    return float(np.max(p.hr["hr"])) if len(p.hr["hr"]) else 200.0, "máxima de la sesión"


# =========================================================================== análisis completo de una sesión
def analizar(p: Prep, cfg, recorte=None, fcmax=None, segmentos=()):
    """recorte: (desde_s, hasta_s) relativos al inicio. segmentos: [{nombre, desde, hasta}] relativos al inicio."""
    a, b = p.t0, p.t1
    if recorte:
        ra, rb = recorte
        a = p.t0 + max(0.0, _num(ra, 0) or 0)
        if _num(rb):
            b = min(p.t1, p.t0 + _num(rb))
    out = dict(resumen=resumen(p, a, b, cfg, fcmax), desde=a - p.t0, hasta=b - p.t0, total=p.t1 - p.t0, avisos=list(p.avisos),
               calidad=p.calidad, tablas={}, series={}, eventos={})
    r = out["resumen"]
    # --------------------------------------------- zonas de velocidad y aceleración
    if p.gps is not None:
        g = p.gps
        s = _sel(g, a, b)
        t, v, ac, dt = g["t"][s], g["v"][s], g["a"][s], g["dt"][s]
        dist = g["d_vel"][s] if cfg.get("fuente_distancia", "velocidad") == "velocidad" else g["d_dev"][s]
        kmh = np.nan_to_num(v * 3.6)
        zv = lista(cfg["zonas_velocidad"])
        idx = np.digitize(kmh, zv)
        et = _etq(zv, "km/h", primero=f"0–{zv[0]:g} km/h")
        D = max(dist.sum(), 1e-9)
        T = max(dt.sum(), 1e-9)
        out["tablas"]["velocidad"] = [dict(zona=e, distancia_m=float(dist[idx == i].sum()), pct_dist=100 * dist[idx == i].sum() / D,
                                           tiempo_min=float(dt[idx == i].sum() / 60), pct_tiempo=100 * dt[idx == i].sum() / T)
                                      for i, e in enumerate(et)]
        za = lista(cfg["zonas_aceleracion"])
        acn = np.nan_to_num(ac)
        idx = np.digitize(acn, za)
        et = _etq(za, "m/s²")
        out["tablas"]["aceleracion"] = [dict(zona=e, distancia_m=float(dist[idx == i].sum()), tiempo_min=float(dt[idx == i].sum() / 60),
                                             pct_tiempo=100 * dt[idx == i].sum() / T) for i, e in enumerate(et)]
        # eventos (para la línea de tiempo y la tabla)
        spr = _num(cfg["umbral_sprint"], 21)
        evs = []
        for i0, i1 in _eventos(kmh >= spr, t, _num(cfg["sprint_min_s"], 1), 1.0):
            evs.append(dict(tipo="Sprint", inicio_s=float(t[i0] - p.t0), duracion_s=float(t[i1] - t[i0]),
                            v_max_kmh=float(kmh[i0:i1 + 1].max()), distancia_m=float(dist[i0:i1 + 1].sum())))
        ua, dm = _num(cfg["umbral_acel"], 2), _num(cfg["acel_min_s"], .5)
        for nombre, m in (("Aceleración", acn >= ua), ("Deceleración", acn <= -ua)):
            for i0, i1 in _eventos(m, t, dm):
                evs.append(dict(tipo=nombre, inicio_s=float(t[i0] - p.t0), duracion_s=float(t[i1] - t[i0]),
                                pico=float(acn[i0:i1 + 1].max() if nombre == "Aceleración" else acn[i0:i1 + 1].min()),
                                v_ini_kmh=float(kmh[i0]), v_fin_kmh=float(kmh[i1])))
        out["eventos"] = sorted(evs, key=lambda e: e["inicio_s"])
    # --------------------------------------------- AcelT
    if p.acc is not None:
        x = p.acc
        s = _sel(x, a, b)
        mod, dt, t = x["mod"][s], x["dt"][s], x["t"][s]
        zt = lista(cfg["zonas_acelt"])
        idx = np.digitize(mod, zt)
        et = _etq(zt, "g", primero=f"< {zt[0]:g} g")
        dist_imu = None
        if p.gps is not None:
            g = p.gps
            vi = np.interp(t, g["t"], np.nan_to_num(g["v"]), left=0, right=0)
            dist_imu = vi * dt
        T = max(dt.sum(), 1e-9)
        out["tablas"]["acelt"] = [dict(zona=e, tiempo_min=float(dt[idx == i].sum() / 60), pct_tiempo=100 * dt[idx == i].sum() / T,
                                       distancia_m=float(dist_imu[idx == i].sum()) if dist_imu is not None else None)
                                  for i, e in enumerate(et)]
    # --------------------------------------------- FC
    if p.hr is not None and r.get("fcmax_ref"):
        h = p.hr
        s = _sel(h, a, b)
        hr, dt = h["hr"][s], h["dt"][s]
        pct = 100 * hr / r["fcmax_ref"]
        zf = lista(cfg["zonas_fc"])
        idx = np.digitize(pct, zf)
        et = _etq(zf, "% FCmáx", primero=f"< {zf[0]:g} % FCmáx")
        T = max(dt.sum(), 1e-9)
        out["tablas"]["fc"] = [dict(zona=e, tiempo_min=float(dt[idx == i].sum() / 60), pct_tiempo=100 * dt[idx == i].sum() / T)
                               for i, e in enumerate(et)]
    # --------------------------------------------- perfil por minuto, WCS y series para gráficos
    out["tablas"]["minutos"] = por_minuto(p, a, b, cfg)
    out["wcs"] = wcs(p, a, b, cfg)
    out["series"] = series(p, p.t0, p.t1, mapa=(a, b))       # series de toda la sesión (para recortar); mapa del tiempo analizado
    out["segmentos"] = []
    for sg in segmentos or []:
        sa, sb = p.t0 + (_num(sg.get("desde"), 0) or 0), p.t0 + (_num(sg.get("hasta"), 0) or 0)
        if sb > sa:
            out["segmentos"].append(dict(nombre=sg.get("nombre") or "Segmento", desde=sa - p.t0, hasta=sb - p.t0,
                                         **resumen(p, sa, sb, cfg, fcmax)))
    return out


def por_minuto(p, a, b, cfg):
    filas = []
    n = int(math.ceil((b - a) / 60))
    hsr = _num(cfg["umbral_hsr"], 18)
    ua = _num(cfg["umbral_acel"], 2)
    for k in range(n):
        x, y = a + 60 * k, min(b, a + 60 * (k + 1))
        f = dict(minuto=k + 1)
        if p.gps is not None:
            g = p.gps
            s = _sel(g, x, y)
            d = (g["d_vel"] if cfg.get("fuente_distancia", "velocidad") == "velocidad" else g["d_dev"])[s]
            kmh = np.nan_to_num(g["v"][s] * 3.6)
            f.update(distancia_m=float(d.sum()), hsr_m=float(d[kmh >= hsr].sum()), v_max_kmh=float(kmh.max()) if len(kmh) else None,
                     acel=len(_eventos(np.nan_to_num(g["a"][s]) >= ua, g["t"][s], _num(cfg["acel_min_s"], .5))),
                     decel=len(_eventos(np.nan_to_num(g["a"][s]) <= -ua, g["t"][s], _num(cfg["acel_min_s"], .5))))
        if p.acc is not None:
            s = _sel(p.acc, x, y)
            f["player_load"] = float(p.acc["dpl"][s].sum())
        if p.hr is not None:
            s = _sel(p.hr, x, y)
            hr = p.hr["hr"][s]
            f["fc_media"] = float(hr.mean()) if len(hr) else None
        filas.append(f)
    return filas


def wcs(p, a, b, cfg):
    """Escenario más exigente: máximo de cada variable en ventanas móviles de 1, 3 y 5 min (resolución 1 s)."""
    out = []
    if p.gps is None and p.acc is None:
        return out
    seg = np.arange(a, b, 1.0)
    if len(seg) < 60:
        return out
    hsr = _num(cfg["umbral_hsr"], 18)
    def por_seg(t, vals):
        i = np.clip(((t - a) // 1).astype(int), 0, len(seg) - 1)
        ok = (t >= a) & (t < b)
        return np.bincount(i[ok], weights=vals[ok], minlength=len(seg))
    dist = hsrm = pl = None
    if p.gps is not None:
        g = p.gps
        dd = g["d_vel"] if cfg.get("fuente_distancia", "velocidad") == "velocidad" else g["d_dev"]
        dist = por_seg(g["t"], dd)
        hsrm = por_seg(g["t"], np.where(np.nan_to_num(g["v"] * 3.6) >= hsr, dd, 0))
    if p.acc is not None:
        pl = por_seg(p.acc["t"], p.acc["dpl"])
    for w in lista(cfg["ventanas_wcs"]):
        k = int(w * 60)
        if k > len(seg):
            continue
        f = dict(ventana_min=w)
        for nombre, arr in (("distancia", dist), ("hsr", hsrm), ("player_load", pl)):
            if arr is None:
                continue
            c = np.convolve(arr, np.ones(k), "valid")
            i = int(np.argmax(c))
            f[f"{nombre}"] = float(c[i])
            f[f"{nombre}_min"] = float(c[i] / w)
            f[f"{nombre}_inicio_s"] = float(seg[i] - p.t0)
        out.append(f)
    return out


def series(p, a, b, paso=1.0, mapa=None):
    """Series a 1 Hz para gráficos: tiempo relativo (s), velocidad, aceleración, FC, AcelT, PL/s y trazado GPS."""
    tt = np.arange(a, b, paso)
    o = dict(t=(tt - p.t0).round(1).tolist())
    if p.gps is not None:
        g = p.gps
        ok = np.isfinite(g["v"])
        v = np.interp(tt, g["t"][ok], g["v"][ok] * 3.6) if ok.sum() > 2 else np.full(len(tt), np.nan)
        o["v"] = np.round(v, 2).tolist()
        oka = np.isfinite(g["a"])
        o["a"] = np.round(np.interp(tt, g["t"][oka], g["a"][oka]), 2).tolist() if oka.sum() > 2 else []
        ma, mb = mapa or (a, b)
        s = _sel(g, ma, mb)
        lat, lon, vv, tg = g["lat"][s], g["lon"][s], g["v"][s] * 3.6, g["t"][s]
        st = max(1, int(round(g["fs"] / 2)))                      # 2 puntos por segundo
        m = np.isfinite(lat) & np.isfinite(lon)
        idx = np.where(m)[0][::st]
        o["mapa"] = dict(lat=np.round(lat[idx], 7).tolist(), lon=np.round(lon[idx], 7).tolist(), v=np.round(np.nan_to_num(vv[idx]), 1).tolist(),
                         t=np.round(tg[idx] - p.t0, 1).tolist())
    if p.hr is not None and len(p.hr["t"]) > 2:
        h = p.hr
        hr = np.interp(tt, h["t"], h["hr"])
        # sin interpolar a través de huecos > 5 s
        j = np.searchsorted(h["t"], tt)
        j0, j1 = np.clip(j - 1, 0, len(h["t"]) - 1), np.clip(j, 0, len(h["t"]) - 1)
        hueco = (h["t"][j1] - h["t"][j0]) > 5
        hr[hueco | (tt < h["t"][0]) | (tt > h["t"][-1])] = np.nan
        o["fc"] = [None if not np.isfinite(x) else round(float(x), 1) for x in hr]
    if p.acc is not None:
        x = p.acc
        i = np.clip(((x["t"] - a) // paso).astype(int), 0, len(tt) - 1)
        ok = (x["t"] >= a) & (x["t"] < b)
        cnt = np.bincount(i[ok], minlength=len(tt))
        o["acelt"] = np.round(np.bincount(i[ok], weights=x["mod"][ok], minlength=len(tt)) / np.maximum(cnt, 1), 3).tolist()
        o["acelt_max"] = np.round(pd.Series(x["mod"][ok]).groupby(i[ok]).max().reindex(range(len(tt))).fillna(0).to_numpy(), 2).tolist()
        o["pl"] = np.round(np.bincount(i[ok], weights=x["dpl"][ok], minlength=len(tt)), 3).tolist()
    if v_ := o.get("v"):
        o["v"] = [None if (x is None or not math.isfinite(x)) else x for x in v_]
    return o


# =========================================================================== nombres legibles
VARIABLES = [  # clave, etiqueta, unidad, decimales, grupo
    ("duracion_min", "Duración", "min", 1, "General"),
    ("distancia_m", "Distancia total", "m", 0, "Carga externa · GPS"),
    ("m_min", "Distancia relativa", "m/min", 1, "Carga externa · GPS"),
    ("v_max_kmh", "Velocidad máxima", "km/h", 1, "Carga externa · GPS"),
    ("v_media_mov_kmh", "Velocidad media en movimiento", "km/h", 1, "Carga externa · GPS"),
    ("hsr_m", "Distancia a alta velocidad (HSR)", "m", 0, "Carga externa · GPS"),
    ("sprint_m", "Distancia en sprint", "m", 0, "Carga externa · GPS"),
    ("n_hsr", "Esfuerzos a alta velocidad", "n", 0, "Carga externa · GPS"),
    ("n_sprints", "Sprints", "n", 0, "Carga externa · GPS"),
    ("n_acel", "Aceleraciones", "n", 0, "Carga externa · GPS"),
    ("n_decel", "Deceleraciones", "n", 0, "Carga externa · GPS"),
    ("n_acel_alta", "Aceleraciones intensas", "n", 0, "Carga externa · GPS"),
    ("n_decel_alta", "Deceleraciones intensas", "n", 0, "Carga externa · GPS"),
    ("acel_min", "Acel. + decel. por minuto", "n/min", 2, "Carga externa · GPS"),
    ("acel_max", "Aceleración máxima", "m/s²", 2, "Carga externa · GPS"),
    ("decel_max", "Deceleración máxima", "m/s²", 2, "Carga externa · GPS"),
    ("player_load", "Player Load", "u.a.", 1, "Carga externa · acelerómetro"),
    ("pl_min", "Player Load por minuto", "u.a./min", 2, "Carga externa · acelerómetro"),
    ("pl_por_m", "Player Load por metro", "u.a./m", 3, "Carga externa · acelerómetro"),
    ("acelt_media", "AcelT media", "g", 2, "Carga externa · acelerómetro"),
    ("acelt_p95", "AcelT percentil 95", "g", 2, "Carga externa · acelerómetro"),
    ("acelt_max", "AcelT máxima", "g", 2, "Carga externa · acelerómetro"),
    ("impactos_3g", "Impactos > 3 g", "n", 0, "Carga externa · acelerómetro"),
    ("impactos_5g", "Impactos > 5 g", "n", 0, "Carga externa · acelerómetro"),
    ("impactos_8g", "Impactos > 8 g", "n", 0, "Carga externa · acelerómetro"),
    ("fc_media", "FC media", "lpm", 0, "Carga interna"),
    ("fc_max", "FC máxima", "lpm", 0, "Carga interna"),
    ("fc_min", "FC mínima", "lpm", 0, "Carga interna"),
    ("pct_fcmax_media", "FC media relativa", "% FCmáx", 1, "Carga interna"),
    ("t_fc_alta_min", "Tiempo en zonas altas de FC", "min", 1, "Carga interna"),
    ("trimp", "TRIMP de Edwards", "u.a.", 0, "Carga interna"),
    ("rmssd_ms", "RMSSD (R-R)", "ms", 1, "Carga interna"),
    ("distancia_vel_m", "Distancia (∫ velocidad)", "m", 0, "Control"),
    ("distancia_disp_m", "Distancia (canal DIST)", "m", 0, "Control"),
    ("cobertura_fc_pct", "Cobertura de la FC", "%", 0, "Control"),
]
VAR = {v[0]: v for v in VARIABLES}


def etiqueta(k):
    v = VAR.get(k)
    if v:
        return f"{v[1]} ({v[2]})" if v[2] and v[2] != "n" else v[1]
    if k.startswith("impactos_"):
        return f"Impactos > {k.split('_')[1]}"
    return k
