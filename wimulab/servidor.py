"""Servidor local (127.0.0.1) de la interfaz de WIMU Lab. Los datos nunca salen del equipo."""
from __future__ import annotations

import json
import math
import mimetypes
import os
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import numpy as np

from . import APP_NAME, __version__
from . import analisis as A
from . import config as C
from . import comparador as COMP
_COMPARACIONES = {}
from . import metricas as M
from . import servicio as SV
from . import spro as SP
from .registro import TIPOS

WEB = Path(__file__).resolve().parent.parent / "web"
PING = dict(t=time.time())
INSTANCIA = C.CONFIG_DIR / "instancia.json"


def clean(v):
    if isinstance(v, (float, np.floating)):
        v = float(v)
        return None if not math.isfinite(v) else round(v, 5)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, dict):
        return {str(k): clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if isinstance(v, np.ndarray):
        return clean(v.tolist())
    return v


# --------------------------------------------------------------------------- utilidades del sistema
def _dialogo(tipo, titulo, inicial=""):
    """Diálogo nativo del sistema (el servidor se ejecuta en el propio equipo). Devuelve la ruta o ''."""
    fn = "askdirectory(title=t, initialdir=i)" if tipo == "carpeta" else \
        "askopenfilename(title=t, initialdir=i, filetypes=[('Excel o CSV', '*.xlsx *.xls *.csv'), ('Todos', '*.*')])"
    codigo = ("import tkinter as tk, tkinter.filedialog as fd, sys\n"
              "r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
              f"t, i = {titulo!r}, {inicial!r}\n"
              f"p = fd.{fn}\nsys.stdout.write(p or '')")
    try:
        r = subprocess.run([sys.executable, "-c", codigo], capture_output=True, text=True, timeout=900,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return (r.stdout or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def abrir(ruta):
    p = Path(ruta).resolve()
    base = [Path(SV.cfg()["carpeta_resultados"]).resolve(), Path(SV.cfg()["carpeta_datos"]).resolve()]
    if not any(str(p).startswith(str(b)) for b in base):
        raise PermissionError("Ruta no permitida")
    if not p.exists():
        raise FileNotFoundError(str(p))
    if sys.platform.startswith("win"):
        os.startfile(str(p))  # noqa: S606
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(p)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def resultados():
    base = Path(SV.cfg()["carpeta_resultados"])
    out = []
    if base.exists():
        for d in sorted([p for p in base.iterdir() if p.is_dir()], key=lambda p: p.name, reverse=True)[:30]:
            arch = [f for f in sorted(d.rglob("*.*")) if "_figuras" not in f.parts and f.suffix.lower() in (".docx", ".pdf", ".xlsx", ".html")]
            out.append(dict(nombre=d.name, ruta=str(d), archivos=[dict(nombre=f.name, ruta=str(f), carpeta=f.parent.name,
                                                                       fecha=datetime.fromtimestamp(f.stat().st_mtime).strftime("%d/%m/%Y %H:%M"))
                                                                  for f in sorted(arch, key=lambda f: f.stat().st_mtime, reverse=True)]))
    return out


def estado():
    c = SV.cfg()
    reg = SV.reg()
    ses = reg.sesiones()
    datos = Path(c["carpeta_datos"])
    return dict(app=APP_NAME, version=__version__, cfg=c, defectos=C.DEFAULTS, job=SV.STATE["job"], tipos=TIPOS,
                n_sesiones=sum(1 for s in ses if not s.get("falta")), n_faltan=sum(1 for s in ses if s.get("falta")),
                n_jugadores=len(reg.d["jugadores"]), sin_asignar=sum(1 for s in ses if not s.get("jugador") and not s.get("falta")),
                sin_calcular=sum(1 for s in ses if not s.get("kpis") and not s.get("falta")),
                datos_existe=datos.exists(), config_archivo=str(C.CONFIG_FILE),
                variables=[dict(clave=v[0], nombre=v[1], unidad=v[2], dec=v[3], grupo=v[4]) for v in M.VARIABLES],
                spro=SP.resumen(SP.cargar(c["carpeta_datos"])) is not None)


def lista_sesiones():
    out = []
    for s in SV.reg().sesiones():
        k = s.get("kpis") or {}
        out.append({kk: s.get(kk) for kk in ("id", "archivo", "carpeta", "ruta", "inicio", "dispositivo", "jugador", "jugador_nombre", "etiqueta_jugador",
                                             "jugador_archivo", "dorsal_archivo", "tipo", "tarea", "notas", "excluida", "falta", "error", "tamano_mb",
                                             "recorte", "segmentos", "duracion_total_min", "avisos", "senales", "posicion", "grupo")}
                   | dict(kpis=k, actual=bool(k) and s.get("firma") == SV.firma(SV.reg().sesion(s["id"]))))
    return out


def _filtro(b):
    return b.get("filtro") or {}


# --------------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body: bytes, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(clean(obj), ensure_ascii=False, default=str).encode("utf-8"))

    def _file(self, p: Path):
        p = p.resolve()
        if not str(p).startswith(str(WEB.resolve())) or not p.is_file():
            return self._json({"error": "No encontrado"}, 404)
        ct = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
        if ct.startswith("text/") or ct.endswith("javascript"):
            ct += "; charset=utf-8"
        self._send(200, p.read_bytes(), ct)

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        q = lambda k, d="": qs.get(k, [d])[0]  # noqa: E731
        PING["t"] = time.time()
        try:
            if u.path in ("/", "/index.html"):
                return self._file(WEB / "index.html")
            if u.path.startswith("/web/"):
                return self._file(WEB / unquote(u.path[5:]))
            routes = {
                "/api/estado": estado,
                "/api/ping": lambda: dict(ok=True),
                "/api/sesiones": lambda: dict(sesiones=lista_sesiones(), jugadores=SV.reg().jugadores(), tipos=TIPOS),
                "/api/sesion": lambda: SV.analisis_sesion(q("id")),
                "/api/jugadores": lambda: dict(jugadores=SV.reg().jugadores()),
                "/api/progreso": lambda: SV.STATE["job"],
                "/api/resultados": resultados,
                "/api/spro": lambda: dict(datos=SP.resumen(SP.cargar(SV.cfg()["carpeta_datos"]))),
            }
            if u.path in routes:
                return self._json(routes[u.path]())
            return self._json({"error": "No encontrado"}, 404)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"error": str(e)}, 500)

    def do_POST(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        PING["t"] = time.time()
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if u.path == "/api/comparador/cargar":
                import uuid
                nombre=unquote(qs.get('nombre',['datos.csv'])[0])
                if n>30_000_000: return self._json({'error':'Máximo 30 MB por archivo'},413)
                datos=COMP.leer(nombre,self.rfile.read(n))
                token=uuid.uuid4().hex
                if len(_COMPARACIONES)>12: _COMPARACIONES.clear()
                _COMPARACIONES[token]=datos
                return self._json({'id':token,'nombre':nombre,'n':len(datos),'variables':[k for k in ('hr','speed','alt') if any(r.get(k) is not None for r in datos)]})
            if u.path == "/api/sesion/externo":                 # archivo de otro dispositivo vinculado a una sesión
                nombre = unquote(qs.get("nombre", ["externo.csv"])[0])
                if n > 60_000_000:
                    return self._json({"error": "Máximo 60 MB por archivo"}, 413)
                return self._json(dict(ok=True, externo=SV.externo_anadir(qs.get("id", [""])[0], nombre, self.rfile.read(n))))
            if u.path == "/api/spro/importar":                  # archivo subido desde el navegador
                nombre = unquote(qs.get("nombre", ["spro.xlsx"])[0])
                return self._json(SP.importar(SV.cfg()["carpeta_datos"], nombre, self.rfile.read(n)))
            b = json.loads(self.rfile.read(n) or b"{}") if n else {}
            reg = SV.reg()
            if u.path == "/api/comparador/analizar":
                token=b.get("id")
                if token not in _COMPARACIONES: raise ValueError("Archivo no cargado")
                return self._json(COMP.analizar(_COMPARACIONES[token]))
            if u.path == "/api/comparador/comparar":
                return self._json(COMP.comparar(_COMPARACIONES[b['a']],_COMPARACIONES[b['b']],b.get('variable','hr'),float(b.get('desfase',0)),float(b.get('intervalo',1))))
            if u.path == "/api/ajustes":
                c = SV.recargar_cfg(b)
                return self._json(dict(ok=True, cfg=c))
            if u.path == "/api/ajustes/restablecer":
                c = {k: v for k, v in C.DEFAULTS.items() if k not in ("carpeta_datos", "carpeta_resultados")}
                return self._json(dict(ok=True, cfg=SV.recargar_cfg(c)))
            if u.path == "/api/elegir_carpeta":
                return self._json(dict(ruta=_dialogo("carpeta", b.get("titulo", "Elegir carpeta"), b.get("inicial", ""))))
            if u.path == "/api/actualizar":
                return self._json(SV.tarea("Actualizar sesiones", lambda p: SV.actualizar(p, bool(b.get("forzar")))))
            if u.path == "/api/sesion/externo/editar":
                return self._json(dict(ok=True, externo=SV.externo_editar(b["id"], b["archivo"], b)))
            if u.path == "/api/sesion/externo/borrar":
                SV.externo_borrar(b["id"], b["archivo"])
                return self._json(dict(ok=True))
            if u.path == "/api/sesion/guardar":
                s = reg.editar_sesion(b["id"], b)
                return self._json(dict(ok=True, sesion=s))
            if u.path == "/api/sesiones/asignar":
                reg.asignar(b.get("ids") or [], b.get("jugador"), b.get("tipo"), b.get("tarea"))
                return self._json(dict(ok=True))
            if u.path == "/api/sesiones/excluir":
                for sid in b.get("ids") or []:
                    reg.editar_sesion(sid, dict(excluida=bool(b.get("excluir", True))))
                return self._json(dict(ok=True))
            if u.path == "/api/sesion/olvidar":
                for sid in b.get("ids") or []:
                    reg.borrar_sesion(sid)
                return self._json(dict(ok=True))
            if u.path == "/api/jugador/guardar":
                j = reg.guardar_jugador(b)
                if b.get("asignar"):
                    reg.asignar(b["asignar"], j["id"])
                return self._json(dict(ok=True, jugador=j))
            if u.path == "/api/jugador/borrar":
                reg.borrar_jugador(b["id"])
                return self._json(dict(ok=True))
            if u.path == "/api/analisis/descriptivo":
                df = SV.tabla(_filtro(b))
                if df.empty:
                    raise ValueError("No hay sesiones con esos filtros")
                return self._json(A.descriptivo(df, b.get("variables") or [], b.get("agrupar") or None, M._num(SV.cfg()["alfa"], .05)))
            if u.path == "/api/analisis/comparar":
                df = SV.tabla(_filtro(b))
                if df.empty:
                    raise ValueError("No hay sesiones con esos filtros")
                return self._json(A.comparar(df, b.get("variables") or [], b["factor"], b.get("diseno", "grupos"), b.get("niveles"),
                                             M._num(SV.cfg()["alfa"], .05), b.get("nivel", "jugador")))
            if u.path == "/api/analisis/correlacion":
                df = SV.tabla(_filtro(b))
                if df.empty:
                    raise ValueError("No hay sesiones con esos filtros")
                out = A.correlacion(df, b["x"], b["y"], M._num(SV.cfg()["alfa"], .05))
                out["matriz"] = A.matriz(df, b.get("variables") or [b["x"], b["y"]])
                out["variabilidad"] = A.variabilidad(df, b.get("variables") or [b["x"], b["y"]])
                return self._json(out)
            if u.path == "/api/analisis/tabla":
                df = SV.tabla(_filtro(b))
                return self._json(dict(filas=df.astype(object).where(df.notna(), None).to_dict("records")))
            if u.path == "/api/spro/mapa":
                d = SP.guardar_mapa(SV.cfg()["carpeta_datos"], b.get("claves") or {}, b.get("mapa") or {})
                return self._json(dict(datos=SP.resumen(d)))
            if u.path == "/api/spro/concordancia":
                d = SP.cargar(SV.cfg()["carpeta_datos"])
                if not d:
                    raise ValueError("Primero importe la exportación de SPRO")
                ses = reg.sesiones(incluir_faltan=False)
                for s in ses:                      # variables al día
                    if not s.get("kpis") or s.get("firma") != SV.firma(reg.sesion(s["id"])):
                        try:
                            SV.calcular_kpis(s["id"])
                        except Exception:  # noqa: BLE001
                            pass
                reg.guardar()
                ses = reg.sesiones(incluir_faltan=False)
                return self._json(SP.concordancia(d, ses, {s["id"]: s.get("kpis") for s in ses}))
            if u.path == "/api/informe":
                from . import informes
                return self._json(SV.tarea("Informe", lambda p: informes.generar(b, p)))
            if u.path == "/api/abrir":
                abrir(b.get("ruta") or SV.cfg()["carpeta_resultados"])
                return self._json(dict(ok=True))
            if u.path == "/api/abrir_datos":
                Path(SV.cfg()["carpeta_datos"]).mkdir(parents=True, exist_ok=True)
                abrir(SV.cfg()["carpeta_datos"])
                return self._json(dict(ok=True))
            if u.path == "/api/salir":
                self._json(dict(ok=True))
                threading.Timer(.3, salir).start()
                return None
            return self._json({"error": "No encontrado"}, 404)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"error": str(e)}, 500)


def instancia_abierta():
    try:
        d = json.loads(INSTANCIA.read_text(encoding="utf-8"))
        from urllib.request import urlopen
        with urlopen(f"http://127.0.0.1:{int(d['puerto'])}/api/ping", timeout=3) as r:
            if r.status == 200:
                return f"http://127.0.0.1:{int(d['puerto'])}/"
    except Exception:  # noqa: BLE001
        pass
    return None


def salir(codigo=0):
    try:
        INSTANCIA.unlink(missing_ok=True)
    except OSError:
        pass
    try:
        SV.reg().guardar()
    except Exception:  # noqa: BLE001
        pass
    os._exit(codigo)


def tareas_activas():
    return bool(SV.STATE["job"]["activo"])


def serve(port=0, auto_cerrar=False, on_ready=None):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        INSTANCIA.parent.mkdir(parents=True, exist_ok=True)
        INSTANCIA.write_text(json.dumps(dict(pid=os.getpid(), puerto=httpd.server_address[1])), encoding="utf-8")
    except OSError:
        pass
    if auto_cerrar:
        def watchdog():
            while True:
                time.sleep(10)
                sin = time.time() - PING["t"]
                if (sin > 75 and not tareas_activas()) or sin > 3 * 3600:
                    salir()
        threading.Thread(target=watchdog, daemon=True).start()
    if on_ready:
        on_ready(httpd.server_address[1])
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        salir()
