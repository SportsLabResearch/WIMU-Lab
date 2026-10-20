"""Estadística descriptiva e inferencial (implementación propia con NumPy/SciPy, sin dependencias adicionales).

Incluye: descriptivos con IC 95 %, normalidad (Shapiro–Wilk), comparaciones pareadas con tamaño del efecto
(g de Hedges promedio, r biserial de rangos) e IC bootstrap, correcciones por comparaciones múltiples (Holm,
Benjamini–Hochberg), modelo lineal mixto de intercepto aleatorio estimado por REML (con grados de libertad
«between-within», LRT del componente de varianza, ICC y R² de Nakagawa), ICC(1) con IC por F, comparación entre
grupos (ANOVA de Welch / Kruskal–Wallis con ω² / ε²), correlación de medidas repetidas (Bakdash y Marusich, 2017)
y análisis de concordancia de Bland–Altman.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd
from scipy import optimize, stats

warnings.filterwarnings("ignore", category=RuntimeWarning)


def _limpio(x):
    x = np.asarray(x, float)
    return x[np.isfinite(x)]


# =========================================================================== descriptivos
def describir(x, alfa=0.05) -> dict:
    x = _limpio(x)
    n = len(x)
    out = dict(n=n, media=np.nan, de=np.nan, ic_inf=np.nan, ic_sup=np.nan, mediana=np.nan, p25=np.nan, p75=np.nan,
               minimo=np.nan, maximo=np.nan, cv_pct=np.nan, asimetria=np.nan, curtosis=np.nan, sw_w=np.nan, sw_p=np.nan)
    if n == 0:
        return out
    m = float(x.mean())
    out.update(media=m, mediana=float(np.median(x)), p25=float(np.percentile(x, 25)), p75=float(np.percentile(x, 75)),
               minimo=float(x.min()), maximo=float(x.max()))
    if n > 1:
        de = float(x.std(ddof=1))
        h = stats.t.ppf(1 - alfa / 2, n - 1) * de / math.sqrt(n)
        out.update(de=de, ic_inf=m - h, ic_sup=m + h, cv_pct=100 * de / m if m else np.nan)
    if n > 2:
        out.update(asimetria=float(stats.skew(x, bias=False)))
    if n > 3:
        out.update(curtosis=float(stats.kurtosis(x, bias=False)))
    if 3 <= n <= 5000 and np.ptp(x) > 0:
        w, p = stats.shapiro(x)
        out.update(sw_w=float(w), sw_p=float(p))
    return out


# =========================================================================== correcciones
def ajustar_p(p, metodo="holm"):
    p = np.asarray(p, float)
    out = np.full_like(p, np.nan)
    ok = np.isfinite(p)
    q = p[ok]
    m = len(q)
    if m == 0 or metodo in (None, "ninguna"):
        out[ok] = q
        return out
    orden = np.argsort(q)
    if metodo == "holm":
        adj = np.maximum.accumulate((m - np.arange(m)) * q[orden])
    else:  # fdr_bh
        adj = (m / np.arange(1, m + 1)) * q[orden]
        adj = np.minimum.accumulate(adj[::-1])[::-1]
    res = np.empty(m)
    res[orden] = np.minimum(adj, 1)
    out[ok] = res
    return out


# =========================================================================== tamaños del efecto
def hedges_gav(a, b):
    """g de Hedges con DE promedio (Lakens, 2013) para medidas repetidas: (media b − media a) / DE_av · J."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    n = len(a)
    sav = math.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2) if n > 1 else np.nan
    if not sav or not np.isfinite(sav):
        return np.nan
    j = 1 - 3 / (4 * (n - 1) - 1) if n > 2 else 1.0
    return float((b.mean() - a.mean()) / sav * j)


def rank_biserial(d):
    d = np.asarray(d, float)
    d = d[d != 0]
    if not len(d):
        return 0.0
    r = stats.rankdata(np.abs(d))
    return float((r[d > 0].sum() - r[d < 0].sum()) / r.sum())


def magnitud_g(g):
    if g is None or not np.isfinite(g):
        return ""
    a = abs(g)
    return "trivial" if a < 0.2 else "pequeño" if a < 0.6 else "moderado" if a < 1.2 else "grande" if a < 2.0 else "muy grande"


def magnitud_r(r):
    if r is None or not np.isfinite(r):
        return ""
    a = abs(r)
    return "trivial" if a < 0.1 else "pequeña" if a < 0.3 else "moderada" if a < 0.5 else "grande" if a < 0.7 else "muy grande"


# =========================================================================== comparación pareada
def pareada(a, b, alfa=0.05, B=2000, semilla=2026) -> dict:
    """Compara b frente a a (p. ej. 2.ª parte frente a 1.ª) con pares completos."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = np.isfinite(a) & np.isfinite(b)
    a, b = a[ok], b[ok]
    n = len(a)
    out = dict(n=n, media_a=np.nan, de_a=np.nan, media_b=np.nan, de_b=np.nan, dif=np.nan, dif_ic_inf=np.nan, dif_ic_sup=np.nan,
               cambio_pct=np.nan, sw_p_dif=np.nan, prueba="", estadistico=np.nan, gl=np.nan, p=np.nan, te="", te_valor=np.nan,
               te_ic_inf=np.nan, te_ic_sup=np.nan, magnitud="")
    if n < 3:
        return out
    d = b - a
    out.update(media_a=a.mean(), de_a=a.std(ddof=1), media_b=b.mean(), de_b=b.std(ddof=1), dif=d.mean())
    h = stats.t.ppf(1 - alfa / 2, n - 1) * d.std(ddof=1) / math.sqrt(n)
    out.update(dif_ic_inf=d.mean() - h, dif_ic_sup=d.mean() + h,
               cambio_pct=100 * d.mean() / a.mean() if a.mean() else np.nan)
    normal = True
    if np.ptp(d) > 0:
        out["sw_p_dif"] = float(stats.shapiro(d)[1])
        normal = out["sw_p_dif"] > alfa
    rng = np.random.default_rng(semilla)
    idx = rng.integers(0, n, size=(B, n))
    if normal:
        t, p = stats.ttest_rel(b, a)
        g = hedges_gav(a, b)
        boot = np.array([hedges_gav(a[i], b[i]) for i in idx])
        out.update(prueba="t de Student pareada", estadistico=float(t), gl=n - 1, p=float(p), te="g de Hedges (av)", te_valor=g,
                   magnitud=magnitud_g(g))
    else:
        res = stats.wilcoxon(b, a, zero_method="wilcox")
        r = rank_biserial(d)
        boot = np.array([rank_biserial(d[i]) for i in idx])
        out.update(prueba="Wilcoxon de rangos con signo", estadistico=float(res.statistic), p=float(res.pvalue),
                   te="r biserial de rangos", te_valor=r, magnitud=magnitud_r(r))
    boot = boot[np.isfinite(boot)]
    if len(boot) > 50:
        out.update(te_ic_inf=float(np.percentile(boot, 100 * alfa / 2)), te_ic_sup=float(np.percentile(boot, 100 * (1 - alfa / 2))))
    return out


# =========================================================================== modelo mixto (intercepto aleatorio, REML)
def lmm(y, X, grupos, nombres=None, alfa=0.05, between=None) -> dict:
    """y = Xβ + u_g + e,  u ~ N(0, σu²), e ~ N(0, σe²). Estimación REML por perfil de λ = σu²/σe².

    between: lista de booleanos (uno por columna de X) que indica si la variable es constante dentro del grupo;
    se usa para los grados de libertad «between-within» (between: G − p_b; within: N − G − p_w).
    """
    y = np.asarray(y, float)
    X = np.asarray(X, float)
    if X.ndim == 1:
        X = X[:, None]
    g = pd.Series(grupos).astype(str).to_numpy()
    ok = np.isfinite(y) & np.isfinite(X).all(axis=1)
    y, X, g = y[ok], X[ok], g[ok]
    N, p = X.shape
    niveles, gi = np.unique(g, return_inverse=True)
    G = len(niveles)
    nombres = nombres or [f"x{i}" for i in range(p)]
    if N <= p + 1 or G < 2:
        return dict(error="datos insuficientes", n=N, grupos=G)
    idx = [np.where(gi == k)[0] for k in range(G)]

    def piezas(lam):
        XtVX = np.zeros((p, p))
        XtVy = np.zeros(p)
        logdet = 0.0
        for ii in idx:
            n = len(ii)
            c = lam / (1 + n * lam)
            Xi, yi = X[ii], y[ii]
            sx, sy = Xi.sum(0), yi.sum()
            XtVX += Xi.T @ Xi - c * np.outer(sx, sx)
            XtVy += Xi.T @ yi - c * sx * sy
            logdet += math.log1p(n * lam)
        return XtVX, XtVy, logdet

    def reml(lam):
        XtVX, XtVy, logdet = piezas(lam)
        try:
            beta = np.linalg.solve(XtVX, XtVy)
        except np.linalg.LinAlgError:
            return np.inf, None, None, None
        r = y - X @ beta
        rtVr = 0.0
        for ii in idx:
            n = len(ii)
            c = lam / (1 + n * lam)
            ri = r[ii]
            rtVr += ri @ ri - c * ri.sum() ** 2
        s2 = rtVr / (N - p)
        sign, ld = np.linalg.slogdet(XtVX)
        nll = 0.5 * ((N - p) * math.log(s2) + logdet + ld + (N - p))
        return nll, beta, s2, XtVX

    res = optimize.minimize_scalar(lambda z: reml(math.exp(z))[0], bounds=(-12, 8), method="bounded")
    lam = math.exp(res.x)
    nll1 = reml(lam)[0]
    nll0 = reml(0.0)[0]
    if nll0 <= nll1:
        lam = 0.0
    nll, beta, s2, XtVX = reml(lam)
    cov = s2 * np.linalg.inv(XtVX)
    se = np.sqrt(np.diag(cov))
    su2 = lam * s2
    # grados de libertad between-within
    if between is None:
        between = []
        for j in range(p):
            col = X[:, j]
            between.append(all(np.ptp(col[ii]) == 0 for ii in idx))
    p_b = sum(between)
    p_w = p - p_b
    gl = np.array([max(G - p_b, 1) if b else max(N - G - p_w, 1) for b in between], float)
    tval = beta / se
    pval = 2 * stats.t.sf(np.abs(tval), gl)
    q = stats.t.ppf(1 - alfa / 2, gl)
    fijos = pd.DataFrame(dict(termino=nombres, estimacion=beta, ee=se, gl=gl, t=tval, p=pval, ic_inf=beta - q * se, ic_sup=beta + q * se))
    lrt = max(0.0, 2 * (nll0 - nll))
    p_lrt = 0.5 * stats.chi2.sf(lrt, 1) if lrt > 0 else 1.0
    var_f = float(np.var(X @ beta, ddof=0))
    tot = var_f + su2 + s2
    return dict(fijos=fijos, sigma_u2=su2, sigma_e2=s2, icc=su2 / (su2 + s2) if su2 + s2 > 0 else np.nan,
                r2_marginal=var_f / tot if tot > 0 else np.nan, r2_condicional=(var_f + su2) / tot if tot > 0 else np.nan,
                lrt=lrt, p_lrt=p_lrt, logvero_reml=-nll, n=N, grupos=G)


def icc_anova(y, grupos, alfa=0.05) -> dict:
    """ICC(1) de un factor (Shrout y Fleiss, 1979) con tamaño de grupo efectivo k0 y IC por la distribución F."""
    d = pd.DataFrame(dict(y=y, g=grupos)).dropna()
    gr = d.groupby("g")["y"]
    k = gr.size()
    k = k[k > 0]
    a = len(k)
    N = int(k.sum())
    if a < 2 or N - a < 1:
        return dict(icc=np.nan, ic_inf=np.nan, ic_sup=np.nan, f=np.nan, p=np.nan)
    m = d["y"].mean()
    msb = float((k * (gr.mean() - m) ** 2).sum() / (a - 1))
    msw = float(((d["y"] - gr.transform("mean")) ** 2).sum() / (N - a))
    k0 = (N - (k ** 2).sum() / N) / (a - 1)
    icc = (msb - msw) / (msb + (k0 - 1) * msw) if msb + (k0 - 1) * msw > 0 else np.nan
    F = msb / msw if msw > 0 else np.nan
    p = float(stats.f.sf(F, a - 1, N - a)) if np.isfinite(F) else np.nan
    fl = F / stats.f.ppf(1 - alfa / 2, a - 1, N - a)
    fu = F * stats.f.ppf(1 - alfa / 2, N - a, a - 1)
    return dict(icc=icc, ic_inf=(fl - 1) / (fl + k0 - 1), ic_sup=(fu - 1) / (fu + k0 - 1), f=F, p=p, k0=k0)


# =========================================================================== entre grupos
def welch_anova(muestras):
    k = len(muestras)
    n = np.array([len(x) for x in muestras], float)
    m = np.array([np.mean(x) for x in muestras])
    v = np.array([np.var(x, ddof=1) for x in muestras])
    w = n / v
    mw = (w * m).sum() / w.sum()
    A = (w * (m - mw) ** 2).sum() / (k - 1)
    tmp = ((1 - w / w.sum()) ** 2 / (n - 1)).sum()
    Bv = 1 + 2 * (k - 2) / (k ** 2 - 1) * tmp
    F = A / Bv
    df2 = (k ** 2 - 1) / (3 * tmp)
    return float(F), k - 1, float(df2), float(stats.f.sf(F, k - 1, df2))


def entre_grupos(y, grupos, alfa=0.05) -> dict:
    d = pd.DataFrame(dict(y=y, g=grupos)).dropna()
    muestras = [x.to_numpy(float) for _, x in d.groupby("g")["y"] if len(x) >= 2]
    out = dict(k=len(muestras), n=int(sum(len(x) for x in muestras)), prueba="", estadistico=np.nan, gl1=np.nan, gl2=np.nan,
               p=np.nan, te="", te_valor=np.nan, levene_p=np.nan, normal=None)
    if len(muestras) < 2:
        return out
    N = out["n"]
    k = len(muestras)
    normal = all((len(x) < 3 or np.ptp(x) == 0 or stats.shapiro(x)[1] > alfa) for x in muestras)
    lev = stats.levene(*muestras, center="median")
    out.update(levene_p=float(lev.pvalue), normal=normal)
    if normal and all(np.var(x, ddof=1) > 0 for x in muestras):
        F, d1, d2, p = welch_anova(muestras)
        # ω² a partir del ANOVA clásico (Olejnik y Algina)
        Fc, _ = stats.f_oneway(*muestras)
        om = (k - 1) * (Fc - 1) / ((k - 1) * (Fc - 1) + N)
        out.update(prueba="ANOVA de Welch", estadistico=F, gl1=d1, gl2=d2, p=p, te="ω²", te_valor=max(om, 0.0))
    else:
        H, p = stats.kruskal(*muestras)
        eps = H / ((N ** 2 - 1) / (N + 1))
        out.update(prueba="Kruskal–Wallis", estadistico=float(H), gl1=k - 1, p=float(p), te="ε²", te_valor=float(eps))
    return out


# =========================================================================== correlaciones
def rmcorr(x, y, sujeto, alfa=0.05) -> dict:
    """Correlación de medidas repetidas (Bakdash y Marusich, 2017): ANCOVA con el sujeto como factor."""
    d = pd.DataFrame(dict(x=x, y=y, s=sujeto)).dropna()
    d = d.groupby("s").filter(lambda z: len(z) >= 2)
    N, k = len(d), d["s"].nunique()
    gl = N - k - 1
    if gl < 3:
        return dict(r=np.nan, gl=gl, p=np.nan, ic_inf=np.nan, ic_sup=np.nan, n=N, sujetos=k)
    xc = d["x"] - d.groupby("s")["x"].transform("mean")
    yc = d["y"] - d.groupby("s")["y"].transform("mean")
    sxx, syy, sxy = (xc ** 2).sum(), (yc ** 2).sum(), (xc * yc).sum()
    if sxx <= 0 or syy <= 0:
        return dict(r=np.nan, gl=gl, p=np.nan, ic_inf=np.nan, ic_sup=np.nan, n=N, sujetos=k)
    beta = sxy / sxx
    ss_mod = beta * sxy
    ss_res = syy - ss_mod
    r = float(np.sign(beta) * math.sqrt(ss_mod / (ss_mod + ss_res)))
    t = r * math.sqrt(gl / (1 - r ** 2)) if abs(r) < 1 else np.inf
    p = float(2 * stats.t.sf(abs(t), gl))
    z = np.arctanh(np.clip(r, -0.9999, 0.9999))
    h = stats.norm.ppf(1 - alfa / 2) / math.sqrt(gl - 1)
    return dict(r=r, gl=gl, p=p, ic_inf=float(np.tanh(z - h)), ic_sup=float(np.tanh(z + h)), n=N, sujetos=k, pendiente=float(beta))


def spearman(x, y) -> dict:
    d = pd.DataFrame(dict(x=x, y=y)).dropna()
    if len(d) < 4:
        return dict(rho=np.nan, p=np.nan, n=len(d))
    r, p = stats.spearmanr(d["x"], d["y"])
    return dict(rho=float(r), p=float(p), n=len(d))


# =========================================================================== concordancia
def bland_altman(a, b, alfa=0.05) -> dict:
    """Concordancia entre dos medidas del mismo constructo (b − a). IC de los límites según Bland y Altman (1999)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = np.isfinite(a) & np.isfinite(b)
    a, b = a[ok], b[ok]
    n = len(a)
    if n < 3:
        return dict(n=n)
    d = b - a
    m = (a + b) / 2
    sesgo, de = d.mean(), d.std(ddof=1)
    z = stats.norm.ppf(1 - alfa / 2)
    tq = stats.t.ppf(1 - alfa / 2, n - 1)
    lim_inf, lim_sup = sesgo - z * de, sesgo + z * de
    se_lim = math.sqrt(3 * de ** 2 / n)
    reg = stats.linregress(m, d)
    return dict(n=n, sesgo=sesgo, de=de, sesgo_ic_inf=sesgo - tq * de / math.sqrt(n), sesgo_ic_sup=sesgo + tq * de / math.sqrt(n),
                lim_inf=lim_inf, lim_sup=lim_sup, lim_inf_ic=(lim_inf - tq * se_lim, lim_inf + tq * se_lim),
                lim_sup_ic=(lim_sup - tq * se_lim, lim_sup + tq * se_lim), sesgo_pct=100 * sesgo / a.mean(),
                prop_pendiente=reg.slope, prop_p=reg.pvalue,
                ccc=float(2 * np.cov(a, b)[0, 1] / (a.var(ddof=1) + b.var(ddof=1) + (a.mean() - b.mean()) ** 2)))


def fmt_p(p):
    if p is None or not np.isfinite(p):
        return "—"
    return "<\u00a00,001" if p < 0.001 else f"{p:.3f}".replace(".", ",")


# =========================================================================== fiabilidad entre dos métodos
def icc_dos_vias(a, b, alfa=0.05) -> dict:
    """ICC de dos vías con medidas únicas (McGraw y Wong, 1996): ICC(A,1) acuerdo absoluto e ICC(C,1) consistencia,
    con sus intervalos de confianza."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = np.isfinite(a) & np.isfinite(b)
    Y = np.column_stack([a[ok], b[ok]])
    n, k = Y.shape
    if n < 3:
        return dict(n=n, icc_a=np.nan, icc_c=np.nan)
    gm = Y.mean()
    ssr = k * ((Y.mean(axis=1) - gm) ** 2).sum()
    ssc = n * ((Y.mean(axis=0) - gm) ** 2).sum()
    sst = ((Y - gm) ** 2).sum()
    sse = sst - ssr - ssc
    msr, msc, mse = ssr / (n - 1), ssc / (k - 1), sse / ((n - 1) * (k - 1))
    icc_c = (msr - mse) / (msr + (k - 1) * mse) if msr + (k - 1) * mse > 0 else np.nan
    den = msr + (k - 1) * mse + k * (msc - mse) / n
    icc_a = (msr - mse) / den if den > 0 else np.nan
    out = dict(n=n, icc_a=float(icc_a), icc_c=float(icc_c))
    # IC de ICC(C,1)
    if mse > 0:
        F = msr / mse
        fl = F / stats.f.ppf(1 - alfa / 2, n - 1, (n - 1) * (k - 1))
        fu = F * stats.f.ppf(1 - alfa / 2, (n - 1) * (k - 1), n - 1)
        out.update(icc_c_inf=float((fl - 1) / (fl + k - 1)), icc_c_sup=float((fu - 1) / (fu + k - 1)))
        # IC de ICC(A,1) (McGraw y Wong, 1996, aproximación de Satterthwaite)
        aa = k * icc_a / (n * (1 - icc_a)) if icc_a < 1 else np.nan
        bb = 1 + k * icc_a * (n - 1) / (n * (1 - icc_a)) if icc_a < 1 else np.nan
        if np.isfinite(aa) and np.isfinite(bb):
            v = (aa * msc + bb * mse) ** 2 / ((aa * msc) ** 2 / (k - 1) + (bb * mse) ** 2 / ((n - 1) * (k - 1)))
            fs = stats.f.ppf(1 - alfa / 2, n - 1, v)
            fi = stats.f.ppf(1 - alfa / 2, v, n - 1)
            lo = n * (msr - fs * mse) / (fs * (k * msc + (k * n - k - n) * mse) + n * msr)
            hi = n * (fi * msr - mse) / (k * msc + (k * n - k - n) * mse + n * fi * msr)
            out.update(icc_a_inf=float(lo), icc_a_sup=float(hi))
    return out


def magnitud_icc(x):
    """Koo y Li (2016)."""
    if x is None or not np.isfinite(x):
        return ""
    return "pobre" if x < 0.5 else "moderada" if x < 0.75 else "buena" if x < 0.9 else "excelente"
