"""Pruebas de la importación de otros dispositivos (v1.2.0). Genera los archivos en memoria: no usa datos reales.

Uso: python pruebas/test_importacion.py
"""
import math
import struct
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from wimulab import comparador as C  # noqa: E402
from wimulab import externos as E  # noqa: E402

MADRID = timezone(timedelta(hours=2))
T0 = datetime(2026, 10, 3, 18, 57, 6, tzinfo=MADRID)          # inicio del registro externo (hora local)
U0 = T0.timestamp()
N = 300


def fc(k):
    return 120 + 30 * math.sin(k / 60)


def pos(k):
    return 38.3327 + 0.00001 * k, -0.5119 + 0.00001 * math.sin(k / 20)


def gpx(con_fc=True):
    pts = []
    for k in range(N):
        la, lo = pos(k)
        t = (T0 + timedelta(seconds=k)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        ext = f"<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>{fc(k):.0f}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>" if con_fc else ""
        pts.append(f'<trkpt lat="{la}" lon="{lo}"><ele>20</ele><time>{t}</time>{ext}</trkpt>')
    return ('<?xml version="1.0"?><gpx version="1.1" creator="Prueba" xmlns="http://www.topografix.com/GPX/1/1" '
            'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><trkseg>' + "".join(pts) + "</trkseg></trk></gpx>").encode()


def tcx():
    pts = []
    for k in range(N):
        la, lo = pos(k)
        t = (T0 + timedelta(seconds=k)).isoformat()
        pts.append(f"<Trackpoint><Time>{t}</Time><Position><LatitudeDegrees>{la}</LatitudeDegrees><LongitudeDegrees>{lo}</LongitudeDegrees></Position>"
                   f"<HeartRateBpm><Value>{fc(k):.0f}</Value></HeartRateBpm><Extensions><ns3:TPX><ns3:Speed>1.1</ns3:Speed></ns3:TPX></Extensions></Trackpoint>")
    return ('<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" '
            'xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Activities><Activity><Lap><Track>' + "".join(pts) +
            "</Track></Lap></Activity></Activities></TrainingCenterDatabase>").encode()


def fit():
    rec = bytearray()
    rec += bytes([0x41, 0, 0]) + struct.pack("<HB", 20, 5) + bytes([253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 3, 1, 0x02, 6, 2, 0x84])
    S = 2 ** 31 / 180
    for k in range(N):
        la, lo = pos(k)
        rec += bytes([0x01]) + struct.pack("<IiiBH", int(U0) + k - C.FIT_EPOCH, round(la * S), round(lo * S), int(fc(k)), 1100)
    hdr = struct.pack("<BBHI4s", 14, 0x20, 2132, len(rec), b".FIT") + b"\0\0"
    return bytes(hdr + rec + b"\0\0")


def polar_flow():
    out = ["Name,Sport,Date,Start time,Duration,Average heart rate (bpm)", f"Prueba,OTHER,{T0:%d-%m-%Y},{T0:%H:%M:%S},00:05:00,130",
           "Sample rate,Time,HR (bpm),Speed (km/h),Altitude (m)"]
    out += [f"1,{k // 3600:02d}:{k % 3600 // 60:02d}:{k % 60:02d},{fc(k):.0f},3.96," for k in range(N)]
    return "\n".join(out).encode()


def csv_es():
    out = ["Exportación de prueba", "", "Fecha y hora;FC (lpm);Velocidad (km/h)"]
    out += [f"{(T0 + timedelta(seconds=k)):%d/%m/%Y %H:%M:%S};{fc(k):.0f};{3.96:.2f}".replace(".", ",") for k in range(N)]
    return "\n".join(out).encode("latin-1")


def csv_largo():
    out = ["participant_id,session_id,timestamp_utc,variable,value,unit,processing_version"]
    out += [f"P015,S001,{(T0 + timedelta(seconds=k)).astimezone(timezone.utc):%Y-%m-%dT%H:%M:%SZ},heart_rate,{fc(k):.0f},bpm,v1.0" for k in range(N)]
    return "\n".join(out).encode()


class Importacion(unittest.TestCase):
    def comprobar(self, nombre, datos, gps, velocidad=None):
        filas, info = C.leer_info(nombre, datos, MADRID, U0 - 3000)
        self.assertEqual(len(filas), N, nombre)
        self.assertAlmostEqual(filas[0]["time"], U0, delta=1, msg=nombre)              # alineado a la hora real
        self.assertAlmostEqual(filas[60]["hr"], round(fc(60)), delta=1, msg=nombre)
        self.assertIn("hr", info["variables"])
        self.assertEqual(info["gps"], gps, nombre)
        if velocidad is not None:
            v = [r["speed"] for r in filas if r["speed"] is not None]
            self.assertAlmostEqual(sum(v) / len(v), velocidad, delta=0.05, msg=nombre)  # m/s
        return filas, info

    def test_gpx(self):
        self.comprobar("reloj.gpx", gpx(), True)

    def test_gpx_sin_velocidad_la_calcula(self):
        _, info = self.comprobar("reloj.gpx", gpx(), True)
        self.assertIn("speed", info["variables"])

    def test_tcx(self):
        self.comprobar("reloj.tcx", tcx(), True, 1.1)

    def test_fit_sin_fitparse(self):
        self.comprobar("reloj.fit", fit(), True, 1.1)

    def test_polar_flow(self):
        self.comprobar("banda.csv", polar_flow(), False, 1.1)

    def test_csv_espanol_coma_decimal(self):
        self.comprobar("banda.csv", csv_es(), False, 1.1)

    def test_csv_formato_largo(self):
        self.comprobar("tabla3.csv", csv_largo(), False)

    def test_sugerencia_zona_horaria(self):
        meta = dict(base_unix=U0 + 3600 * 2 - 600, t0=0, t1=3600, desfase="+0200")   # sesión 2 h después del registro
        s = E._sugerir_desfase(meta, U0, U0 + N, None, [])
        self.assertIsNotNone(s)
        self.assertEqual(s["desfase_s"] % 3600, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
