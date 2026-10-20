"""Análisis estadístico de las sesiones registradas (descriptivo, comparativo, inferencial y correlacional).

Unidad de análisis: la sesión. Como un mismo jugador aporta varias sesiones (medidas repetidas), las comparaciones
ofrecen tres diseños:
  · «grupos»   – niveles independientes (p. ej. posiciones): se promedia cada jugador dentro de cada nivel y se
                 comparan los promedios (ANOVA de Welch o Kruskal–Wallis; parejas con t de Welch / U de Mann–Whitney,
                 g de Hedges y corrección de Holm).
  · «pareado»  – dos niveles medidos en los mismos jugadores (p. ej. entrenamiento vs partido): promedio por jugador
                 en cada nivel y prueba pareada (t o Wilcoxon según Shapiro de las diferencias), g de Hedges (av) con
                 IC bootstrap.
  · «mixto»    – todas las sesiones con modelo lineal mixto (intercepto aleatorio por jugador, REML): efecto de cada
                 nivel frente al de referencia, ICC, R² marginal y condicional.
Varias variables a la vez → p ajustada por Holm.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from . import estadistica as E
from . import metricas as M


def _f(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _vars(df, variables):
    return [v for v in variables if v in df.columns and pd.to_numeric(df[v], errors="coerce").notna().any()]


def nombre(v):
    return M.etiqueta(v)


# =========================================================================== descriptivo
def descriptivo(df: pd.DataFrame, variables, agrupar=None, alfa=0.05):
    filas, puntos = [], {}
    variables = _vars(df, variables)
    grupos = [("Todas las sesiones", df)] if not agrupar or agrupar not in df.columns else \
        [(str(k) or "(vacío)", g) for k, g in df.groupby(agrupar, sort=True)]
    for v in variables:
        puntos[v] = []
        for gname, g in grupos:
            x = pd.to_numeric(g[v], errors="coerce").to_numpy(float)
            d = E.describir(x, alfa)
            filas.append(dict(variable=v, nombre=nombre(v), grupo=gname, jugadores=int(g["jugador_id"].nunique()), **{k: _f(val) for k, val in d.items()}))
            puntos[v].append(dict(grupo=gname, valores=[_f(a) for a in x if np.isfinite(a)],
                                  etiquetas=[f"{r.jugador} · {r.fecha}" for r, a in zip(g.itertuples(), x) if np.isfinite(a)]))
    return dict(filas=filas, puntos=puntos, n_sesiones=len(df), n_jugadores=int(df["jugador_id"].nunique()) if len(df) else 0)


# =========================================================================== comparaciones
def _por_jugador(df, v, factor):
    d = df[["jugador_id", "jugador", factor, v]].copy()
    d[v] = pd.to_numeric(d[v], errors="coerce")
    return d.dropna().groupby(["jugador_id", "jugador", factor], as_index=False)[v].mean()


def _hedges(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return None
    sp = math.sqrt(((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2))
    if sp == 0:
        return None
    j = 1 - 3 / (4 * (na + nb) - 9)
    return float((b.mean() - a.mean()) / sp * j)


def comparar(df: pd.DataFrame, variables, factor, diseno="grupos", niveles=None, alfa=0.05, nivel_analisis="jugador"):
    variables = _vars(df, variables)
    if factor not in df.columns:
        raise ValueError("Factor no válido")
    d0 = df[df[factor].astype(str).str.len() > 0]
    if niveles:
        d0 = d0[d0[factor].astype(str).isin([str(x) for x in niveles])]
    lv = sorted(d0[factor].astype(str).unique().tolist())
    if len(lv) < 2:
        raise ValueError(f"El factor «{factor}» necesita al menos dos niveles con datos (hay {len(lv)}).")
    res = []
    for v in variables:
        r = dict(variable=v, nombre=nombre(v), diseno=diseno)
        try:
            if diseno == "pareado":
                if len(lv) != 2:
                    raise ValueError("el diseño pareado necesita exactamente dos niveles: elíjalos")
                pj = _por_jugador(d0, v, factor)
                w = pj.pivot_table(index="jugador_id", columns=factor, values=v)
                w = w.dropna()
                a, b = w[lv[0]].to_numpy(float), w[lv[1]].to_numpy(float)
                o = E.pareada(a, b, alfa)
                r.update(n=o["n"], a=lv[0], b=lv[1], media_a=_f(o["media_a"]), de_a=_f(o["de_a"]), media_b=_f(o["media_b"]), de_b=_f(o["de_b"]),
                         dif=_f(o["dif"]), dif_ic=[_f(o["dif_ic_inf"]), _f(o["dif_ic_sup"])], cambio_pct=_f(o["cambio_pct"]),
                         prueba=o["prueba"], estadistico=_f(o["estadistico"]), p=_f(o["p"]), te=o["te"], te_valor=_f(o["te_valor"]),
                         te_ic=[_f(o["te_ic_inf"]), _f(o["te_ic_sup"])], magnitud=o["magnitud"],
                         pares=[dict(jugador=pj[pj.jugador_id == j].jugador.iloc[0], a=_f(x), b=_f(y)) for j, x, y in zip(w.index, a, b)])
            elif diseno == "mixto":
                d = d0[["jugador_id", factor, v]].copy()
                d[v] = pd.to_numeric(d[v], errors="coerce")
                d = d.dropna()
                ref = lv[0]
                X = np.column_stack([np.ones(len(d))] + [(d[factor].astype(str) == l).to_numpy(float) for l in lv[1:]])
                o = E.lmm(d[v].to_numpy(float), X, d["jugador_id"].to_numpy(), ["(Intercepto) " + ref] + [f"{l} vs {ref}" for l in lv[1:]], alfa)
                if o.get("error"):
                    raise ValueError(o["error"])
                fij = o["fijos"]
                medias = d.groupby(factor)[v].agg(["mean", "std", "count"]).reset_index()
                r.update(n=int(o["n"]), jugadores=int(o["grupos"]), referencia=ref, icc=_f(o["icc"]), r2m=_f(o["r2_marginal"]),
                         r2c=_f(o["r2_condicional"]), p_lrt=_f(o["p_lrt"]), sigma_u=_f(math.sqrt(o["sigma_u2"])), sigma_e=_f(math.sqrt(o["sigma_e2"])),
                         efectos=[dict(termino=t, estimacion=_f(e), ee=_f(s), gl=_f(g), t=_f(tv), p=_f(p), ic=[_f(li), _f(ls)],
                                       d=_f(e / math.sqrt(o["sigma_u2"] + o["sigma_e2"])) if k > 0 and (o["sigma_u2"] + o["sigma_e2"]) > 0 else None)
                                  for k, (t, e, s, g, tv, p, li, ls) in enumerate(fij[["termino", "estimacion", "ee", "gl", "t", "p", "ic_inf", "ic_sup"]].itertuples(index=False))],
                         medias=[dict(nivel=str(m[factor]), media=_f(m["mean"]), de=_f(m["std"]), n=int(m["count"])) for _, m in medias.iterrows()],
                         prueba="Modelo lineal mixto (REML)")
                ps = [e["p"] for e in r["efectos"][1:] if e["p"] is not None]
                r["p"] = min(ps) * len(ps) if ps else None          # contraste global aproximado (Bonferroni del mínimo)
                r["p"] = min(r["p"], 1.0) if r["p"] is not None else None
            else:
                pj = _por_jugador(d0, v, factor) if nivel_analisis == "jugador" else d0.assign(**{v: pd.to_numeric(d0[v], errors="coerce")}).dropna(subset=[v])
                o = E.entre_grupos(pj[v].to_numpy(float), pj[factor].astype(str).to_numpy(), alfa)
                medias = pj.groupby(factor)[v].agg(["mean", "std", "count"]).reset_index()
                pares = []
                for i in range(len(lv)):
                    for j in range(i + 1, len(lv)):
                        a = pj[pj[factor].astype(str) == lv[i]][v].to_numpy(float)
                        b = pj[pj[factor].astype(str) == lv[j]][v].to_numpy(float)
                        if len(a) < 2 or len(b) < 2:
                            continue
                        if o.get("normal"):
                            t, p = stats.ttest_ind(b, a, equal_var=False)
                            pr = "t de Welch"
                        else:
                            t, p = stats.mannwhitneyu(b, a, alternative="two-sided")
                            pr = "U de Mann–Whitney"
                        pares.append(dict(a=lv[i], b=lv[j], dif=_f(b.mean() - a.mean()), prueba=pr, p=_f(p), g=_f(_hedges(a, b)),
                                          magnitud=E.magnitud_g(_hedges(a, b)) if _hedges(a, b) is not None else ""))
                adj = E.ajustar_p([x["p"] if x["p"] is not None else np.nan for x in pares])
                for x, pa in zip(pares, adj):
                    x["p_holm"] = _f(pa)
                r.update(n=int(o["n"]), k=int(o["k"]), prueba=o["prueba"], estadistico=_f(o["estadistico"]), gl1=_f(o["gl1"]), gl2=_f(o["gl2"]),
                         p=_f(o["p"]), te=o["te"], te_valor=_f(o["te_valor"]), levene_p=_f(o["levene_p"]), normal=o["normal"],
                         unidad=("jugador (media de sus sesiones)" if nivel_analisis == "jugador" else "sesión"),
                         medias=[dict(nivel=str(m[factor]), media=_f(m["mean"]), de=_f(m["std"]), n=int(m["count"])) for _, m in medias.iterrows()],
                         pares=pares, puntos=[dict(grupo=l, valores=[_f(x) for x in pj[pj[factor].astype(str) == l][v]]) for l in lv])
        except Exception as e:  # noqa: BLE001
            r["error"] = str(e)
        res.append(r)
    adj = E.ajustar_p([r.get("p") if r.get("p") is not None else np.nan for r in res])
    for r, pa in zip(res, adj):
        r["p_holm"] = _f(pa)
        r["p_txt"] = E.fmt_p(r.get("p") if r.get("p") is not None else np.nan)
        r["p_holm_txt"] = E.fmt_p(r["p_holm"] if r["p_holm"] is not None else np.nan)
    return dict(resultados=res, niveles=lv, factor=factor, diseno=diseno, alfa=alfa)


# =========================================================================== correlación
def correlacion(df: pd.DataFrame, x, y, alfa=0.05):
    d = df[["jugador_id", "jugador", "fecha", x, y]].copy()
    d[x] = pd.to_numeric(d[x], errors="coerce")
    d[y] = pd.to_numeric(d[y], errors="coerce")
    d = d.dropna()
    sp = E.spearman(d[x], d[y])
    pe = stats.pearsonr(d[x], d[y]) if len(d) >= 4 else None
    rm = E.rmcorr(d[x], d[y], d["jugador_id"], alfa)
    return dict(x=x, y=y, nx=nombre(x), ny=nombre(y), n=len(d), jugadores=int(d["jugador_id"].nunique()),
                spearman=dict(rho=_f(sp["rho"]), p=_f(sp["p"]), magnitud=E.magnitud_r(sp["rho"]) if _f(sp["rho"]) is not None else ""),
                pearson=dict(r=_f(pe[0]), p=_f(pe[1])) if pe else None,
                rmcorr={k: _f(v) for k, v in rm.items()} | {"magnitud": E.magnitud_r(rm["r"]) if _f(rm.get("r")) is not None else ""},
                puntos=[dict(x=_f(a), y=_f(b), jugador=j, etiqueta=f"{j} · {f}") for a, b, j, f in zip(d[x], d[y], d["jugador"], d["fecha"])])


def matriz(df: pd.DataFrame, variables):
    variables = _vars(df, variables)
    m = []
    for a in variables:
        fila = []
        for b in variables:
            s = E.spearman(pd.to_numeric(df[a], errors="coerce"), pd.to_numeric(df[b], errors="coerce"))
            fila.append(dict(rho=_f(s["rho"]), p=_f(s["p"]), n=s["n"]))
        m.append(fila)
    return dict(variables=variables, nombres=[nombre(v) for v in variables], m=m)


# =========================================================================== fiabilidad entre sesiones (ICC por jugador)
def variabilidad(df: pd.DataFrame, variables, alfa=0.05):
    out = []
    for v in _vars(df, variables):
        d = df[["jugador_id", v]].copy()
        d[v] = pd.to_numeric(d[v], errors="coerce")
        d = d.dropna()
        icc = E.icc_anova(d[v], d["jugador_id"], alfa)
        cv_int = d.groupby("jugador_id")[v].agg(lambda z: 100 * z.std(ddof=1) / z.mean() if len(z) > 1 and z.mean() else np.nan)
        out.append(dict(variable=v, nombre=nombre(v), n=len(d), jugadores=int(d["jugador_id"].nunique()), icc=_f(icc["icc"]),
                        icc_ic=[_f(icc["ic_inf"]), _f(icc["ic_sup"])], cv_intra=_f(np.nanmean(cv_int)) if len(cv_int) else None,
                        magnitud=E.magnitud_icc(icc["icc"])))
    return out
