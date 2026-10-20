/* WIMU Lab — análisis estadístico, concordancia con SPRO, informes y ajustes */
"use strict";
const PAL = ["#2a78d6", "#eb6834", "#2e9e6b", "#8e5bd6", "#d64545", "#c98500", "#3fb6b2", "#142B4C", "#e377c2", "#7f7f7f"];
const VARS_DEF = ["distancia_m", "m_min", "v_max_kmh", "hsr_m", "n_sprints", "n_acel", "n_decel", "player_load", "fc_media", "trimp"];
const FACTORES = [["tipo", "Tipo de sesión"], ["tarea", "Tarea / etiqueta"], ["posicion", "Posición"], ["grupo", "Grupo / equipo"], ["jugador", "Jugador"], ["fecha", "Fecha"]];
const fp = (p) => p === null || p === undefined ? "—" : p < 0.001 ? "< 0,001" : fnum(p, 3);
const sig = (p) => p !== null && p !== undefined && p < (parseNum(S.st.cfg.alfa) || 0.05);

/* ---------------------------------------------------------------------- filtro común */
function filtroHtml(f, o = {}) {
  const tipos = S.tipos || S.st.tipos;
  const tareas = [...new Set((S.ses || []).map((s) => s.tarea).filter(Boolean))].sort();
  return `<div class="filters">
    ${o.ids ? `<div class="field"><label>Sesiones</label><label class="switch"><input type="checkbox" id="fl-ids" ${f.usarIds ? "checked" : ""}><i></i>Solo las ${o.ids.length} seleccionadas</label></div>` : ""}
    <div class="field"><label>Periodo</label><select id="fl-periodo">
      <option value="sesion" ${(!f.periodo || f.periodo === "sesion") ? "selected" : ""}>Sesión completa (original)</option>
      <option value="primero" ${f.periodo === "primero" ? "selected" : ""}>Primer tiempo</option>
      <option value="segundo" ${f.periodo === "segundo" ? "selected" : ""}>Segundo tiempo</option>
      <option value="partido" ${f.periodo === "partido" ? "selected" : ""}>Partido sin descanso</option>
      <option value="selecciones" ${f.periodo === "selecciones" ? "selected" : ""}>Todas las partes guardadas (sin descansos)</option>
      <option value="nombre" ${f.periodo === "nombre" ? "selected" : ""}>Intervalo por nombre</option>
    </select></div>
    <div class="field"><label>Nombre del intervalo (opcional)</label><input id="fl-nombre-periodo" value="${esc(f.nombre_periodo || "")}" placeholder="Ejercicio 1, rondo…"></div>
    <div class="field"><label>Desde</label><input type="date" id="fl-desde" value="${f.desde || ""}"></div>
    <div class="field"><label>Hasta</label><input type="date" id="fl-hasta" value="${f.hasta || ""}"></div>
    <div class="field"><label>Tipos</label><div class="chipsel">${tipos.map((t) => `<label class="chipopt ${(f.tipos || []).includes(t) ? "on" : ""}"><input type="checkbox" data-ft="${esc(t)}" ${(f.tipos || []).includes(t) ? "checked" : ""}>${esc(t)}</label>`).join("")}</div></div>
    ${tareas.length ? `<div class="field"><label>Tarea</label><select id="fl-tarea"><option value="">Todas</option>${tareas.map((t) => `<option ${f.tareas?.[0] === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>` : ""}
    <div class="field wide"><label>Jugadores <span class="muted">(ninguno = todos)</span></label><div class="chipsel">${(S.jug || []).map((j) => `<label class="chipopt ${(f.jugadores || []).includes(j.id) ? "on" : ""}"><input type="checkbox" data-fj="${j.id}" ${(f.jugadores || []).includes(j.id) ? "checked" : ""}>${esc(j.nombre)}</label>`).join("")}</div></div>
  </div>`;
}
function leeFiltro(root, f, ids) {
  f.periodo = $("#fl-periodo", root)?.value || "sesion";
  f.nombre_periodo = $("#fl-nombre-periodo", root)?.value?.trim() || "";
  f.desde = $("#fl-desde", root)?.value || ""; f.hasta = $("#fl-hasta", root)?.value || "";
  f.tipos = $$("[data-ft]:checked", root).map((x) => x.dataset.ft);
  f.jugadores = $$("[data-fj]:checked", root).map((x) => x.dataset.fj);
  f.tareas = $("#fl-tarea", root)?.value ? [$("#fl-tarea", root).value] : [];
  f.usarIds = !!$("#fl-ids", root)?.checked;
  const out = { desde: f.desde || undefined, hasta: f.hasta || undefined, tipos: f.tipos.length ? f.tipos : undefined, jugadores: f.jugadores.length ? f.jugadores : undefined, tareas: f.tareas.length ? f.tareas : undefined };
  out.periodo = f.periodo;
  if (f.nombre_periodo) out.nombre_periodo = f.nombre_periodo;
  if (f.usarIds && ids) out.ids = ids;
  return out;
}
const wireChips = (root, cb) => $$(".chipopt input", root).forEach((c) => (c.onchange = () => { c.parentElement.classList.toggle("on", c.checked); cb && cb(); }));
const varChecks = (sel, name = "vv") => `<div class="chipsel">${VARS().filter((x) => x.grupo !== "Control" && x.clave !== "duracion_min").map((x) => `<label class="chipopt ${sel.includes(x.clave) ? "on" : ""}"><input type="checkbox" data-${name}="${x.clave}" ${sel.includes(x.clave) ? "checked" : ""}>${esc(x.nombre)}</label>`).join("")}</div>`;
const varSelect = (id, sel) => `<select id="${id}">${VARS().filter((x) => x.clave !== "duracion_min").map((x) => `<option value="${x.clave}" ${x.clave === sel ? "selected" : ""}>${esc(x.nombre)}${x.unidad && x.unidad !== "n" ? ` (${esc(x.unidad)})` : ""}</option>`).join("")}</select>`;

/* ---------------------------------------------------------------------- ANÁLISIS */
V.analisis = async (v, o = {}) => {
  loading(v);
  await cargarSesiones();
  const sub = o.sub || store.get("an.sub", "descriptivo");
  store.set("an.sub", sub);
  if (o.ids) S.anIds = o.ids;
  const f = S.anF = S.anF || { usarIds: !!o.ids };
  if (o.ids) f.usarIds = true;
  const cfgA = S.anC = S.anC || { vars: VARS_DEF.slice(), agrupar: "tipo", factor: "tipo", diseno: "grupos", nivel: "jugador", x: "player_load", y: "distancia_m" };
  v.innerHTML = head("Análisis", "Unidad: la sesión (las excluidas no cuentan). Como cada jugador aporta varias sesiones, las comparaciones se hacen con la media de cada jugador o con modelos mixtos.") + `
  <div class="card mb"><div class="card-head">${seg("sub", [["descriptivo", "Descriptivo"], ["comparar", "Comparaciones e inferencia"], ["correlacion", "Correlación y variabilidad"]], sub)}</div>
    <div class="card-body">${filtroHtml(f, { ids: S.anIds })}
      <div class="field mt"><label>Variables</label>${varChecks(cfgA.vars)}</div>
      <div class="row mt" id="an-opts"></div></div></div>
  <div id="an-res"></div>`;
  wireSeg($(".card-head", v), (_, s) => go("analisis", { sub: s }));
  wireChips(v);
  const opts = $("#an-opts");
  const factorSel = (id, sel) => `<select id="${id}">${FACTORES.map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  if (sub === "descriptivo") opts.innerHTML = `<div class="field"><label>Agrupar por</label><select id="an-agr"><option value="">Sin agrupar</option>${FACTORES.map(([k, l]) => `<option value="${k}" ${k === cfgA.agrupar ? "selected" : ""}>${l}</option>`).join("")}</select></div><button class="btn primary" id="an-go">${I.stats}Calcular</button>`;
  if (sub === "comparar") opts.innerHTML = `<div class="field"><label>Factor</label>${factorSel("an-fac", cfgA.factor)}</div>
    <div class="field"><label>Diseño</label><select id="an-dis"><option value="grupos" ${cfgA.diseno === "grupos" ? "selected" : ""}>Niveles independientes (ANOVA de Welch / Kruskal–Wallis)</option><option value="pareado" ${cfgA.diseno === "pareado" ? "selected" : ""}>Dos condiciones en los mismos jugadores (pareado)</option><option value="mixto" ${cfgA.diseno === "mixto" ? "selected" : ""}>Todas las sesiones: modelo lineal mixto</option></select></div>
    <div class="field" id="an-nivw"><label>Unidad</label><select id="an-niv"><option value="jugador" ${cfgA.nivel === "jugador" ? "selected" : ""}>Media de cada jugador (recomendado)</option><option value="sesion" ${cfgA.nivel === "sesion" ? "selected" : ""}>Cada sesión</option></select></div>
    <div class="field"><label>Niveles <span class="muted">(vacío = todos)</span></label><input type="text" id="an-lv" placeholder="p. ej. Entrenamiento; Partido" value="${esc(cfgA.niveles || "")}"></div>
    <button class="btn primary" id="an-go">${I.compare}Comparar</button>`;
  if (sub === "correlacion") opts.innerHTML = `<div class="field"><label>Variable X</label>${varSelect("an-x", cfgA.x)}</div><div class="field"><label>Variable Y</label>${varSelect("an-y", cfgA.y)}</div><button class="btn primary" id="an-go">${I.scatter}Calcular</button>`;
  const res = $("#an-res");
  const run = async () => {
    cfgA.vars = $$("[data-vv]:checked", v).map((x) => x.dataset.vv);
    if (!cfgA.vars.length) return toast("Elija al menos una variable", true);
    const filtro = leeFiltro(v, f, S.anIds);
    loading(res, "Calculando…");
    try {
      if (sub === "descriptivo") {
        cfgA.agrupar = $("#an-agr").value;
        const d = await api("/api/analisis/descriptivo", { filtro, variables: cfgA.vars, agrupar: cfgA.agrupar });
        pintaDescriptivo(res, d, cfgA);
      } else if (sub === "comparar") {
        cfgA.factor = $("#an-fac").value; cfgA.diseno = $("#an-dis").value; cfgA.nivel = $("#an-niv").value; cfgA.niveles = $("#an-lv").value;
        const niveles = cfgA.niveles.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
        const d = await api("/api/analisis/comparar", { filtro, variables: cfgA.vars, factor: cfgA.factor, diseno: cfgA.diseno, nivel: cfgA.nivel, niveles: niveles.length ? niveles : null });
        pintaComparacion(res, d);
      } else {
        cfgA.x = $("#an-x").value; cfgA.y = $("#an-y").value;
        const d = await api("/api/analisis/correlacion", { filtro, x: cfgA.x, y: cfgA.y, variables: cfgA.vars });
        pintaCorrelacion(res, d);
      }
    } catch (e) { res.innerHTML = `<div class="card">${empty(I.alert, "No se pudo calcular", `<p>${esc(e.message)}</p>`)}</div>`; }
  };
  $("#an-go").onclick = run;
  if ($("#an-dis")) { const t = () => ($("#an-nivw").hidden = $("#an-dis").value !== "grupos"); $("#an-dis").onchange = t; t(); }
  run();
};
function pintaDescriptivo(el, d, c) {
  const cols = ["Variable", "Grupo", "n", "Jugadores", "Media", "DE", "IC 95 %", "Mediana", "P25–P75", "Mín.–máx.", "CV %", "Shapiro p"];
  const rows = d.filas.map((x) => [x.nombre, x.grupo, x.n, x.jugadores, x.media, x.de, `${fnum(x.ic_inf, 1)}; ${fnum(x.ic_sup, 1)}`, x.mediana, `${fnum(x.p25, 1)}–${fnum(x.p75, 1)}`, `${fnum(x.minimo, 1)}–${fnum(x.maximo, 1)}`, x.cv_pct, x.sw_p]);
  const dec = (k) => VAR(k).dec;
  el.innerHTML = `<div class="card mb"><div class="card-head"><h3>${I.stats}Estadísticos descriptivos · ${d.n_sesiones} sesiones, ${d.n_jugadores} jugadores</h3><div class="tools">${tableTools("desc")}</div></div>
    <div class="tablewrap"><table class="data"><thead><tr>${cols.map((h, i) => `<th class="${i > 1 ? "n" : ""}">${h}</th>`).join("")}</tr></thead><tbody>
    ${d.filas.map((x, i) => `<tr class="${i && d.filas[i - 1].variable !== x.variable ? "sep" : ""}"><td>${i && d.filas[i - 1].variable === x.variable ? "" : `<b>${esc(x.nombre)}</b>`}</td><td>${esc(x.grupo)}</td><td class="n">${x.n}</td><td class="n">${x.jugadores}</td>
      <td class="n"><b>${fnum(x.media, dec(x.variable))}</b></td><td class="n">${fnum(x.de, dec(x.variable))}</td><td class="n">${fnum(x.ic_inf, dec(x.variable))}; ${fnum(x.ic_sup, dec(x.variable))}</td><td class="n">${fnum(x.mediana, dec(x.variable))}</td>
      <td class="n">${fnum(x.p25, dec(x.variable))}–${fnum(x.p75, dec(x.variable))}</td><td class="n">${fnum(x.minimo, dec(x.variable))}–${fnum(x.maximo, dec(x.variable))}</td><td class="n">${fnum(x.cv_pct, 1)}</td>
      <td class="n ${x.sw_p !== null && x.sw_p < 0.05 ? "warn" : ""}" title="${x.sw_p !== null && x.sw_p < 0.05 ? "Distribución no normal (p < 0,05)" : ""}">${fp(x.sw_p)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card-body muted small">IC 95 %: intervalo de confianza de la media (t de Student). CV: coeficiente de variación. Shapiro p &lt; 0,05 indica distribución no normal (use mediana y P25–P75).</div></div>
    <div class="grid-2" id="ds-ch"></div>`;
  wireTableTools(el, { desc: { cols, rows } });
  const box = $("#ds-ch", el);
  Object.entries(d.puntos).forEach(([k, gs]) => {
    const c2 = document.createElement("div");
    c2.className = "card";
    c2.innerHTML = `<div class="card-head"><h3>${esc(vlabel(k))}</h3></div><div class="card-body"></div>`;
    box.append(c2);
    const b = $(".card-body", c2);
    b.innerHTML = Charts.strip(gs.map((g, i) => ({ name: g.grupo, color: PAL[i % PAL.length], values: g.valores.map((x, j) => ({ v: x, label: g.etiquetas[j] })) })), { width: width(b), name: VAR(k).nombre, labelWidth: 150 });
  });
}
function pintaComparacion(el, d) {
  const R = d.resultados, dis = d.diseno;
  let tabla = "", cols, rows;
  if (dis === "pareado") {
    cols = ["Variable", "n", d.niveles[0], d.niveles[1], "Diferencia", "IC 95 %", "Cambio %", "Prueba", "p", "p Holm", "Efecto", "IC 95 % efecto", "Magnitud"];
    rows = R.map((r) => [r.nombre, r.n, `${fnum(r.media_a, 1)} ± ${fnum(r.de_a, 1)}`, `${fnum(r.media_b, 1)} ± ${fnum(r.de_b, 1)}`, r.dif, `${fnum(r.dif_ic?.[0], 1)}; ${fnum(r.dif_ic?.[1], 1)}`, r.cambio_pct, r.prueba || r.error, r.p, r.p_holm, `${r.te || ""} ${fnum(r.te_valor, 2)}`, `${fnum(r.te_ic?.[0], 2)}; ${fnum(r.te_ic?.[1], 2)}`, r.magnitud]);
    tabla = `<table class="data"><thead><tr><th>Variable</th><th class="n">n</th><th class="n">${esc(d.niveles[0])}</th><th class="n">${esc(d.niveles[1])}</th><th class="n">Diferencia [IC 95 %]</th><th class="n">Cambio</th><th>Prueba</th><th class="n">p</th><th class="n">p Holm</th><th>Tamaño del efecto [IC 95 %]</th></tr></thead><tbody>
      ${R.map((r) => r.error ? `<tr><td><b>${esc(r.nombre)}</b></td><td colspan="9" class="muted">${esc(r.error)}</td></tr>` : `<tr><td><b>${esc(r.nombre)}</b></td><td class="n">${r.n}</td><td class="n">${fnum(r.media_a, 1)} ± ${fnum(r.de_a, 1)}</td><td class="n">${fnum(r.media_b, 1)} ± ${fnum(r.de_b, 1)}</td>
        <td class="n">${fnum(r.dif, 1)} [${fnum(r.dif_ic?.[0], 1)}; ${fnum(r.dif_ic?.[1], 1)}]</td><td class="n">${fnum(r.cambio_pct, 1)} %</td><td class="small">${esc(r.prueba)}</td>
        <td class="n">${sig(r.p) ? `<span class="badge sig">${fp(r.p)}</span>` : fp(r.p)}</td><td class="n">${sig(r.p_holm) ? `<span class="badge sig">${fp(r.p_holm)}</span>` : fp(r.p_holm)}</td>
        <td class="small">${esc(r.te)} = <b>${fnum(r.te_valor, 2)}</b> [${fnum(r.te_ic?.[0], 2)}; ${fnum(r.te_ic?.[1], 2)}] · ${esc(r.magnitud)}</td></tr>`).join("")}</tbody></table>`;
  } else if (dis === "mixto") {
    cols = ["Variable", "Efecto", "Estimación", "EE", "gl", "IC 95 %", "p", "d", "ICC", "R² marginal", "R² condicional"];
    rows = R.flatMap((r) => (r.efectos || []).slice(1).map((e) => [r.nombre, e.termino, e.estimacion, e.ee, e.gl, `${fnum(e.ic[0], 2)}; ${fnum(e.ic[1], 2)}`, e.p, e.d, r.icc, r.r2m, r.r2c]));
    tabla = `<table class="data"><thead><tr><th>Variable</th><th>Medias por nivel</th><th>Efecto</th><th class="n">Estimación [IC 95 %]</th><th class="n">p</th><th class="n">d</th><th class="n">ICC</th><th class="n">R² marg. / cond.</th></tr></thead><tbody>
      ${R.map((r) => r.error ? `<tr><td><b>${esc(r.nombre)}</b></td><td colspan="7" class="muted">${esc(r.error)}</td></tr>` : (r.efectos || []).slice(1).map((e, i) => `<tr><td>${i ? "" : `<b>${esc(r.nombre)}</b><br><span class="muted small">${r.n} sesiones · ${r.jugadores} jugadores</span>`}</td>
        <td class="small">${i ? "" : (r.medias || []).map((m) => `${esc(m.nivel)}: ${fnum(m.media, 1)} ± ${fnum(m.de, 1)} (${m.n})`).join("<br>")}</td><td>${esc(e.termino)}</td>
        <td class="n">${fnum(e.estimacion, 2)} [${fnum(e.ic[0], 2)}; ${fnum(e.ic[1], 2)}]</td><td class="n">${sig(e.p) ? `<span class="badge sig">${fp(e.p)}</span>` : fp(e.p)}</td><td class="n">${fnum(e.d, 2)}</td>
        <td class="n">${i ? "" : fnum(r.icc, 2)}</td><td class="n">${i ? "" : `${fnum(r.r2m, 2)} / ${fnum(r.r2c, 2)}`}</td></tr>`).join("")).join("")}</tbody></table>`;
  } else {
    cols = ["Variable", "Niveles", "Prueba", "Estadístico", "gl", "p", "p Holm", "Tamaño del efecto", "Levene p"];
    rows = R.map((r) => [r.nombre, (r.medias || []).map((m) => `${m.nivel}: ${fnum(m.media, 1)} ± ${fnum(m.de, 1)} (${m.n})`).join("; "), r.prueba || r.error, r.estadistico, `${fnum(r.gl1, 0)}; ${fnum(r.gl2, 1)}`, r.p, r.p_holm, `${r.te} ${fnum(r.te_valor, 3)}`, r.levene_p]);
    tabla = `<table class="data"><thead><tr><th>Variable</th><th>Media ± DE (n)</th><th>Prueba</th><th class="n">Estadístico</th><th class="n">p</th><th class="n">p Holm</th><th>Efecto</th></tr></thead><tbody>
      ${R.map((r) => r.error ? `<tr><td><b>${esc(r.nombre)}</b></td><td colspan="6" class="muted">${esc(r.error)}</td></tr>` : `<tr><td><b>${esc(r.nombre)}</b><br><span class="muted small">unidad: ${esc(r.unidad)}</span></td><td class="small">${(r.medias || []).map((m) => `${esc(m.nivel)}: <b>${fnum(m.media, 1)}</b> ± ${fnum(m.de, 1)} (${m.n})`).join("<br>")}</td>
        <td class="small">${esc(r.prueba)}</td><td class="n">${fnum(r.estadistico, 2)}</td><td class="n">${sig(r.p) ? `<span class="badge sig">${fp(r.p)}</span>` : fp(r.p)}</td><td class="n">${sig(r.p_holm) ? `<span class="badge sig">${fp(r.p_holm)}</span>` : fp(r.p_holm)}</td><td class="small">${esc(r.te)} = ${fnum(r.te_valor, 3)}</td></tr>`).join("")}</tbody></table>`;
  }
  const pares = dis === "grupos" ? R.flatMap((r) => (r.pares || []).map((p) => ({ ...p, nombre: r.nombre }))) : [];
  el.innerHTML = `<div class="card mb"><div class="card-head"><h3>${I.compare}${esc({ grupos: "Niveles independientes", pareado: "Comparación pareada", mixto: "Modelo lineal mixto (intercepto aleatorio por jugador)" }[dis])} · factor «${esc(d.factor)}» (${d.niveles.map(esc).join(", ")})</h3><div class="tools">${tableTools("cmp")}</div></div>
    <div class="tablewrap">${tabla}</div>
    <div class="card-body muted small">${dis === "pareado" ? "Media de cada jugador en cada condición; t pareada si las diferencias son normales (Shapiro), si no Wilcoxon. g de Hedges (av) con IC bootstrap (2000 réplicas)." : dis === "mixto" ? "Estimación: diferencia frente al nivel de referencia ajustando por jugador. d: estimación / DE total. ICC: proporción de la variabilidad atribuible al jugador." : "ANOVA de Welch si todos los grupos son normales; si no, Kruskal–Wallis. ω² / ε²: tamaño del efecto."} p Holm: corregida por el número de variables.</div></div>
    ${pares.length ? `<div class="card mb"><div class="card-head"><h3>Comparaciones por parejas</h3></div><div class="tablewrap"><table class="data"><thead><tr><th>Variable</th><th>Pareja</th><th class="n">Diferencia</th><th>Prueba</th><th class="n">p</th><th class="n">p Holm</th><th class="n">g de Hedges</th></tr></thead><tbody>
      ${pares.map((p) => `<tr><td>${esc(p.nombre)}</td><td>${esc(p.b)} − ${esc(p.a)}</td><td class="n">${fnum(p.dif, 1)}</td><td class="small">${esc(p.prueba)}</td><td class="n">${fp(p.p)}</td><td class="n">${sig(p.p_holm) ? `<span class="badge sig">${fp(p.p_holm)}</span>` : fp(p.p_holm)}</td><td class="n">${fnum(p.g, 2)} <span class="muted">${esc(p.magnitud)}</span></td></tr>`).join("")}</tbody></table></div></div>` : ""}
    <div class="grid-2" id="cm-ch"></div>`;
  wireTableTools(el, { cmp: { cols, rows } });
  const box = $("#cm-ch", el);
  R.filter((r) => !r.error).forEach((r) => {
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `<div class="card-head"><h3>${esc(r.nombre)}</h3><span class="muted small">p ${r.p !== null && r.p < 0.001 ? "" : "= "}${fp(r.p)}</span></div><div class="card-body"></div>`;
    box.append(c);
    const b = $(".card-body", c);
    if (dis === "pareado") b.innerHTML = slopeChart(r, d.niveles, width(b));
    else if (r.puntos) b.innerHTML = Charts.strip(r.puntos.map((g, i) => ({ name: g.grupo, color: PAL[i % PAL.length], values: g.valores.map((x) => ({ v: x, label: g.grupo })) })), { width: width(b), labelWidth: 140, name: r.nombre });
    else if (r.medias) b.innerHTML = Charts.hbar(r.medias.map((m, i) => ({ label: m.nivel, value: m.media || 0, color: PAL[i % PAL.length], sub: `DE ${fnum(m.de, 1)} · n ${m.n}` })), { width: width(b), labelWidth: 140, dec: 1, name: "Media" });
  });
}
function slopeChart(r, lv, W) {
  const H = 260, L = 120, R = 120, T = 16, B = 26;
  const vals = r.pares.flatMap((p) => [p.a, p.b]);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * .08 || 1;
  const Y = (v) => T + (H - T - B) * (1 - (v - lo + pad) / (hi - lo + 2 * pad));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart"><text x="${L}" y="${H - 6}" class="ax" text-anchor="middle">${esc(lv[0])}</text><text x="${W - R}" y="${H - 6}" class="ax" text-anchor="middle">${esc(lv[1])}</text>`;
  r.pares.forEach((p, i) => {
    const c = p.b > p.a ? "#2e9e6b" : "#d64545";
    s += `<g data-tip="<b>${esc(p.jugador)}</b><br>${esc(lv[0])}: ${fnum(p.a, 1)}<br>${esc(lv[1])}: ${fnum(p.b, 1)}"><line x1="${L}" x2="${W - R}" y1="${Y(p.a)}" y2="${Y(p.b)}" stroke="${c}" stroke-width="1.6" opacity=".75"/><circle cx="${L}" cy="${Y(p.a)}" r="4" fill="${c}"/><circle cx="${W - R}" cy="${Y(p.b)}" r="4" fill="${c}"/>
      <text x="${L - 8}" y="${Y(p.a) + 4}" class="lb sm" text-anchor="end">${esc(p.jugador.split(" ")[0])}</text></g>`;
  });
  s += `<line x1="${L}" x2="${W - R}" y1="${Y(r.media_a)}" y2="${Y(r.media_b)}" stroke="#142B4C" stroke-width="3.5"/><text x="${W - R + 8}" y="${Y(r.media_b) + 4}" class="lb">media ${fnum(r.media_b, 1)}</text>`;
  return s + "</svg>";
}
function pintaCorrelacion(el, d) {
  const jugs = [...new Set(d.puntos.map((p) => p.jugador))];
  const col = (j) => PAL[jugs.indexOf(j) % PAL.length];
  const m = d.matriz;
  const heat = (rho) => rho === null ? "transparent" : rho > 0 ? `rgba(42,120,214,${Math.abs(rho) * .5})` : `rgba(214,69,69,${Math.abs(rho) * .5})`;
  el.innerHTML = `<div class="grid-2 mb">
    <div class="card"><div class="card-head"><h3>${I.scatter}${esc(d.ny)} frente a ${esc(d.nx)}</h3></div><div class="card-body" id="cr-sc"></div>
      <div class="legend" style="padding:0 16px 12px">${jugs.map((j) => `<span><i style="background:${col(j)}"></i>${esc(j)}</span>`).join("")}</div></div>
    <div class="card"><div class="card-head"><h3>Coeficientes</h3></div><div class="card-body"><table class="data"><tbody>
      <tr><td><b>Spearman (ρ)</b><br><span class="muted small">todas las sesiones, sin tener en cuenta el jugador</span></td><td class="n"><b>${fnum(d.spearman.rho, 2)}</b> · p ${fp(d.spearman.p)}<br><span class="muted">${esc(d.spearman.magnitud)}</span></td></tr>
      ${d.pearson ? `<tr><td><b>Pearson (r)</b></td><td class="n">${fnum(d.pearson.r, 2)} · p ${fp(d.pearson.p)}</td></tr>` : ""}
      <tr><td><b>Medidas repetidas (rmcorr)</b><br><span class="muted small">relación dentro de cada jugador (Bakdash y Marusich, 2017)</span></td><td class="n"><b>${fnum(d.rmcorr.r, 2)}</b> [${fnum(d.rmcorr.ic_inf, 2)}; ${fnum(d.rmcorr.ic_sup, 2)}] · p ${fp(d.rmcorr.p)}<br><span class="muted">${esc(d.rmcorr.magnitud)} · gl ${fnum(d.rmcorr.gl)}</span></td></tr>
      <tr><td>Sesiones / jugadores</td><td class="n">${d.n} / ${d.jugadores}</td></tr></tbody></table>
      <p class="muted small mt">Con varias sesiones por jugador, rmcorr es la correlación adecuada: indica si, cuando un jugador hace más «X» en una sesión, también hace más «Y».</p></div></div></div>
  <div class="card mb"><div class="card-head"><h3>Matriz de correlaciones de Spearman</h3><div class="tools">${tableTools("mat")}</div></div><div class="tablewrap"><table class="data heat"><thead><tr><th></th>${m.nombres.map((x) => `<th class="n small">${esc(x)}</th>`).join("")}</tr></thead><tbody>
    ${m.m.map((fila, i) => `<tr><td><b>${esc(m.nombres[i])}</b></td>${fila.map((c, j) => `<td class="n" style="background:${i === j ? "transparent" : heat(c.rho)}" title="p = ${fp(c.p)} · n = ${c.n}">${i === j ? "—" : fnum(c.rho, 2) + (sig(c.p) ? "*" : "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="card-body muted small">* p &lt; ${fnum(parseNum(S.st.cfg.alfa) || .05, 2)} sin corregir. Azul: relación positiva; rojo: negativa.</div></div>
  <div class="card"><div class="card-head"><h3>Variabilidad entre sesiones del mismo jugador</h3><div class="tools">${tableTools("var")}</div></div><div class="tablewrap"><table class="data"><thead><tr><th>Variable</th><th class="n">Sesiones</th><th class="n">Jugadores</th><th class="n">ICC(1) [IC 95 %]</th><th>Magnitud</th><th class="n">CV intraindividual</th></tr></thead><tbody>
    ${d.variabilidad.map((x) => `<tr><td><b>${esc(x.nombre)}</b></td><td class="n">${x.n}</td><td class="n">${x.jugadores}</td><td class="n">${fnum(x.icc, 2)} [${fnum(x.icc_ic[0], 2)}; ${fnum(x.icc_ic[1], 2)}]</td><td>${esc(x.magnitud)}</td><td class="n">${fnum(x.cv_intra, 1)} %</td></tr>`).join("")}</tbody></table></div>
    <div class="card-body muted small">ICC alto: las diferencias se deben sobre todo al jugador (perfil estable); CV intraindividual: cuánto varía cada jugador de una sesión a otra.</div></div>`;
  const sc = $("#cr-sc", el);
  sc.innerHTML = Charts.scatter(d.puntos.map((p) => ({ x: p.x, y: p.y, label: p.etiqueta, color: col(p.jugador) })), { width: width(sc), height: 320, xlabel: d.nx, ylabel: d.ny });
  wireTableTools(el, {
    mat: { cols: ["", ...m.nombres], rows: m.m.map((f, i) => [m.nombres[i], ...f.map((c) => c.rho)]) },
    var: { cols: ["Variable", "Sesiones", "Jugadores", "ICC", "IC inf", "IC sup", "CV intra %"], rows: d.variabilidad.map((x) => [x.nombre, x.n, x.jugadores, x.icc, x.icc_ic[0], x.icc_ic[1], x.cv_intra]) },
  });
}

/* ---------------------------------------------------------------------- CONCORDANCIA SPRO */
V.spro = async (v) => {
  loading(v);
  await cargarSesiones();
  const d = (await api("/api/spro")).datos;
  v.innerHTML = head("Concordancia con SPRO", "Compare los valores de WIMU Lab con los que exporta SPRO (software oficial de WIMU) para las mismas sesiones.",
    `<button class="btn primary" id="sp-imp">${I.upload}${d ? "Importar otra exportación" : "Importar Excel/CSV de SPRO"}</button>`) +
    (d ? `<div class="card mb"><div class="card-head"><h3>${I.excel}${esc(d.nombre)} · ${d.n} filas</h3><div class="tools"><button class="btn ghost" id="sp-ver">${I.eye}Ver filas</button></div></div><div class="card-body">
      <p class="muted">1) Indique qué columnas identifican cada sesión (se emparejan por nombre de archivo, por jugador + fecha o por dispositivo + fecha). 2) Indique qué columna de SPRO equivale a cada variable de WIMU Lab.</p>
      <div class="form-grid g4">${[["archivo", "Archivo"], ["jugador", "Jugador"], ["fecha", "Fecha"], ["dispositivo", "Dispositivo"]].map(([k, l]) => `<div class="field"><label>Columna «${l}»</label><select data-cl="${k}"><option value="">—</option>${d.columnas.map((c) => `<option ${d.claves[k] === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>`).join("")}</div>
      <h4 class="h4 mt">Variables equivalentes</h4>
      <div class="form-grid g3">${d.variables.filter((x) => !["distancia_vel_m", "distancia_disp_m", "cobertura_fc_pct"].includes(x.clave)).map((x) => `<div class="field"><label>${esc(x.nombre)}</label><select data-mp="${x.clave}"><option value="">— no comparar —</option>${d.columnas.map((c) => `<option ${d.mapa[x.clave] === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>`).join("")}</div>
      <div class="row mt"><button class="btn primary" id="sp-go">${I.target}Calcular concordancia</button><span class="muted small">Asegúrese de que los umbrales de Ajustes (HSR, sprint, aceleraciones) son los mismos que en SPRO.</span></div></div></div>
      <div id="sp-res"></div>` : `<div class="card">${empty(I.target, "Todavía no ha importado datos de SPRO", "<p>En SPRO, exporte el informe de las sesiones a Excel (una fila por jugador y sesión) e impórtelo aquí.</p>")}</div>`);
  $("#sp-imp").onclick = () => { const fi = $("#file-input"); fi.value = ""; fi.onchange = async () => { const f = fi.files[0]; if (!f) return; try { await api("/api/spro/importar?nombre=" + encodeURIComponent(f.name), await f.arrayBuffer(), true); toast("Exportación de SPRO importada"); go("spro"); } catch (e) { toast(e.message, true); } }; fi.click(); };
  if (!d) return;
  $("#sp-ver").onclick = () => modal("Filas importadas (primeras 8)", `<div class="tablewrap"><table class="data compact"><thead><tr>${d.columnas.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${d.muestra.map((f) => `<tr>${d.columnas.map((c) => `<td>${esc(f[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`, true);
  $("#sp-go").onclick = async () => {
    const claves = {}, mapa = {};
    $$("[data-cl]", v).forEach((s) => (claves[s.dataset.cl] = s.value || null));
    $$("[data-mp]", v).forEach((s) => { if (s.value) mapa[s.dataset.mp] = s.value; });
    const res = $("#sp-res");
    loading(res, "Emparejando y calculando…");
    try {
      await api("/api/spro/mapa", { claves, mapa });
      const c = await api("/api/spro/concordancia", {});
      pintaConcordancia(res, c);
    } catch (e) { res.innerHTML = `<div class="card">${empty(I.alert, "No se pudo calcular", `<p>${esc(e.message)}</p>`)}</div>`; }
  };
  if (Object.keys(d.mapa).length) $("#sp-go").click();
};
function pintaConcordancia(el, c) {
  const R = c.resultados.filter((r) => r.n >= 3);
  const cols = ["Variable", "n", "SPRO media", "WIMU Lab media", "Sesgo", "IC inf", "IC sup", "Sesgo %", "MAE", "RMSE", "MAPE %", "ICC(A,1)", "ICC IC inf", "ICC IC sup", "ICC(C,1)", "CCC", "r", "LoA inf", "LoA sup", "Pendiente sesgo prop.", "p sesgo prop."];
  const rows = R.map((r) => [r.nombre, r.n, r.media_ref, r.media_nuevo, r.sesgo, r.sesgo_ic[0], r.sesgo_ic[1], r.sesgo_pct, r.mae, r.rmse, r.mape, r.icc_a, r.icc_a_ic[0], r.icc_a_ic[1], r.icc_c, r.ccc, r.r, r.lim_inf, r.lim_sup, r.prop_pendiente, r.prop_p]);
  const mag = (x) => x === "excelente" ? "ok" : x === "buena" ? "info" : "aviso";
  el.innerHTML = `<div class="kpis"><div class="card kpi"><div class="k-label">Filas de SPRO</div><div class="k-value">${c.n_filas}</div></div><div class="card kpi"><div class="k-label">Emparejadas</div><div class="k-value">${c.emparejadas.length}</div><div class="k-sub">${c.sin_pareja.length} sin sesión</div></div></div>
  <div class="card mb"><div class="card-head"><h3>${I.target}Concordancia (diferencia = WIMU Lab − SPRO)</h3><div class="tools">${tableTools("conc")}</div></div><div class="tablewrap"><table class="data"><thead><tr><th>Variable</th><th class="n">n</th><th class="n">SPRO</th><th class="n">WIMU Lab</th><th class="n">Sesgo [IC 95 %]</th><th class="n">Sesgo %</th><th class="n">MAE</th><th class="n">RMSE</th><th class="n">MAPE</th><th class="n">ICC(A,1) [IC 95 %]</th><th class="n">CCC</th><th class="n">Límites de acuerdo</th></tr></thead><tbody>
    ${R.map((r) => `<tr><td><b>${esc(r.nombre)}</b><br><span class="muted small">SPRO: ${esc(r.columna)}</span></td><td class="n">${r.n}</td><td class="n">${fnum(r.media_ref, 1)} ± ${fnum(r.de_ref, 1)}</td><td class="n">${fnum(r.media_nuevo, 1)} ± ${fnum(r.de_nuevo, 1)}</td>
      <td class="n">${fnum(r.sesgo, 2)} [${fnum(r.sesgo_ic[0], 2)}; ${fnum(r.sesgo_ic[1], 2)}]</td><td class="n">${fnum(r.sesgo_pct, 1)} %</td><td class="n">${fnum(r.mae, 2)}</td><td class="n">${fnum(r.rmse, 2)}</td><td class="n">${r.mape === null ? "—" : fnum(r.mape, 1) + " %"}</td>
      <td class="n">${fnum(r.icc_a, 3)} [${fnum(r.icc_a_ic[0], 2)}; ${fnum(r.icc_a_ic[1], 2)}]<br><span class="badge ${mag(r.magnitud)}">${esc(r.magnitud)}</span></td><td class="n">${fnum(r.ccc, 3)}</td><td class="n">${fnum(r.lim_inf, 2)} a ${fnum(r.lim_sup, 2)}</td></tr>`).join("") || `<tr><td colspan="12">${empty(I.target, "Menos de 3 sesiones emparejadas por variable")}</td></tr>`}</tbody></table></div>
    <div class="card-body muted small">ICC(A,1): acuerdo absoluto (McGraw y Wong, 1996); &lt; 0,5 pobre, 0,5–0,75 moderada, 0,75–0,9 buena, &gt; 0,9 excelente (Koo y Li, 2016). MAPE solo con valores de referencia ≥ 1 % de la media. Límites de acuerdo: sesgo ± 1,96 DE (Bland y Altman).</div></div>
  <div class="grid-2" id="ba"></div>
  <div class="card mt"><div class="card-head"><h3>Emparejamiento</h3></div><div class="tablewrap" style="max-height:320px"><table class="data compact"><thead><tr><th class="n">Fila SPRO</th><th>Sesión</th><th>Jugador</th><th>Fecha</th><th>Método</th></tr></thead><tbody>
    ${c.emparejadas.map((e) => `<tr><td class="n">${e.fila}</td><td class="small">${esc(e.sesion)}</td><td>${esc(e.jugador)}</td><td>${esc(e.fecha)}</td><td class="muted">${esc(e.metodo)}</td></tr>`).join("")}
    ${c.sin_pareja.map((e) => `<tr class="excl"><td class="n">${e.fila}</td><td colspan="3">${esc(e.texto)}</td><td><span class="badge aviso">sin sesión</span></td></tr>`).join("")}</tbody></table></div></div>`;
  wireTableTools(el, { conc: { cols, rows } });
  const box = $("#ba", el);
  R.forEach((r) => {
    const cd = document.createElement("div");
    cd.className = "card";
    cd.innerHTML = `<div class="card-head"><h3>${esc(r.nombre)}</h3><span class="muted small">sesgo prop.: pendiente ${fnum(r.prop_pendiente, 3)}, p ${fp(r.prop_p)}</span></div><div class="card-body"></div>`;
    box.append(cd);
    const b = $(".card-body", cd);
    b.innerHTML = blandAltman(r, width(b));
  });
}
function blandAltman(r, W) {
  const H = 240, L = 54, R = 12, T = 12, B = 34;
  const p = r.puntos, m = p.map((x) => (x.ref + x.nuevo) / 2), d = p.map((x) => x.nuevo - x.ref);
  const xlo = Math.min(...m), xhi = Math.max(...m), xp = (xhi - xlo) * .06 || 1;
  const ylo = Math.min(...d, r.lim_inf, 0), yhi = Math.max(...d, r.lim_sup, 0), yp = (yhi - ylo) * .12 || 1;
  const X = (x) => L + (W - L - R) * (x - xlo + xp) / (xhi - xlo + 2 * xp), Y = (y) => T + (H - T - B) * (1 - (y - ylo + yp) / (yhi - ylo + 2 * yp));
  const lineaH = (y, c, lab, dash) => `<line x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}" stroke="${c}" ${dash ? 'stroke-dasharray="5 3"' : ""}/><text x="${W - R - 4}" y="${Y(y) - 4}" class="ax" text-anchor="end" fill="${c}">${lab} ${fnum(y, 2)}</text>`;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart"><line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="currentColor" opacity=".25"/>`;
  s += lineaH(r.sesgo, "#eb6834", "sesgo") + lineaH(r.lim_sup, "#d64545", "+1,96 DE", 1) + lineaH(r.lim_inf, "#d64545", "−1,96 DE", 1);
  [ylo, (ylo + yhi) / 2, yhi].forEach((y) => (s += `<text x="${L - 6}" y="${Y(y) + 4}" class="ax" text-anchor="end">${fnum(y, Math.abs(yhi - ylo) < 10 ? 1 : 0)}</text>`));
  [xlo, (xlo + xhi) / 2, xhi].forEach((x) => (s += `<text x="${X(x)}" y="${H - 16}" class="ax" text-anchor="middle">${fnum(x, Math.abs(xhi - xlo) < 10 ? 1 : 0)}</text>`));
  p.forEach((q, i) => (s += `<circle cx="${X(m[i])}" cy="${Y(d[i])}" r="4" fill="#2a78d6" fill-opacity=".75" data-tip="<b>${esc(q.etiqueta)}</b><br>SPRO: ${fnum(q.ref, 1)}<br>WIMU Lab: ${fnum(q.nuevo, 1)}<br>Diferencia: ${fnum(d[i], 2)}"/>`));
  s += `<text x="${(W + L) / 2}" y="${H - 2}" class="axt" text-anchor="middle">Media de los dos métodos</text><text transform="translate(12 ${(H - B) / 2}) rotate(-90)" class="axt" text-anchor="middle">WIMU Lab − SPRO</text></svg>`;
  return s;
}

/* ---------------------------------------------------------------------- INFORMES */
const TIPOS_INF = [
  ["sesion", "Individual de sesión", "Para el jugador o el cuerpo técnico: resumen, mapa, velocidad y FC, zonas, comparación con sus sesiones anteriores. Uno por sesión.", I.word],
  ["tecnico", "Técnico de sesión", "Todas las variables, zonas, minuto a minuto, WCS, esfuerzos, calidad de la señal, canales y procesado. Uno por sesión.", I.doc],
  ["jugador", "Evolución del jugador", "Sesiones de un jugador en el tiempo, medias y última sesión frente a las anteriores. Uno por jugador.", I.person],
  ["colectivo", "Colectivo", "Comparación de los jugadores en las sesiones elegidas (p. ej. un entrenamiento o un partido), valores destacados.", I.users],
  ["estadistico", "Estadístico (técnico colectivo)", "Métodos, descriptivo, comparaciones, correlaciones, variabilidad entre sesiones y concordancia con SPRO.", I.stats],
];
V.informes = async (v, o = {}) => {
  loading(v);
  await cargarSesiones();
  const st = S.inf = S.inf || { tipo: "sesion", formatos: store.get("formatos", ["docx", "pdf", "xlsx"]), f: {}, sel: [], jug: [], agrupar: "tipo", factor: "", diseno: "pareado", titulo: "" };
  if (o.tipo) st.tipo = o.tipo;
  if (o.ids) { st.sel = o.ids.slice(); st.f.usarIds = true; st.ids = o.ids.slice(); }
  if (o.jugador) st.jug = [o.jugador];
  v.innerHTML = head("Informes", "Se guardan en la carpeta de resultados, en una subcarpeta con la fecha de hoy.", `<button class="btn" id="i-dir">${I.folder}Abrir carpeta de resultados</button>`) + `
  <div class="split-inf"><div>
    <div class="card mb"><div class="card-head"><h3>1. Tipo de informe</h3></div><div class="card-body opts">${TIPOS_INF.map(([k, t, d, ic]) => `<label class="opt ${st.tipo === k ? "on" : ""}"><input type="radio" name="it" value="${k}" ${st.tipo === k ? "checked" : ""}>${ic}<div><b>${t}</b><span>${d}</span></div></label>`).join("")}</div></div>
    <div class="card mb"><div class="card-head"><h3>2. Qué incluir</h3></div><div class="card-body" id="i-sel"></div></div>
    <div class="card mb"><div class="card-head"><h3>3. Formatos</h3></div><div class="card-body row">
      ${[["docx", "Word (.docx)", I.word], ["pdf", "PDF", I.pdf], ["xlsx", "Excel (.xlsx)", I.excel]].map(([k, l, ic]) => `<label class="switch"><input type="checkbox" data-fmt="${k}" ${st.formatos.includes(k) ? "checked" : ""}><i></i>${ic}${l}</label>`).join("")}
      <span class="grow"></span><button class="btn primary" id="i-go">${I.doc}Generar</button></div><div id="job-box" class="card-body"></div></div>
  </div>
  <div class="card"><div class="card-head"><h3>${I.folder}Informes generados</h3></div><div class="card-body flush" id="i-prev"></div></div></div>`;
  $$("input[name=it]", v).forEach((r) => (r.onchange = () => { st.tipo = r.value; $$(".opt", v).forEach((x) => x.classList.toggle("on", $("input", x).checked)); selPanel(); }));
  $("#i-dir").onclick = () => api("/api/abrir", {}).catch((e) => toast(e.message, true));
  const selPanel = () => {
    const el = $("#i-sel");
    if (st.tipo === "sesion" || st.tipo === "tecnico") {
      const ses = S.ses.filter((s) => !s.falta);
      el.innerHTML = `<div class="toolbar"><input type="search" id="is-q" placeholder="Filtrar…"><span class="grow"></span><button class="btn ghost" id="is-all">Todas las visibles</button><button class="btn ghost" id="is-none">Ninguna</button><span class="count" id="is-n"></span></div>
        <div class="tablewrap" style="max-height:330px"><table class="data compact"><tbody id="is-list"></tbody></table></div>`;
      const draw = () => {
        const q = ($("#is-q").value || "").toLowerCase();
        const vis = ses.filter((s) => !q || `${s.etiqueta_jugador} ${s.tipo} ${s.tarea} ${s.archivo} ${ffecha(s.inicio)}`.toLowerCase().includes(q));
        $("#is-list").innerHTML = vis.map((s) => `<tr><td style="width:28px"><input type="checkbox" data-is="${s.id}" ${st.sel.includes(s.id) ? "checked" : ""}></td><td>${ffecha(s.inicio)}</td><td><b>${esc(s.etiqueta_jugador)}</b></td><td>${esc(s.tipo)}</td><td>${esc(s.tarea || "")}</td><td class="n">${fvar("distancia_m", s.kpis?.distancia_m)} m</td></tr>`).join("");
        $("#is-n").textContent = `${st.sel.length} seleccionadas`;
        $$("[data-is]").forEach((c) => (c.onchange = () => { c.checked ? st.sel.push(c.dataset.is) : (st.sel = st.sel.filter((x) => x !== c.dataset.is)); $("#is-n").textContent = `${st.sel.length} seleccionadas`; }));
        $("#is-all").onclick = () => { st.sel = [...new Set([...st.sel, ...vis.map((s) => s.id)])]; draw(); };
      };
      $("#is-q").oninput = debounce(draw, 150);
      $("#is-none").onclick = () => { st.sel = []; draw(); };
      draw();
    } else if (st.tipo === "jugador") {
      el.innerHTML = `<div class="field"><label>Jugadores (un informe por jugador)</label><div class="chipsel">${S.jug.map((j) => `<label class="chipopt ${st.jug.includes(j.id) ? "on" : ""}"><input type="checkbox" data-ij="${j.id}" ${st.jug.includes(j.id) ? "checked" : ""}>${esc(j.nombre)} <span class="muted">(${j.n_sesiones})</span></label>`).join("") || '<span class="muted">No hay jugadores</span>'}</div></div>
        <div class="row mt"><label>Desde <input type="date" id="fl-desde" value="${st.f.desde || ""}"></label><label>hasta <input type="date" id="fl-hasta" value="${st.f.hasta || ""}"></label></div>`;
      wireChips(el);
    } else {
      el.innerHTML = filtroHtml(st.f, { ids: st.ids }) + `<div class="form-grid mt">
        <div class="field"><label>Título</label><input type="text" id="i-tit" value="${esc(st.titulo)}" placeholder="${st.tipo === "colectivo" ? "Informe colectivo de carga" : "Informe técnico: análisis estadístico de la carga"}"></div>
        ${st.tipo === "estadistico" ? `<div class="field"><label>Descriptivo agrupado por</label><select id="i-agr"><option value="">Sin agrupar</option>${FACTORES.map(([k, l]) => `<option value="${k}" ${st.agrupar === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label>Comparación por</label><select id="i-fac"><option value="">Sin comparación</option>${FACTORES.map(([k, l]) => `<option value="${k}" ${st.factor === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label>Diseño</label><select id="i-dis"><option value="pareado" ${st.diseno === "pareado" ? "selected" : ""}>Pareado (2 niveles)</option><option value="grupos" ${st.diseno === "grupos" ? "selected" : ""}>Niveles independientes</option><option value="mixto" ${st.diseno === "mixto" ? "selected" : ""}>Modelo mixto</option></select></div>` : ""}</div>
        ${st.tipo === "estadistico" ? `<div class="field mt"><label>Variables</label>${varChecks(st.vars || VARS_DEF, "iv")}</div>` : ""}`;
      wireChips(el);
    }
  };
  selPanel();
  $("#i-go").onclick = async () => {
    st.formatos = $$("[data-fmt]:checked", v).map((x) => x.dataset.fmt);
    if (!st.formatos.length) return toast("Elija al menos un formato", true);
    store.set("formatos", st.formatos);
    const b = { tipo: st.tipo, formatos: st.formatos };
    if (st.tipo === "sesion" || st.tipo === "tecnico") { if (!st.sel.length) return toast("Seleccione al menos una sesión", true); b.ids = st.sel; }
    else if (st.tipo === "jugador") {
      st.jug = $$("[data-ij]:checked", v).map((x) => x.dataset.ij);
      if (!st.jug.length) return toast("Elija al menos un jugador", true);
      b.jugadores = st.jug; b.filtro = { desde: $("#fl-desde").value || undefined, hasta: $("#fl-hasta").value || undefined };
    } else {
      b.filtro = leeFiltro(v, st.f, st.ids);
      st.titulo = $("#i-tit").value; b.titulo = st.titulo || undefined;
      if (st.tipo === "estadistico") {
        st.agrupar = $("#i-agr").value; st.factor = $("#i-fac").value; st.diseno = $("#i-dis").value;
        st.vars = $$("[data-iv]:checked", v).map((x) => x.dataset.iv);
        b.agrupar = st.agrupar; b.variables = st.vars;
        if (st.factor) b.comparacion = { factor: st.factor, diseno: st.diseno };
      }
    }
    try {
      await api("/api/informe", b);
      $("#job-box").innerHTML = progressHtml({ activo: true, mensaje: "Iniciando…", fraccion: 0 });
      esperarTarea((j) => { $("#job-box").innerHTML = ""; if (j.resultado) { resultadoInforme(j.resultado); previos(); } });
    } catch (e) { toast(e.message, true); }
  };
  const previos = async () => {
    const el = $("#i-prev");
    const r = await api("/api/resultados");
    const ic = (n) => n.endsWith(".pdf") ? I.pdf : n.endsWith(".xlsx") ? I.excel : n.endsWith(".docx") ? I.word : I.doc;
    el.innerHTML = r.length ? r.map((d) => `<div class="prev-day"><div class="row"><b>${esc(d.nombre.replace(/_/g, "/"))}</b><span class="grow"></span><button class="btn ghost" data-open="${esc(d.ruta)}">${I.folder}</button></div>
      <ul class="filelist">${d.archivos.slice(0, 40).map((f) => `<li>${ic(f.nombre)}<span class="grow" title="${esc(f.carpeta)}">${esc(f.nombre)}</span><span class="meta">${esc(f.carpeta)} · ${esc(f.fecha.slice(-5))}</span><button class="btn ghost" data-open="${esc(f.ruta)}">Abrir</button></li>`).join("")}</ul></div>`).join("") : empty(I.doc, "Aún no hay informes");
    $$("[data-open]", el).forEach((b) => (b.onclick = () => api("/api/abrir", { ruta: b.dataset.open }).catch((e) => toast(e.message, true))));
  };
  previos();
  if (S.st.job.activo) esperarTarea(() => previos());
};

/* ---------------------------------------------------------------------- AJUSTES */
V.ajustes = async (v) => {
  await refresh();
  const c = S.st.cfg, def = S.st.defectos;
  const lst = (x) => Array.isArray(x) ? x.map((y) => fnum(y, y % 1 ? 1 : 0)).join("; ") : typeof x === "number" ? fnum(x, x % 1 ? (Math.abs(x) < 0.1 ? 2 : 1) : 0) : x;
  const campo = (k, l, h, tipo = "text") => `<div class="field"><label>${l}</label><input type="${tipo}" data-k="${k}" value="${esc(lst(c[k]))}">${h ? `<span class="hint">${h} · por defecto: ${esc(lst(def[k]))}</span>` : ""}</div>`;
  v.innerHTML = head("Ajustes", "Los cambios de procesado y zonas recalculan las sesiones automáticamente la próxima vez que se consultan.",
    `<button class="btn ghost" id="a-def">Valores por defecto</button><button class="btn primary" id="a-ok">${I.check}Guardar</button>`) + `
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>${I.folder}Carpetas</h3></div><div class="card-body">
      <div class="field"><label>Carpeta de datos (archivos .qul / .qui, también subcarpetas)</label><div class="row"><input type="text" data-k="carpeta_datos" value="${esc(c.carpeta_datos)}" class="grow"><button class="btn" data-pick="carpeta_datos">Elegir…</button></div>
        <span class="hint">Dentro se guarda el registro de jugadores y sesiones (wimulab_registro.json): no lo borre.</span></div>
      <div class="field mt"><label>Carpeta de resultados (informes)</label><div class="row"><input type="text" data-k="carpeta_resultados" value="${esc(c.carpeta_resultados)}" class="grow"><button class="btn" data-pick="carpeta_resultados">Elegir…</button></div></div>
      <div class="form-grid mt">${campo("titulo", "Título de los informes")}${campo("institucion", "Club / institución")}${campo("autor", "Autor")}</div></div></div>
    <div class="card"><div class="card-head"><h3>${I.map}GPS y distancia</h3></div><div class="card-body">
      <div class="field"><label>Distancia</label><select data-k="fuente_distancia"><option value="velocidad" ${c.fuente_distancia === "velocidad" ? "selected" : ""}>Integral de la velocidad Doppler del GPS (recomendado)</option><option value="dispositivo" ${c.fuente_distancia === "dispositivo" ? "selected" : ""}>Canal DIST del dispositivo (como SPRO)</option></select>
        <span class="hint">DIST suma también el ruido de la posición con el jugador parado; en el archivo de prueba da un 22 % más.</span></div>
      <div class="form-grid mt">${campo("sat_min", "Satélites mínimos", "muestra válida", "number")}${campo("pdop_max", "PDOP máximo", "muestra válida")}${campo("v_max_valida", "Velocidad máxima válida (km/h)", "por encima = artefacto")}${campo("suavizado_v_s", "Suavizado de la velocidad (s)", "media móvil")}</div></div></div>
    <div class="card"><div class="card-head"><h3>${I.speed}Velocidad y aceleraciones</h3></div><div class="card-body form-grid">
      ${campo("zonas_velocidad", "Límites de zonas de velocidad (km/h)", "separados por «;»")}${campo("umbral_hsr", "Alta velocidad, HSR (km/h)", "")}${campo("umbral_sprint", "Sprint (km/h)", "")}${campo("sprint_min_s", "Duración mínima del sprint (s)", "")}
      ${campo("zonas_aceleracion", "Límites de zonas de aceleración (m/s²)", "")}${campo("umbral_acel", "Aceleración / deceleración (m/s²)", "")}${campo("umbral_acel_alta", "Intensa (m/s²)", "")}${campo("acel_min_s", "Duración mínima (s)", "")}
      ${campo("ventanas_wcs", "Ventanas WCS (min)", "")}</div></div>
    <div class="card"><div class="card-head"><h3>${I.heart}Acelerómetro, FC y estadística</h3></div><div class="card-body form-grid">
      ${campo("zonas_acelt", "Límites de zonas de AcelT (g)", "")}${campo("umbrales_impacto", "Umbrales de impacto (g)", "")}
      ${campo("zonas_fc", "Límites de zonas de FC (% FCmáx)", "")}${campo("fcmax_defecto", "FCmáx por defecto (lpm)", "vacío = la de cada jugador o la máxima de la sesión")}
      ${campo("alfa", "Nivel de significación (α)", "")}
      <div class="field"><label>Separador decimal</label><select data-k="decimal"><option value="," ${c.decimal === "," ? "selected" : ""}>Coma (1,5)</option><option value="." ${c.decimal === "." ? "selected" : ""}>Punto (1.5)</option></select></div></div></div>
  </div>`;
  const listas = ["zonas_velocidad", "zonas_aceleracion", "zonas_acelt", "umbrales_impacto", "zonas_fc", "ventanas_wcs"];
  $$("[data-pick]", v).forEach((b) => (b.onclick = async () => {
    const inp = $(`[data-k="${b.dataset.pick}"]`, v);
    const r = await api("/api/elegir_carpeta", { titulo: "Elegir carpeta", inicial: inp.value });
    if (r.ruta) inp.value = r.ruta;
  }));
  $("#a-ok").onclick = async () => {
    const p = {};
    for (const el of $$("[data-k]", v)) {
      const k = el.dataset.k;
      let val = el.value;
      if (listas.includes(k)) {
        val = val.split(/[;\s]+/).map((x) => parseNum(x)).filter((x) => x !== null);
        if (!val.length) return toast(`Revise «${k}»`, true);
        if (k !== "zonas_aceleracion" && val.some((x, i) => i && x <= val[i - 1])) return toast(`Los límites de «${k}» deben ir de menor a mayor`, true);
      } else if (["sat_min", "pdop_max", "v_max_valida", "suavizado_v_s", "umbral_hsr", "umbral_sprint", "sprint_min_s", "umbral_acel", "umbral_acel_alta", "acel_min_s", "alfa"].includes(k)) {
        val = parseNum(val);
        if (val === null) return toast(`Revise «${k}»`, true);
      }
      p[k] = val;
    }
    const cambiaDatos = p.carpeta_datos !== c.carpeta_datos;
    await saveCfg(p);
    if (cambiaDatos) actualizar();
  };
  $("#a-def").onclick = async () => { if (!confirm("¿Restablecer los valores por defecto (las carpetas no cambian)?")) return; await api("/api/ajustes/restablecer", {}); toast("Valores por defecto"); go("ajustes"); };
};
