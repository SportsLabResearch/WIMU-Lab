# Publicación y DOI sin PowerShell

1. Crear un repositorio público llamado `WIMU-Lab` en la organización `SportsLabResearch` (si no existe).
2. En GitHub, pulsar **Add file → Upload files** y subir **el contenido de esta carpeta**, no el ZIP ni la carpeta contenedora.
3. Revisar que `README.md`, `CITATION.cff`, `iniciar.py`, `wimulab/`, `web/` y `pruebas/` están en la raíz del repositorio.
4. Entrar en https://zenodo.org y conectar la cuenta GitHub desde las opciones de integración de Zenodo. Activar el repositorio WIMU-Lab cuando aparezca.
5. En GitHub, abrir **Releases → Draft a new release**, crear la etiqueta `v1.2.0`, título `WIMU-Lab v1.2.0 — Experimental research software` y publicar la release.
6. Comprobar que Zenodo haya importado la release. Completar metadatos, autores y licencia según los derechos reales, y verificar que el depósito tenga DOI.
7. Incorporar el DOI a README y CITATION.cff en una actualización posterior. Zenodo ofrece DOI de versión y DOI conceptual.

No publicar datasets con datos identificables. No declarar validación científica ni ejecutable Windows comprobado.
