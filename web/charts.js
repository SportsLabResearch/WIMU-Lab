/* BiblioMetrics — gráficos SVG interactivos sin dependencias */
"use strict";
const Charts = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ink2 = () => css("--ink-2") || "#52514e";
  const grid = () => css("--line-2") || "#e1e0d9";
  let DEC = ",";
  const fmt = (v, d = 0) => v === null || v === undefined || Number.isNaN(v) ? "—"
    : Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(",", DEC === "," ? "," : ".");
  function nice(max, n = 5) {
    if (!max || max <= 0) return [0, 1];
    const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const top = Math.ceil(max / step) * step;
    const t = [];
    for (let v = 0; v <= top + 1e-9; v += step) t.push(+v.toFixed(10));
    return t;
  }
  const tip = (html) => `data-tip="${esc(html)}"`;

  /* ---------------- barras horizontales (ranking) */
  function hbar(items, o = {}) {
    const W = o.width || 640, rowH = o.rowH || 24, lw = o.labelWidth || 210, pad = 56;
    const H = items.length * rowH + 26;
    const max = o.max ?? Math.max(...items.map((i) => i.value || 0), 1);
    const ticks = nice(max, 4), top = ticks[ticks.length - 1];
    const x = (v) => lw + ((W - lw - pad) * (v || 0)) / top;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
    ticks.forEach((t) => (s += `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 20}" stroke="${grid()}"/><text x="${x(t)}" y="${H - 5}" class="ax" text-anchor="middle">${fmt(t, o.dec || 0)}</text>`));
    items.forEach((it, i) => {
      const y = i * rowH + 3, h = rowH - 8;
      const mc = Math.floor((lw - (it.rank !== undefined ? 34 : 10)) / 6.6);
      const lab = it.label.length > mc ? it.label.slice(0, mc - 1) + "…" : it.label;
      s += `<g class="hb ${it.id ? "clk" : ""}" ${it.id ? `data-id="${it.id}"` : ""} ${tip(`<b>${esc(it.label)}</b>${it.sub ? `<br>${esc(it.sub)}` : ""}<br>${esc(o.name || "Valor")}: <b>${fmt(it.value, o.dec || 0)}</b>`)}>
        <rect x="0" y="${y - 3}" width="${W}" height="${rowH}" fill="transparent"/>
        ${it.rank !== undefined ? `<text x="4" y="${y + h / 2 + 4}" class="rk">${it.rank ?? ""}</text>` : ""}
        <text x="${lw - 8}" y="${y + h / 2 + 4}" text-anchor="end" class="lb">${esc(lab)}</text>
        <rect x="${lw}" y="${y}" width="${Math.max(2, x(it.value) - lw)}" height="${h}" rx="3" fill="${it.color || "#2a78d6"}"/>
        <text x="${x(it.value) + 6}" y="${y + h / 2 + 4}" class="vl">${fmt(it.value, o.dec || 0)}</text></g>`;
    });
    return s + "</svg>";
  }

  /* ---------------- columnas por año (apiladas o simples) */
  function columns(labels, sets, o = {}) {
    const W = o.width || 720, H = o.height || 260, L = 46, B = 26, T = 12, R = 10;
    const n = labels.length;
    const tot = labels.map((_, i) => sets.reduce((a, s) => a + (s.values[i] || 0), 0));
    const ticks = nice(Math.max(...tot, 1)), top = ticks[ticks.length - 1];
    const bw = (W - L - R) / n, y = (v) => T + (H - T - B) * (1 - v / top);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
    ticks.forEach((t) => (s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${grid()}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${fmt(t)}</text>`));
    const every = Math.ceil(n / 14);
    labels.forEach((lab, i) => {
      let acc = 0;
      const x0 = L + i * bw + Math.min(2, bw * 0.12), w = Math.max(1, bw - Math.min(4, bw * 0.24));
      const parts = sets.map((st) => `${esc(st.name)}: <b>${fmt(st.values[i])}</b>`).join("<br>");
      s += `<g ${tip(`<b>${esc(lab)}</b><br>${parts}${sets.length > 1 ? `<br>Total: <b>${fmt(tot[i])}</b>` : ""}`)}><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>`;
      sets.forEach((st, k) => {
        const v = st.values[i] || 0;
        if (!v) return;
        const yt = y(acc + v), yb = y(acc);
        s += `<rect x="${x0}" y="${yt}" width="${w}" height="${Math.max(0.5, yb - yt - (k < sets.length - 1 ? 1 : 0))}" fill="${st.color}" rx="${k === sets.length - 1 ? 2 : 0}"/>`;
        acc += v;
      });
      s += "</g>";
      if (i % every === 0) s += `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" class="ax">${esc(lab)}</text>`;
    });
    return s + "</svg>" + legend(sets);
  }

  /* ---------------- líneas */
  function lines(labels, sets, o = {}) {
    const W = o.width || 720, H = o.height || 260, L = 50, B = 26, T = 14, R = 14;
    const n = labels.length;
    const max = Math.max(...sets.flatMap((s) => s.values.filter((v) => v !== null)), 1);
    const ticks = nice(max), top = ticks[ticks.length - 1];
    const x = (i) => L + (n === 1 ? (W - L - R) / 2 : ((W - L - R) * i) / (n - 1)), y = (v) => T + (H - T - B) * (1 - v / top);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
    ticks.forEach((t) => (s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${grid()}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${fmt(t, o.dec || 0)}</text>`));
    const every = Math.ceil(n / 14);
    labels.forEach((lab, i) => { if (i % every === 0) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(lab)}</text>`; });
    sets.forEach((st) => {
      const pts = st.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
      let d = "", pen = false;
      pts.forEach((p) => { if (!p) { pen = false; return; } d += (pen ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); pen = true; });
      if (o.area && sets.length === 1) s += `<path d="${d}L${x(n - 1)} ${y(0)}L${x(0)} ${y(0)}Z" fill="${st.color}" opacity=".12"/>`;
      s += `<path d="${d}" fill="none" stroke="${st.color}" stroke-width="2" stroke-linejoin="round"/>`;
    });
    labels.forEach((lab, i) => {
      const parts = sets.map((st) => `${esc(st.name)}: <b>${fmt(st.values[i], o.dec || 0)}</b>`).join("<br>");
      s += `<g ${tip(`<b>${esc(lab)}</b><br>${parts}`)}><rect x="${x(i) - (W - L - R) / n / 2}" y="${T}" width="${(W - L - R) / n}" height="${H - T - B}" fill="transparent"/>
        ${sets.map((st) => (st.values[i] === null || st.values[i] === undefined ? "" : `<circle cx="${x(i)}" cy="${y(st.values[i])}" r="${n > 30 ? 0 : 3}" fill="${st.color}" stroke="var(--surface)" stroke-width="1.5"/>`)).join("")}</g>`;
    });
    return s + "</svg>" + (sets.length > 1 ? legend(sets) : "");
  }

  /* ---------------- dispersión */
  function scatter(pts, o = {}) {
    const W = o.width || 720, H = o.height || 340, L = 66, B = 40, T = 12, R = 16;
    const logx = o.logx, logy = o.logy;
    const tx = (v) => (logx ? Math.log10((v || 0) + 1) : v || 0), ty = (v) => (logy ? Math.log10((v || 0) + 1) : v || 0);
    const xm = Math.max(...pts.map((p) => tx(p.x)), 1), ym = Math.max(...pts.map((p) => ty(p.y)), 1);
    const xt = nice(xm, 5), yt = nice(ym, 5);
    const X = (v) => L + ((W - L - R) * tx(v)) / xt[xt.length - 1], Y = (v) => T + (H - T - B) * (1 - ty(v) / yt[yt.length - 1]);
    const lab = (v, log) => (log ? fmt(Math.round(10 ** v - 1)) : fmt(v, Math.abs(v) < 10 && v % 1 ? 1 : 0));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
    yt.forEach((t) => (s += `<line x1="${L}" x2="${W - R}" y1="${T + (H - T - B) * (1 - t / yt[yt.length - 1])}" y2="${T + (H - T - B) * (1 - t / yt[yt.length - 1])}" stroke="${grid()}"/><text x="${L - 6}" y="${T + (H - T - B) * (1 - t / yt[yt.length - 1]) + 4}" text-anchor="end" class="ax">${lab(t, logy)}</text>`));
    xt.forEach((t) => (s += `<line y1="${T}" y2="${H - B}" x1="${L + ((W - L - R) * t) / xt[xt.length - 1]}" x2="${L + ((W - L - R) * t) / xt[xt.length - 1]}" stroke="${grid()}"/><text y="${H - B + 16}" x="${L + ((W - L - R) * t) / xt[xt.length - 1]}" text-anchor="middle" class="ax">${lab(t, logx)}</text>`));
    s += `<text x="${(W + L) / 2}" y="${H - 4}" text-anchor="middle" class="axt">${esc(o.xlabel || "")}</text>
      <text transform="translate(12 ${(H - B + T) / 2}) rotate(-90)" text-anchor="middle" class="axt">${esc(o.ylabel || "")}</text>`;
    const rmax = Math.max(...pts.map((p) => p.r || 1), 1);
    [...pts].sort((a, b) => (b.r || 1) - (a.r || 1)).forEach((p) => {
      const r = o.size ? 4 + 18 * Math.sqrt((p.r || 0) / rmax) : 5.5;
      s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${r}" fill="${p.color || "#2a78d6"}" fill-opacity="${o.size ? 0.55 : 0.8}" stroke="var(--surface)" stroke-width="1.5" class="${p.id ? "clk" : ""}" ${p.id ? `data-id="${p.id}"` : ""} ${tip(`<b>${esc(p.label)}</b>${p.sub ? `<br>${esc(p.sub)}` : ""}<br>${esc(o.xlabel)}: <b>${fmt(p.x)}</b><br>${esc(o.ylabel)}: <b>${fmt(p.y)}</b>${o.rlabel ? `<br>${esc(o.rlabel)}: <b>${fmt(p.r)}</b>` : ""}`)}/>`;
      if (p.tag) s += `<text x="${X(p.x)}" y="${Y(p.y) - r - 4}" text-anchor="middle" class="lb sm">${esc(p.tag)}</text>`;
    });
    return s + "</svg>";
  }

  /* ---------------- distribución por grupos (caja + puntos) */
  function strip(groups, o = {}) {
    const W = o.width || 720, rowH = 46, lw = o.labelWidth || 190, R = 20;
    const H = groups.length * rowH + 30;
    const max = Math.max(...groups.flatMap((g) => g.values.map((v) => v.v)), 1);
    const ticks = nice(max, 5), top = ticks[ticks.length - 1];
    const x = (v) => lw + ((W - lw - R) * v) / top;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">`;
    ticks.forEach((t) => (s += `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 22}" stroke="${grid()}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle" class="ax">${fmt(t)}</text>`));
    groups.forEach((g, i) => {
      const vs = g.values.map((v) => v.v).sort((a, b) => a - b);
      const cy = i * rowH + rowH / 2;
      const q = (p) => { if (!vs.length) return 0; const k = (vs.length - 1) * p, f = Math.floor(k); return vs[f] + (vs[Math.min(f + 1, vs.length - 1)] - vs[f]) * (k - f); };
      s += `<text x="${lw - 10}" y="${cy + 4}" text-anchor="end" class="lb">${esc(g.name.length > 30 ? g.name.slice(0, 29) + "…" : g.name)}</text>`;
      if (vs.length >= 3) s += `<rect x="${x(q(0.25))}" y="${cy - 11}" width="${Math.max(1, x(q(0.75)) - x(q(0.25)))}" height="22" fill="${g.color}" opacity=".14" rx="3"/>
          <line x1="${x(q(0.5))}" x2="${x(q(0.5))}" y1="${cy - 13}" y2="${cy + 13}" stroke="${g.color}" stroke-width="2.5"/>`;
      let seed = 7 * (i + 1);
      g.values.forEach((v) => {
        seed = (seed * 9301 + 49297) % 233280;
        const jy = ((seed / 233280) - 0.5) * 18;
        s += `<circle cx="${x(v.v)}" cy="${cy + jy}" r="4.2" fill="${g.color}" fill-opacity=".8" stroke="var(--surface)" stroke-width="1" class="${v.id ? "clk" : ""}" ${v.id ? `data-id="${v.id}"` : ""} ${tip(`<b>${esc(v.label)}</b><br>${esc(g.name)}<br>${esc(o.name || "Valor")}: <b>${fmt(v.v)}</b>`)}/>`;
      });
    });
    return s + "</svg>";
  }

  function spark(vals, color = "#2a78d6", w = 90, h = 22) {
    if (!vals || !vals.length) return "";
    const m = Math.max(...vals, 1), bw = w / vals.length;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="spark">${vals.map((v, i) => `<rect x="${i * bw + 0.5}" y="${h - (h - 2) * (v / m)}" width="${bw - 1.5}" height="${Math.max(0.5, (h - 2) * (v / m))}" fill="${color}" opacity="${i >= vals.length - 5 ? 1 : 0.45}" rx="1"/>`).join("")}</svg>`;
  }

  function legend(sets) {
    if (sets.length < 2) return "";
    return `<div class="legend">${sets.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
  }

  /* ---------------- red de colaboración (fuerzas) */
  function network(el, nodes, edges, o = {}) {
    const W = el.clientWidth || 900, H = o.height || 620;
    const byId = new Map(nodes.map((n, i) => [n.id, i]));
    const N = nodes.length;
    const maxP = Math.max(...nodes.map((n) => n.pubs), 1), maxW = Math.max(...edges.map((e) => e.w), 1);
    const P = nodes.map((n, i) => ({ x: W / 2 + Math.cos(i * 2.4) * (60 + 3 * i), y: H / 2 + Math.sin(i * 2.4) * (60 + 3 * i), vx: 0, vy: 0, r: 5 + 16 * Math.sqrt(n.pubs / maxP) }));
    const E = edges.map((e) => ({ a: byId.get(e.a), b: byId.get(e.b), w: e.w })).filter((e) => e.a !== undefined && e.b !== undefined);
    const k = Math.sqrt((W * H) / Math.max(N, 1)) * 0.95;
    for (let it = 0; it < 420; it++) {
      const t = 1 - it / 420;
      for (let i = 0; i < N; i++) { P[i].vx = 0; P[i].vy = 0; }
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y; const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        const f = (k * k) / d; dx /= d; dy /= d;
        P[i].vx += dx * f; P[i].vy += dy * f; P[j].vx -= dx * f; P[j].vy -= dy * f;
      }
      E.forEach((e) => {
        const A = P[e.a], B = P[e.b]; let dx = A.x - B.x, dy = A.y - B.y; const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = ((d * d) / k) * (0.15 + 0.35 * Math.log1p(e.w) / Math.log1p(maxW + 1e-9)) * (N > 25 ? 25 / N + 0.3 : 1); dx /= d; dy /= d;
        A.vx -= dx * f; A.vy -= dy * f; B.vx += dx * f; B.vy += dy * f;
      });
      for (let i = 0; i < N; i++) {
        const p = P[i];
        p.vx += (W / 2 - p.x) * 0.4; p.vy += (H / 2 - p.y) * 0.65;
        const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy) + 0.01, lim = 18 * t + 0.5;
        p.x += (p.vx / v) * Math.min(v, lim); p.y += (p.vy / v) * Math.min(v, lim);
        p.x = Math.max(p.r + 4, Math.min(W - p.r - 4, p.x)); p.y = Math.max(p.r + 4, Math.min(H - p.r - 4, p.y));
      }
    }
    const draw = () => {
      let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="chart net">`;
      E.forEach((e, i) => (s += `<line data-e="${i}" data-a="${e.a}" data-b="${e.b}" x1="${P[e.a].x}" y1="${P[e.a].y}" x2="${P[e.b].x}" y2="${P[e.b].y}" stroke="${ink2()}" stroke-opacity="${0.08 + 0.45 * (e.w / maxW)}" stroke-width="${0.6 + 4 * (e.w / maxW)}"/>`));
      nodes.forEach((n, i) => {
        s += `<g class="nd" data-i="${i}" data-id="${n.id}" ${tip(`<b>${esc(n.nombre)}</b><br>${esc(n.facultad)}<br>Publicaciones: <b>${n.pubs}</b><br>Coautores internos: <b>${n.grado}</b><br>Publicaciones con coautoría interna: <b>${n.internas}</b>`)}>
          <circle cx="${P[i].x}" cy="${P[i].y}" r="${P[i].r}" fill="${n.color}" stroke="var(--surface)" stroke-width="2"/>
          ${P[i].r > (N > 30 ? 13 : 9) || o.labels ? `<text x="${P[i].x}" y="${P[i].y + P[i].r + 11}" text-anchor="middle" class="lb sm">${esc(n.nombre.split(" ").slice(0, 2).join(" "))}</text>` : ""}</g>`;
      });
      el.innerHTML = s + "</svg>";
      const svg = el.querySelector("svg");
      svg.querySelectorAll(".nd").forEach((g) => {
        g.addEventListener("mouseenter", () => {
          const i = +g.dataset.i;
          svg.classList.add("focus");
          svg.querySelectorAll("line").forEach((l) => l.classList.toggle("hl", +l.dataset.a === i || +l.dataset.b === i));
          const nb = new Set([i]);
          E.forEach((e) => { if (e.a === i) nb.add(e.b); if (e.b === i) nb.add(e.a); });
          svg.querySelectorAll(".nd").forEach((x) => x.classList.toggle("hl", nb.has(+x.dataset.i)));
        });
        g.addEventListener("mouseleave", () => svg.classList.remove("focus"));
        g.addEventListener("click", () => o.onClick && o.onClick(+g.dataset.id));
      });
    };
    draw();
  }

  return { hbar, columns, lines, scatter, strip, spark, network, fmt, setDec: (d) => (DEC = d) };
})();

/* tooltip global */
(() => {
  const t = document.createElement("div");
  t.id = "tip";
  document.addEventListener("DOMContentLoaded", () => document.body.append(t));
  document.addEventListener("mousemove", (e) => {
    const g = e.target.closest && e.target.closest("[data-tip]");
    if (!g) { t.style.opacity = 0; return; }
    t.innerHTML = g.getAttribute("data-tip");
    t.style.opacity = 1;
    const r = t.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    t.style.transform = `translate(${x}px,${y}px)`;
  });
})();
