"""Registro persistente de jugadores y sesiones (wimulab_registro.json, dentro de la carpeta de datos).

Cada archivo .qul/.qui es una SESIÓN. Se guarda: jugador asignado, tipo (entrenamiento, partido, test…), tarea o
etiqueta, notas, recorte del tiempo útil, segmentos (partes, tareas) y las variables principales ya calculadas
(se recalculan solas si cambia el archivo, el recorte, la FCmáx o los ajustes de procesado).
"""
from __future__ import annotations

import hashlib
import json
import threading
import uuid
from datetime import datetime
from pathlib import Path

from . import qul

LOCK = threading.RLock()
NOMBRE = "wimulab_registro.json"
TIPOS = ["Entrenamiento", "Partido", "Test", "Recuperación", "Otro"]
GENERICOS = {"", "WIMU", "PLAYER", "JUGADOR", "SIN NOMBRE", "NONAME"}


class Registro:
    def __init__(self, carpeta_datos):
        self.base = Path(carpeta_datos)
        self.f = self.base / NOMBRE
        self.d = dict(version=1, jugadores={}, sesiones={})
        self.cargar()

    # ------------------------------------------------------------------ disco
    def cargar(self):
        with LOCK:
            try:
                self.d = json.loads(self.f.read_text(encoding="utf-8"))
                self.d.setdefault("jugadores", {})
                self.d.setdefault("sesiones", {})
            except FileNotFoundError:
                pass
            except Exception:  # noqa: BLE001  (archivo dañado: se conserva una copia y se empieza de cero)
                try:
                    self.f.replace(self.f.with_suffix(f".danado_{datetime.now():%Y%m%d%H%M%S}.json"))
                except OSError:
                    pass

    def guardar(self):
        with LOCK:
            self.base.mkdir(parents=True, exist_ok=True)
            tmp = self.f.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.d, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
            tmp.replace(self.f)

    @property
    def cache(self):
        return self.base / ".wimulab_cache"

    # ------------------------------------------------------------------ archivos
    def ruta(self, s):
        return self.base / s["ruta"]

    def escanear(self):
        """Busca .qul/.qui nuevos (y marca los que ya no están). Devuelve (nuevos, desaparecidos)."""
        nuevos, vistos = [], set()
        if not self.base.exists():
            return [], []
        for f in sorted(self.base.rglob("*")):
            if f.suffix.lower() not in qul.EXT or ".wimulab_cache" in f.parts or ".wimulab_externos" in f.parts or not f.is_file():
                continue
            rel = f.relative_to(self.base).as_posix()
            sid = hashlib.sha1(rel.lower().encode()).hexdigest()[:12]
            vistos.add(sid)
            with LOCK:
                if sid in self.d["sesiones"]:
                    s = self.d["sesiones"][sid]
                    s["falta"] = False
                    continue
            try:
                cab = qul.cabecera_rapida(f)
            except Exception:  # noqa: BLE001
                cab = dict(archivo=f.name)
            s = dict(id=sid, ruta=rel, archivo=f.name, carpeta=str(Path(rel).parent) if Path(rel).parent != Path(".") else "",
                     dispositivo=cab.get("dispositivo", ""), dorsal_archivo=cab.get("dorsal", ""), jugador_archivo=cab.get("jugador", ""),
                     inicio=cab.get("fecha_nombre"), tamano_mb=cab.get("tamano_mb"), jugador=None, tipo="Entrenamiento", tarea="",
                     notas="", recorte=[None, None], segmentos=[], excluida=False, falta=False, alta=datetime.now().isoformat(timespec="seconds"),
                     kpis=None, firma=None)
            s["jugador"] = self._jugador_por_cabecera(s)
            with LOCK:
                self.d["sesiones"][sid] = s
            nuevos.append(sid)
        faltan = []
        with LOCK:
            for sid, s in self.d["sesiones"].items():
                if sid not in vistos and not s.get("falta"):
                    s["falta"] = True
                    faltan.append(sid)
        self.guardar()
        return nuevos, faltan

    def _jugador_por_cabecera(self, s):
        nombre = (s.get("jugador_archivo") or "").strip()
        if nombre.upper() in GENERICOS:
            return None
        with LOCK:
            for j in self.d["jugadores"].values():
                if j["nombre"].strip().lower() == nombre.lower():
                    return j["id"]
        return self.guardar_jugador(dict(nombre=nombre, dorsal=s.get("dorsal_archivo", "")), guardar=False)["id"]

    # ------------------------------------------------------------------ jugadores
    def jugadores(self):
        with LOCK:
            js = [dict(j) for j in self.d["jugadores"].values()]
            cuenta = {}
            for s in self.d["sesiones"].values():
                if s.get("jugador"):
                    cuenta[s["jugador"]] = cuenta.get(s["jugador"], 0) + 1
        for j in js:
            j["n_sesiones"] = cuenta.get(j["id"], 0)
        return sorted(js, key=lambda j: j["nombre"].lower())

    def jugador(self, jid):
        return self.d["jugadores"].get(jid) if jid else None

    def guardar_jugador(self, datos, guardar=True):
        with LOCK:
            jid = datos.get("id") or uuid.uuid4().hex[:8]
            j = self.d["jugadores"].get(jid, dict(id=jid, nombre="", dorsal="", posicion="", grupo="", fcmax="", fcrep="", peso="",
                                                  nacimiento="", notas=""))
            for k in ("nombre", "dorsal", "posicion", "grupo", "fcmax", "fcrep", "peso", "nacimiento", "notas"):
                if k in datos:
                    j[k] = str(datos[k] or "").strip()
            if not j["nombre"]:
                raise ValueError("El jugador necesita un nombre")
            self.d["jugadores"][jid] = j
        if guardar:
            self.guardar()
        return j

    def borrar_jugador(self, jid):
        with LOCK:
            self.d["jugadores"].pop(jid, None)
            for s in self.d["sesiones"].values():
                if s.get("jugador") == jid:
                    s["jugador"] = None
        self.guardar()

    # ------------------------------------------------------------------ sesiones
    def sesiones(self, incluir_faltan=True):
        with LOCK:
            out = [dict(s) for s in self.d["sesiones"].values() if incluir_faltan or not s.get("falta")]
        for s in out:
            j = self.jugador(s.get("jugador"))
            s["jugador_nombre"] = j["nombre"] if j else ""
            s["etiqueta_jugador"] = j["nombre"] if j else f"{s.get('dispositivo') or 'WIMU'} (sin asignar)"
            s["posicion"] = j.get("posicion", "") if j else ""
            s["grupo"] = j.get("grupo", "") if j else ""
        return sorted(out, key=lambda s: (s.get("inicio") or "", s["archivo"]), reverse=True)

    def sesion(self, sid):
        s = self.d["sesiones"].get(sid)
        if not s:
            raise KeyError("Sesión no encontrada")
        return s

    def editar_sesion(self, sid, datos):
        with LOCK:
            s = self.sesion(sid)
            for k in ("jugador", "tipo", "tarea", "notas", "excluida"):
                if k in datos:
                    s[k] = datos[k]
            if "recorte" in datos:
                r = datos["recorte"] or [None, None]
                s["recorte"] = [(_num(r[0])), (_num(r[1]))]
            if "segmentos" in datos:
                s["segmentos"] = [dict(nombre=str(x.get("nombre") or f"Segmento {i + 1}"), desde=_num(x.get("desde")) or 0,
                                       hasta=_num(x.get("hasta")) or 0) for i, x in enumerate(datos["segmentos"] or [])
                                  if (_num(x.get("hasta")) or 0) > (_num(x.get("desde")) or 0)]
        self.guardar()
        return s

    def asignar(self, ids, jid=None, tipo=None, tarea=None):
        with LOCK:
            for sid in ids:
                s = self.d["sesiones"].get(sid)
                if not s:
                    continue
                if jid is not None:
                    s["jugador"] = jid or None
                if tipo:
                    s["tipo"] = tipo
                if tarea is not None:
                    s["tarea"] = tarea
        self.guardar()

    def borrar_sesion(self, sid):
        with LOCK:
            self.d["sesiones"].pop(sid, None)
        self.guardar()


def _num(x):
    try:
        v = float(str(x).replace(",", "."))
        return v
    except (TypeError, ValueError):
        return None
