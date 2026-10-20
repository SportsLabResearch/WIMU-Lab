"""Figuras (matplotlib, PNG 200 ppp) para los informes Word/PDF."""
from __future__ import annotations

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, Normalize  # noqa: E402

AZUL, NAVY, NARANJA, VERDE, ROJO, GRIS = "#2a78d6", "#142B4C", "#eb6834", "#2e9e6b", "#d64545", "#8a94a6"
ZONAS = ["#9cc3ee", "#5598e7", "#2a78d6", "#f2b33d", "#eb6834", "#d64545", "#8e2b2b"]
CMAP_V = LinearSegmentedColormap.from_list("vel", ["#2a78d6", "#3fb6b2", "#f2c94c", "#eb6834", "#c0392b"])
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#5b6577", "axes.labelcolor": "#2b3443", "xtick.color": "#5b6577", "ytick.color": "#5b6577",
                     "axes.titleweight": "bold", "axes.titlesize": 10, "axes.grid": True, "grid.color": "#e6e9ef", "grid.linewidth": .6,
                     "legend.frameon": False, "figure.dpi": 100, "savefig.dpi": 200, "savefig.bbox": "tight"})


def _dec(x, d=0):
    return f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _save(fig, ruta):
    Path(ruta).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(ruta, facecolor="white")
    plt.close(fig)
    return str(ruta)


def _tiempo_fmt(ax, eje="x"):
    def f(v, _):
        v = int(round(v))
        return f"{v // 60}:{v % 60:02d}" if v < 3600 else f"{v // 3600}:{(v % 3600) // 60:02d}:{v % 60:02d}"
    from matplotlib.ticker import FuncFormatter
    (ax.xaxis if eje == "x" else ax.yaxis).set_major_formatter(FuncFormatter(f))


# --------------------------------------------------------------------------- sesión
def mapa(serie, ruta, titulo="Trayectoria GPS (color = velocidad)"):
    m = serie.get("mapa") or {}
    lat, lon, v = np.array(m.get("lat", []), float), np.array(m.get("lon", []), float), np.array(m.get("v", []), float)
    if len(lat) < 5:
        return None
    lat0, lon0 = np.nanmean(lat), np.nanmean(lon)
    x = (lon - lon0) * math.cos(math.radians(lat0)) * 111320
    y = (lat - lat0) * 110540
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    pts = np.column_stack([x, y]).reshape(-1, 1, 2)
    seg = np.concatenate([pts[:-1], pts[1:]], axis=1)
    paso = np.hypot(np.diff(x), np.diff(y))
    seg, vv = seg[paso < 30], v[1:][paso < 30]
    lc = LineCollection(seg, cmap=CMAP_V, norm=Normalize(0, max(24, np.nanpercentile(v, 99.5))), linewidths=1.3)
    lc.set_array(vv)
    ax.add_collection(lc)
    ax.plot(x[0], y[0], "o", color=VERDE, ms=7, label="Inicio", zorder=3)
    ax.plot(x[-1], y[-1], "s", color=NAVY, ms=6, label="Fin", zorder=3)
    ax.set_aspect("equal")
    ax.autoscale()
    ax.set_xlabel("Este–oeste (m)")
    ax.set_ylabel("Norte–sur (m)")
    ax.set_title(titulo, loc="left")
    cb = fig.colorbar(lc, ax=ax, shrink=.8, pad=.02)
    cb.set_label("km/h")
    ax.legend(loc="upper right", fontsize=8)
    return _save(fig, ruta)


def linea_tiempo(serie, eventos, ruta, umbral_sprint=21.0, ventana=None):
    t = np.array(serie.get("t", []), float)
    if not len(t):
        return None
    if ventana:
        m = (t >= ventana[0] - .5) & (t <= ventana[1] + .5)
        serie = {k: (list(np.array(v, dtype=object)[m]) if isinstance(v, list) and len(v) == len(t) else v) for k, v in serie.items()}
        t = t[m]
        eventos = [e for e in (eventos or []) if ventana[0] <= e["inicio_s"] <= ventana[1]]
    fig, ax = plt.subplots(figsize=(7.2, 3.0))
    if serie.get("v"):
        v = np.array([np.nan if x is None else x for x in serie["v"]], float)
        ax.fill_between(t, 0, v, color=AZUL, alpha=.18, lw=0)
        ax.plot(t, v, color=AZUL, lw=.8, label="Velocidad (km/h)")
        ax.axhline(umbral_sprint, color=NARANJA, lw=.7, ls="--")
        for e in eventos or []:
            if e["tipo"] == "Sprint":
                ax.plot(e["inicio_s"], e["v_max_kmh"], "v", color=NARANJA, ms=5)
        ax.set_ylabel("Velocidad (km/h)", color=AZUL)
        ax.set_ylim(0, max(26, np.nanmax(v) * 1.1) if np.isfinite(v).any() else 26)
    if serie.get("fc"):
        ax2 = ax.twinx()
        fc = np.array([np.nan if x is None else x for x in serie["fc"]], float)
        ax2.plot(t, fc, color=ROJO, lw=.9, label="FC (lpm)")
        ax2.set_ylabel("FC (lpm)", color=ROJO)
        ax2.grid(False)
        ax2.spines["right"].set_visible(True)
        if np.isfinite(fc).any():
            ax2.set_ylim(max(40, np.nanmin(fc) - 10), np.nanmax(fc) + 8)
    _tiempo_fmt(ax)
    ax.set_xlabel("Tiempo de sesión (min:s)")
    ax.set_title("Velocidad y frecuencia cardiaca a lo largo de la sesión", loc="left")
    return _save(fig, ruta)


def barras_zonas(filas, campo, ruta, titulo, unidad, colores=None):
    if not filas:
        return None
    et = [f["zona"] for f in filas]
    val = [f.get(campo) or 0 for f in filas]
    fig, ax = plt.subplots(figsize=(6.4, 2.3))
    cols = (colores or ZONAS)[: len(et)] if len(et) <= len(colores or ZONAS) else None
    b = ax.bar(range(len(et)), val, color=cols or AZUL, width=.7)
    for r, x in zip(b, val):
        ax.text(r.get_x() + r.get_width() / 2, r.get_height(), _dec(x, 1 if max(val) < 20 else 0), ha="center", va="bottom", fontsize=8)
    ax.set_xticks(range(len(et)), et, fontsize=8)
    ax.set_ylabel(unidad)
    ax.set_title(titulo, loc="left")
    ax.grid(axis="x", visible=False)
    return _save(fig, ruta)


def por_minuto(filas, ruta):
    if not filas:
        return None
    x = [f["minuto"] for f in filas]
    fig, ax = plt.subplots(figsize=(7.2, 2.8))
    if "distancia_m" in filas[0]:
        d = [f.get("distancia_m") or 0 for f in filas]
        h = [f.get("hsr_m") or 0 for f in filas]
        ax.bar(x, d, color="#9cc3ee", width=.85, label="Distancia (m/min)")
        ax.bar(x, h, color=NARANJA, width=.85, label="HSR (m/min)")
        ax.set_ylabel("m por minuto")
    if any(f.get("fc_media") for f in filas):
        ax2 = ax.twinx()
        ax2.plot(x, [f.get("fc_media") or np.nan for f in filas], color=ROJO, lw=1.2, marker="o", ms=2, label="FC media")
        ax2.set_ylabel("FC (lpm)", color=ROJO)
        ax2.grid(False)
        ax2.spines["right"].set_visible(True)
    ax.set_xlabel("Minuto")
    ax.legend(loc="upper left", fontsize=8, ncol=2)
    ax.set_title("Perfil minuto a minuto", loc="left")
    return _save(fig, ruta)


# --------------------------------------------------------------------------- colectivo / evolución
def barras_jugadores(nombres, valores, ruta, titulo, unidad, media=None):
    if not nombres:
        return None
    orden = np.argsort(valores)[::-1]
    nombres = [nombres[i] for i in orden]
    valores = [valores[i] for i in orden]
    fig, ax = plt.subplots(figsize=(6.8, max(2.2, .28 * len(nombres) + .8)))
    ax.barh(range(len(nombres)), valores, color=AZUL, height=.65)
    for i, v in enumerate(valores):
        ax.text(v, i, " " + _dec(v, 0 if abs(v) >= 100 else 1), va="center", fontsize=8)
    if media is not None:
        ax.axvline(media, color=NARANJA, lw=1, ls="--")
        ax.text(media, len(nombres) - .4, f" media {_dec(media, 0 if abs(media) >= 100 else 1)}", color=NARANJA, fontsize=8)
    ax.set_yticks(range(len(nombres)), nombres, fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel(unidad)
    ax.set_title(titulo, loc="left")
    ax.grid(axis="y", visible=False)
    return _save(fig, ruta)


def evolucion(fechas, valores, ruta, titulo, unidad):
    if len(fechas) < 2:
        return None
    fig, ax = plt.subplots(figsize=(6.8, 2.2))
    x = range(len(fechas))
    ax.plot(x, valores, color=AZUL, marker="o", ms=4, lw=1.4)
    m = np.nanmean(valores)
    sd = np.nanstd(valores, ddof=1) if len(valores) > 2 else 0
    ax.axhspan(m - sd, m + sd, color=AZUL, alpha=.08, lw=0)
    ax.axhline(m, color=GRIS, lw=.8, ls="--")
    ax.set_xticks(list(x), fechas, rotation=45, ha="right", fontsize=7)
    ax.set_ylabel(unidad)
    ax.set_title(titulo, loc="left")
    return _save(fig, ruta)


def puntos_grupos(grupos, ruta, titulo, unidad):
    """grupos: [(nombre, valores)] → puntos + media ± DE."""
    if not grupos:
        return None
    fig, ax = plt.subplots(figsize=(6.6, 2.4))
    rng = np.random.default_rng(7)
    for i, (g, vals) in enumerate(grupos):
        vals = np.array([v for v in vals if v is not None], float)
        if not len(vals):
            continue
        ax.scatter(i + rng.uniform(-.15, .15, len(vals)), vals, s=16, color=AZUL, alpha=.6, lw=0)
        m = vals.mean()
        sd = vals.std(ddof=1) if len(vals) > 1 else 0
        ax.errorbar(i + .3, m, yerr=sd, fmt="o", color=NARANJA, ms=5, capsize=3)
    ax.set_xticks(range(len(grupos)), [g for g, _ in grupos], fontsize=8)
    ax.set_ylabel(unidad)
    ax.set_title(titulo, loc="left")
    ax.grid(axis="x", visible=False)
    return _save(fig, ruta)


def bland_altman(r, ruta):
    pts = r.get("puntos") or []
    if len(pts) < 3 or r.get("sesgo") is None:
        return None
    a = np.array([p["ref"] for p in pts], float)
    b = np.array([p["nuevo"] for p in pts], float)
    m, d = (a + b) / 2, b - a
    fig, axs = plt.subplots(1, 2, figsize=(7.4, 2.9))
    ax = axs[0]
    ax.scatter(a, b, s=16, color=AZUL, alpha=.75, lw=0)
    lo, hi = min(a.min(), b.min()), max(a.max(), b.max())
    ax.plot([lo, hi], [lo, hi], color=GRIS, lw=.8, ls="--")
    ax.set_xlabel("SPRO")
    ax.set_ylabel("WIMU Lab")
    ax.set_title("Identidad", loc="left")
    ax = axs[1]
    ax.scatter(m, d, s=16, color=AZUL, alpha=.75, lw=0)
    for y, c, ls in ((r["sesgo"], NARANJA, "-"), (r["lim_inf"], ROJO, "--"), (r["lim_sup"], ROJO, "--")):
        ax.axhline(y, color=c, lw=1, ls=ls)
    ax.axhline(0, color=GRIS, lw=.6)
    ax.set_xlabel("Media de los dos métodos")
    ax.set_ylabel("WIMU Lab − SPRO")
    ax.set_title("Bland–Altman", loc="left")
    fig.suptitle(r["nombre"], x=.01, ha="left", fontweight="bold", fontsize=10)
    fig.tight_layout()
    return _save(fig, ruta)
