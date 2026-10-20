"""Genera sesiones .qul SIMULADAS con la misma estructura que un archivo real de WIMU PRO (cabecera XML real,
GPS tipo 1/81 con 9 canales float64, ACEL 6/44, HRM 6/62, sincronización 2/0) y una exportación ficticia de SPRO,
para probar WIMU Lab con varios jugadores y sesiones.

Uso: python simular_sesiones.py <archivo_qul_real> <carpeta_salida>
"""
from __future__ import annotations

import math
import struct
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

JUGADORES = [("Pablo Martínez", 4), ("Sergio López", 7), ("Álvaro Ruiz", 9), ("Javier Sánchez", 10), ("Daniel Gómez", 14), ("Marcos Navarro", 21)]
SESIONES = [("2026-05-18 10:00", "Entrenamiento", 22, 0.9), ("2026-05-20 10:00", "Entrenamiento", 24, 1.0), ("2026-05-24 11:30", "Partido", 30, 1.3)]


def _pack(tipo, code, t_ms, vals, fmt):
    n = len(t_ms)
    k = vals.shape[1]
    w = 8 if fmt == "d" else 4
    size = 7 + k * w
    dt = np.dtype([("m", "u1", 2), ("s", "<u2"), ("ty", "u1"), ("c", "u1"), ("f", "u1"), ("t", "<u4"), ("v", "<f8" if w == 8 else "<f4", (k,)), ("x", "u1")])
    a = np.zeros(n, dt)
    a["m"] = (0xE1, 0xED)
    a["s"], a["ty"], a["c"], a["t"], a["v"] = size, tipo, code, t_ms, vals
    return a


def generar(xml_real: bytes, dest: Path, jugador, dorsal, inicio: datetime, minutos, intensidad, semilla):
    rng = np.random.default_rng(semilla)
    xml = xml_real.replace(b"<PLAYER_NAME>WIMU</PLAYER_NAME>", f"<PLAYER_NAME>{jugador}</PLAYER_NAME>".encode()) \
                  .replace(b"<PLAYER_NUMBER>18</PLAYER_NUMBER>", f"<PLAYER_NUMBER>{dorsal}</PLAYER_NUMBER>".encode()) \
                  .replace(b"<NAME>WIMU_18</NAME>", f"<NAME>WIMU_{dorsal:02d}</NAME>".encode())
    boot = inicio.timestamp() - 600                       # el dispositivo se encendió 10 min antes
    t0 = 600.0
    dur = minutos * 60
    cola = f"\n<TIMEZ>Europe/Madrid</TIMEZ><TIMEO>+0200</TIMEO><TIMEU>{boot * 1000:.6f}</TIMEU>".encode()
    # ---------------- velocidad (m/s) a 10 Hz: andar/trotar + carreras + sprints
    t10 = t0 + np.arange(0, dur, 0.1)
    base = 0.8 + intensidad * (1.1 + 0.9 * np.sin((t10 - t0) / (50 + 10 * rng.random())) + 0.6 * np.sin((t10 - t0) / 13))
    v = np.clip(base + rng.normal(0, .12, len(t10)), 0, None)
    for s in rng.uniform(t0 + 20, t0 + dur - 10, int(12 * intensidad * minutos / 20)):
        L = rng.uniform(3, 6)
        m = (t10 > s) & (t10 < s + L)
        v[m] += rng.uniform(3.5, 5.2) * np.sin(np.pi * (t10[m] - s) / L)
    pausa = rng.uniform(t0 + dur * .4, t0 + dur * .55)
    v[(t10 > pausa) & (t10 < pausa + 120)] *= .1           # descanso
    v = np.clip(np.convolve(v, np.ones(5) / 5, "same"), 0, 9.5)
    rumbo = np.cumsum(rng.normal(0, .06, len(t10)))
    lat0, lon0 = 38.5328 + rng.normal(0, 1e-4), -0.2537 + rng.normal(0, 1e-4)
    dy = np.cumsum(v * .1 * np.cos(rumbo))
    dx = np.cumsum(v * .1 * np.sin(rumbo))
    pliega = lambda u, L: L - np.abs(np.mod(u + L, 2 * L) - L) - L / 2   # noqa: E731  (rebota en las bandas: campo de 90 × 60 m)
    dy, dx = pliega(dy, 90), pliega(dx, 60)
    lat = lat0 + dy / 110540
    lon = lon0 + dx / (111320 * math.cos(math.radians(lat0)))
    sat = np.clip(np.round(11 + rng.normal(0, 1, len(t10))), 5, 14)
    pdop = np.clip(1.6 + np.abs(rng.normal(0, .3, len(t10))), 1, 8)
    dist = np.r_[0, np.hypot(np.diff(dx), np.diff(dy))] + np.abs(rng.normal(0, .02, len(t10)))
    gps = np.column_stack([lat, lon, v * 3.6, 120 + rng.normal(0, .5, len(t10)), sat, boot + t10, np.zeros(len(t10)), dist, pdop])
    # ---------------- acelerómetro 100 Hz (g)
    t100 = t0 + np.arange(0, dur, 0.01)
    vi = np.interp(t100, t10, v)
    amp = 0.05 + 0.16 * vi
    fase = 2 * np.pi * np.cumsum(1.4 + 0.25 * vi) * 0.01
    z = 1 + amp * np.sin(fase) + rng.normal(0, .03, len(t100))
    pic = rng.random(len(t100)) < (0.0004 + 0.0012 * (vi > 4))
    z[pic] += rng.uniform(2, 7, pic.sum())
    acc = np.column_stack([rng.normal(0, 1, len(t100)) * amp / 2, rng.normal(0, 1, len(t100)) * amp / 2, z])
    # ---------------- FC ~ 2 Hz con pérdidas
    th = t0 + np.arange(0, dur, 0.5)
    obj = 85 + 14 * np.interp(th, t10, np.convolve(v, np.ones(300) / 300, "same")) * intensidad ** .3
    fc = np.empty(len(th))
    f = 90.0
    for i, o in enumerate(obj):
        f += (o - f) * 0.02 + rng.normal(0, .4)
        fc[i] = f
    keep = rng.random(len(th)) > 0.05
    hr = np.column_stack([np.round(fc), 60000 / fc + rng.normal(0, 8, len(th)), np.arange(len(th))])[keep]
    th = th[keep]
    sync_t = t0 + np.arange(0, dur, 1.0)
    partes = [
        _pack(2, 0, (sync_t * 1000).astype(np.uint32), (boot + sync_t)[:, None], "d"),
        _pack(1, 81, (t10 * 1000).astype(np.uint32), gps, "d"),
        _pack(6, 44, (t100 * 1000).astype(np.uint32), acc, "f"),
        _pack(6, 62, (th * 1000).astype(np.uint32), hr, "f"),
    ]
    # intercalar por tiempo
    todos = sorted(((p["t"][i], j, i) for j, p in enumerate(partes) for i in range(len(p))), key=lambda x: x[0])
    out = bytearray(xml + cola)
    bloques = [p.tobytes() for p in partes]
    sizes = [p.dtype.itemsize for p in partes]
    for _, j, i in todos:
        out += bloques[j][i * sizes[j]:(i + 1) * sizes[j]]
    dest.write_bytes(bytes(out))


def main(real, salida):
    real, salida = Path(real), Path(salida)
    raw = real.read_bytes()
    xml = raw[: raw.find(b"</NODE>") + 7]
    salida.mkdir(parents=True, exist_ok=True)
    k = 0
    for fecha, tipo, mins, inten in SESIONES:
        d0 = datetime.strptime(fecha, "%Y-%m-%d %H:%M").replace(tzinfo=timezone(timedelta(hours=2)))
        carpeta = salida / d0.strftime("%Y-%m-%d")
        carpeta.mkdir(exist_ok=True)
        for (nom, dor) in JUGADORES:
            k += 1
            ini = d0 + timedelta(seconds=int(np.random.default_rng(k).integers(0, 90)))
            f = carpeta / f"WIMU_{dor:02d}-log_{ini:%Y%m%d-%H_%M_%S}.qul"
            generar(xml, f, nom, dor, ini, mins, inten * (0.85 + 0.3 * np.random.default_rng(100 + k).random()), k)
            print("·", f.relative_to(salida))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
