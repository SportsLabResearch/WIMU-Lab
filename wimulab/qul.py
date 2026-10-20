"""Lectura directa de los archivos de WIMU PRO (RealTrack Systems).

.qul  Contenedor propio: cabecera XML (<NODE> … </NODE>) con el dispositivo, el jugador y la descripción de los
      sensores; a continuación <TIMEZ>/<TIMEO>/<TIMEU> (zona horaria, desfase y hora UNIX de referencia) y los
      paquetes binarios:
          E1 ED | tamaño (uint16 LE) | tipo (byte) | cuerpo [código, marca, t_ms (uint32 LE), valores…, suma]
      tipo 1 = valores float64 (GPS), tipo 6 = float32 (inerciales, pulsómetro, barómetro…), tipo 2 = sincronización
      horaria (double UNIX en el desplazamiento 6). Los sensores con código > 255 llegan como código % 256
      (300 ACEL → 44, 301 ATTITUDE → 45, 302 GYRO → 46).
.qui  Base SQLite (tablas CHANNELxx con blobs X uint32 ms e Y float32/64 y Sesion.cfg con los nombres).

El resultado es un objeto Registro con las señales estandarizadas (gps, acc, hr, gyro, bar) como arrays numpy,
el inventario de canales y los metadatos (dispositivo, jugador, inicio real en hora local del dispositivo).
Se guarda en caché (.npz) para que la segunda apertura sea instantánea.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import struct
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

MAGIC = b"\xe1\xed"
ALIAS = {44: 300, 45: 301, 46: 302}
CACHE_V = 3
EXT = {".qul", ".qui"}


def _norm(s):
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def _txt(node, tag):
    c = node.find(tag) if node is not None else None
    return "" if c is None or c.text is None else c.text.strip()


# --------------------------------------------------------------------------- cabecera XML
def _cabecera(xml_bytes):
    info, sensores = {}, {}
    try:
        root = ET.fromstring(xml_bytes.decode("utf-8", errors="replace"))
    except ET.ParseError:
        return info, sensores
    i, p = root.find("INFO"), root.find("PLAYER")
    info = dict(dispositivo=_txt(i, "NAME"), id=_txt(i, "ID"), mac=_txt(i, "MAC"), firmware=_txt(i, "VER"),
                jugador=_txt(p, "PLAYER_NAME"), dorsal=_txt(p, "PLAYER_NUMBER"), jugador_id=_txt(p, "PLAYER_ID"))
    for s in root.iter("SENSOR"):
        try:
            code = int(float(_txt(s, "CODE")))
        except ValueError:
            continue
        sensores[code] = dict(code=code, nombre=_txt(s, "NAME") or f"SENSOR_{code}", magnitud=_txt(s, "MAGNITUDE"),
                              unidad=_txt(s, "UNIT"),
                              canales=[_txt(c, "NAME") or f"v{k + 1}" for k, c in enumerate(s.findall("./CHANNELS/CHANNEL"))])
    return info, sensores


def _desfase(txt):
    m = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", (txt or "").strip())
    if not m:
        return None
    mins = int(m.group(2)) * 60 + int(m.group(3))
    return timedelta(minutes=mins if m.group(1) == "+" else -mins)


# --------------------------------------------------------------------------- paquetes
def _paquetes(raw, start):
    """Devuelve {(tipo, código, nvalores): bytes concatenados [t_ms + valores]} y la lista de sincronizaciones."""
    trozos, sync, resinc = defaultdict(list), [], 0
    o, n = start, len(raw)
    find, unpack = raw.find, struct.unpack_from
    while o + 5 <= n:
        if raw[o] != 0xE1 or raw[o + 1] != 0xED:
            o2 = find(MAGIC, o + 1)
            if o2 < 0:
                break
            resinc += 1
            o = o2
            continue
        size = unpack("<H", raw, o + 2)[0]
        tipo = raw[o + 4]
        b0 = o + 5
        b1 = b0 + size
        if b1 > n:
            break
        if size >= 7:
            code = raw[b0]
            if tipo == 2:
                if size >= 14:
                    sync.append((unpack("<I", raw, b0 + 2)[0], unpack("<d", raw, b0 + 6)[0]))
            elif tipo in (1, 6):
                w = 8 if tipo == 1 else 4
                nv = (size - 7) // w
                if nv > 0:
                    trozos[(tipo, code, nv)].append(raw[b0 + 2: b0 + 6 + nv * w])
        o = b1
    return trozos, sync, resinc


def _matriz(tipo, nv, partes):
    w = 8 if tipo == 1 else 4
    dt = np.dtype([("t", "<u4"), ("v", ("<f8" if w == 8 else "<f4"), (nv,))])
    a = np.frombuffer(b"".join(partes), dtype=dt)
    t = a["t"].astype(np.int64)
    v = a["v"].astype(np.float64)
    orden = np.argsort(t, kind="stable")
    t, v = t[orden], v[orden]
    keep = np.r_[True, np.diff(t) > 0]
    return t[keep] / 1000.0, v[keep]


def _fs(t):
    dt = np.diff(np.asarray(t, float))
    dt = dt[dt > 0]
    return round(float(1 / np.median(dt)), 2) if len(dt) else None


# --------------------------------------------------------------------------- registro estandarizado
class Registro:
    """Señales de una sesión: dict canal → (t_s, matriz) y metadatos."""

    def __init__(self):
        self.meta: dict = {}
        self.inventario: list = []
        self.senales: dict = {}   # nombre → dict(t=…, cols=[…], v=matriz)

    # --- acceso
    def tiene(self, k):
        return k in self.senales and len(self.senales[k]["t"]) > 10

    def col(self, k, c):
        s = self.senales[k]
        return s["v"][:, s["cols"].index(c)]

    def t(self, k):
        return self.senales[k]["t"]

    # --- caché
    def guardar(self, f: Path):
        arr = {}
        for k, s in self.senales.items():
            arr[f"{k}__t"] = s["t"]
            arr[f"{k}__v"] = s["v"].astype(np.float32 if k not in ("gps",) else np.float64)
        arr["__json"] = np.frombuffer(json.dumps(dict(meta=self.meta, inventario=self.inventario,
                                                      cols={k: s["cols"] for k, s in self.senales.items()}, v=CACHE_V),
                                                 ensure_ascii=False, default=str).encode("utf-8"), dtype=np.uint8)
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp.npz")
        np.savez(tmp, **arr)
        tmp.replace(f)

    @classmethod
    def cargar(cls, f: Path):
        z = np.load(f, allow_pickle=False)
        j = json.loads(bytes(z["__json"]).decode("utf-8"))
        if j.get("v") != CACHE_V:
            raise ValueError("caché antigua")
        r = cls()
        r.meta, r.inventario = j["meta"], j["inventario"]
        for k, cols in j["cols"].items():
            r.senales[k] = dict(t=z[f"{k}__t"], v=z[f"{k}__v"].astype(np.float64), cols=cols)
        return r


def _estandarizar(r: Registro, crudos: dict):
    """crudos: {nombre_sensor: (t, v, canales, unidad, magnitud)} → señales gps/acc/hr/gyro/bar."""
    for nombre, (t, v, canales, unidad, mag) in crudos.items():
        nc = [_norm(c) for c in canales]
        txt = _norm(f"{nombre} {mag}")
        if "LAT" in nc and any(c.startswith("LON") for c in nc):
            want = dict(lat="LAT", lon="LON", speed="SPEED", alt="ALT", sat="SATCOUNT", dist="DIST", pdop="PDOP", fecha="DATETIME")
            cols, mat = [], []
            for k, key in want.items():
                idx = next((i for i, c in enumerate(nc) if c.startswith(key)), None)
                if idx is not None:
                    cols.append(k)
                    mat.append(v[:, idx])
            if "gps" not in r.senales or len(t) > len(r.senales["gps"]["t"]):
                r.senales["gps"] = dict(t=t, cols=cols, v=np.column_stack(mat))
                u = _norm(unidad)
                r.meta["gps_speed_unidad"] = "km/h"
        elif any(k in txt for k in ("HRM", "HEART", "PULS")) or (nc and nc[0] in ("HEARTRATE", "HR", "FC")):
            i_hr = next((i for i, c in enumerate(nc) if c in ("HEARTRATE", "HR", "FC", "BPM")), 0)
            i_rr = next((i for i, c in enumerate(nc) if c in ("RR", "RRINTERVAL")), None)
            cols, mat = ["hr"], [v[:, i_hr]]
            if i_rr is not None:
                cols.append("rr")
                mat.append(v[:, i_rr])
            r.senales["hr"] = dict(t=t, cols=cols, v=np.column_stack(mat))
        elif v.shape[1] >= 3 and any(k in txt for k in ("ACEL", "ACC")) and not any(k in txt for k in ("ATTITUDE",)):
            mod = np.nanmedian(np.linalg.norm(v[:, :3], axis=1))
            fac = 1.0 if 0.5 <= mod <= 1.6 else (1 / 9.80665 if 5 <= mod <= 15 else None)
            if fac and ("acc" not in r.senales or len(t) > len(r.senales["acc"]["t"])):
                r.senales["acc"] = dict(t=t, cols=["x", "y", "z"], v=v[:, :3] * fac)
        elif v.shape[1] >= 3 and any(k in txt for k in ("GYRO", "GIRO")):
            r.senales["gyro"] = dict(t=t, cols=["x", "y", "z"], v=v[:, :3])
        elif "BAR" in txt or "PRESS" in txt:
            r.senales["bar"] = dict(t=t, cols=[c.lower() for c in canales[: v.shape[1]]], v=v)


def leer_qul(path: Path) -> Registro:
    raw = Path(path).read_bytes()
    fin = raw.find(b"</NODE>")
    if fin < 0:
        raise ValueError("no es un archivo .qul de WIMU (no hay cabecera XML)")
    fin += len(b"</NODE>")
    ini = raw.find(MAGIC, fin)
    if ini < 0:
        raise ValueError("el archivo no contiene datos (no se encontraron paquetes)")
    info, xml = _cabecera(raw[:fin])
    cola = raw[fin:ini].decode("utf-8", errors="replace")
    tz = {t: m.group(1).strip() for t in ("TIMEZ", "TIMEO", "TIMEU") for m in [re.search(rf"<{t}>(.*?)</{t}>", cola, re.S)] if m}
    trozos, sync, resinc = _paquetes(raw, ini)
    del raw
    r = Registro()
    crudos, t_min, t_max = {}, [], []
    for (tipo, code, nv), partes in sorted(trozos.items(), key=lambda x: -len(x[1])):
        s = xml.get(code) or xml.get(ALIAS.get(code, -1))
        if s is None:
            cand = [x for c, x in xml.items() if c % 256 == code]
            s = cand[0] if len(cand) == 1 else None
        nombre = s["nombre"] if s else f"PAQUETE_{tipo}_{code}"
        canales = (s["canales"] if s else [])[:nv]
        canales = canales + [f"v{i + 1}" for i in range(len(canales), nv)]
        t, v = _matriz(tipo, nv, partes)
        if len(t) < 2:
            continue
        clave = nombre if nombre not in crudos else f"{nombre}_{code}"
        crudos[clave] = (t, v, canales, s["unidad"] if s else "", s["magnitud"] if s else "")
        t_min.append(t[0])
        t_max.append(t[-1])
        r.inventario.append(dict(sensor=clave, paquete=f"{tipo}/{code}", magnitud=s["magnitud"] if s else "", unidad=s["unidad"] if s else "",
                                 canales=", ".join(canales), muestras=int(len(t)), hz=_fs(t), desde_s=round(float(t[0]), 2),
                                 hasta_s=round(float(t[-1]), 2)))
    _estandarizar(r, crudos)
    # ---------------------------------------------- hora real de inicio
    off = _desfase(tz.get("TIMEO"))
    base = None                                  # hora UNIX (s) correspondiente a t = 0 del dispositivo
    if sync:
        ts = np.array(sync, float)
        ok = ts[:, 1] > 1e9
        if ok.any():
            base = float(np.median(ts[ok, 1] - ts[ok, 0] / 1000.0))
    if base is None and tz.get("TIMEU"):
        try:
            base = float(tz["TIMEU"]) / 1000.0
        except ValueError:
            pass
    if base is None and r.tiene("gps") and "fecha" in r.senales["gps"]["cols"]:
        f = r.col("gps", "fecha")
        ok = f > 1e9
        if ok.any():
            base = float(np.median(f[ok] - r.t("gps")[ok]))
    t0 = float(min(t_min)) if t_min else 0.0
    inicio_iso = fin_iso = None
    if base is not None:
        tzinfo = timezone(off) if off is not None else None
        ini_dt = datetime.fromtimestamp(base + t0, tz=tzinfo or timezone.utc)
        fin_dt = datetime.fromtimestamp(base + (max(t_max) if t_max else t0), tz=tzinfo or timezone.utc)
        if tzinfo is None:
            ini_dt, fin_dt = ini_dt.astimezone(), fin_dt.astimezone()
        inicio_iso, fin_iso = ini_dt.replace(tzinfo=None).isoformat(timespec="seconds"), fin_dt.replace(tzinfo=None).isoformat(timespec="seconds")
    r.meta.update(info)
    r.meta.update(formato="QUL", zona=tz.get("TIMEZ", ""), desfase=tz.get("TIMEO", ""), base_unix=base, t0=t0,
                  t1=float(max(t_max)) if t_max else t0, inicio=inicio_iso, fin=fin_iso, resincronizaciones=resinc,
                  paquetes=int(sum(len(p) for p in trozos.values())), sincronizaciones=len(sync))
    return r


def leer_qui(path: Path) -> Registro:
    con = sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True)
    r = Registro()
    crudos = {}
    try:
        meta = {}
        try:
            row = con.execute("SELECT DATA FROM FILES WHERE lower(FILENAME)='sesion.cfg' LIMIT 1").fetchone()
            if row:
                root = ET.fromstring(row[0].decode("utf-8", errors="replace"))
                for ch in root.iter("CHANNEL"):
                    d = {c.tag: (c.text or "").strip() for c in ch}
                    try:
                        meta[int(float(d.get("TAG", "")))] = d
                    except ValueError:
                        pass
        except (sqlite3.Error, ET.ParseError):
            pass
        grupos = defaultdict(list)
        for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'CHANNEL%'"):
            m = re.fullmatch(r"CHANNEL(\d+)", name)
            if not m:
                continue
            row = con.execute(f"SELECT X, Y FROM {name} LIMIT 1").fetchone()
            if not row or not row[0]:
                continue
            x = np.frombuffer(row[0][: len(row[0]) // 4 * 4], "<u4")
            y = row[1] or b""
            y = np.frombuffer(y[: len(y) // 8 * 8], "<f8") if len(x) and abs(len(y) / len(x) - 8) < .01 else np.frombuffer(y[: len(y) // 4 * 4], "<f4")
            n = min(len(x), len(y))
            d = meta.get(int(m.group(1)), {})
            grupos[d.get("MAGNITUDE") or d.get("NAME") or name].append((d.get("NAME") or name, x[:n] / 1000.0, y[:n].astype(float), d.get("UNIT", "")))
        t_min, t_max = [], []
        for g, chans in grupos.items():
            t = chans[0][1]
            if all(len(c[1]) == len(t) and np.array_equal(c[1], t) for c in chans):
                v = np.column_stack([c[2] for c in chans])
                crudos[g] = (t, v, [c[0] for c in chans], chans[0][3], g)
            else:
                for nm, tt, yy, u in chans:
                    crudos[f"{g}·{nm}"] = (tt, yy[:, None], [nm], u, g)
            for nm, tt, yy, u in chans:
                if len(tt):
                    t_min.append(tt[0])
                    t_max.append(tt[-1])
                r.inventario.append(dict(sensor=g, paquete="qui", magnitud=g, unidad=u, canales=nm, muestras=int(len(tt)), hz=_fs(tt),
                                         desde_s=round(float(tt[0]), 2) if len(tt) else None, hasta_s=round(float(tt[-1]), 2) if len(tt) else None))
    finally:
        con.close()
    _estandarizar(r, crudos)
    base = None
    if r.tiene("gps") and "fecha" in r.senales["gps"]["cols"]:
        f = r.col("gps", "fecha")
        ok = f > 1e9
        if ok.any():
            base = float(np.median(f[ok] - r.t("gps")[ok]))
    t0 = float(min(t_min)) if t_min else 0.0
    ini = datetime.fromtimestamp(base + t0).isoformat(timespec="seconds") if base else None
    r.meta.update(formato="QUI", t0=t0, t1=float(max(t_max)) if t_max else t0, inicio=ini, base_unix=base, dispositivo="", jugador="", dorsal="")
    return r


def _clave_cache(path: Path):
    st = path.stat()
    return hashlib.sha1(f"{path.name}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:16]


def leer(path, cache_dir: Path | None = None) -> Registro:
    path = Path(path)
    if cache_dir:
        cf = Path(cache_dir) / f"{_clave_cache(path)}.npz"
        if cf.exists():
            try:
                return Registro.cargar(cf)
            except Exception:  # noqa: BLE001
                pass
    with open(path, "rb") as f:
        cab = f.read(16)
    r = leer_qui(path) if cab.startswith(b"SQLite format 3") else leer_qul(path)
    r.meta["archivo"] = path.name
    r.meta["tamano_mb"] = round(path.stat().st_size / 1e6, 1)
    if not r.meta.get("inicio"):          # último recurso: fecha del nombre «…_20260523-09_39_02»
        m = re.search(r"(20\d{6})[-_](\d{2})[_\-:](\d{2})[_\-:](\d{2})", path.stem)
        if m:
            r.meta["inicio"] = datetime.strptime("".join(m.groups()), "%Y%m%d%H%M%S").isoformat()
            r.meta["inicio_fuente"] = "nombre del archivo"
    if cache_dir:
        try:
            r.guardar(Path(cache_dir) / f"{_clave_cache(path)}.npz")
        except Exception:  # noqa: BLE001
            pass
    return r


def cabecera_rapida(path):
    """Metadatos sin decodificar los paquetes (para el registro de archivos)."""
    path = Path(path)
    out = dict(archivo=path.name, tamano_mb=round(path.stat().st_size / 1e6, 1))
    if path.suffix.lower() == ".qul":
        with open(path, "rb") as f:
            cab = f.read(400_000)
        fin = cab.find(b"</NODE>")
        if fin > 0:
            info, _ = _cabecera(cab[: fin + 7])
            out.update(info)
    m = re.search(r"(20\d{6})[-_](\d{2})[_\-:](\d{2})[_\-:](\d{2})", path.stem)
    if m:
        out["fecha_nombre"] = datetime.strptime("".join(m.groups()), "%Y%m%d%H%M%S").isoformat()
    return out
