"""Prueba de extremo a extremo de WIMU Lab con sesiones simuladas (y el .qul real si se indica).

Uso: python pruebas/prueba_completa.py <carpeta_datos> <carpeta_resultados>
Crea además una exportación ficticia de SPRO (spro_ficticio.xlsx) para probar la concordancia.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from wimulab import analisis as A  # noqa: E402
from wimulab import informes as INF  # noqa: E402
from wimulab import servicio as SV  # noqa: E402
from wimulab import spro as SP  # noqa: E402


def main(datos, resultados):
    c = dict(SV.cfg())
    c.update(carpeta_datos=str(datos), carpeta_resultados=str(resultados))
    SV.recargar_cfg(c)
    r = SV.actualizar(lambda f, m: None)
    print("Escaneo:", r)
    assert not r["errores"], r["errores"]
    ses = SV.reg().sesiones()
    for s in ses:
        SV.reg().editar_sesion(s["id"], dict(tipo="Partido" if (s.get("inicio") or "").startswith("2026-05-24") else "Entrenamiento"))
    df = SV.tabla()
    print("Sesiones:", len(df), "Jugadores:", df["jugador_id"].nunique())
    # ---------- SPRO ficticio: distancia del canal DIST (+ ruido), vmax + 0,3, HSR × 1,05, PL × 0,98…
    rng = np.random.default_rng(3)
    filas = []
    for s in SV.reg().sesiones():
        k = s["kpis"]
        if s["etiqueta_jugador"].endswith("(sin asignar)"):
            continue
        filas.append({"Jugador": s["etiqueta_jugador"], "Fecha": pd.Timestamp(s["inicio"]).strftime("%d/%m/%Y"),
                      "Duración": f"{int(k['duracion_min'] // 60):02d}:{int(k['duracion_min'] % 60):02d}:00",
                      "Distancia (m)": round(k["distancia_m"] * (1.02 + rng.normal(0, .015)), 1),
                      "Vel. Máx (km/h)": round(k["v_max_kmh"] + .3 + rng.normal(0, .2), 2),
                      "HSR (m)": round(k["hsr_m"] * 1.05 + rng.normal(0, 4), 1), "Aceleraciones": int(k["n_acel"] + rng.integers(-2, 3)),
                      "Player Load": round(k["player_load"] * .98 + rng.normal(0, 5), 1), "FC media": round(k["fc_media"] + rng.normal(0, 1), 0)})
    xl = Path(datos).parent / "spro_ficticio.xlsx"
    with pd.ExcelWriter(xl) as w:
        pd.DataFrame([["Informe SPRO – exportación"], [""]]).to_excel(w, index=False, header=False)
        pd.DataFrame(filas).to_excel(w, index=False, startrow=2)
    imp = SP.importar(c["carpeta_datos"], xl.name, xl.read_bytes())
    print("SPRO columnas:", imp["claves"], imp["mapa"])
    con = SP.concordancia(SP.cargar(c["carpeta_datos"]), SV.reg().sesiones(), {s["id"]: s["kpis"] for s in SV.reg().sesiones()})
    print("Emparejadas:", len(con["emparejadas"]), "sin pareja:", len(con["sin_pareja"]))
    for x in con["resultados"]:
        print(f"  {x['nombre']}: n={x['n']} sesgo={x.get('sesgo')} ICC={x.get('icc_a')}")
    # ---------- informes
    real = next((s for s in SV.reg().sesiones() if s["archivo"].startswith("WIMU_18")), SV.reg().sesiones()[0])
    SV.reg().editar_sesion(real["id"], dict(segmentos=[dict(nombre="Calentamiento", desde=0, hasta=600), dict(nombre="Parte principal", desde=600, hasta=2400)]))
    for op in (dict(tipo="sesion", ids=[real["id"]]), dict(tipo="tecnico", ids=[real["id"]]),
               dict(tipo="colectivo", filtro=dict(desde="2026-05-24", hasta="2026-05-24")),
               dict(tipo="jugador", jugadores=[SV.reg().jugadores()[0]["id"]]),
               dict(tipo="estadistico", agrupar="tipo", comparacion=dict(factor="tipo", diseno="pareado"))):
        out = INF.generar(dict(op, formatos=["docx", "pdf", "xlsx"]), lambda f, m: None)
        print(op["tipo"], "→", [Path(x).name for x in out["archivos"]])


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
