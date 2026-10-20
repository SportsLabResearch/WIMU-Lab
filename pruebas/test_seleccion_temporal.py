"""Pruebas de regresión de interfaz y filtrado temporal (sin datos privados)."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class TemporalTests(unittest.TestCase):
    def test_seleccion_actualiza_campos(self):
        src = (ROOT/"web"/"sesion.js").read_text(encoding="utf-8")
        self.assertIn('$("#rc-a").value = fmin(a)', src)
        self.assertIn('$("#rc-b").value = fmin(b)', src)
    def test_nombres_y_guardado(self):
        src = (ROOT/"web"/"sesion.js").read_text(encoding="utf-8")
        self.assertIn('nombre.trim()', src)
        self.assertIn('guardar({ segmentos: orden }, true)', src)
    def test_aplicar_traslada_intervalo_a_partes(self):
        js = (ROOT/"web"/"sesion.js").read_text(encoding="utf-8")
        self.assertIn('id="rc-ok">Aplicar a partes', js)
        inicio = js.index('$("#rc-ok").onclick')
        fin = js.index('$("#rc-x").onclick', inicio)
        bloque = js[inicio:fin]
        self.assertIn('parseMin($("#rc-a").value)', bloque)
        self.assertIn('parseMin($("#rc-b").value)', bloque)
        self.assertIn('addSeg(a, b, nm.trim())', bloque)
        self.assertNotIn('aplicaRecorte(a, b)', bloque)
    def test_filtros(self):
        js = (ROOT/"web"/"analisis.js").read_text(encoding="utf-8")
        py = (ROOT/"wimulab"/"servicio.py").read_text(encoding="utf-8")
        for clave in ("sesion","primero","segundo","partido","selecciones","nombre"):
            self.assertIn('value="'+clave+'"',js)
        self.assertIn('periodo == "selecciones"',py)
        self.assertIn('nombre_buscado',py)
    def test_partes_en_informe_individual(self):
        py = (ROOT/"wimulab"/"informes.py").read_text(encoding="utf-8")
        self.assertIn('hoja="Partes"',py)

if __name__ == "__main__":
    unittest.main()
