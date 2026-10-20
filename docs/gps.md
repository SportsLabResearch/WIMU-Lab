# Gráficos temporales y GPS

La interfaz incluye gráficos de series temporales, una barra horizontal de desplazamiento y un mapa de recorrido cuando existen coordenadas válidas.

## Interpretación

La posición GPS debe corresponder al instante temporal de la muestra seleccionada. Diferentes frecuencias de muestreo, discontinuidades y desfases pueden impedir una correspondencia exacta.

!!! warning "Limitación conocida"
    La sincronización gráfico–mapa de la versión 1.2.0 no se considera validada de extremo a extremo. No utilice la posición del marcador como evidencia temporal precisa sin contrastarla con los datos originales.

Las selecciones temporales deben distinguirse del análisis de la sesión completa.
