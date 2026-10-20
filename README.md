# WIMU-Lab v1.2.0

**Software experimental para análisis de datos de monitorización deportiva.**

**Autor principal:** José Pino-Ortega — Universidad de Murcia, España.  
**Repositorio:** SportsLabResearch/WIMU-Lab  
**Versión:** 1.2.0 (2026-10-20)

## Funcionalidades

- Lectura y análisis de registros WIMU compatibles.
- Importación de registros FIT, GPX, TCX y CSV de otros dispositivos, según estructura y variables disponibles.
- Análisis de series temporales, métricas deportivas, representación GPS y selección de intervalos.
- Incorporación opcional de frecuencia cardíaca procedente de archivos externos, con ajuste temporal.
- Comparación de variables compatibles entre dispositivos.
- Generación de informes y exportaciones según los datos y módulos disponibles.

## Instalación y uso

Se distribuye el código fuente Python y una interfaz web local. Consultar `requirements.txt`.

En Windows, `INICIAR_WIMU_Lab.bat` inicia el programa si el entorno Python y sus dependencias están disponibles. `COMPILAR_AUTONOMO_WINDOWS.bat` permite intentar construir una distribución autónoma, pero **no se incluye un ejecutable Windows verificado**.

## Estado de validación

**Software de investigación en desarrollo; no es un instrumento científicamente validado.** Las notas de la versión declaran pruebas funcionales en Linux/Chromium con registros concretos y pruebas automatizadas incluidas en `pruebas/`. Esas pruebas no constituyen validación de precisión o concordancia entre fabricantes. Quedan pendientes la comprobación de ejecución autónoma en Windows, la interacción con mapas reales y pruebas con exportaciones de distintos dispositivos.

## Datos y privacidad

No se incluyen registros individuales de deportistas ni datos de participantes. Antes de usar datos personales, deben cumplirse las normas de protección de datos aplicables.

## Citación

Consultar `CITATION.cff`. El DOI de Zenodo se incorporará una vez que se publique y archive una versión.

## Licencia

No se concede licencia de reutilización hasta que los titulares de los derechos determinen y añadan una licencia expresa. El código es visible, pero no debe asumirse que puede redistribuirse o modificarse libremente.
