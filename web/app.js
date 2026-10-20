/* WIMU Lab — interfaz (núcleo, inicio, sesiones y jugadores) */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("wimu." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("wimu." + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  home: P('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  list: P('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  pulse: P('<path d="M3 12h4l2-6 4 12 2-6h6"/>'),
  users: P('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.6.2 4.3 1.9 5 4.9"/>'),
  person: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.3 4-6.5 8-6.5s7 2.2 8 6.5"/>'),
  stats: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  compare: P('<path d="M7 4v16M17 4v16M3 8h8M13 16h8"/>'),
  scatter: P('<circle cx="7" cy="16" r="1.5"/><circle cx="11" cy="11" r="1.5"/><circle cx="16" cy="13" r="1.5"/><circle cx="18" cy="6" r="1.5"/><path d="M3 3v18h18"/>'),
  target: P('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
  doc: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  gear: P('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  sync: P('<path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'),
  folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  upload: P('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  download: P('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  trash: P('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  alert: P('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.1"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>'),
  help: P('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17v.1"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  monitor: P('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  exit: P('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>'),
  word: P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 8 2 8 3-6 3 6 2-8"/>'),
  pdf: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 16v-4h1.5a1.2 1.2 0 0 1 0 2.4H8.5"/>'),
  excel: P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 8 8 8M16 8l-8 8"/>'),
  back: P('<path d="M15 18l-6-6 6-6"/>'),
  map: P('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  heart: P('<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>'),
  bolt: P('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  speed: P('<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-6"/>'),
  scissors: P('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/>'),
  eye: P('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  keyboard: P('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
};
const S = { st: null, view: "inicio", opts: {}, busy: 0, ses: null, jug: null, sel: new Set() };
const D = () => (S.st?.cfg?.decimal || ",");
const fnum = (x, d = 0) => x === null || x === undefined || Number.isNaN(+x) || x === "" ? "—" : Number(x).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: Math.abs(x) >= 10000 }).replace(",", D() === "," ? "," : ".");
const fint = (x) => x === null || x === undefined ? "—" : Number(x).toLocaleString("es-ES");
const VARS = () => S.st?.variables || [];
const VAR = (k) => VARS().find((v) => v.clave === k) || { clave: k, nombre: k, unidad: "", dec: 1 };
const fvar = (k, x) => fnum(x, VAR(k).dec);
const vlabel = (k) => { const v = VAR(k); return v.unidad && v.unidad !== "n" ? `${v.nombre} (${v.unidad})` : v.nombre; };
const fmin = (s) => { if (s === null || s === undefined) return "—"; s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const ffecha = (iso, hora = true) => { if (!iso) return "—"; const d = new Date(iso); if (isNaN(d)) return iso; return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) + (hora ? " " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""); };
const parseNum = (s) => { if (s === null || s === undefined || String(s).trim() === "") return null; const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : null; };
const parseMin = (s) => { s = String(s ?? "").trim(); if (!s) return null; const m = s.match(/^(\d+):(\d{1,2})$/); if (m) return +m[1] * 60 + +m[2]; const v = parseNum(s); return v === null ? null : v * 60; };

async function api(path, body, raw) {
  setBusy(1);
  try {
    const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: raw ? {} : { "Content-Type": "application/json" }, body: raw ? body : JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || (j && j.error)) throw new Error(j.error || `Error ${r.status}`);
    return j;
  } finally { setBusy(-1); }
}
function setBusy(d) {
  S.busy = Math.max(0, S.busy + d);
  $("#st-state").innerHTML = S.busy ? '<i class="dot busy"></i>Calculando…' : '<i class="dot"></i>Preparado';
}
function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.innerHTML = (err ? I.alert : I.check) + `<div>${msg}</div>`;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), err ? 8000 : 3800);
}
function modal(title, html, wide) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-bg"><div class="modal" style="${wide ? `width:min(${wide === true ? 1000 : wide}px,calc(100vw - 32px))` : ""}">
    <div class="card-head"><h3>${title}</h3><div class="tools"><button class="btn ghost" data-close>Cerrar (Esc)</button></div></div>
    <div class="card-body">${html}</div></div></div>`;
  const bg = $(".modal-bg", root);
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) closeModal(); });
  $("[data-close]", root).onclick = closeModal;
  return $(".modal", root);
}
const closeModal = () => ($("#modal-root").innerHTML = "");
const loading = (el, m = "Cargando…") => (el.innerHTML = `<div class="loading"><div class="spinner"></div>${m}</div>`);
const empty = (ic, t, x = "") => `<div class="empty">${ic}<b>${t}</b>${x}</div>`;
const head = (t, d, a = "") => `<div class="page-head"><div><h1>${t}</h1>${d ? `<p>${d}</p>` : ""}</div><div class="actions">${a}</div></div>`;
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const width = (el) => Math.max(360, (el?.clientWidth || 700) - 32);
function seg(name, opts, val) {
  return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(v) === String(val) ? "on" : ""}">${l}</button>`).join("")}</div>`;
}
function wireSeg(root, cb) {
  $$("[data-seg]", root).forEach((s) => $$("button", s).forEach((b) => (b.onclick = () => { $$("button", s).forEach((x) => x.classList.toggle("on", x === b)); cb(s.dataset.seg, b.dataset.v); })));
}
const segVal = (root, n) => $(`[data-seg="${n}"] .on`, root)?.dataset.v;
function downloadCSV(name, cols, rows) {
  const cell = (c) => c === null || c === undefined ? "" : typeof c === "number" ? String(c).replace(".", D()) : `"${String(c).replace(/"/g, '""')}"`;
  const txt = "﻿" + [cols.map(cell).join(";"), ...rows.map((r) => r.map(cell).join(";"))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copyTable(cols, rows) {
  const html = `<table style="border-collapse:collapse;font-family:Calibri,Arial;font-size:10pt"><tr>${cols.map((c) => `<th style="border-top:1.5pt solid #000;border-bottom:1pt solid #000;padding:3pt 6pt">${esc(c)}</th>`).join("")}</tr>${rows.map((r, i) => `<tr>${r.map((c, j) => `<td style="padding:2pt 6pt;text-align:${j < 1 ? "left" : "right"};${i === rows.length - 1 ? "border-bottom:1.5pt solid #000" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
  const tsv = [cols, ...rows].map((r) => r.join("\t")).join("\n");
  try { await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([tsv], { type: "text/plain" }) })]); }
  catch { await navigator.clipboard.writeText(tsv); }
  toast("Tabla copiada: péguela en Word o Excel");
}
const tableTools = (id) => `<button class="btn ghost" data-copy="${id}" title="Copiar para Word/Excel">${I.doc}Copiar</button><button class="btn ghost" data-csv="${id}" title="Descargar CSV">${I.download}CSV</button>`;
function wireTableTools(root, tables) {
  $$("[data-copy]", root).forEach((b) => (b.onclick = () => { const t = tables[b.dataset.copy]; copyTable(t.cols, t.rows); }));
  $$("[data-csv]", root).forEach((b) => (b.onclick = () => { const t = tables[b.dataset.csv]; downloadCSV(`${b.dataset.csv}.csv`, t.cols, t.rows); }));
}

/* ====================================================================== tema */
function applyTheme(t) {
  if (t === "claro") document.documentElement.dataset.theme = "light";
  else if (t === "oscuro") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  store.set("tema", t);
  const dark = t === "oscuro" || (t === "sistema" && matchMedia("(prefers-color-scheme: dark)").matches);
  $("#theme-btn").innerHTML = dark ? I.sun : I.moon;
  if (S.st) go(S.view, S.opts, true);
}
const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
const toggleTheme = () => applyTheme(isDark() ? "claro" : "oscuro");

/* ====================================================================== menús y pestañas */
const MENUS = [
  { label: "Archivo", items: [
    { icon: I.sync, label: "Buscar archivos nuevos y calcular", kbd: "F5", run: () => actualizar() },
    { icon: I.sync, label: "Recalcular todas las sesiones", run: () => actualizar(true) },
    "-",
    { icon: I.folder, label: "Abrir carpeta de datos (.qul)", run: () => api("/api/abrir_datos", {}).catch((e) => toast(e.message, true)) },
    { icon: I.folder, label: "Abrir carpeta de resultados", run: () => api("/api/abrir", {}).catch((e) => toast(e.message, true)) },
    "-",
    { icon: I.gear, label: "Ajustes", kbd: "Ctrl+,", run: () => go("ajustes") },
    "-",
    { icon: I.exit, label: "Salir", run: quit },
  ] },
  { label: "Sesiones", items: [
    { icon: I.list, label: "Todas las sesiones", kbd: "Ctrl+1", run: () => go("sesiones") },
    { icon: I.users, label: "Jugadores", kbd: "Ctrl+2", run: () => go("jugadores") },
    { icon: I.plus, label: "Nuevo jugador…", run: () => editJugador() },
  ] },
  { label: "Análisis", items: [
    { icon: I.stats, label: "Descriptivo", kbd: "Ctrl+3", run: () => go("analisis", { sub: "descriptivo" }) },
    { icon: I.compare, label: "Comparaciones e inferencia", kbd: "Ctrl+4", run: () => go("analisis", { sub: "comparar" }) },
    { icon: I.scatter, label: "Correlación y variabilidad", kbd: "Ctrl+5", run: () => go("analisis", { sub: "correlacion" }) },
    "-",
    { icon: I.target, label: "Concordancia con SPRO", kbd: "Ctrl+6", run: () => go("spro") },
  ] },
  { label: "Informes", items: [
    { icon: I.word, label: "Informe individual de sesión", run: () => go("informes", { tipo: "sesion" }) },
    { icon: I.doc, label: "Informe técnico de sesión", run: () => go("informes", { tipo: "tecnico" }) },
    { icon: I.person, label: "Evolución de un jugador", run: () => go("informes", { tipo: "jugador" }) },
    { icon: I.users, label: "Informe colectivo", run: () => go("informes", { tipo: "colectivo" }) },
    { icon: I.stats, label: "Informe estadístico (técnico colectivo)", run: () => go("informes", { tipo: "estadistico" }) },
    "-",
    { icon: I.folder, label: "Abrir carpeta de resultados", run: () => api("/api/abrir", {}).catch((e) => toast(e.message, true)) },
  ] },
  { label: "Ver", items: [
    { icon: I.sun, label: "Tema claro", run: () => applyTheme("claro") },
    { icon: I.moon, label: "Tema oscuro", run: () => applyTheme("oscuro") },
    { icon: I.monitor, label: "Según el sistema", run: () => applyTheme("sistema") },
    "-",
    { icon: I.stats, label: "Decimales con coma", run: () => saveCfg({ decimal: "," }) },
    { icon: I.stats, label: "Decimales con punto", run: () => saveCfg({ decimal: "." }) },
  ] },
  { label: "Ayuda", items: [
    { icon: I.help, label: "Guía rápida", kbd: "F1", run: guide },
    { icon: I.stats, label: "Definición de las variables", run: glossary },
    { icon: I.keyboard, label: "Atajos de teclado", run: shortcuts },
    "-",
    { icon: I.info, label: "Acerca de WIMU Lab", run: about },
  ] },
];
function buildMenus() {
  const bar = $("#menubar");
  bar.innerHTML = "";
  MENUS.forEach((m) => {
    const el = document.createElement("div");
    el.className = "menu";
    el.innerHTML = `<button>${m.label}</button><div class="dropdown"></div>`;
    const dd = $(".dropdown", el);
    m.items.forEach((it) => {
      if (it === "-") return dd.insertAdjacentHTML("beforeend", "<hr>");
      const b = document.createElement("button");
      b.innerHTML = `${it.icon}<span>${it.label}</span><kbd>${it.kbd || ""}</kbd>`;
      b.onclick = () => { closeMenus(); it.run(); };
      dd.append(b);
    });
    const btn = $("button", el);
    btn.onclick = (e) => { e.stopPropagation(); const o = el.classList.contains("open"); closeMenus(); if (!o) el.classList.add("open"); };
    btn.onmouseenter = () => { if ($(".menu.open") && !el.classList.contains("open")) { closeMenus(); el.classList.add("open"); } };
    bar.append(el);
  });
}
const closeMenus = () => $$(".menu.open").forEach((m) => m.classList.remove("open"));
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) closeMenus(); });
const TABS = [["inicio", "Inicio", I.home], ["sesiones", "Sesiones", I.list], ["jugadores", "Jugadores", I.users], "|",
  ["analisis", "Análisis", I.stats], ["spro", "Concordancia SPRO", I.target], ["comparador", "Comparar dispositivos", I.compare], "|", ["informes", "Informes", I.doc], ["ajustes", "Ajustes", I.gear], ["autores", "Autores", I.person]];
function buildTabs() {
  const n = S.st?.sin_asignar || 0;
  $("#tabs").innerHTML = TABS.map((t) => t === "|" ? '<span class="tab-sep"></span>' :
    `<button class="tab ${S.view === t[0] || (S.view === "sesion" && t[0] === "sesiones") ? "active" : ""}" data-v="${t[0]}">${t[2]}${t[1]}${t[0] === "sesiones" && n ? ` <span class="tabbadge" title="Sesiones sin jugador asignado">${n}</span>` : ""}</button>`).join("");
  $$("#tabs .tab").forEach((b) => (b.onclick = () => go(b.dataset.v)));
}
function go(view, opts = {}, keepScroll) {
  if (view !== S.view || !keepScroll) $("#view").scrollTop = 0;
  if (S.cleanup) { try { S.cleanup(); } catch { /* */ } S.cleanup = null; }
  S.view = view; S.opts = opts;
  if (view !== "sesion") store.set("vista", view);
  buildTabs();
  Promise.resolve((V[view] || V.inicio)($("#view"), opts)).catch((e) => { $("#view").innerHTML = `<div class="card">${empty(I.alert, "No se pudo mostrar esta vista", `<p>${esc(e.message)}</p>`)}</div>`; });
}

/* ====================================================================== estado global y tareas */
async function refresh() {
  S.st = await api("/api/estado");
  Charts.setDec(D());
  $("#st-datos").textContent = `${S.st.n_sesiones} sesiones · ${S.st.n_jugadores} jugadores · datos en ${S.st.cfg.carpeta_datos}`;
  $("#st-version").textContent = "v" + S.st.version;
  const j = S.st.job;
  $("#job-chip").hidden = !j.activo;
  if (j.activo) $("#job-chip").innerHTML = `${I.sync}${esc(j.tipo)}: ${Math.round(100 * j.fraccion)} %`;
  buildTabs();
  return S.st;
}
async function cargarSesiones(force) {
  if (!S.ses || force) {
    const d = await api("/api/sesiones");
    S.ses = d.sesiones; S.jug = d.jugadores; S.tipos = d.tipos;
  }
  return S.ses;
}
let jobTimer = null;
function esperarTarea(onDone) {
  clearTimeout(jobTimer);
  jobTimer = setTimeout(async () => {
    let j;
    try { j = await api("/api/progreso"); } catch { j = { activo: true }; }
    const box = $("#job-box");
    if (box) box.innerHTML = progressHtml(j);
    $("#job-chip").hidden = !j.activo;
    if (j.activo) { $("#job-chip").innerHTML = `${I.sync}${esc(j.tipo)}: ${Math.round(100 * j.fraccion)} %`; esperarTarea(onDone); return; }
    await refresh().catch(() => {});
    if (j.error) toast(`${esc(j.tipo)}: ${esc(j.error)}`, true);
    onDone && onDone(j);
  }, 700);
}
const progressHtml = (j) => j.activo ? `<div class="jobline"><div class="spinner"></div><div class="grow"><b>${esc(j.mensaje || "Trabajando…")}</b><div class="progress"><div style="width:${Math.round(100 * (j.fraccion || 0))}%"></div></div></div></div>` : "";
async function actualizar(forzar = false) {
  try {
    await api("/api/actualizar", { forzar });
    toast(forzar ? "Recalculando todas las sesiones…" : "Buscando archivos nuevos…");
    const host = $("#job-box") || (() => { const d = document.createElement("div"); d.id = "job-box"; $("#view").prepend(d); return d; })();
    host.innerHTML = progressHtml({ activo: true, mensaje: "Iniciando…", fraccion: 0 });
    esperarTarea(async (j) => {
      if (j.resultado) {
        const r = j.resultado;
        toast(`${r.nuevos} archivos nuevos · ${r.calculadas} sesiones calculadas${r.errores?.length ? ` · ${r.errores.length} con error` : ""}`, !!r.errores?.length);
      }
      await cargarSesiones(true);
      go(S.view, S.opts, true);
    });
  } catch (e) { toast(e.message, true); }
}
async function saveCfg(patch) {
  try { await api("/api/ajustes", patch); await refresh(); S.ses = null; toast("Ajustes guardados"); go(S.view, S.opts, true); }
  catch (e) { toast(e.message, true); }
}
async function quit() {
  if (!confirm("¿Cerrar WIMU Lab?")) return;
  try { await api("/api/salir", {}); } catch { /* cerrado */ }
  window.close();
  document.body.innerHTML = '<div class="empty" style="margin:auto"><b>WIMU Lab se ha cerrado.</b>Puede cerrar esta ventana con Alt + F4.</div>';
}
const jugOptions = (sel, vacio = "— Sin asignar —") => `<option value="">${vacio}</option>` + (S.jug || []).map((j) => `<option value="${j.id}" ${j.id === sel ? "selected" : ""}>${esc(j.nombre)}${j.dorsal ? ` (${esc(j.dorsal)})` : ""}</option>`).join("");
const tipoOptions = (sel) => (S.tipos || S.st?.tipos || []).map((t) => `<option ${t === sel ? "selected" : ""}>${esc(t)}</option>`).join("");

/* ====================================================================== VISTAS */
const V = {};

/* ---------- INICIO */
V.inicio = async (v) => {
  loading(v);
  const ses = await cargarSesiones(true);
  const st = S.st;
  const act = ses.filter((s) => !s.falta);
  if (!act.length) {
    v.innerHTML = `<div id="job-box"></div>
    <section class="hero">${heroDeco()}<h1>Bienvenido a WIMU Lab</h1>
      <p>Lee directamente los archivos de los dispositivos WIMU PRO (.qul y .qui) y analiza la carga externa (GPS y acelerómetro) e interna (frecuencia cardiaca).</p>
      <div class="hero-actions"><button class="btn primary" id="h-upd">${I.sync}Buscar archivos</button><button class="btn" id="h-dat">${I.folder}Abrir carpeta de datos</button><button class="btn" id="h-cfg">${I.gear}Elegir otra carpeta</button></div></section>
    <div class="card"><div class="card-body"><ol class="steps">
      <li>Copie los archivos <b>.qul</b> (o .qui) de los dispositivos en la carpeta de datos:<br><code>${esc(st.cfg.carpeta_datos)}</code> (puede usar subcarpetas por fecha o por equipo).</li>
      <li>Pulse <b>Buscar archivos</b>: cada archivo es una sesión; se leen todos los sensores (GPS 10 Hz, acelerómetro 100 Hz, pulsómetro…).</li>
      <li>Asigne cada sesión a un <b>jugador</b> (el archivo solo guarda el dispositivo) y su tipo: entrenamiento, partido, test…</li>
      <li>Revise cada sesión, recorte el tiempo útil o marque partes, y genere <b>informes</b> en Word, PDF y Excel.</li></ol></div></div>`;
    $("#h-upd").onclick = () => actualizar(); $("#h-dat").onclick = () => api("/api/abrir_datos", {}).catch((e) => toast(e.message, true)); $("#h-cfg").onclick = () => go("ajustes");
    return;
  }
  const fechas = [...new Set(act.map((s) => (s.inicio || "").slice(0, 10)).filter(Boolean))].sort().reverse();
  const ultima = fechas[0];
  const deUltima = act.filter((s) => (s.inicio || "").startsWith(ultima) && s.kpis?.distancia_m !== undefined);
  const media = (k, arr) => { const x = arr.map((s) => s.kpis?.[k]).filter((y) => y !== null && y !== undefined); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };
  const kp = (ic, lab, val, sub) => `<div class="card kpi"><div class="k-label">${ic}${lab}</div><div class="k-value">${val}</div><div class="k-sub">${sub || ""}</div></div>`;
  v.innerHTML = `<div id="job-box"></div>
  <section class="hero">${heroDeco()}
    <p style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase">${esc(st.cfg.institucion || "WIMU PRO")}</p>
    <h1>${esc(st.cfg.titulo || "Carga externa e interna")}</h1>
    <p>${st.n_sesiones} sesiones · ${st.n_jugadores} jugadores · ${fechas.length} días con datos${ultima ? ` · última sesión ${ffecha(ultima, false)}` : ""}</p>
    <div class="hero-actions"><button class="btn primary" id="h-ses">${I.list}Ver sesiones</button><button class="btn" id="h-upd">${I.sync}Buscar archivos nuevos</button>
    <button class="btn" id="h-inf">${I.word}Generar informes</button><button class="btn" id="h-an">${I.stats}Analizar</button></div>
  </section>
  ${st.sin_asignar ? `<div class="notice warn mb">${I.alert}<div><b>${st.sin_asignar === 1 ? "1 sesión" : st.sin_asignar + " sesiones"} sin jugador asignado.</b> El archivo solo identifica el dispositivo (p. ej. WIMU_18). <a href="#" id="h-asig">Asignarlas ahora</a></div></div>` : ""}
  ${st.n_faltan ? `<div class="notice mb">${I.info}<div>${st.n_faltan} sesiones del registro ya no están en la carpeta de datos (se conservan sus datos calculados).</div></div>` : ""}
  ${st.sin_calcular ? `<div class="notice mb">${I.info}<div>${st.sin_calcular} sesiones pendientes de calcular. <a href="#" id="h-calc">Calcular ahora</a></div></div>` : ""}
  <h2 class="sec">Último día · ${ffecha(ultima, false)} <span class="muted">(${deUltima.length} sesiones)</span></h2>
  <div class="kpis">
    ${kp(I.map, "Distancia media", fnum(media("distancia_m", deUltima)), "m por jugador")}
    ${kp(I.speed, "Distancia relativa", fnum(media("m_min", deUltima), 1), "m/min")}
    ${kp(I.bolt, "Alta velocidad", fnum(media("hsr_m", deUltima)), `m ≥ ${fnum(parseNum(st.cfg.umbral_hsr))} km/h`)}
    ${kp(I.pulse, "Player Load", fnum(media("player_load", deUltima), 1), "u.a.")}
    ${kp(I.heart, "FC media", fnum(media("fc_media", deUltima)), "lpm")}
  </div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>${I.map}Distancia por jugador · ${ffecha(ultima, false)}</h3></div><div class="card-body" id="h-ch1"></div></div>
    <div class="card"><div class="card-head"><h3>${I.list}Sesiones recientes</h3><div class="tools"><button class="btn ghost" id="h-todas">Ver todas</button></div></div>
      <div class="card-body flush"><table class="data"><thead><tr><th>Fecha</th><th>Jugador</th><th>Tipo</th><th class="n">Distancia</th><th class="n">FC media</th></tr></thead><tbody>
      ${act.slice(0, 10).map((s) => `<tr class="clk" data-id="${s.id}"><td>${ffecha(s.inicio)}</td><td>${s.jugador ? esc(s.jugador_nombre) : `<span class="muted">${esc(s.etiqueta_jugador)}</span>`}</td><td>${esc(s.tipo)}</td><td class="n">${fvar("distancia_m", s.kpis?.distancia_m)}</td><td class="n">${fvar("fc_media", s.kpis?.fc_media)}</td></tr>`).join("")}
      </tbody></table></div></div>
  </div>`;
  const ch = $("#h-ch1");
  ch.innerHTML = deUltima.length ? Charts.hbar(deUltima.map((s) => ({ label: s.etiqueta_jugador, value: s.kpis.distancia_m || 0, id: s.id, sub: `${s.tipo} ${s.tarea || ""}` })).sort((a, b) => b.value - a.value),
    { width: width(ch), name: "Distancia (m)", labelWidth: 170 }) : empty(I.map, "Sin datos de GPS");
  $$("[data-id]", ch).forEach((g) => (g.onclick = () => go("sesion", { id: g.dataset.id })));
  $$("tr.clk", v).forEach((r) => (r.onclick = () => go("sesion", { id: r.dataset.id })));
  $("#h-ses").onclick = $("#h-todas").onclick = () => go("sesiones");
  $("#h-upd").onclick = () => actualizar();
  $("#h-inf").onclick = () => go("informes");
  $("#h-an").onclick = () => go("analisis");
  if ($("#h-asig")) $("#h-asig").onclick = (e) => { e.preventDefault(); go("sesiones", { soloSinAsignar: true }); };
  if ($("#h-calc")) $("#h-calc").onclick = (e) => { e.preventDefault(); actualizar(); };
  if (st.job.activo) esperarTarea(() => go(S.view, S.opts, true));
};
const heroDeco = () => `<svg class="deco" viewBox="0 0 300 120"><path d="M0 90 L40 60 L70 80 L110 30 L150 70 L190 40 L230 75 L270 20 L300 50" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><circle cx="270" cy="20" r="9" fill="#eb6834"/></svg>`;

/* ---------- SESIONES */
const COLS_SES = [["distancia_m", "Distancia"], ["m_min", "m/min"], ["v_max_kmh", "V. máx."], ["hsr_m", "HSR"], ["n_sprints", "Sprints"], ["n_acel", "Acel."], ["n_decel", "Decel."], ["player_load", "PL"], ["fc_media", "FC med."], ["trimp", "TRIMP"]];
V.sesiones = async (v, o = {}) => {
  loading(v);
  await cargarSesiones(o.reload);
  const f = S.fs = S.fs || { q: "", tipo: "", jugador: o.soloSinAsignar ? "__sin" : "", desde: "", hasta: "", orden: "inicio", dir: -1, ver: "activas" };
  if (o.soloSinAsignar) f.jugador = "__sin";
  v.innerHTML = `<div id="job-box"></div>${head("Sesiones", "Cada archivo .qul/.qui es una sesión. Seleccione varias para asignar jugador, tipo o tarea, o para generar informes.",
    `<button class="btn" id="s-upd">${I.sync}Buscar archivos nuevos</button><button class="btn" id="s-dat">${I.folder}Carpeta de datos</button>`)}
  <div class="card mb"><div class="card-body"><h3>Analizar archivo de otro dispositivo</h3><p class="muted">Importe FIT, GPX, TCX o CSV para analizarlo individualmente, sin compararlo con WIMU. Para añadir la <b>FC de una banda o un reloj a una sesión WIMU</b>, abra la sesión y use «Datos de otros dispositivos».</p><input type="file" id="s-universal-file" accept=".fit,.gpx,.tcx,.csv"> <button class="btn primary" id="s-universal-open">Analizar archivo</button><p class="muted small">Las variables disponibles dependen del dispositivo y de la exportación.</p></div></div>
  <div class="card">
    <div class="toolbar">
      <input type="search" id="s-q" placeholder="Buscar archivo, jugador, tarea…" value="${esc(f.q)}">
      <select id="s-tipo"><option value="">Todos los tipos</option>${tipoOptions(f.tipo)}</select>
      <select id="s-jug"><option value="">Todos los jugadores</option><option value="__sin" ${f.jugador === "__sin" ? "selected" : ""}>— Sin asignar —</option>${(S.jug || []).map((j) => `<option value="${j.id}" ${f.jugador === j.id ? "selected" : ""}>${esc(j.nombre)}</option>`).join("")}</select>
      <label class="muted">Desde <input type="date" id="s-desde" value="${f.desde}"></label><label class="muted">hasta <input type="date" id="s-hasta" value="${f.hasta}"></label>
      <select id="s-ver"><option value="activas" ${f.ver === "activas" ? "selected" : ""}>Incluidas en el análisis</option><option value="todas" ${f.ver === "todas" ? "selected" : ""}>Todas (también excluidas)</option><option value="excluidas" ${f.ver === "excluidas" ? "selected" : ""}>Solo excluidas</option></select>
      <span class="grow"></span><span class="count" id="s-count"></span>
    </div>
    <div class="selbar" id="s-selbar" hidden></div>
    <div class="tablewrap" style="max-height:calc(100vh - 330px)"><table class="data sticky-head" id="s-tab"></table></div>
  </div>`;
  $("#s-universal-open").onclick = async () => {
    const file = $("#s-universal-file").files[0];
    if (!file) return toast("Selecciona un archivo FIT, GPX, TCX o CSV", true);
    if (file.size > 30000000) return toast("Máximo 30 MB", true);
    try {
      const r = await fetch("/api/comparador/cargar?nombre=" + encodeURIComponent(file.name), {method:"POST",body:file});
      const j = await r.json(); if (!r.ok || j.error) throw Error(j.error || "No se pudo importar");
      S.archivoUniversal = {id:j.id,nombre:file.name};
      go("comparador", {analizarUniversal:true});
    } catch(e) {toast(e.message,true)}
  };
  const draw = () => {
    const q = f.q.toLowerCase();
    let rows = S.ses.filter((s) => (f.ver === "todas" || (f.ver === "excluidas" ? s.excluida : !s.excluida))
      && (!f.tipo || s.tipo === f.tipo) && (!f.jugador || (f.jugador === "__sin" ? !s.jugador : s.jugador === f.jugador))
      && (!f.desde || (s.inicio || "") >= f.desde) && (!f.hasta || (s.inicio || "").slice(0, 10) <= f.hasta)
      && (!q || `${s.archivo} ${s.etiqueta_jugador} ${s.tarea} ${s.dispositivo} ${s.carpeta}`.toLowerCase().includes(q)));
    const key = (s) => f.orden === "inicio" ? s.inicio || "" : f.orden === "jugador" ? s.etiqueta_jugador : f.orden === "tipo" ? s.tipo : (s.kpis?.[f.orden] ?? -1e9);
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * f.dir);
    S.vis = rows;
    $("#s-count").textContent = `${rows.length} de ${S.ses.length}`;
    const th = (k, l, n) => `<th class="${n ? "n" : ""} ${f.orden === k ? "on" : ""}" data-o="${k}">${l}${f.orden === k ? (f.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
    $("#s-tab").innerHTML = `<thead><tr><th style="width:30px"><input type="checkbox" id="s-all" title="Seleccionar todas"></th>${th("inicio", "Fecha")}${th("jugador", "Jugador")}${th("tipo", "Tipo")}<th>Tarea</th><th>Archivo</th>${th("duracion_min", "Min", 1)}${COLS_SES.map(([k, l]) => th(k, l, 1)).join("")}<th></th></tr></thead>
    <tbody>${rows.map((s) => `<tr data-id="${s.id}" class="${s.excluida ? "excl" : ""} ${s.falta ? "falta" : ""}">
      <td><input type="checkbox" data-sel="${s.id}" ${S.sel.has(s.id) ? "checked" : ""}></td>
      <td class="nowrap">${ffecha(s.inicio)}</td>
      <td>${s.jugador ? `<b>${esc(s.jugador_nombre)}</b>` : `<span class="badge aviso">${esc(s.dispositivo || "WIMU")} · sin asignar</span>`}</td>
      <td>${esc(s.tipo)}</td><td>${esc(s.tarea || "")}</td>
      <td class="muted small" title="${esc(s.ruta)}">${esc(s.archivo)}</td>
      <td class="n">${fnum(s.kpis?.duracion_min, 0)}</td>
      ${COLS_SES.map(([k]) => `<td class="n">${fvar(k, s.kpis?.[k])}</td>`).join("")}
      <td class="nowrap">${s.error ? `<span class="badge error" title="${esc(s.error)}">error</span>` : s.falta ? '<span class="badge info" title="El archivo ya no está en la carpeta de datos">falta</span>' : !s.actual ? '<span class="badge info" title="Pendiente de recalcular">pendiente</span>' : ""}${s.avisos?.length ? `<span class="badge aviso" title="${esc(s.avisos.join("\n"))}">${I.alert}</span>` : ""}</td></tr>`).join("") || `<tr><td colspan="20">${empty(I.list, "No hay sesiones con estos filtros")}</td></tr>`}</tbody>`;
    $$("#s-tab th[data-o]").forEach((t) => (t.onclick = () => { if (f.orden === t.dataset.o) f.dir *= -1; else { f.orden = t.dataset.o; f.dir = ["inicio", "jugador", "tipo"].includes(t.dataset.o) ? 1 : -1; } draw(); }));
    $$("#s-tab tbody tr[data-id]").forEach((r) => (r.onclick = (e) => { if (e.target.closest("input")) return; go("sesion", { id: r.dataset.id }); }));
    $$("[data-sel]").forEach((c) => (c.onchange = () => { c.checked ? S.sel.add(c.dataset.sel) : S.sel.delete(c.dataset.sel); selbar(); }));
    $("#s-all").checked = rows.length && rows.every((s) => S.sel.has(s.id));
    $("#s-all").onchange = (e) => { rows.forEach((s) => (e.target.checked ? S.sel.add(s.id) : S.sel.delete(s.id))); draw(); selbar(); };
  };
  const selbar = () => {
    const n = S.sel.size, bar = $("#s-selbar");
    bar.hidden = !n;
    if (!n) return;
    bar.innerHTML = `<b>${n} seleccionadas</b>
      <select id="b-jug">${jugOptions("", "Asignar jugador…")}<option value="__nuevo">+ Nuevo jugador…</option></select>
      <select id="b-tipo"><option value="">Cambiar tipo…</option>${tipoOptions("")}</select>
      <button class="btn" id="b-tarea">${I.edit}Tarea…</button>
      <button class="btn" id="b-excl">${I.eye}Excluir / incluir</button>
      <button class="btn" id="b-inf">${I.word}Informes…</button>
      <button class="btn" id="b-an">${I.stats}Analizar</button>
      <span class="grow"></span><button class="btn ghost" id="b-none">Quitar selección</button>`;
    const ids = [...S.sel];
    $("#b-jug").onchange = async (e) => {
      const val = e.target.value;
      if (val === "__nuevo") return editJugador(null, ids);
      if (!val) return;
      await api("/api/sesiones/asignar", { ids, jugador: val }).catch((er) => toast(er.message, true));
      toast(`${ids.length} sesiones asignadas`); await refresh(); await cargarSesiones(true); draw(); selbar();
    };
    $("#b-tipo").onchange = async (e) => { if (!e.target.value) return; await api("/api/sesiones/asignar", { ids, tipo: e.target.value }); toast("Tipo actualizado"); await cargarSesiones(true); draw(); selbar(); };
    $("#b-tarea").onclick = async () => { const t = prompt("Tarea o etiqueta para las sesiones seleccionadas (p. ej. «Rondos», «Partido amistoso»):", ""); if (t === null) return; await api("/api/sesiones/asignar", { ids, tarea: t }); await cargarSesiones(true); draw(); selbar(); };
    $("#b-excl").onclick = async () => { const ex = !S.ses.find((s) => s.id === ids[0])?.excluida; await api("/api/sesiones/excluir", { ids, excluir: ex }); toast(ex ? "Sesiones excluidas del análisis" : "Sesiones incluidas"); await cargarSesiones(true); draw(); selbar(); };
    $("#b-inf").onclick = () => go("informes", { ids });
    $("#b-an").onclick = () => go("analisis", { ids });
    $("#b-none").onclick = () => { S.sel.clear(); draw(); selbar(); };
  };
  const upd = debounce(() => { f.q = $("#s-q").value; draw(); }, 200);
  $("#s-q").oninput = upd;
  $("#s-tipo").onchange = (e) => { f.tipo = e.target.value; draw(); };
  $("#s-jug").onchange = (e) => { f.jugador = e.target.value; draw(); };
  $("#s-desde").onchange = (e) => { f.desde = e.target.value; draw(); };
  $("#s-hasta").onchange = (e) => { f.hasta = e.target.value; draw(); };
  $("#s-ver").onchange = (e) => { f.ver = e.target.value; draw(); };
  $("#s-upd").onclick = () => actualizar();
  $("#s-dat").onclick = () => api("/api/abrir_datos", {}).catch((e) => toast(e.message, true));
  draw(); selbar();
  if (S.st.job.activo) esperarTarea(async () => { await cargarSesiones(true); draw(); });
};

/* ---------- JUGADORES */
V.jugadores = async (v) => {
  loading(v);
  await cargarSesiones(true);
  const js = S.jug;
  const porJ = {};
  S.ses.forEach((s) => { if (s.jugador && !s.excluida) (porJ[s.jugador] = porJ[s.jugador] || []).push(s); });
  const sinAsig = S.ses.filter((s) => !s.jugador && !s.falta);
  const disp = [...new Set(sinAsig.map((s) => s.dispositivo || "WIMU"))];
  v.innerHTML = head("Jugadores", "Datos de cada jugador. La FCmáx se usa para las zonas de frecuencia cardiaca y el TRIMP (si se deja vacía, se usa la de Ajustes o la máxima de cada sesión).",
    `<button class="btn primary" id="j-new">${I.plus}Nuevo jugador</button>`) +
  (sinAsig.length ? `<div class="notice warn mb">${I.alert}<div><b>${sinAsig.length === 1 ? "1 sesión" : sinAsig.length + " sesiones"} sin jugador</b> (dispositivos ${disp.map(esc).join(", ")}).
    <button class="btn" id="j-asig" style="margin-left:8px">Asignar por dispositivo y fecha…</button></div></div>` : "") +
  `<div class="card"><div class="tablewrap"><table class="data"><thead><tr><th>Jugador</th><th>Dorsal</th><th>Posición</th><th>Grupo</th><th class="n">FCmáx</th><th class="n">Sesiones</th>
    <th class="n">Distancia media</th><th class="n">m/min</th><th class="n">HSR medio</th><th class="n">FC media</th><th>Distancia por sesión</th><th></th></tr></thead><tbody>
    ${js.map((j) => {
      const ss = (porJ[j.id] || []).sort((a, b) => (a.inicio > b.inicio ? 1 : -1));
      const m = (k) => { const x = ss.map((s) => s.kpis?.[k]).filter((y) => y !== null && y !== undefined); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };
      return `<tr data-id="${j.id}"><td><b>${esc(j.nombre)}</b></td><td>${esc(j.dorsal)}</td><td>${esc(j.posicion)}</td><td>${esc(j.grupo)}</td><td class="n">${esc(j.fcmax) || '<span class="muted">—</span>'}</td>
        <td class="n">${ss.length}</td><td class="n">${fnum(m("distancia_m"))}</td><td class="n">${fnum(m("m_min"), 1)}</td><td class="n">${fnum(m("hsr_m"))}</td><td class="n">${fnum(m("fc_media"))}</td>
        <td>${Charts.spark(ss.map((s) => s.kpis?.distancia_m || 0), "#2a78d6", 110, 22)}</td>
        <td class="nowrap"><button class="btn ghost" data-ev="${j.id}" title="Evolución">${I.stats}</button><button class="btn ghost" data-ed="${j.id}" title="Editar">${I.edit}</button></td></tr>`;
    }).join("") || `<tr><td colspan="12">${empty(I.users, "Todavía no hay jugadores", "<p>Cree jugadores y asígneles sesiones; si el archivo trae el nombre del jugador se crea solo.</p>")}</td></tr>`}
  </tbody></table></div></div>`;
  $("#j-new").onclick = () => editJugador();
  if ($("#j-asig")) $("#j-asig").onclick = asignarPorDispositivo;
  $$("[data-ed]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); editJugador(js.find((j) => j.id === b.dataset.ed)); }));
  $$("[data-ev]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); evolucionJugador(b.dataset.ev); }));
  $$("tr[data-id]").forEach((r) => (r.onclick = () => evolucionJugador(r.dataset.id)));
};
function editJugador(j, asignar) {
  j = j || {};
  const m = modal(j.id ? `Editar jugador · ${esc(j.nombre)}` : "Nuevo jugador", `<div class="form-grid">
    <div class="field full"><label>Nombre y apellidos</label><input type="text" id="f-nombre" value="${esc(j.nombre || "")}"></div>
    <div class="field"><label>Dorsal</label><input type="text" id="f-dorsal" value="${esc(j.dorsal || "")}"></div>
    <div class="field"><label>Posición</label><input type="text" id="f-posicion" list="dl-pos" value="${esc(j.posicion || "")}"><datalist id="dl-pos">${["Portero", "Defensa central", "Lateral", "Centrocampista", "Mediapunta", "Extremo", "Delantero"].map((p) => `<option>${p}</option>`).join("")}</datalist></div>
    <div class="field"><label>Grupo / equipo</label><input type="text" id="f-grupo" value="${esc(j.grupo || "")}"></div>
    <div class="field"><label>Fecha de nacimiento</label><input type="date" id="f-nacimiento" value="${esc(j.nacimiento || "")}"></div>
    <div class="field"><label>FC máxima (lpm)</label><input type="number" id="f-fcmax" value="${esc(j.fcmax || "")}"><span class="hint">De una prueba máxima; si se deja vacía se usa la máxima de cada sesión.</span></div>
    <div class="field"><label>FC de reposo (lpm)</label><input type="number" id="f-fcrep" value="${esc(j.fcrep || "")}"></div>
    <div class="field"><label>Peso (kg)</label><input type="number" id="f-peso" value="${esc(j.peso || "")}"></div>
    <div class="field full"><label>Notas</label><textarea id="f-notas" rows="2">${esc(j.notas || "")}</textarea></div></div>
    ${asignar ? `<p class="muted">Se asignarán ${asignar.length} sesiones a este jugador.</p>` : ""}
    <div class="row mt"><button class="btn primary" id="f-ok">${I.check}Guardar</button>${j.id ? `<button class="btn ghost" id="f-del">${I.trash}Eliminar jugador</button>` : ""}</div>`);
  $("#f-nombre", m).focus();
  $("#f-ok", m).onclick = async () => {
    const d = { id: j.id }; ["nombre", "dorsal", "posicion", "grupo", "nacimiento", "fcmax", "fcrep", "peso", "notas"].forEach((k) => (d[k] = $("#f-" + k, m).value));
    if (asignar) d.asignar = asignar;
    try { await api("/api/jugador/guardar", d); closeModal(); toast("Jugador guardado"); await refresh(); S.ses = null; go(S.view, S.opts, true); }
    catch (e) { toast(e.message, true); }
  };
  if ($("#f-del", m)) $("#f-del", m).onclick = async () => {
    if (!confirm(`¿Eliminar a ${j.nombre}? Sus sesiones quedarán sin asignar (no se borran).`)) return;
    await api("/api/jugador/borrar", { id: j.id }); closeModal(); await refresh(); S.ses = null; go(S.view, S.opts, true);
  };
}
function asignarPorDispositivo() {
  const sin = S.ses.filter((s) => !s.jugador && !s.falta);
  const grupos = {};
  sin.forEach((s) => { const k = `${s.dispositivo || "WIMU"}|${(s.inicio || "").slice(0, 10)}`; (grupos[k] = grupos[k] || []).push(s); });
  const m = modal("Asignar sesiones por dispositivo y fecha", `<p class="muted">El archivo .qul identifica el dispositivo, no al jugador. Indique quién llevaba cada dispositivo ese día.</p>
    <table class="data"><thead><tr><th>Dispositivo</th><th>Fecha</th><th class="n">Sesiones</th><th>Jugador</th></tr></thead><tbody>
    ${Object.entries(grupos).map(([k, ss]) => { const [d, f] = k.split("|"); return `<tr><td><b>${esc(d)}</b></td><td>${ffecha(f, false)}</td><td class="n">${ss.length}</td><td><select data-g="${esc(k)}">${jugOptions("", "— Dejar sin asignar —")}</select></td></tr>`; }).join("")}
    </tbody></table><div class="row mt"><button class="btn primary" id="a-ok">${I.check}Asignar</button><button class="btn" id="a-new">${I.plus}Nuevo jugador…</button></div>`, 760);
  $("#a-new", m).onclick = () => editJugador();
  $("#a-ok", m).onclick = async () => {
    let n = 0;
    for (const sel of $$("[data-g]", m)) {
      if (!sel.value) continue;
      const ids = grupos[sel.dataset.g].map((s) => s.id);
      await api("/api/sesiones/asignar", { ids, jugador: sel.value });
      n += ids.length;
    }
    closeModal(); toast(`${n} sesiones asignadas`); await refresh(); S.ses = null; go(S.view, S.opts, true);
  };
}
async function evolucionJugador(jid) {
  await cargarSesiones();
  const j = S.jug.find((x) => x.id === jid);
  const ss = S.ses.filter((s) => s.jugador === jid && !s.excluida && s.kpis).sort((a, b) => (a.inicio > b.inicio ? 1 : -1));
  const vars = ["distancia_m", "m_min", "hsr_m", "n_acel", "player_load", "fc_media"];
  const m = modal(`Evolución · ${esc(j.nombre)}`, ss.length < 1 ? empty(I.stats, "Sin sesiones asignadas") : `
    <div class="row mb">${seg("ev", vars.map((k) => [k, VAR(k).nombre]), "distancia_m")}<span class="grow"></span><button class="btn" id="ev-inf">${I.word}Informe de evolución</button></div>
    <div id="ev-ch"></div>
    <div class="tablewrap mt" style="max-height:300px"><table class="data"><thead><tr><th>Fecha</th><th>Tipo</th><th>Tarea</th>${vars.map((k) => `<th class="n">${esc(VAR(k).nombre)}</th>`).join("")}</tr></thead><tbody>
    ${ss.map((s) => `<tr class="clk" data-id="${s.id}"><td>${ffecha(s.inicio)}</td><td>${esc(s.tipo)}</td><td>${esc(s.tarea)}</td>${vars.map((k) => `<td class="n">${fvar(k, s.kpis[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`, 980);
  if (!ss.length) return;
  const draw = (k) => { const el = $("#ev-ch", m); el.innerHTML = Charts.lines(ss.map((s) => ffecha(s.inicio, false)), [{ name: vlabel(k), values: ss.map((s) => s.kpis[k] ?? null), color: "#2a78d6" }], { width: 900, height: 240, dec: VAR(k).dec, area: true }); };
  draw("distancia_m");
  wireSeg(m, (_, k) => draw(k));
  $$("tr.clk", m).forEach((r) => (r.onclick = () => { closeModal(); go("sesion", { id: r.dataset.id }); }));
  $("#ev-inf", m).onclick = () => { closeModal(); go("informes", { tipo: "jugador", jugador: jid }); };
}

/* ====================================================================== ayuda */
function guide() {
  modal("Guía rápida", `<ol class="steps">
  <li><b>Datos.</b> Copie los archivos .qul/.qui de los WIMU en la carpeta de datos (Archivo › Abrir carpeta de datos). Puede organizarlos en subcarpetas.</li>
  <li><b>Buscar archivos</b> (F5): cada archivo es una sesión. Se lee el archivo binario directamente: GPS (10 Hz), acelerómetro (100 Hz), pulsómetro, barómetro…</li>
  <li><b>Jugadores.</b> El archivo identifica el dispositivo (WIMU_18). En <b>Jugadores</b> › «Asignar por dispositivo y fecha» o en <b>Sesiones</b> (selección múltiple) indique quién lo llevaba. Escriba la FCmáx de cada jugador si la conoce.</li>
  <li><b>Sesión.</b> Pulse una sesión: mapa, velocidad y FC en el tiempo, zonas, minuto a minuto, escenarios más exigentes, esfuerzos y calidad de la señal. Arrastre sobre la gráfica para <b>recortar</b> el tiempo útil o crear <b>partes</b> (calentamiento, tareas…).</li>
  <li><b>Análisis.</b> Descriptivo, comparaciones (entre grupos, pareadas o con modelo mixto), correlaciones y variabilidad entre sesiones.</li>
  <li><b>SPRO.</b> Importe el Excel exportado por SPRO para comprobar la concordancia (sesgo, ICC, Bland–Altman).</li>
  <li><b>Informes.</b> Individuales, técnicos, de evolución, colectivos y estadísticos, en Word, PDF y Excel.</li></ol>`, 760);
}
function glossary() {
  modal("Definición de las variables", `<div class="tablewrap" style="max-height:60vh"><table class="data"><thead><tr><th>Variable</th><th>Unidad</th><th>Grupo</th></tr></thead><tbody>${VARS().map((x) => `<tr><td>${esc(x.nombre)}</td><td>${esc(x.unidad)}</td><td class="muted">${esc(x.grupo)}</td></tr>`).join("")}</tbody></table></div>
  <ul class="mt">
  <li><b>Distancia</b>: integral de la velocidad Doppler del GPS (por defecto) o suma del canal DIST del dispositivo (Ajustes). DIST suma el ruido de la posición con el jugador parado y suele dar más metros.</li>
  <li><b>HSR / sprint</b>: distancia por encima de los umbrales de Ajustes. Sprint y esfuerzos: tiempo mínimo por encima del umbral.</li>
  <li><b>Aceleraciones / deceleraciones</b>: derivada de la velocidad suavizada; se cuentan los esfuerzos ≥ umbral durante el tiempo mínimo.</li>
  <li><b>AcelT</b>: módulo de la aceleración del acelerómetro (g, incluye la gravedad ≈ 1 g). <b>Player Load</b>: Σ√(Δx²+Δy²+Δz²)/100 a 100 Hz.</li>
  <li><b>TRIMP de Edwards</b>: minutos en 50–60, 60–70, 70–80, 80–90 y ≥ 90 % FCmáx ponderados de 1 a 5.</li>
  <li><b>WCS</b>: escenario más exigente, máximo en ventanas móviles de 1, 3 y 5 minutos.</li></ul>`, 820);
}
function shortcuts() {
  modal("Atajos de teclado", `<table class="data">${[["F5", "Buscar archivos nuevos y calcular"], ["Ctrl+1…6", "Sesiones, Jugadores, Descriptivo, Comparaciones, Correlación, SPRO"], ["Ctrl+,", "Ajustes"], ["Ctrl+Mayús+L", "Cambiar tema"], ["F1", "Guía rápida"], ["← →", "Sesión anterior / siguiente (en la ficha de sesión)"], ["Esc", "Cerrar menús y diálogos"]].map(([a, b]) => `<tr><td><kbd class="k">${a}</kbd></td><td>${b}</td></tr>`).join("")}</table>`);
}
function about() {
  modal("Acerca de WIMU Lab", `<p><b>WIMU Lab</b> v${esc(S.st.version)} — lectura directa de los archivos de WIMU PRO (.qul y .qui) y análisis de la carga externa e interna.</p>
  <p>Todo el procesamiento se hace en este equipo; los archivos originales no se modifican. Configuración: <code>${esc(S.st.config_archivo)}</code>.</p>
  <p class="muted">WIMU PRO y SPRO son marcas de RealTrack Systems; WIMU Lab es una herramienta independiente.</p>`);
}

/* Pestaña informativa de autores: no modifica datos ni análisis. */
V.autores = (v) => {
  const autores = [
    ["Pino-Ortega, J.", "Autor principal", "Universidad de Murcia", "https://openalex.org/authors/A5073491181", "https://scholar.google.com/citations?user=tIXi2ucAAAAJ"],
    ["Navarro-Martínez, C.", "Autor colaborador", "", "", "https://scholar.google.com/citations?user=IyrtUVAAAAAJ&hl=es"],
    ["López-Baro, P.", "Autor colaborador", "", "", ""],
    ["Pino-Moreno, E.", "Autor colaborador", "", "", ""]
  ];
  const link = (url, label) => url ? `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : "";
  v.innerHTML = head("Autores", "Equipo de desarrollo e investigación de WIMU Lab") +
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">` +
    autores.map(([nombre, rol, afiliacion, openalex, scholar]) => `<section class="card" style="padding:20px;min-width:0">
      <div class="muted" style="font-size:12px;margin-bottom:9px">${esc(rol)}</div>
      <h2 style="margin:0 0 10px;font-size:19px">${esc(nombre)}</h2>
      ${afiliacion ? `<p>${esc(afiliacion)}</p>` : ""}
      ${nombre === "Pino-Ortega, J." ? `<p><a href="mailto:jospinoortega@um.es">jospinoortega@um.es</a></p>` : ""}
      <div class="row" style="flex-wrap:wrap;gap:8px">${link(openalex,"OpenAlex")}${link(scholar,"Google Scholar")}</div>
    </section>`).join("") + `</div>`;
};

/* ====================================================================== arranque */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeMenus(); closeModal(); return; }
  if (e.key === "F1") { e.preventDefault(); guide(); return; }
  if (e.key === "F5") { e.preventDefault(); actualizar(); return; }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); toggleTheme(); return; }
  if (!e.ctrlKey && !e.altKey && !$(".modal") && S.view === "sesion" && ["ArrowLeft", "ArrowRight"].includes(e.key) && !e.target.closest("input,select,textarea")) {
    const lista = S.vis || S.ses || [];
    const i = lista.findIndex((s) => s.id === S.opts.id);
    const n = lista[i + (e.key === "ArrowRight" ? 1 : -1)];
    if (n) go("sesion", { id: n.id });
    return;
  }
  if (!e.ctrlKey || e.altKey || e.shiftKey || $(".modal")) return;
  const map = { 1: () => go("sesiones"), 2: () => go("jugadores"), 3: () => go("analisis", { sub: "descriptivo" }), 4: () => go("analisis", { sub: "comparar" }), 5: () => go("analisis", { sub: "correlacion" }), 6: () => go("spro"), ",": () => go("ajustes") };
  const f = map[e.key.toLowerCase()];
  if (f) { e.preventDefault(); f(); }
});
$("#theme-btn").onclick = toggleTheme;
$("#exit-btn").onclick = quit;
$("#job-chip").onclick = () => toast("Tarea en curso: el resultado aparecerá al terminar");
setInterval(() => fetch("/api/ping").catch(() => {}), 20000);
let rsz;
window.addEventListener("resize", () => { clearTimeout(rsz); rsz = setTimeout(() => ["inicio", "analisis", "spro"].includes(S.view) && go(S.view, S.opts, true), 300); });
window.addEventListener("load", async () => {
  applyTheme(store.get("tema", "claro"));
  buildMenus();
  loading($("#view"));
  try { await refresh(); } catch (e) { toast(e.message, true); }
  go(store.get("vista", "inicio"));
});
