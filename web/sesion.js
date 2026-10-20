/* WIMU Lab — ficha de sesión: mapa, línea de tiempo con recorte y partes, zonas, minuto a minuto, WCS, esfuerzos, calidad */
"use strict";
const ZCOL = ["#9cc3ee", "#5598e7", "#2a78d6", "#f2b33d", "#eb6834", "#d64545", "#8e2b2b"];
const VCOL = (v) => v < 6 ? "#2a78d6" : v < 12 ? "#3fb6b2" : v < 18 ? "#f2c94c" : v < 21 ? "#f29a3d" : v < 24 ? "#eb6834" : "#c0392b";
const SEGCOL = ["#2a78d6", "#eb6834", "#2e9e6b", "#8e5bd6", "#d64545", "#c98500", "#3fb6b2"];

V.sesion = async (v, o) => {
  loading(v, "Leyendo el archivo y calculando…");
  await cargarSesiones();
  let A;
  try { A = await api("/api/sesion?id=" + encodeURIComponent(o.id)); }
  catch (e) { v.innerHTML = `<div class="card">${empty(I.alert, "No se pudo leer la sesión", `<p>${esc(e.message)}</p><button class="btn" onclick="go('sesiones')">Volver</button>`)}</div>`; return; }
  S.A = A;
  const s = A.sesion, r = A.resumen, meta = A.meta;
  const lista = S.vis || S.ses || [];
  const idx = lista.findIndex((x) => x.id === s.id);
  const tipos = S.tipos || S.st.tipos;
  const kp = (ic, k, lab, sub) => r[k] === null || r[k] === undefined ? "" : `<div class="card kpi sm"><div class="k-label">${ic}${lab}</div><div class="k-value">${fvar(k, r[k])}<small>${esc(VAR(k).unidad === "n" ? "" : VAR(k).unidad)}</small></div>${sub ? `<div class="k-sub">${sub}</div>` : ""}</div>`;
  v.innerHTML = `
  <div class="page-head ses-head"><div>
      <div class="row" style="gap:6px"><button class="btn ghost" id="x-back">${I.back}Sesiones</button>
      <button class="btn ghost" id="x-prev" ${idx > 0 ? "" : "disabled"} title="Anterior (←)">‹</button><button class="btn ghost" id="x-next" ${idx >= 0 && idx < lista.length - 1 ? "" : "disabled"} title="Siguiente (→)">›</button></div>
      <h1>${s.jugador_nombre ? esc(s.jugador_nombre) : `<span class="muted">${esc(meta.dispositivo || "WIMU")} · sin jugador</span>`}</h1>
      <p>${ffecha(meta.inicio)}${meta.fin ? `–${ffecha(meta.fin).slice(-5)}` : ""} · ${esc(meta.dispositivo || "")} · <span class="muted" title="${esc(s.ruta)}">${esc(s.archivo)}</span></p></div>
    <div class="actions"><button class="btn" id="x-inf">${I.word}Informe individual</button><button class="btn" id="x-tec">${I.doc}Informe técnico</button><button class="btn ghost" id="x-csv" title="Serie de 1 Hz en CSV">${I.download}Datos 1 Hz</button></div></div>
  <div class="card mb"><div class="ses-meta">
    <div class="field"><label>Jugador</label><select id="x-jug">${jugOptions(s.jugador)}<option value="__nuevo">+ Nuevo jugador…</option></select></div>
    <div class="field"><label>Tipo</label><select id="x-tipo">${tipos.map((t) => `<option ${t === s.tipo ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
    <div class="field"><label>Tarea / etiqueta</label><input type="text" id="x-tarea" value="${esc(s.tarea || "")}" placeholder="p. ej. Partido de liga, Rondos…"></div>
    <div class="field grow"><label>Notas</label><input type="text" id="x-notas" value="${esc(s.notas || "")}"></div>
    <label class="switch" title="Las sesiones excluidas no entran en el análisis ni en los informes colectivos"><input type="checkbox" id="x-excl" ${s.excluida ? "checked" : ""}><i></i>Excluir del análisis</label>
  </div></div>
  ${A.avisos.map((a) => `<div class="notice warn mb">${I.alert}<div>${esc(a)}</div></div>`).join("")}
  <div class="card mb" id="ext-card"><div class="card-head"><h3>${I.heart}Datos de otros dispositivos</h3>
    <div class="tools"><label class="btn" for="ext-file" title="FIT, GPX, TCX o CSV exportado del reloj, la banda o su aplicación">${I.upload}Añadir archivo…</label>
    <input type="file" id="ext-file" accept=".fit,.gpx,.tcx,.csv,.txt" hidden></div></div>
    <div class="card-body" id="ext-body"></div></div>
  <div class="kpis kpis-6">
    ${kp(I.clock, "duracion_min", "Duración", `analizado ${fmin(A.desde)}–${fmin(A.hasta)}`)}
    ${kp(I.map, "distancia_m", "Distancia", `${fvar("m_min", r.m_min)} m/min`)}
    ${kp(I.speed, "v_max_kmh", "Velocidad máxima", `${r.n_sprints ?? 0} sprints`)}
    ${kp(I.bolt, "hsr_m", "Alta velocidad", `≥ ${fnum(parseNum(S.st.cfg.umbral_hsr))} km/h`)}
    ${kp(I.compare, "n_acel", "Aceleraciones", `${r.n_decel ?? "—"} deceleraciones`)}
    ${kp(I.pulse, "player_load", "Player Load", `${fvar("pl_min", r.pl_min)} por min`)}
    ${kp(I.heart, "fc_media", "FC media", r.pct_fcmax_media ? `${fnum(r.pct_fcmax_media, 0)} % FCmáx` : "")}
    ${kp(I.heart, "fc_max", "FC máxima", r.fcmax_ref ? `ref. ${fnum(r.fcmax_ref)} (${esc(r.fcmax_fuente)})` : "")}
    ${kp(I.stats, "trimp", "TRIMP", "Edwards")}
    ${kp(I.pulse, "impactos_5g", "Impactos > 5 g", `${fnum(r.impactos_3g)} > 3 g`)}
    ${kp(I.speed, "acel_max", "Acel. máxima", `decel. ${fvar("decel_max", r.decel_max)} m/s²`)}
    ${kp(I.compare, "m_min", "Distancia relativa", `${fnum(r.tiempo_mov_min, 0)} min en movimiento`)}
  </div>
  <div class="card mb"><div class="card-head"><h3>${I.pulse}Línea de tiempo</h3>
    <div class="tools">${seg("tl", [["vfc", "Velocidad y FC"], ["a", "Aceleración"], ["acelt", "AcelT"], ["pl", "Player Load"]], store.get("tl", "vfc"))}</div></div>
    <div class="card-body"><div id="tl" class="tl"></div>
      <div class="tl-bar" id="tl-bar"><button class="btn ghost" id="tl-clear" type="button">Quitar selección del gráfico</button><span class="muted">Arrastre para seleccionar · clic sobre una parte para eliminarla · doble clic para ver todo.</span></div>
      <div class="grid-2 mt">
        <div><h4 class="h4">${I.scissors}Tiempo analizado</h4>
          <div class="row"><label>Desde <input type="text" id="rc-a" size="6" value="${fmin(A.desde)}"></label><label>hasta <input type="text" id="rc-b" size="6" value="${fmin(A.hasta)}"></label>
          <span class="muted">de ${fmin(A.total)} (min:s)</span><button class="btn" id="rc-ok">Aplicar a partes</button><button class="btn ghost" id="rc-x">Toda la sesión</button></div>
          <p class="muted small">Quite el tiempo antes de empezar y después de terminar (dispositivo encendido en el vestuario, banquillo…).</p></div>
        <div><h4 class="h4">${I.list}Partes de la sesión</h4><div id="sg"></div>
          <div class="row mt"><button class="btn" id="sg-add">${I.plus}Añadir parte</button><button class="btn" id="sg-auto" title="Divide el tiempo analizado en partes iguales">Dividir en…</button><button class="btn primary" id="sg-save" hidden>${I.check}Guardar partes</button></div></div>
      </div></div></div>
  <div class="grid-2 mb">
    <div class="card"><div class="card-head"><h3>${I.map}Recorrido</h3><div class="tools">${seg("mapa", [["sat", "Satélite"], ["osm", "Mapa"], ["plano", "Plano"]], store.get("mapa", "sat"))}</div></div>
      <div class="card-body"><div id="mapa" class="mapa"></div><div class="legend">${[[0, "< 6"], [6, "6–12"], [12, "12–18"], [18, "18–21"], [21, "21–24"], [24, "≥ 24 km/h"]].map(([x, l]) => `<span><i style="background:${VCOL(x + .1)}"></i>${l}</span>`).join("")}</div>
        <div class="row map-opts"><label class="switch" title="Desplaza el mapa para que el jugador no salga de la vista"><input type="checkbox" id="map-seguir" ${store.get("mapSeguir", true) ? "checked" : ""}><i></i>Seguir al jugador</label>
          <label class="muted">Estela <select id="map-estela">${[[0, "No"], [10, "10 s"], [30, "30 s"], [60, "1 min"], [300, "5 min"]].map(([v, l]) => `<option value="${v}" ${store.get("mapEstela", 30) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div></div></div>
    <div class="card"><div class="card-head"><h3>${I.stats}Zonas</h3><div class="tools">${seg("zona", [["velocidad", "Velocidad"], ["aceleracion", "Aceleración"], ["acelt", "AcelT"], ["fc", "FC"]], "velocidad")}</div></div>
      <div class="card-body" id="zonas"></div></div>
  </div>
  <div class="card"><div class="card-head">${seg("det", [["min", "Minuto a minuto"], ["wcs", "Escenarios más exigentes"], ["ev", "Esfuerzos"], ["partes", "Partes"], ["vars", "Todas las variables"], ["cal", "Calidad de la señal"], ["can", "Archivo y canales"]], store.get("det", "min"))}</div>
    <div class="card-body" id="det"></div></div>`;
  // ------------------------------------------------ cabecera y metadatos
  $("#x-back").onclick = () => go("sesiones");
  $("#x-prev").onclick = () => idx > 0 && go("sesion", { id: lista[idx - 1].id });
  $("#x-next").onclick = () => idx < lista.length - 1 && go("sesion", { id: lista[idx + 1].id });
  $("#x-inf").onclick = () => informeRapido("sesion", [s.id]);
  $("#x-tec").onclick = () => informeRapido("tecnico", [s.id]);
  $("#x-csv").onclick = () => {
    const ser = A.series, keys = ["t", "v", "a", "fc", "acelt", "acelt_max", "pl"].filter((k) => ser[k] && ser[k].length === ser.t.length);
    downloadCSV(`${s.archivo.replace(/\.\w+$/, "")}_1Hz.csv`, keys.map((k) => ({ t: "tiempo_s", v: "velocidad_kmh", a: "aceleracion_ms2", fc: "fc_lpm", acelt: "acelt_media_g", acelt_max: "acelt_max_g", pl: "player_load" }[k])), ser.t.map((_, i) => keys.map((k) => ser[k][i])));
  };
  const guardar = async (patch, recargar) => {
    try {
      await api("/api/sesion/guardar", { id: s.id, ...patch });
      S.ses = null;
      if (recargar) { await refresh(); go("sesion", { id: s.id }, true); } else toast("Guardado");
    } catch (e) { toast(e.message, true); }
  };
  $("#x-jug").onchange = (e) => e.target.value === "__nuevo" ? editJugador(null, [s.id]) : guardar({ jugador: e.target.value || null }, true);
  $("#x-tipo").onchange = (e) => guardar({ tipo: e.target.value });
  $("#x-tarea").onchange = (e) => guardar({ tarea: e.target.value });
  $("#x-notas").onchange = (e) => guardar({ notas: e.target.value });
  $("#x-excl").onchange = (e) => guardar({ excluida: e.target.checked });
  // ------------------------------------------------ recorte
  const aplicaRecorte = (a, b) => guardar({ recorte: [a <= 0.5 ? null : Math.round(a), b >= A.total - 0.5 ? null : Math.round(b)] }, true);
  // El botón Aplicar transfiere el intervalo visible a «Partes de la sesión».
  // «Analizar solo este tramo» sigue disponible en la barra de selección.
  $("#rc-ok").onclick = () => {
    const a = parseMin($("#rc-a").value), b = parseMin($("#rc-b").value);
    if (a === null || b === null || a < 0 || b > A.total || b <= a)
      return toast("Introduzca un intervalo válido dentro de la sesión", true);
    const nm = prompt("Nombre de la parte:", `Parte ${segs.length + 1}`);
    if (nm === null) return;
    if (!nm.trim()) return toast("Introduzca un nombre para la parte", true);
    addSeg(a, b, nm.trim());
  };
  $("#rc-x").onclick = () => guardar({ recorte: [null, null] }, true);
  // ------------------------------------------------ partes
  let segs = (s.segmentos || []).map((x) => ({ ...x }));
  let seleccionActual = null;
  const quitarSeleccionGrafica = () => {
    seleccionActual = null;
    $("#rc-a").value = fmin(A.desde);
    $("#rc-b").value = fmin(A.hasta);
    tl.clearSel();
    pintarBarraSinSeleccion();
  };
  const pintarBarraSinSeleccion = () => {
    $("#tl-bar").innerHTML = `<button class="btn ghost" id="tl-clear" type="button">Quitar selección del gráfico</button><span class="muted">Arrastre para seleccionar · clic sobre una parte para eliminarla · doble clic para ver todo.</span>`;
    $("#tl-clear").onclick = quitarSeleccionGrafica;
  };
  let borrando = false;
  const borrarParte = async (i) => {
    if (borrando || !segs[i]) return;
    if (!confirm(`¿Eliminar definitivamente «${segs[i].nombre}»?`)) return;
    borrando = true;
    try {
      const nuevas = segs.filter((_, j) => j !== i);
      await api("/api/sesion/guardar", { id: s.id, segmentos: nuevas });
      segs = nuevas;
      S.ses = null;
      toast("Parte eliminada y guardada");
      await refresh();
      go("sesion", { id: s.id }, true);
    } catch (e) { toast(`No se pudo borrar: ${e.message}`, true); drawSegs(true); }
    finally { borrando = false; }
  };
  const drawSegs = (dirty) => {
    $("#sg").innerHTML = segs.length ? `<table class="data compact"><tbody>${segs.map((g, i) => `<tr><td><i class="dotc" style="background:${SEGCOL[i % SEGCOL.length]}"></i></td>
      <td><input type="text" data-sn="${i}" value="${esc(g.nombre)}"></td><td><input type="text" size="6" data-sa="${i}" value="${fmin(g.desde)}"></td><td>–</td><td><input type="text" size="6" data-sb="${i}" value="${fmin(g.hasta)}"></td>
      <td><button class="btn ghost" data-sd="${i}" title="Eliminar parte definitivamente">${I.trash}</button></td></tr>`).join("")}</tbody></table>` : '<p class="muted small">Sin partes. Seleccione un tramo en la gráfica y pulse «Añadir como parte», o use «Dividir en…».</p>';
    $("#sg-save").hidden = !dirty;
    $$("[data-sn]").forEach((x) => (x.onchange = () => { segs[x.dataset.sn].nombre = x.value; drawSegs(true); }));
    $$("[data-sa]").forEach((x) => (x.onchange = () => { segs[x.dataset.sa].desde = parseMin(x.value) ?? 0; drawSegs(true); tl.draw(); }));
    $$("[data-sb]").forEach((x) => (x.onchange = () => { segs[x.dataset.sb].hasta = parseMin(x.value) ?? 0; drawSegs(true); tl.draw(); }));
    $$("[data-sd]").forEach((x) => (x.onclick = () => borrarParte(+x.dataset.sd)));
  };
  const addSeg = (a, b, nombre) => { segs.push({ nombre: nombre || `Parte ${segs.length + 1}`, desde: Math.round(a), hasta: Math.round(b) }); segs.sort((x, y) => x.desde - y.desde); drawSegs(true); tl.draw(); };
  $("#sg-add").onclick = () => {
    const [a,b] = seleccionActual || [A.desde,A.hasta];
    const nombre = prompt("Nombre del intervalo (primer tiempo, ejercicio, etc.):", `Parte ${segs.length+1}`);
    if (nombre === null) return;
    if (!nombre.trim()) return toast("Introduzca un nombre para el intervalo", true);
    addSeg(a,b,nombre.trim());
  };
  $("#sg-auto").onclick = () => {
    const n = parseInt(prompt("¿En cuántas partes iguales dividir el tiempo analizado? (p. ej. 2 = primera y segunda parte)", "2"), 10);
    if (!n || n < 1 || n > 20) return;
    const L = (A.hasta - A.desde) / n;
    segs = Array.from({ length: n }, (_, i) => ({ nombre: n === 2 ? ["1.ª parte", "2.ª parte"][i] : `Parte ${i + 1}`, desde: Math.round(A.desde + i * L), hasta: Math.round(A.desde + (i + 1) * L) }));
    drawSegs(true); tl.draw();
  };
  $("#sg-save").onclick = () => {
    if (segs.some(x => !x.nombre.trim() || !Number.isFinite(x.desde) || !Number.isFinite(x.hasta) ||
          x.desde < 0 || x.hasta > A.total || x.hasta <= x.desde))
      return toast("Revise los nombres y los límites temporales de las partes", true);
    const orden = [...segs].sort((a,b)=>a.desde-b.desde);
    if (orden.some((x,i)=>i>0 && x.desde < orden[i-1].hasta))
      return toast("Hay intervalos solapados. Corrija los límites antes de guardar", true);
    guardar({ segmentos: orden }, true);
  };
  drawSegs(false);
  // ------------------------------------------------ línea de tiempo
  const tl = timeline($("#tl"), A, () => segs, {
    onSelect: (a, b) => {
      seleccionActual = [a,b];
      $("#rc-a").value = fmin(a);
      $("#rc-b").value = fmin(b);
      $("#tl-bar").innerHTML = `<b>${fmin(a)}–${fmin(b)}</b> <span class="muted">(${fmin(b - a)})</span>
        <button class="btn" id="tb-rc">${I.scissors}Analizar solo este tramo</button><button class="btn" id="tb-sg">${I.plus}Añadir como parte</button><button class="btn" id="tb-zoom">Ampliar</button><button class="btn ghost" id="tb-x">Cancelar</button>`;
      $("#tb-rc").onclick = () => aplicaRecorte(a, b);
      $("#tb-sg").onclick = () => {
        const nm = prompt("Nombre de la parte (primer tiempo, ejercicio, etc.):", `Parte ${segs.length + 1}`);
        if (nm !== null && nm.trim()) addSeg(a, b, nm.trim());
      };
      $("#tb-zoom").onclick = () => tl.zoom(a, b);
      $("#tb-x").onclick = quitarSeleccionGrafica;
    },
    onPartClick: (i) => borrarParte(i),
    onHover: (t) => S.mapHover && S.mapHover(t),
    onPin: (t) => S.mapHover && S.mapHover(t),
  });
  $("#tl-clear").onclick = quitarSeleccionGrafica;
  wireSeg($(".card-head", $("#tl").closest(".card")), (_, m) => { store.set("tl", m); tl.mode(m); });
  // ------------------------------------------------ mapa, zonas, detalle
  const mapEl = $("#mapa");
  const pintaMapa = (m) => { store.set("mapa", m); dibujaMapa(mapEl, A.series.mapa, m, (t) => tl.setCursor(t, true)); S.mapHover && S.mapHover(tl.cursor()); };
  pintaMapa(store.get("mapa", "sat"));
  if (A.series?.t?.length) tl.setCursor(A.series.t[0], true);
  wireSeg($("#mapa").closest(".card"), (_, m) => pintaMapa(m));
  $("#map-seguir").onchange = (e) => { store.set("mapSeguir", e.target.checked); S.mapHover && S.mapHover(tl.cursor()); };
  $("#map-estela").onchange = (e) => { store.set("mapEstela", +e.target.value); S.mapHover && S.mapHover(tl.cursor()); };
  // ------------------------------------------------ datos de otros dispositivos (FC de banda/reloj, GPS…)
  pintaExternos(A, s.id);
  const zonas = (k) => {
    const t = A.tablas[k], el = $("#zonas");
    if (!t) { el.innerHTML = empty(I.stats, "Sin datos para estas zonas"); return; }
    const campo = t[0].distancia_m !== undefined && k !== "fc" ? "distancia_m" : "tiempo_min";
    const cols = k === "aceleracion" ? ["#8e2b2b", "#d64545", "#eb6834", "#c9d3e0", "#5598e7", "#2a78d6", "#142B4C"] : ZCOL;
    el.innerHTML = Charts.hbar(t.map((z, i) => ({ label: z.zona, value: z[campo] || 0, color: cols[i % cols.length], sub: `${fnum(z.tiempo_min, 1)} min${z.distancia_m !== undefined && z.distancia_m !== null ? ` · ${fnum(z.distancia_m)} m` : ""}` })),
      { width: width(el), name: campo === "distancia_m" ? "Distancia (m)" : "Tiempo (min)", dec: campo === "distancia_m" ? 0 : 1, labelWidth: 130, rowH: 30 }) +
      `<table class="data compact mt"><thead><tr><th>Zona</th>${t[0].distancia_m !== undefined ? '<th class="n">Distancia (m)</th>' : ""}${t[0].pct_dist !== undefined ? '<th class="n">% dist.</th>' : ""}<th class="n">Tiempo (min)</th><th class="n">% tiempo</th></tr></thead><tbody>
      ${t.map((z, i) => `<tr><td><i class="dotc" style="background:${cols[i % cols.length]}"></i>${esc(z.zona)}</td>${z.distancia_m !== undefined ? `<td class="n">${fnum(z.distancia_m)}</td>` : ""}${z.pct_dist !== undefined ? `<td class="n">${fnum(z.pct_dist, 1)}</td>` : ""}<td class="n">${fnum(z.tiempo_min, 2)}</td><td class="n">${fnum(z.pct_tiempo, 1)}</td></tr>`).join("")}</tbody></table>`;
  };
  zonas("velocidad");
  wireSeg($("#zonas").closest(".card"), (_, k) => zonas(k));
  const det = (k) => { store.set("det", k); detalle($("#det"), A, k); };
  det(store.get("det", "min"));
  wireSeg($("#det").closest(".card"), (_, k) => det(k));
  S.cleanup = () => { tl.play(false); if (S.mapa) { S.mapa.remove(); S.mapa = null; } S.mapHover = null; };
};

/* ---------------------------------------------------------------------- otros dispositivos vinculados a la sesión */
/* Hora de reloj (la de la sesión WIMU, p. ej. +0200) para un instante UNIX. */
function horaSesion(A, unix) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec((A.meta.desfase || "").trim());
  if (!m) return new Date(unix * 1000).toLocaleTimeString("es-ES", { hour12: false });
  const off = (m[1] === "-" ? -1 : 1) * (+m[2] * 3600 + +m[3] * 60);
  return new Date((unix + off) * 1000).toISOString().slice(11, 19);
}
const NOMBRE_VAR = { hr: "FC", speed: "velocidad", alt: "altitud" };
function pintaExternos(A, sid) {
  const el = $("#ext-body"), lst = A.externos || [];
  const usada = lst.find((e) => e.usar_fc);
  const recargar = () => { S.ses = null; go("sesion", { id: sid }, true); };
  const editar = async (archivo, patch) => {
    try { await api("/api/sesion/externo/editar", { id: sid, archivo, ...patch }); toast("Guardado. Recalculando la sesión…"); recargar(); }
    catch (e) { toast(e.message, true); }
  };
  let h = "";
  if (!A.fc_wimu && !usada) h += `<div class="notice warn mb">${I.alert}<div><b>Este archivo WIMU no contiene frecuencia cardíaca</b> (la banda no se emparejó o no transmitió).
    Si la FC está en el reloj o en la aplicación de la banda (Polar Flow, Garmin Connect, Suunto…), exporte esa sesión en <b>FIT, TCX, GPX o CSV</b> y añádala con «Añadir archivo…»: se alinea por hora y su FC se usa en la gráfica, las zonas, el TRIMP y los informes.</div></div>`;
  if (!lst.length) h += `<p class="muted small">Sin archivos de otros dispositivos. Formatos: FIT, GPX, TCX y CSV (comas o punto y coma, coma decimal, exportación de Polar Flow y formato largo «timestamp_utc, variable, value»). El archivo original no se modifica: se guarda una copia junto a los datos.</p>`;
  else h += `<div class="tablewrap"><table class="data compact ext-tab"><thead><tr><th>Archivo</th><th>Registro</th><th>Variables</th><th class="n">Solape con la sesión</th><th>Desfase (s)</th><th>Usar su FC</th><th></th></tr></thead><tbody>
    ${lst.map((e, i) => {
      const sol = e.solape ? e.solape.pct_sesion : null;
      const solTxt = sol === null ? "—" : sol <= 0 ? `<span class="badge error" title="Revise la hora o el desfase">sin solape</span>` : `${fnum(sol, 1)} %<br><span class="muted small">${fmin(e.solape.segundos)} min:s</span>`;
      const sug = e.sugerencia && Math.abs((e.sugerencia.desfase_s || 0) - (e.desfase_s || 0)) > 0.4
        ? `<button class="btn ghost small" data-sug="${i}" title="${esc(e.sugerencia.motivo)}">Sugerido: ${e.sugerencia.desfase_s > 0 ? "+" : ""}${fnum(e.sugerencia.desfase_s, 0)} s</button>` : "";
      return `<tr>
        <td><b>${esc(e.original)}</b><br><span class="muted small">${esc(e.formato)}${e.dispositivo ? " · " + esc(e.dispositivo) : ""}${e.existe === false ? " · <b>falta la copia</b>" : ""}</span></td>
        <td class="nowrap">${horaSesion(A, e.inicio + (e.desfase_s || 0))}–${horaSesion(A, e.fin + (e.desfase_s || 0))}<br><span class="muted small">${fint(e.n)} registros${e.gps ? " · GPS" : ""}</span></td>
        <td>${(e.variables || []).map((v) => `<span class="badge info">${NOMBRE_VAR[v] || v}</span>`).join(" ") || '<span class="muted">—</span>'}</td>
        <td class="n">${solTxt}</td>
        <td class="nowrap"><input type="number" step="0.1" data-off="${i}" value="${e.desfase_s || 0}" style="width:84px" title="Suma estos segundos a la hora del archivo externo">${sug}</td>
        <td>${(e.variables || []).includes("hr") ? `<label class="switch"><input type="checkbox" data-usar="${i}" ${e.usar_fc ? "checked" : ""}><i></i></label>` : '<span class="muted small">sin FC</span>'}</td>
        <td><button class="btn ghost" data-del="${i}" title="Quitar este archivo de la sesión">${I.trash}</button></td></tr>
        ${(e.avisos || []).length ? `<tr class="ext-av"><td colspan="7" class="muted small">${e.avisos.map(esc).join(" · ")}</td></tr>` : ""}`;
    }).join("")}</tbody></table></div>
    <p class="muted small mt">El desfase corrige relojes desajustados: antes de aplicarlo conviene averiguar si la diferencia se debe al reloj, a la zona horaria o al inicio real de la captura. ${usada ? `La FC que se analiza procede de <b>${esc(usada.original)}</b>.` : "Ningún archivo externo aporta la FC del análisis."}</p>`;
  el.innerHTML = h;
  $$("[data-off]", el).forEach((x) => (x.onchange = () => editar(lst[+x.dataset.off].archivo, { desfase_s: parseNum(x.value) || 0 })));
  $$("[data-usar]", el).forEach((x) => (x.onchange = () => editar(lst[+x.dataset.usar].archivo, { usar_fc: x.checked })));
  $$("[data-sug]", el).forEach((x) => (x.onclick = () => { const e = lst[+x.dataset.sug]; if (confirm(`${e.sugerencia.motivo}\n\n¿Aplicar un desfase de ${e.sugerencia.desfase_s} s?`)) editar(e.archivo, { desfase_s: e.sugerencia.desfase_s }); }));
  $$("[data-del]", el).forEach((x) => (x.onclick = async () => {
    const e = lst[+x.dataset.del];
    if (!confirm(`¿Quitar «${e.original}» de esta sesión? Se borra la copia guardada (no el archivo original).`)) return;
    try { await api("/api/sesion/externo/borrar", { id: sid, archivo: e.archivo }); toast("Archivo quitado"); recargar(); } catch (er) { toast(er.message, true); }
  }));
  $("#ext-file").onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    if (f.size > 60000000) return toast("Máximo 60 MB", true);
    try {
      toast(`Importando ${f.name}…`);
      const r = await api(`/api/sesion/externo?id=${encodeURIComponent(sid)}&nombre=${encodeURIComponent(f.name)}`, f, true);
      const e = r.externo;
      toast(`${f.name}: ${(e.variables || []).map((v) => NOMBRE_VAR[v] || v).join(", ") || "sin variables"}${e.usar_fc ? " · su FC se usa en el análisis" : ""}`);
      recargar();
    } catch (er) { toast(`No se pudo importar ${f.name}: ${er.message}`, true); }
  };
}

/* ---------------------------------------------------------------------- informe rápido desde la ficha */
async function informeRapido(tipo, ids) {
  try {
    await api("/api/informe", { tipo, ids, formatos: store.get("formatos", ["docx", "pdf", "xlsx"]) });
    toast("Generando el informe…");
    esperarTarea((j) => { if (j.resultado) resultadoInforme(j.resultado); });
  } catch (e) { toast(e.message, true); }
}
function resultadoInforme(r) {
  const ic = (n) => n.endsWith(".pdf") ? I.pdf : n.endsWith(".xlsx") ? I.excel : n.endsWith(".docx") ? I.word : I.doc;
  const m = modal("Informe generado", `<ul class="filelist">${r.archivos.map((f) => `<li>${ic(f)}<span class="grow">${esc(f.split(/[\\/]/).pop())}</span><button class="btn" data-open="${esc(f)}">Abrir</button></li>`).join("")}</ul>
    <div class="row mt"><button class="btn" id="r-dir">${I.folder}Abrir carpeta</button></div>`, 720);
  $$("[data-open]", m).forEach((b) => (b.onclick = () => api("/api/abrir", { ruta: b.dataset.open }).catch((e) => toast(e.message, true))));
  $("#r-dir", m).onclick = () => api("/api/abrir", { ruta: r.carpeta }).catch((e) => toast(e.message, true));
}

/* ---------------------------------------------------------------------- línea de tiempo (SVG) */
function timeline(el, A, getSegs, cb) {
  const ser = A.series, T = ser.t, n = T.length;
  let modo = store.get("tl", "vfc"), v0 = 0, v1 = A.total, sel = null, pinned = null;
  const W = Math.max(600, el.clientWidth || 900), H = 262, L = 46, R = 46, TOP = 36, B = 24;
  const X = (t) => L + ((W - L - R) * (t - v0)) / Math.max(1e-6, v1 - v0);
  const Tinv = (x) => v0 + ((x - L) / (W - L - R)) * (v1 - v0);
  const nice = (max) => { const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw || 1)); const st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw); return st; };
  const path = (vals, Y) => { let d = "", pen = false; for (let i = 0; i < n; i++) { const t = T[i]; if (t < v0 - 2 || t > v1 + 2) continue; const val = vals[i]; if (val === null || val === undefined || Number.isNaN(val)) { pen = false; continue; } d += (pen ? "L" : "M") + X(t).toFixed(1) + " " + Y(val).toFixed(1); pen = true; } return d; };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function draw() {
    const grid = css("--line-2"), ink = css("--ink-2");
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart tlsvg">`;
    // eje de tiempo
    const span = v1 - v0, stepT = [30, 60, 120, 300, 600, 900, 1800].find((x) => span / x <= 10) || 3600;
    for (let t = Math.ceil(v0 / stepT) * stepT; t <= v1; t += stepT) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${TOP}" y2="${H - B}" stroke="${grid}"/><text x="${X(t)}" y="${H - 7}" class="ax" text-anchor="middle">${fmin(t)}</text>`;
    let Yl, lab;
    if (modo === "vfc") {
      const vmax = Math.max(26, ...(ser.v || []).filter((x) => x !== null));
      const st = nice(vmax), top = Math.ceil(vmax / st) * st;
      Yl = (x) => TOP + (H - TOP - B) * (1 - x / top);
      for (let y = 0; y <= top; y += st) s += `<line x1="${L}" x2="${W - R}" y1="${Yl(y)}" y2="${Yl(y)}" stroke="${grid}"/><text x="${L - 6}" y="${Yl(y) + 4}" class="ax" text-anchor="end">${y}</text>`;
      const thr = parseNum(S.st.cfg.umbral_sprint) || 21;
      if (ser.v) {
        const d = path(ser.v, Yl);
        s += `<path d="${d}" fill="none" stroke="#2a78d6" stroke-width="1.1"/>`;
        s += `<line x1="${L}" x2="${W - R}" y1="${Yl(thr)}" y2="${Yl(thr)}" stroke="#eb6834" stroke-dasharray="4 3"/><text x="${W - R - 4}" y="${Yl(thr) - 4}" class="ax" text-anchor="end" fill="#eb6834">sprint ${thr} km/h</text>`;
      }
      if (ser.fc) {
        const fv = ser.fc.filter((x) => x !== null);
        if (fv.length) {
          const lo = Math.floor((Math.min(...fv) - 10) / 20) * 20, hi = Math.ceil((Math.max(...fv) + 5) / 20) * 20;
          const Yr = (x) => TOP + (H - TOP - B) * (1 - (x - lo) / (hi - lo));
          for (let y = lo; y <= hi; y += 20) s += `<text x="${W - R + 6}" y="${Yr(y) + 4}" class="ax" fill="#d64545">${y}</text>`;
          s += `<path d="${path(ser.fc, Yr)}" fill="none" stroke="#d64545" stroke-width="1.5"/>`;
        }
      }
      s += `<text x="${L}" y="12" class="ax" fill="#2a78d6">Velocidad (km/h)</text><text x="${W - R}" y="12" class="ax" text-anchor="end" fill="#d64545">FC (lpm)</text>`;
      (A.eventos || []).filter((e) => e.tipo === "Sprint" && e.inicio_s >= v0 && e.inicio_s <= v1).forEach((e) => (s += `<path d="M${X(e.inicio_s)} ${Yl(e.v_max_kmh) - 9}l-4 -7h8z" fill="#eb6834" data-tip="<b>Sprint</b> ${fmin(e.inicio_s)}<br>${fnum(e.v_max_kmh, 1)} km/h · ${fnum(e.distancia_m)} m · ${fnum(e.duracion_s, 1)} s"/>`));
    } else {
      const key = { a: "a", acelt: "acelt_max", pl: "pl" }[modo];
      const vals = ser[key] || [];
      const fin = vals.filter((x) => x !== null && !Number.isNaN(x));
      let lo = modo === "a" ? -Math.max(4, ...fin.map(Math.abs)) : 0, hi = modo === "a" ? -lo : Math.max(...fin, 1);
      if (modo === "a") { lo = Math.max(lo, -8); hi = -lo; }
      const st = nice(hi - lo);
      lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
      Yl = (x) => TOP + (H - TOP - B) * (1 - (x - lo) / (hi - lo));
      for (let y = lo; y <= hi + 1e-9; y += st) s += `<line x1="${L}" x2="${W - R}" y1="${Yl(y)}" y2="${Yl(y)}" stroke="${grid}"/><text x="${L - 6}" y="${Yl(y) + 4}" class="ax" text-anchor="end">${fnum(y, st < 1 ? 1 : 0)}</text>`;
      if (modo === "a") {
        const ua = parseNum(S.st.cfg.umbral_acel) || 2;
        s += `<path d="${path(vals.map((x) => (x > 0 ? x : 0)), Yl)}" fill="none" stroke="#2e9e6b" stroke-width="1"/><path d="${path(vals.map((x) => (x < 0 ? x : 0)), Yl)}" fill="none" stroke="#d64545" stroke-width="1"/>`;
        s += [ua, -ua].map((u) => `<line x1="${L}" x2="${W - R}" y1="${Yl(u)}" y2="${Yl(u)}" stroke="#eb6834" stroke-dasharray="4 3"/>`).join("");
        lab = "Aceleración (m/s²): verde acelera, rojo frena";
      } else {
        s += `<path d="${path(vals, Yl)}" fill="none" stroke="${modo === "pl" ? "#8e5bd6" : "#2a78d6"}" stroke-width="1"/>`;
        if (modo === "acelt") (S.st.cfg.umbrales_impacto || []).forEach((u) => (s += `<line x1="${L}" x2="${W - R}" y1="${Yl(u)}" y2="${Yl(u)}" stroke="#eb6834" stroke-dasharray="3 3" opacity=".7"/>`));
        lab = modo === "pl" ? "Player Load por segundo (u.a.)" : "AcelT máxima de cada segundo (g)";
      }
      s += `<text x="${L}" y="12" class="ax">${lab}</text>`;
    }
    // partes
    getSegs().forEach((g, i) => {
      const a = Math.max(g.desde, v0), b = Math.min(g.hasta, v1);
      if (b <= a) return;
      const c = SEGCOL[i % SEGCOL.length];
      s += `<rect x="${X(a)}" y="${TOP - 6}" width="${X(b) - X(a)}" height="5" fill="${c}" rx="2"/><rect x="${X(a)}" y="${TOP}" width="${X(b) - X(a)}" height="${H - TOP - B}" fill="${c}" opacity=".05"/>
        <text x="${X(a) + 3}" y="${TOP - 9}" class="ax" fill="${c}">${esc(g.nombre)}</text>`;
    });
    // fuera del tiempo analizado
    if (A.desde > v0) s += `<rect x="${L}" y="${TOP}" width="${Math.max(0, X(A.desde) - L)}" height="${H - TOP - B}" class="tl-out"/>`;
    if (A.hasta < v1) s += `<rect x="${X(A.hasta)}" y="${TOP}" width="${Math.max(0, W - R - X(A.hasta))}" height="${H - TOP - B}" class="tl-out"/>`;
    if (sel) s += `<rect x="${X(sel[0])}" y="${TOP}" width="${Math.max(1, X(sel[1]) - X(sel[0]))}" height="${H - TOP - B}" class="tl-sel"/>`;
    s += `<line id="tl-cur" x1="0" x2="0" y1="${TOP}" y2="${H - B}" stroke="${ink}" stroke-width="1" opacity="0"/><rect id="tl-hit" x="${L}" y="${TOP}" width="${W - L - R}" height="${H - TOP - B}" fill="transparent" style="cursor:crosshair"/></svg>
      <div class="tl-read" id="tl-read"></div>
      <div class="tl-navigator">
        <button class="btn tl-play" id="tl-play" type="button" title="Reproducir / pausa (barra espaciadora con la barra seleccionada)" aria-label="Reproducir">${playing ? "❚❚" : "▶"}</button>
        <select id="tl-speed" title="Velocidad de reproducción">${[1, 5, 10, 30, 60].map((x) => `<option value="${x}" ${x === store.get("tlVel", 10) ? "selected" : ""}>×${x}</option>`).join("")}</select>
        <label for="tl-position">Desplazar cursor · GPS</label>
        <input id="tl-position" type="range" min="0" max="${Math.max(0, n - 1)}" step="1" value="${idxDe(pinned ?? T[0])}" aria-label="Desplazar cursor vertical y posición GPS" />
        <output id="tl-position-time">${fmin(pinned ?? T[0])}</output>
      </div>`;
    el.innerHTML = s;
    wire();
    setCursor(pinned ?? T[0], true);
  }
  /* índice de la muestra de 1 Hz más próxima a t (búsqueda binaria) */
  function idxDe(t) {
    let lo = 0, hi = n - 1;
    if (!n) return 0;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; }
    return lo > 0 && Math.abs(T[lo - 1] - t) <= Math.abs(T[lo] - t) ? lo - 1 : lo;
  }
  /* hora de reloj (la del dispositivo WIMU) para un tiempo relativo */
  const ini = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(A.meta?.inicio || "");
  const reloj = (t) => ini ? new Date(Date.UTC(+ini[1], ini[2] - 1, +ini[3], +ini[4], +ini[5], +ini[6]) + t * 1000).toISOString().slice(11, 19) : "";
  function setCursor(t, notify = true) {
    if (t === null || !Number.isFinite(t)) return;
    pinned = t;
    const cur = $("#tl-cur", el), rd = $("#tl-read", el);
    if (!cur || !rd) return;
    const i = idxDe(t);
    // con el gráfico ampliado, desplazar la ventana para que el cursor no salga de la vista
    if (v1 - v0 < A.total - 1 && (T[i] < v0 || T[i] > v1)) { const w = v1 - v0; v0 = Math.max(0, Math.min(A.total - w, T[i] - w * (playing ? 0.1 : 0.5))); v1 = v0 + w; draw(); return; }
    const x = X(T[i]);
    const slider = $("#tl-position", el), time = $("#tl-position-time", el);
    if (slider) slider.value = String(i);
    if (time) time.textContent = `${fmin(T[i])}${ini ? " · " + reloj(T[i]) : ""}`;
    cur.setAttribute("x1", x); cur.setAttribute("x2", x); cur.setAttribute("opacity", "1");
    rd.innerHTML = `<b>${fmin(T[i])}</b>${ini ? ` <span class="muted">(${reloj(T[i])})</span>` : ""} · ${ser.v ? `${fnum(ser.v[i], 1)} km/h` : ""}${ser.fc && ser.fc[i] ? ` · ${fnum(ser.fc[i])} lpm` : ""}`;
    if (notify && cb.onPin) cb.onPin(T[i]);
  }
  /* reproducción: avanza el cursor (y el jugador en el mapa) a la velocidad elegida */
  let playing = false, ultimo = 0;
  function paso(now) {
    if (!playing || !el.isConnected) { playing = false; return; }
    const dt = ultimo ? (now - ultimo) / 1000 : 0; ultimo = now;
    const t = (pinned ?? T[0]) + dt * (+store.get("tlVel", 10));
    if (t >= T[n - 1]) { setCursor(T[n - 1], true); play(false); return; }
    setCursor(t, true);
    requestAnimationFrame(paso);
  }
  function play(on) {
    playing = on; ultimo = 0;
    const b = $("#tl-play", el); if (b) { b.textContent = on ? "❚❚" : "▶"; b.setAttribute("aria-label", on ? "Pausa" : "Reproducir"); }
    if (on) { if ((pinned ?? 0) >= T[n - 1]) pinned = T[0]; requestAnimationFrame(paso); }
  }
  function wire() {
    const svg = $("svg", el), hit = $("#tl-hit", el), cur = $("#tl-cur", el), rd = $("#tl-read", el);
    const slider = $("#tl-position", el);
    if (slider) {
      slider.oninput = () => setCursor(T[Number(slider.value)], true);
      slider.onchange = () => setCursor(T[Number(slider.value)], true);
      slider.onkeydown = (ev) => { if (ev.key === " ") { ev.preventDefault(); play(!playing); } };
    }
    $("#tl-play", el).onclick = () => play(!playing);
    $("#tl-speed", el).onchange = (ev) => store.set("tlVel", +ev.target.value);
    const toT = (ev) => { const r = svg.getBoundingClientRect(); return Math.min(v1, Math.max(v0, Tinv(((ev.clientX - r.left) / r.width) * W))); };
    let drag = null;
    hit.onmousedown = (ev) => { drag = toT(ev); sel = null; };
    hit.onmousemove = (ev) => {
      const t = toT(ev);
      cur.setAttribute("x1", X(t)); cur.setAttribute("x2", X(t)); cur.setAttribute("opacity", ".5");
      const i = Math.max(0, Math.min(n - 1, Math.round(t - T[0])));
      rd.innerHTML = `<b>${fmin(T[i])}</b> · ${ser.v ? `${fnum(ser.v[i], 1)} km/h` : ""}${ser.fc && ser.fc[i] ? ` · ${fnum(ser.fc[i])} lpm` : ""}${ser.a ? ` · ${fnum(ser.a[i], 2)} m/s²` : ""}${ser.acelt_max ? ` · ${fnum(ser.acelt_max[i], 2)} g` : ""}`;
      cb.onHover && cb.onHover(T[i]);
      if (drag !== null) { const a = Math.min(drag, t), b = Math.max(drag, t); let r = $(".tl-sel", svg); if (!r) { r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); r.setAttribute("class", "tl-sel"); r.setAttribute("y", TOP); r.setAttribute("height", H - TOP - B); svg.insertBefore(r, cur); } r.setAttribute("x", X(a)); r.setAttribute("width", Math.max(1, X(b) - X(a))); }
    };
    hit.onmouseleave = () => { if (pinned === null) { cur.setAttribute("opacity", "0"); rd.innerHTML = ""; cb.onHover && cb.onHover(null); } else { setCursor(pinned, true); } };
    hit.onmouseup = (ev) => {
      if (drag === null) return;
      const t = toT(ev), a = Math.min(drag, t), b = Math.max(drag, t);
      drag = null;
      if (b - a >= 5) { sel = [a, b]; cb.onSelect && cb.onSelect(Math.round(a), Math.round(b)); }
      else {
        setCursor(t, true);
        const candidatos = getSegs().map((g, i) => ({g, i})).filter(x => t >= x.g.desde && t <= x.g.hasta);
        if (candidatos.length && cb.onPartClick) cb.onPartClick(candidatos[0].i);
      }
    };
    hit.ondblclick = () => { v0 = 0; v1 = A.total; sel = null; draw(); };
  }
  draw();
  return { draw, setCursor, play, cursor: () => pinned, mode: (m) => { modo = m; draw(); }, zoom: (a, b) => { v0 = a; v1 = b; sel = null; draw(); }, clearSel: () => { sel = null; draw(); } };
}

/* ---------------------------------------------------------------------- mapa (Leaflet con satélite; plano SVG sin conexión) */
function dibujaMapa(el, m, modo, onPositionClick) {
  if (S.mapa) { S.mapa.remove(); S.mapa = null; }
  S.mapHover = null;
  if (!m || !m.lat || m.lat.length < 3) { el.innerHTML = empty(I.map, "Sin posiciones GPS"); return; }
  const tramos = [];
  let cur = null;
  for (let i = 1; i < m.lat.length; i++) {
    const c = VCOL(m.v[i]);
    if (!cur || cur.c !== c) { cur = { c, p: [[m.lat[i - 1], m.lon[i - 1]]] }; tramos.push(cur); }
    cur.p.push([m.lat[i], m.lon[i]]);
  }
  if (modo !== "plano" && !window.L && !el.dataset.sinred) { el.dataset.sinred = 1; toast("Sin conexión a internet: se muestra el plano del recorrido (sin imagen de fondo)."); }
  if (modo !== "plano" && window.L) {
    el.innerHTML = "";
    const map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true });
    const capa = modo === "sat"
      ? L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, maxNativeZoom: 19, attribution: "Imágenes © Esri" })
      : L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 19, attribution: "© OpenStreetMap" });
    capa.addTo(map);
    capa.on("tileerror", () => { if (!el.dataset.avisado) { el.dataset.avisado = 1; toast("No se pudo descargar el mapa de fondo (¿sin conexión?). Use «Plano».", true); } });
    tramos.forEach((t) => L.polyline(t.p, { color: t.c, weight: 3, opacity: .9 }).addTo(map));
    L.circleMarker([m.lat[0], m.lon[0]], { radius: 6, color: "#fff", weight: 2, fillColor: "#2e9e6b", fillOpacity: 1 }).bindTooltip("Inicio").addTo(map);
    L.circleMarker([m.lat.at(-1), m.lon.at(-1)], { radius: 6, color: "#fff", weight: 2, fillColor: "#142B4C", fillOpacity: 1 }).bindTooltip("Fin").addTo(map);
    map.fitBounds(L.latLngBounds(m.lat.map((a, i) => [a, m.lon[i]])), { padding: [12, 12] });
    const estela = L.polyline([], { color: "#ffffff", weight: 7, opacity: .9, interactive: false }).addTo(map);
    const estela2 = L.polyline([], { color: "#eb6834", weight: 4, opacity: 1, interactive: false }).addTo(map);
    const mk = L.circleMarker([m.lat[0], m.lon[0]], { radius: 8, color: "#fff", weight: 3, fillColor: "#eb6834", fillOpacity: 1, opacity: 0, interactive: false }).addTo(map);
    S.mapHover = (t) => {
      if (t === null || t === undefined || !m.t) { mk.setStyle({ opacity: 0, fillOpacity: 0 }); estela.setLatLngs([]); estela2.setLatLngs([]); return; }
      const k = idxMapa(m, t);
      if (k < 0 || !Number.isFinite(m.lat[k]) || !Number.isFinite(m.lon[k])) return;
      const ll = L.latLng(m.lat[k], m.lon[k]);
      mk.setLatLng(ll); mk.setStyle({ opacity: 1, fillOpacity: 1 }); mk.bringToFront();
      const pts = puntosEstela(m, k, t);
      estela.setLatLngs(pts); estela2.setLatLngs(pts);
      if (store.get("mapSeguir", true) && !map.getBounds().pad(-0.12).contains(ll)) map.panTo(ll, { animate: false });
    };
    // Selección bidireccional: pulsar sobre el trazado GPS fija el cursor temporal.
    if (m.t && onPositionClick) {
      const valid = m.t.map((t, i) => ({t, i})).filter(x => Number.isFinite(x.t) && Number.isFinite(m.lat[x.i]) && Number.isFinite(m.lon[x.i]));
      const pts = valid.map(x => [m.lat[x.i], m.lon[x.i]]);
      if (pts.length > 1) {
        const target = L.polyline(pts, { color: '#ffffff', opacity: 0, weight: 16, interactive: true }).addTo(map);
        target.on('click', ev => {
          let best = valid[0], dist = Infinity;
          valid.forEach(x => { const d = map.distance(ev.latlng, [m.lat[x.i], m.lon[x.i]]); if (d < dist) { dist = d; best = x; } });
          onPositionClick(best.t);
          S.mapHover && S.mapHover(best.t);
        });
      }
    }
    S.mapa = map;
    setTimeout(() => map.invalidateSize(), 50);
    return;
  }
  // plano en metros
  const lat0 = m.lat.reduce((a, b) => a + b, 0) / m.lat.length, lon0 = m.lon.reduce((a, b) => a + b, 0) / m.lon.length;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
  const xs = m.lon.map((x) => (x - lon0) * kx), ys = m.lat.map((y) => (y - lat0) * ky);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const W = Math.max(320, el.clientWidth || 500), H = 380, pad = 16;
  const sc = Math.min((W - 2 * pad) / (maxx - minx || 1), (H - 2 * pad) / (maxy - miny || 1));
  const px = (x) => pad + (x - minx) * sc + ((W - 2 * pad) - (maxx - minx) * sc) / 2, py = (y) => H - pad - (y - miny) * sc - ((H - 2 * pad) - (maxy - miny) * sc) / 2;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart plano">`;
  let i0 = 0;
  tramos.forEach((t) => { const pts = t.p.map((_, k) => `${px(xs[i0 + k]).toFixed(1)},${py(ys[i0 + k]).toFixed(1)}`).join(" "); s += `<polyline points="${pts}" fill="none" stroke="${t.c}" stroke-width="2"/>`; i0 += t.p.length - 1; });
  const bar = [5, 10, 20, 50, 100].find((b) => b * sc > 50) || 100;
  s += `<circle cx="${px(xs[0])}" cy="${py(ys[0])}" r="5" fill="#2e9e6b"/><circle cx="${px(xs.at(-1))}" cy="${py(ys.at(-1))}" r="5" fill="#142B4C"/>
    <line x1="${W - pad - bar * sc}" x2="${W - pad}" y1="${H - 8}" y2="${H - 8}" stroke="currentColor" stroke-width="2"/><text x="${W - pad - bar * sc / 2}" y="${H - 12}" class="ax" text-anchor="middle">${bar} m</text>
    <polyline id="pl-trail" points="" fill="none" stroke="#eb6834" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle id="pl-mk" r="7" fill="#eb6834" stroke="#fff" stroke-width="2.5" opacity="0"/></svg>`;
  el.innerHTML = s;
  const plano = $("svg", el);
  if (m.t && onPositionClick) plano.addEventListener("click", ev => {
    const pt = plano.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const loc = pt.matrixTransform(plano.getScreenCTM().inverse());
    let best = -1, dist = Infinity;
    for (let i = 0; i < m.t.length; i++) {
      if (!Number.isFinite(m.t[i])) continue;
      const d = (px(xs[i])-loc.x)**2 + (py(ys[i])-loc.y)**2;
      if (d < dist) { dist = d; best = i; }
    }
    if (best >= 0 && dist <= 625) { onPositionClick(m.t[best]); S.mapHover && S.mapHover(m.t[best]); }
  });
  const mk = $("#pl-mk", el), tr = $("#pl-trail", el);
  S.mapHover = (t) => {
    if (t === null || t === undefined || !m.t) { mk.setAttribute("opacity", 0); tr.setAttribute("points", ""); return; }
    const k = idxMapa(m, t);
    if (k < 0) return;
    mk.setAttribute("cx", px(xs[k])); mk.setAttribute("cy", py(ys[k])); mk.setAttribute("opacity", 1);
    let j = k; const est = +store.get("mapEstela", 30);
    while (est && j > 0 && t - m.t[j - 1] <= est) j--;
    tr.setAttribute("points", est ? xs.slice(j, k + 1).map((x, q) => `${px(x).toFixed(1)},${py(ys[j + q]).toFixed(1)}`).join(" ") : "");
  };
}
/* muestra del recorrido más próxima al instante t (búsqueda binaria; el mapa va a 2 puntos/s) */
function idxMapa(m, t) {
  const n = m.t.length; if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (m.t[mid] < t) lo = mid + 1; else hi = mid; }
  return lo > 0 && Math.abs(m.t[lo - 1] - t) <= Math.abs(m.t[lo] - t) ? lo - 1 : lo;
}
/* últimos segundos del recorrido hasta la muestra k (estela del jugador) */
function puntosEstela(m, k, t) {
  const est = +store.get("mapEstela", 30);
  if (!est) return [];
  let j = k;
  while (j > 0 && t - m.t[j - 1] <= est) j--;
  const out = [];
  for (let q = j; q <= k; q++) if (Number.isFinite(m.lat[q]) && Number.isFinite(m.lon[q])) out.push([m.lat[q], m.lon[q]]);
  return out;
}

/* ---------------------------------------------------------------------- pestañas de detalle */
function detalle(el, A, k) {
  const r = A.resumen, tables = {};
  if (k === "min") {
    const mm = A.tablas.minutos || [];
    if (!mm.length) { el.innerHTML = empty(I.stats, "Sin datos"); return; }
    const cols = [["minuto", "Min", 0], ["distancia_m", "Distancia (m)", 0], ["hsr_m", "HSR (m)", 0], ["v_max_kmh", "V. máx. (km/h)", 1], ["acel", "Acel.", 0], ["decel", "Decel.", 0], ["player_load", "Player Load", 1], ["fc_media", "FC media", 0]].filter(([c]) => mm[0][c] !== undefined);
    tables.min = { cols: cols.map((c) => c[1]), rows: mm.map((f) => cols.map(([c]) => f[c])) };
    el.innerHTML = `<div class="row mb"><span class="muted">Barras: distancia (azul claro) y alta velocidad (naranja) de cada minuto del tiempo analizado.</span><span class="grow"></span>${tableTools("min")}</div>
      <div id="mm-ch"></div><div class="tablewrap mt" style="max-height:320px"><table class="data compact"><thead><tr>${cols.map((c) => `<th class="n">${c[1]}</th>`).join("")}</tr></thead><tbody>
      ${mm.map((f) => `<tr>${cols.map(([c, , d]) => `<td class="n">${fnum(f[c], d)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const ch = $("#mm-ch", el);
    if (mm[0].distancia_m !== undefined) ch.innerHTML = Charts.columns(mm.map((f) => String(f.minuto)), [{ name: "Distancia < HSR (m)", values: mm.map((f) => Math.max(0, (f.distancia_m || 0) - (f.hsr_m || 0))), color: "#9cc3ee" }, { name: "HSR (m)", values: mm.map((f) => f.hsr_m || 0), color: "#eb6834" }], { width: width(ch), height: 220 });
    if (mm[0].fc_media !== undefined) ch.innerHTML += Charts.lines(mm.map((f) => String(f.minuto)), [{ name: "FC media (lpm)", values: mm.map((f) => f.fc_media), color: "#d64545" }], { width: width(ch), height: 170 });
  } else if (k === "wcs") {
    const w = A.wcs || [];
    tables.wcs = { cols: ["Ventana (min)", "Distancia (m)", "m/min", "Inicio", "HSR (m)", "Inicio HSR", "Player Load", "Inicio PL"], rows: w.map((x) => [x.ventana_min, x.distancia, x.distancia_min, fmin(x.distancia_inicio_s), x.hsr, fmin(x.hsr_inicio_s), x.player_load, fmin(x.player_load_inicio_s)]) };
    el.innerHTML = w.length ? `<p class="muted">Escenario más exigente (worst-case scenario): el periodo de 1, 3 y 5 min con más distancia, HSR o Player Load (ventana móvil, resolución 1 s). Compárelo con la media de la sesión (${fvar("m_min", r.m_min)} m/min).</p>
      <div class="row mb"><span class="grow"></span>${tableTools("wcs")}</div>
      <table class="data"><thead><tr><th>Ventana</th><th class="n">Distancia (m)</th><th class="n">m/min</th><th class="n">× media</th><th>Inicio</th><th class="n">HSR (m)</th><th>Inicio</th><th class="n">Player Load</th><th>Inicio</th></tr></thead><tbody>
      ${w.map((x) => `<tr><td><b>${fnum(x.ventana_min)} min</b></td><td class="n">${fnum(x.distancia)}</td><td class="n">${fnum(x.distancia_min, 1)}</td><td class="n">${r.m_min ? fnum(x.distancia_min / r.m_min, 1) : "—"}</td><td>${fmin(x.distancia_inicio_s)}</td><td class="n">${fnum(x.hsr)}</td><td>${fmin(x.hsr_inicio_s)}</td><td class="n">${fnum(x.player_load, 1)}</td><td>${fmin(x.player_load_inicio_s)}</td></tr>`).join("")}</tbody></table>` : empty(I.stats, "Sesión demasiado corta");
  } else if (k === "ev") {
    const ev = A.eventos || [];
    const cnt = (t) => ev.filter((e) => e.tipo === t).length;
    tables.ev = { cols: ["Tipo", "Inicio (s)", "Duración (s)", "Pico", "V. inicial (km/h)", "V. final (km/h)", "Distancia (m)"], rows: ev.map((e) => [e.tipo, e.inicio_s, e.duracion_s, e.v_max_kmh ?? e.pico, e.v_ini_kmh, e.v_fin_kmh, e.distancia_m]) };
    el.innerHTML = `<div class="row mb"><span class="badge info">${cnt("Sprint")} sprints</span><span class="badge sig">${cnt("Aceleración")} aceleraciones</span><span class="badge error">${cnt("Deceleración")} deceleraciones</span><span class="grow"></span>${tableTools("ev")}</div>
      ${ev.length ? `<div class="tablewrap" style="max-height:380px"><table class="data compact"><thead><tr><th>Tipo</th><th>Inicio</th><th class="n">Duración (s)</th><th class="n">Pico</th><th class="n">Velocidad</th><th class="n">Distancia (m)</th></tr></thead><tbody>
      ${ev.map((e) => `<tr><td>${esc(e.tipo)}</td><td>${fmin(e.inicio_s)}</td><td class="n">${fnum(e.duracion_s, 1)}</td><td class="n">${e.tipo === "Sprint" ? `${fnum(e.v_max_kmh, 1)} km/h` : `${fnum(e.pico, 2)} m/s²`}</td><td class="n">${e.tipo === "Sprint" ? "" : `${fnum(e.v_ini_kmh, 1)} → ${fnum(e.v_fin_kmh, 1)} km/h`}</td><td class="n">${fnum(e.distancia_m)}</td></tr>`).join("")}</tbody></table></div>` : empty(I.bolt, "Sin esfuerzos por encima de los umbrales")}`;
  } else if (k === "partes") {
    const sg = A.segmentos || [];
    const ks = ["duracion_min", "distancia_m", "m_min", "v_max_kmh", "hsr_m", "n_acel", "n_decel", "player_load", "pl_min", "fc_media", "pct_fcmax_media"];
    tables.partes = { cols: ["Parte", "Desde", "Hasta", ...ks.map(vlabel)], rows: sg.map((g) => [g.nombre, fmin(g.desde), fmin(g.hasta), ...ks.map((c) => g[c])]) };
    el.innerHTML = sg.length ? `<div class="row mb"><span class="grow"></span>${tableTools("partes")}</div><div class="tablewrap"><table class="data"><thead><tr><th>Parte</th><th>Tiempo</th>${ks.map((c) => `<th class="n">${esc(vlabel(c))}</th>`).join("")}</tr></thead><tbody>
      ${sg.map((g, i) => `<tr><td><i class="dotc" style="background:${SEGCOL[i % SEGCOL.length]}"></i><b>${esc(g.nombre)}</b></td><td class="nowrap">${fmin(g.desde)}–${fmin(g.hasta)}</td>${ks.map((c) => `<td class="n">${fvar(c, g[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div id="pt-ch" class="mt"></div>` : empty(I.list, "Sin partes definidas", "<p>Defínalas en la línea de tiempo (arrastrando) o con «Dividir en…».</p>");
    if (sg.length > 1) { const ch = $("#pt-ch", el); ch.innerHTML = Charts.columns(sg.map((g) => g.nombre), [{ name: "m/min", values: sg.map((g) => g.m_min || 0), color: "#2a78d6" }], { width: width(ch), height: 200 }); }
  } else if (k === "vars") {
    const grupos = {};
    VARS().forEach((x) => { if (r[x.clave] !== null && r[x.clave] !== undefined) (grupos[x.grupo] = grupos[x.grupo] || []).push(x); });
    tables.vars = { cols: ["Grupo", "Variable", "Unidad", "Valor"], rows: Object.entries(grupos).flatMap(([g, xs]) => xs.map((x) => [g, x.nombre, x.unidad, r[x.clave]])) };
    el.innerHTML = `<div class="row mb"><span class="muted">FCmáx de referencia: ${fnum(r.fcmax_ref)} lpm (${esc(r.fcmax_fuente || "—")}).</span><span class="grow"></span>${tableTools("vars")}</div><div class="cols-3">${Object.entries(grupos).map(([g, xs]) => `<div><h4 class="h4">${esc(g)}</h4><table class="data compact"><tbody>${xs.map((x) => `<tr><td>${esc(x.nombre)}</td><td class="n"><b>${fvar(x.clave, r[x.clave])}</b> <span class="muted">${esc(x.unidad === "n" ? "" : x.unidad)}</span></td></tr>`).join("")}</tbody></table></div>`).join("")}</div>`;
  } else if (k === "cal") {
    const q = A.calidad, g = q.gps, a = q.acc, h = q.hr, cfg = S.st.cfg;
    const fila = (lab, val, ok) => `<tr><td>${lab}</td><td class="n">${val}</td><td>${ok === undefined ? "" : ok ? `<span class="badge sig">${I.check}correcto</span>` : `<span class="badge aviso">${I.alert}revisar</span>`}</td></tr>`;
    el.innerHTML = `<div class="cols-3">
      <div><h4 class="h4">GPS</h4>${g ? `<table class="data compact"><tbody>${fila("Frecuencia", `${fnum(g.hz)} Hz`, g.hz >= 9)}${fila("Muestras válidas", `${fnum(g.validas_pct, 1)} %`, g.validas_pct >= 95)}${fila("Satélites (media; mín.)", `${fnum(g.sat_media, 1)}; ${fnum(g.sat_min)}`, g.sat_media >= 8)}
        ${fila(`Muestras con &lt; ${cfg.sat_min} satélites`, `${fnum(g.pct_sat_bajo, 1)} %`, g.pct_sat_bajo < 5)}${fila("PDOP (media; P95)", `${fnum(g.pdop_medio, 2)}; ${fnum(g.pdop_p95, 2)}`, g.pdop_medio < 2.5)}${fila(`PDOP &gt; ${cfg.pdop_max}`, `${fnum(g.pct_pdop_alto, 1)} %`, g.pct_pdop_alto < 5)}
        ${fila("Huecos &gt; 0,5 s / &gt; 2 s", `${g.huecos_05s} / ${g.huecos_2s}`, g.huecos_2s === 0)}${fila("Hueco máximo", `${fnum(g.hueco_max_s, 1)} s`)}${fila("Velocidades imposibles", g.artefactos_v, g.artefactos_v === 0)}</tbody></table>
        <p class="muted small">Distancia: ∫ velocidad ${fnum(r.distancia_vel_m)} m · canal DIST ${fnum(r.distancia_disp_m)} m · posiciones ${fnum(g.dist_haversine)} m. Se usa: <b>${cfg.fuente_distancia === "velocidad" ? "velocidad Doppler" : "canal DIST"}</b> (Ajustes).</p>` : empty(I.map, "Sin GPS")}</div>
      <div><h4 class="h4">Acelerómetro</h4>${a ? `<table class="data compact"><tbody>${fila("Frecuencia", `${fnum(a.hz)} Hz`, a.hz >= 99)}${fila("Huecos &gt; 0,1 s", a.huecos_01s, a.huecos_01s === 0)}${fila("Muestras saturadas", a.saturadas, a.saturadas === 0)}${fila("Mediana de |a|", `${fnum(a.mod_mediana, 3)} g`, Math.abs(a.mod_mediana - 1) < .1)}</tbody></table>` : empty(I.pulse, "Sin acelerómetro")}</div>
      <div><h4 class="h4">Pulsómetro</h4>${h ? `<table class="data compact"><tbody>${fila("Cobertura", `${fnum(h.cobertura_pct, 1)} %`, h.cobertura_pct >= 90)}${fila("Huecos &gt; 5 s", h.huecos_5s, h.huecos_5s < 5)}${fila("Hueco máximo", `${fnum(h.hueco_max_s)} s`)}${fila("Valores descartados", h.descartadas, h.descartadas < 10)}</tbody></table>
        <p class="muted small">Las pérdidas suelen deberse a la banda (contacto, humedad) o a la distancia al dispositivo.</p>` : empty(I.heart, "Sin pulsómetro")}</div></div>`;
  } else if (k === "can") {
    const m = A.meta;
    tables.can = { cols: ["Sensor", "Paquete", "Magnitud", "Unidad", "Canales", "Muestras", "Hz"], rows: A.inventario.map((i) => [i.sensor, i.paquete, i.magnitud, i.unidad, i.canales, i.muestras, i.hz]) };
    el.innerHTML = `<div class="cols-2"><div><table class="data compact"><tbody>
      ${[["Archivo", A.sesion.ruta], ["Formato", m.formato], ["Tamaño", `${fnum(m.tamano_mb, 1)} MB`], ["Dispositivo", `${m.dispositivo || "—"} (ID ${m.id || "—"})`], ["MAC", m.mac || "—"], ["Firmware", m.firmware || "—"],
         ["Jugador en el archivo", `${m.jugador || "—"} · dorsal ${m.dorsal || "—"}`], ["Inicio", ffecha(m.inicio)], ["Fin", ffecha(m.fin)], ["Zona horaria", `${m.zona || ""} ${m.desfase || ""}`],
         ["Paquetes leídos", fint(m.paquetes)], ["Sincronizaciones horarias", fint(m.sincronizaciones)], ["Bytes no reconocidos", m.resincronizaciones ?? "—"]].map(([a, b]) => `<tr><td>${a}</td><td><b>${esc(b)}</b></td></tr>`).join("")}</tbody></table></div>
      <div><div class="row mb"><span class="grow"></span>${tableTools("can")}</div><table class="data compact"><thead><tr><th>Sensor</th><th>Canales</th><th class="n">Muestras</th><th class="n">Hz</th></tr></thead><tbody>
      ${A.inventario.map((i) => `<tr><td><b>${esc(i.sensor)}</b><br><span class="muted small">${esc(i.magnitud || "")} · ${esc(i.paquete)}</span></td><td class="small">${esc(i.canales)}</td><td class="n">${fint(i.muestras)}</td><td class="n">${fnum(i.hz, 1)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  wireTableTools(el, tables);
}
