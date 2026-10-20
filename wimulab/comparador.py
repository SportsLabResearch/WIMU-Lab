"""Importación y concordancia entre dispositivos. Los originales no se alteran.

Formatos admitidos (v1.2.0):
  · FIT  (Garmin, Coros, Wahoo, Suunto, Polar…): decodificador propio de los mensajes «record»; no necesita fitparse.
  · GPX  (con extensiones de FC/cadencia de Garmin u otras: <hr>, <heartrate>…).
  · TCX  (Garmin Training Center).
  · CSV  separado por comas, punto y coma o tabulador; coma decimal; cabeceras en español o inglés con unidades entre
         paréntesis («FC (lpm)», «Speed (km/h)»); exportación de Polar Flow (resumen + muestras con tiempo transcurrido);
         formato largo de la Tabla 3 del módulo (participant_id, session_id, timestamp_utc, variable, value, unit).

Cada registro se devuelve como dict(time=UNIX s, hr=lpm, lat, lon, alt=m, speed=m/s). Lo que el archivo no trae es None:
las variables ausentes no se estiman, salvo la velocidad de un GPX sin velocidad, que se calcula a partir de las posiciones
y se declara en los avisos.
"""
import csv
import io
import math
import re
import struct
import unicodedata
from datetime import date, datetime, time as dtime, timedelta, timezone
from xml.etree import ElementTree as ET

import numpy as np

CAMPOS = ("time", "hr", "lat", "lon", "alt", "speed")


# --------------------------------------------------------------------------- utilidades
def _num(x, coma=False):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x) if math.isfinite(x) else None
    s = str(x).strip().strip('"')
    if not s:
        return None
    if coma:
        s = s.replace(".", "").replace(",", ".") if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s) else s.replace(",", ".")
    else:
        s = s.replace(",", ".") if s.count(",") == 1 and "." not in s else s
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except ValueError:
        return None


def _zona(tz):
    """tz: None (hora local del equipo), tzinfo o desfase en horas."""
    if tz is None or isinstance(tz, timezone):
        return tz
    if isinstance(tz, (int, float)):
        return timezone(timedelta(hours=tz))
    return tz


def _unix(dt, tz):
    """datetime → UNIX s. Las horas sin zona se interpretan en la zona indicada (la de la sesión) o en la del equipo."""
    if dt.tzinfo is None:
        z = _zona(tz)
        return dt.replace(tzinfo=z).timestamp() if z is not None else dt.timestamp()
    return dt.timestamp()


def _ts(x, tz=None):
    """Texto ISO-8601 (con o sin zona) o número UNIX → UNIX s."""
    if x is None or str(x).strip() == "":
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip()
    try:
        return _unix(datetime.fromisoformat(s.replace("Z", "+00:00")), tz)
    except ValueError:
        return None


def _clave(h):
    """«FC (lpm)» → ('fc', 'lpm'); «Speed (km/h)» → ('speed', 'km/h')."""
    h = str(h or "").strip().strip('"').lstrip("﻿")
    unidad = " ".join(re.findall(r"[\(\[]([^\)\]]*)[\)\]]", h)).strip().lower()
    base = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", h)
    base = unicodedata.normalize("NFD", base).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", base).strip("_"), unidad


ALIAS = {
    "time": ("timestamp_utc", "timestamp", "datetime", "date_time", "fecha_hora", "fechahora", "time", "tiempo", "hora",
             "elapsed_time", "elapsed", "seconds", "segundos", "tiempo_s", "time_s", "sec", "t", "fecha", "date"),
    "hr": ("hr", "heart_rate", "heartrate", "fc", "frecuencia_cardiaca", "frec_cardiaca", "pulso", "pulse", "bpm", "hr_bpm",
           "fc_lpm", "heart_rate_bpm", "frecuencia"),
    "lat": ("lat", "latitude", "latitud", "position_lat", "lat_deg"),
    "lon": ("lon", "lng", "long", "longitude", "longitud", "position_long", "lon_deg"),
    "alt": ("alt", "altitude", "altitud", "elevation", "ele", "altura", "enhanced_altitude", "altitude_m"),
    "speed": ("speed", "velocidad", "vel", "enhanced_speed", "speed_m_s", "speed_ms", "speed_kmh", "speed_km_h",
              "velocidad_kmh", "velocidad_ms"),
}


# si ninguna cabecera coincide exactamente, se acepta una coincidencia parcial («Fecha y hora», «FC banda»…)
PARCIAL = {"time": r"(timestamp|fecha|hora|tiempo|time|date)", "hr": r"(^fc(_|$)|heart|pulso|frecuencia_card|^hr(_|$))",
           "lat": r"^lat", "lon": r"^(lon|lng)", "alt": r"(altitud|altitude|elevation)", "speed": r"(veloc|speed)"}


def _indices(claves):
    idx = {}
    for campo, alias in ALIAS.items():
        j = next((claves.index(a) for a in alias if a in claves), None)
        if j is None:
            j = next((k for k, c in enumerate(claves) if c and re.search(PARCIAL[campo], c) and k not in idx.values()), None)
        if j is not None:
            idx[campo] = j
    return idx


def _haversine(lat1, lon1, lat2, lon2):
    r = math.radians
    a = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 6371008.8 * 2 * math.asin(min(1.0, math.sqrt(a)))


def _velocidad_desde_posiciones(filas):
    """Velocidad (m/s) centrada en ±1 s a partir de lat/lon, solo donde el archivo no la trae."""
    gps = [r for r in filas if r.get("lat") is not None and r.get("lon") is not None]
    n = len(gps)
    for i, r in enumerate(gps):
        a, b = i, i
        while a > 0 and r["time"] - gps[a - 1]["time"] <= 1.0:
            a -= 1
        while b < n - 1 and gps[b + 1]["time"] - r["time"] <= 1.0:
            b += 1
        if a == b:
            a, b = (i - 1, i) if i > 0 else (0, min(1, n - 1))
        dt = gps[b]["time"] - gps[a]["time"]
        if a == b or not 0 < dt <= 10:
            continue
        d = sum(_haversine(gps[k]["lat"], gps[k]["lon"], gps[k + 1]["lat"], gps[k + 1]["lon"]) for k in range(a, b))
        r["speed"] = d / dt


# --------------------------------------------------------------------------- GPX / TCX
def _leer_xml(contenido, ext, tz, info):
    txt = contenido.lstrip(b"\xef\xbb\xbf \t\r\n")
    root = ET.fromstring(txt)
    loc = lambda el: el.tag.split("}")[-1]  # noqa: E731
    filas = []
    if ext == "gpx":
        info["dispositivo"] = root.get("creator") or ""
        pts = [el for el in root.iter() if loc(el) == "trkpt"] or [el for el in root.iter() if loc(el) == "rtept"]
        for p in pts:
            d = dict.fromkeys(CAMPOS)
            d["lat"], d["lon"] = _num(p.get("lat")), _num(p.get("lon"))
            for c in p.iter():
                tag, val = loc(c).lower(), (c.text or "").strip()
                if c is p or not val:
                    continue
                if tag == "time":
                    d["time"] = _ts(val, tz)
                elif tag == "ele":
                    d["alt"] = _num(val)
                elif tag in ("hr", "heartrate", "heart_rate") and d["hr"] is None:
                    d["hr"] = _num(val)
                elif tag == "speed" and d["speed"] is None:
                    d["speed"] = _num(val)
            filas.append(d)
    else:  # TCX
        cr = next((el for el in root.iter() if loc(el) == "Creator"), None)
        if cr is not None:
            nm = next((el for el in cr.iter() if loc(el) == "Name"), None)
            info["dispositivo"] = (nm.text or "").strip() if nm is not None else ""
        for p in (el for el in root.iter() if loc(el) == "Trackpoint"):
            d = dict.fromkeys(CAMPOS)
            for c in p.iter():
                tag, val = loc(c), (c.text or "").strip()
                if c is p:
                    continue
                if tag == "Time":
                    d["time"] = _ts(val, tz)
                elif tag == "LatitudeDegrees":
                    d["lat"] = _num(val)
                elif tag == "LongitudeDegrees":
                    d["lon"] = _num(val)
                elif tag == "AltitudeMeters":
                    d["alt"] = _num(val)
                elif tag == "HeartRateBpm":
                    v = next((x for x in c.iter() if loc(x) == "Value"), None)
                    d["hr"] = _num(v.text) if v is not None else None
                elif tag == "Speed":
                    d["speed"] = _num(val)
            filas.append(d)
    return filas


# --------------------------------------------------------------------------- FIT (decodificador propio)
FIT_EPOCH = 631065600            # 1989-12-31T00:00:00Z
_FMT = {0: "B", 1: "b", 2: "B", 3: "h", 4: "H", 5: "i", 6: "I", 8: "f", 9: "d", 10: "B", 11: "H", 12: "I", 13: "B", 14: "q", 15: "Q", 16: "Q"}
_INV = {0: 0xFF, 1: 0x7F, 2: 0xFF, 3: 0x7FFF, 4: 0xFFFF, 5: 0x7FFFFFFF, 6: 0xFFFFFFFF, 10: 0, 11: 0, 12: 0, 13: 0xFF}


def _leer_fit(b, info):
    if len(b) < 12 or b[8:12] != b".FIT":
        raise ValueError("No es un archivo FIT válido.")
    filas, i, total = [], 0, len(b)
    while i + 12 <= total and b[i + 8:i + 12] == b".FIT":          # admite archivos FIT encadenados
        hs = b[i]
        tam = struct.unpack_from("<I", b, i + 4)[0]
        fin = min(i + hs + tam, total)
        _bloque_fit(b, i + hs, fin, filas, info)
        i = fin + 2                                                 # CRC final
    if not filas:
        raise ValueError("El archivo FIT no contiene registros de actividad («record»).")
    return filas


def _bloque_fit(b, i, fin, filas, info):
    defs, ultimo = {}, None
    S = 180.0 / 2 ** 31

    def leer(off, d):
        vals = {}
        for num, sz, bt, o in d["campos"]:
            f = _FMT.get(bt & 0x1F)
            if f is None or struct.calcsize(f) != sz:
                continue
            v = struct.unpack_from(d["e"] + f, b, off + o)[0]
            vals[num] = None if v == _INV.get(bt & 0x1F, object()) else v
        return vals

    while i < fin:
        h = b[i]
        i += 1
        if h & 0x80:                                                # cabecera de marca de tiempo comprimida
            d = defs.get((h >> 5) & 3)
            if d is None:
                raise ValueError("FIT dañado: mensaje sin definición.")
            base = ultimo or 0
            ts = base + (((h & 0x1F) - (base & 0x1F)) & 0x1F)
            vals = leer(i, d)
            i += d["size"]
        elif h & 0x40:                                              # mensaje de definición
            e = "<" if b[i + 1] == 0 else ">"
            g = struct.unpack_from(e + "H", b, i + 2)[0]
            nf, p, o, campos = b[i + 4], i + 5, 0, []
            for _ in range(nf):
                campos.append((b[p], b[p + 1], b[p + 2], o))
                o += b[p + 1]
                p += 3
            if h & 0x20:                                            # campos de desarrollador
                nd = b[p]
                p += 1
                for _ in range(nd):
                    o += b[p + 1]
                    p += 3
            defs[h & 0x0F] = dict(g=g, e=e, campos=campos, size=o)
            i = p
            continue
        else:
            d = defs.get(h & 0x0F)
            if d is None:
                raise ValueError("FIT dañado: mensaje sin definición.")
            vals = leer(i, d)
            i += d["size"]
            ts = None
        if vals.get(253) is not None:
            ultimo = ts = vals[253]
        elif ts is not None:
            ultimo = ts
        if d["g"] == 0 and vals.get(1) is not None:                 # file_id: fabricante / producto
            info.setdefault("dispositivo", f"fabricante {vals.get(1)} · producto {vals.get(2)}")
        if d["g"] == 20 and (ts if ts is not None else ultimo) is not None:   # record
            t = (ts if ts is not None else ultimo) + FIT_EPOCH
            sp = vals.get(73) if vals.get(73) is not None else vals.get(6)
            al = vals.get(78) if vals.get(78) is not None else vals.get(2)
            filas.append(dict(time=float(t),
                              hr=float(vals[3]) if vals.get(3) is not None else None,
                              lat=vals[0] * S if vals.get(0) is not None else None,
                              lon=vals[1] * S if vals.get(1) is not None else None,
                              alt=al / 5 - 500 if al is not None else None,
                              speed=sp / 1000 if sp is not None else None))


# --------------------------------------------------------------------------- CSV
_HMS = re.compile(r"^(\d{1,3}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?$")


def _hms(s):
    m = _HMS.match(s.strip())
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float((m.group(3) or "0").replace(",", ".")) if m.group(3) is not None \
        else int(m.group(1)) * 60 + int(m.group(2))       # «mm:ss»


def _fecha_hora(s, tz):
    s = s.strip().strip('"')
    if not s:
        return None
    v = _ts(s.replace(" ", "T", 1) if re.match(r"^\d{4}-\d{2}-\d{2} \d", s) else s, tz)
    if v is not None:
        return v
    for f in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S.%f", "%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y/%m/%d %H:%M:%S", "%d.%m.%Y %H:%M:%S"):
        try:
            return _unix(datetime.strptime(s, f), tz)
        except ValueError:
            pass
    return None


def _leer_csv(contenido, tz, ref, info):
    txt = contenido.decode("utf-8-sig", errors="replace")
    if "�" in txt[:5000]:
        txt = contenido.decode("latin-1")
    lineas = txt.splitlines()
    # 1) localizar la cabecera de las muestras (puede haber líneas de resumen antes)
    cab, sep = None, ","
    for k, ln in enumerate(lineas[:60]):
        if not ln.strip():
            continue
        s = max((";", "\t", ","), key=ln.count)
        claves = [_clave(c)[0] for c in next(csv.reader([ln], delimiter=s))]
        ix = _indices(claves)
        # una cabecera de muestras va seguida de filas de datos con el mismo número de columnas (el resumen de Polar, no)
        sig = [r for r in csv.reader([x for x in lineas[k + 1:k + 6] if x.strip()], delimiter=s)]
        datos_ok = 0
        for r in sig[:3]:                       # filas de datos consecutivas justo después de la cabecera
            if not (abs(len(r) - len(claves)) <= 1 and "time" in ix and len(r) > ix["time"] and re.search(r"\d", r[ix["time"]])):
                break
            datos_ok += 1
        if (("time" in ix and len(ix) >= 2 and len(claves) >= 2) or ("variable" in claves and "value" in claves)) \
                and (datos_ok >= min(2, len(lineas) - k - 1) or ("variable" in claves and "value" in claves)):
            cab, sep = k, s
            break
    if cab is None:
        raise ValueError("No se encuentra la fila de cabecera (debe tener una columna de tiempo: timestamp, time, tiempo, hora… "
                         "y al menos otra variable: FC/HR, lat, lon, velocidad…).")
    filas_txt = [r for r in csv.reader(lineas[cab + 1:], delimiter=sep) if any(x.strip() for x in r)]
    cols = [_clave(c) for c in next(csv.reader([lineas[cab]], delimiter=sep))]
    claves = [c[0] for c in cols]
    coma = sep != "," and any(re.fullmatch(r"-?\d+,\d+", x.strip()) for r in filas_txt[:100] for x in r)
    idx = _indices(claves)
    # 2) inicio declarado en el resumen (Polar Flow: Date + Start time en la fila anterior a la cabecera)
    inicio = None
    if cab >= 2:
        rc = [_clave(c)[0] for c in next(csv.reader([lineas[cab - 2]], delimiter=sep))]
        rv = next(csv.reader([lineas[cab - 1]], delimiter=sep), [])
        if "date" in rc and "start_time" in rc and len(rv) > max(rc.index("date"), rc.index("start_time")):
            d, h = rv[rc.index("date")].strip(), rv[rc.index("start_time")].strip()
            for f in ("%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%m-%d-%Y %H:%M:%S"):
                try:
                    inicio = _unix(datetime.strptime(f"{d} {h}", f), tz)
                    info["avisos"].append(f"Inicio tomado del resumen del archivo ({d} {h}).")
                    break
                except ValueError:
                    pass
    # 3) formato largo (Tabla 3): una fila por variable
    if "variable" in claves and "value" in claves:
        nombre = {"heart_rate": "hr", "hr": "hr", "fc": "hr", "speed": "speed", "velocidad": "speed", "latitude": "lat", "lat": "lat",
                  "longitude": "lon", "lon": "lon", "altitude": "alt", "alt": "alt"}
        it, iv, ivar = idx.get("time"), claves.index("value"), claves.index("variable")
        iu = claves.index("unit") if "unit" in claves else None
        por_t = {}
        for r in filas_txt:
            if it is None or len(r) <= max(it, iv, ivar):
                continue
            t = _fecha_hora(r[it], tz)
            campo = nombre.get(_clave(r[ivar])[0])
            v = _num(r[iv], coma)
            if t is None or campo is None or v is None:
                continue
            u = (r[iu].strip().lower() if iu is not None and len(r) > iu else "")
            if campo == "speed" and "km" in u:
                v /= 3.6
            por_t.setdefault(t, dict.fromkeys(CAMPOS, None) | {"time": t})[campo] = v
        info["avisos"].append("CSV en formato largo (variable/value) convertido a una fila por instante.")
        return [por_t[t] for t in sorted(por_t)]
    if "time" not in idx:
        raise ValueError("No se encuentra la columna de tiempo.")
    # 4) tiempo de cada fila
    crudos = [r[idx["time"]].strip().strip('"') if len(r) > idx["time"] else "" for r in filas_txt]
    muestra = next((x for x in crudos if x), "")
    tiempos, relativo = [], False
    if _num(muestra, coma) is not None and _HMS.match(muestra) is None:
        nums = [_num(x, coma) for x in crudos]
        v0 = next(x for x in nums if x is not None)
        if v0 > 1e12:
            tiempos = [x / 1000 if x is not None else None for x in nums]
        elif v0 > 1e9:
            tiempos = nums
        else:
            relativo = True
            tiempos = [x if x is not None else None for x in nums]
    elif _HMS.match(muestra):
        segs = [_hms(x) if x else None for x in crudos]
        if inicio is not None or (segs[0] is not None and segs[0] < 600):        # tiempo transcurrido
            relativo = inicio is None
            tiempos = [(inicio or 0) + s if s is not None else None for s in segs]
        else:                                                                     # hora del día sin fecha
            dia = datetime.fromtimestamp(ref, _zona(tz)).date() if ref else date.today()
            base = _unix(datetime.combine(dia, dtime()), tz)
            tiempos = [base + s if s is not None else None for s in segs]
            info["avisos"].append(f"El archivo solo tiene la hora del día: se ha supuesto la fecha {dia.strftime('%d/%m/%Y')}.")
    else:
        tiempos = [_fecha_hora(x, tz) for x in crudos]
    if relativo:
        info["relativo"] = True
        base = ref or 0
        tiempos = [base + x if x is not None else None for x in tiempos]
        info["avisos"].append("El tiempo del archivo es relativo (transcurrido desde el inicio): se ha colocado al principio de la "
                              "sesión. Ajuste el desfase si el registro empezó en otro momento.")
    # 5) variables
    def col(campo):
        j = idx.get(campo)
        return [(_num(r[j], coma) if j is not None and len(r) > j else None) for r in filas_txt]
    hr, lat, lon, alt, sp = col("hr"), col("lat"), col("lon"), col("alt"), col("speed")
    if "speed" in idx and any(x is not None for x in sp):
        u = cols[idx["speed"]][1] + " " + claves[idx["speed"]]
        v = [x for x in sp if x is not None]
        kmh = "km" in u or "kmh" in u or (not re.search(r"m/s|_ms\b|m_s", u) and v and float(np.percentile(v, 95)) > 12)
        if kmh:
            sp = [x / 3.6 if x is not None else None for x in sp]
            info["avisos"].append("Velocidad del archivo en km/h convertida a m/s.")
    return [dict(time=t, hr=hr[k], lat=lat[k], lon=lon[k], alt=alt[k], speed=sp[k]) for k, t in enumerate(tiempos)]


# --------------------------------------------------------------------------- API
def leer_info(nombre, contenido, tz=None, ref=None):
    """Devuelve (filas, info). tz: zona para horas sin zona (por defecto la del equipo); ref: UNIX de referencia (inicio de
    la sesión WIMU) para tiempos relativos u horas sin fecha."""
    ext = nombre.lower().rsplit(".", 1)[-1]
    info = dict(formato=ext.upper(), dispositivo="", avisos=[], relativo=False)
    if ext in ("gpx", "tcx"):
        try:
            filas = _leer_xml(contenido, ext, tz, info)
        except ET.ParseError as e:
            raise ValueError(f"El archivo {ext.upper()} no es un XML válido ({e}).") from e
    elif ext == "fit":
        filas = _leer_fit(contenido, info)
    elif ext in ("csv", "txt"):
        filas = _leer_csv(contenido, tz, ref, info)
    else:
        raise ValueError("Formato no compatible: " + ext + " (use FIT, GPX, TCX o CSV)")
    filas = [r for r in filas if r.get("time") is not None]
    for r in filas:
        for k in ("hr",):
            if r.get(k) is not None and not 20 <= r[k] <= 250:
                r[k] = None
        if r.get("lat") is not None and (not -90 <= r["lat"] <= 90 or (r["lat"] == 0 and r.get("lon") == 0)):
            r["lat"] = r["lon"] = None
    filas.sort(key=lambda r: r["time"])
    if len(filas) < 2:
        raise ValueError("El archivo no contiene al menos dos registros con tiempo válido.")
    if any(r.get("lat") is not None for r in filas) and not any(r.get("speed") is not None for r in filas):
        _velocidad_desde_posiciones(filas)
        info["avisos"].append("Velocidad calculada a partir de las posiciones (el archivo no la registra).")
    info["variables"] = [k for k in ("hr", "speed", "alt") if any(r.get(k) is not None for r in filas)]
    info["gps"] = any(r.get("lat") is not None for r in filas)
    info["inicio"], info["fin"] = filas[0]["time"], filas[-1]["time"]
    if "hr" not in info["variables"]:
        info["avisos"].append("El archivo no contiene frecuencia cardíaca.")
    return filas, info


def leer(nombre, contenido, tz=None, ref=None):
    return leer_info(nombre, contenido, tz, ref)[0]


def comparar(a, b, campo='hr', desfase=0, intervalo=1):
    if campo not in ('hr', 'speed', 'alt'):
        raise ValueError('Variable no compatible')
    if not -86400 <= desfase <= 86400:
        raise ValueError('Desfase fuera de rango')

    def pares(f, shift=0):
        z = {r['time'] + shift: r[campo] for r in f if r.get(campo) is not None}
        x = np.array(sorted(z), dtype=float)
        y = np.array([z[t] for t in x], dtype=float)
        if len(x) < 2:
            raise ValueError('La variable no está disponible en ambos dispositivos')
        return x, y
    xa, ya = pares(a)
    xb, yb = pares(b, desfase)
    lo = max(xa[0], xb[0])
    hi = min(xa[-1], xb[-1])
    if hi - lo < intervalo:
        raise ValueError('Sin solapamiento temporal. Revisa la hora y el desfase.')
    grid = np.arange(lo, hi + intervalo * 0.5, intervalo)
    if len(grid) > 200000:
        raise ValueError('Intervalo demasiado pequeño para la duración')
    aa = np.interp(grid, xa, ya)
    bb = np.interp(grid, xb, yb)

    # Evitar interpolar atravesando lagunas de datos mayores que 10 s.
    def valid(x):
        j = np.searchsorted(x, grid, side='left')
        l = np.clip(j - 1, 0, len(x) - 1)
        r = np.clip(j, 0, len(x) - 1)
        return (x[r] - x[l] <= max(10, intervalo * 2))
    ok = valid(xa) & valid(xb)
    aa = aa[ok]
    bb = bb[ok]
    tt = grid[ok]
    if len(aa) < 3:
        raise ValueError('Menos de tres muestras emparejadas válidas')
    diff = bb - aa
    bias = float(np.mean(diff))
    sd = float(np.std(diff, ddof=1))
    rmse = float(np.sqrt(np.mean(diff ** 2)))
    st = max(1, len(tt) // 1200)
    return {'variable': campo, 'n': len(aa), 'sesgo_B_menos_A': bias, 'limites_acuerdo_95': [bias - 1.96 * sd, bias + 1.96 * sd],
            'rmse': rmse, 'mae': float(np.mean(np.abs(diff))),
            'pearson_r': float(np.corrcoef(aa, bb)[0, 1]) if np.std(aa) > 0 and np.std(bb) > 0 else None,
            'inicio': float(tt[0]), 'final': float(tt[-1]),
            'serie': [{'t': round(float(t - tt[0]), 2), 'a': round(float(x), 3), 'b': round(float(y), 3)} for t, x, y in zip(tt[::st], aa[::st], bb[::st])],
            'advertencia': 'La correlación no equivale a concordancia. Límites descriptivos, no validación de instrumentos. No se ajusta automáticamente el desfase.'}


def analizar(filas):
    """Análisis descriptivo sin inventar variables ausentes; tiempos originales preservados."""
    if not filas:
        raise ValueError('Sin registros')
    start = filas[0]['time']
    end = filas[-1]['time']

    def resumen(campo):
        v = [r[campo] for r in filas if r.get(campo) is not None and math.isfinite(r[campo])]
        return None if not v else {'n': len(v), 'media': float(np.mean(v)), 'min': float(min(v)), 'max': float(max(v)), 'sd': float(np.std(v, ddof=1)) if len(v) > 1 else None}
    gps = [r for r in filas if r.get('lat') is not None and r.get('lon') is not None and -90 <= r['lat'] <= 90 and -180 <= r['lon'] <= 180]
    distancia = 0.
    segmentos = 0
    for a, b in zip(gps, gps[1:]):
        dt = b['time'] - a['time']
        if not 0 < dt <= 10:
            continue
        distancia += _haversine(a['lat'], a['lon'], b['lat'], b['lon'])
        segmentos += 1
    stride = max(1, math.ceil(len(filas) / 5000))
    return {'n': len(filas), 'duracion_s': end - start, 'variables': {k: resumen(k) for k in ('hr', 'speed', 'alt')}, 'gps_n': len(gps),
            'distancia_gps_m': distancia if segmentos else None,
            'serie': [{'t': round(r['time'] - start, 3), 'hr': r.get('hr'), 'speed': r.get('speed'), 'alt': r.get('alt'), 'lat': r.get('lat'), 'lon': r.get('lon')} for r in filas[::stride]],
            'advertencia': 'Análisis descriptivo. La distancia GPS excluye saltos temporales mayores de 10 segundos. La velocidad se expresa en m/s. Las variables ausentes no se estiman.'}
