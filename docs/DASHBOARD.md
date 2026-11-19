# Dashboard del administrador

En **Administración → Dashboard**, el administrador consulta los resultados del local elegido en **Local de trabajo**. La consulta usa los datos ya cargados de ese local y se actualiza al recibir cambios del estado de la aplicación. Sin conexión, muestra la información local y avisa sobre sincronización.

## Filtros

- Hoy, semana desde el lunes, mes y año hasta la fecha actual.
- Mes completo seleccionado o fechas inicial y final inclusivas, en hora de Colombia.
- Todos los turnos o un turno que se cruce con el rango. Un turno que cruza medianoche muestra únicamente las ventas cobradas dentro del rango.

## Indicadores

- **Ventas netas:** total cobrado de tickets vigentes después de descuentos. Una anulación pendiente sigue incluida hasta su aprobación. Se excluyen anulados, cancelados, abiertos e incidentes sin pago. Un ticket sustituto cuenta por su total y fecha de cobro, sin duplicar el original anulado.
- **Tickets, ticket promedio y unidades:** conteo de tickets cobrados, ventas divididas entre tickets y cantidades de sus líneas. Las unidades incluyen productos gratuitos; cada mezcla cuenta una vez.
- **Comparación:** intervalo inmediatamente anterior con el mismo número de días. No compara un turno individual. Cuando incluye hoy, la jornada actual está incompleta.
- **Evolución:** ventas, tickets o unidades por día; por mes si el rango supera 62 días. Incluye periodos sin actividad y una tabla accesible con los valores exactos.
- **Productos:** los diez sabores o mezclas y tamaños con más unidades, con su importe después de descuentos. El CSV incluye todos los productos.
- **Turnos:** ventas, tickets, promedio y unidades por turno, incluidos turnos abiertos durante el periodo sin ventas.
- **Dinero:** movimientos de cobro y devolución por fecha efectiva, separados entre efectivo y cada cuenta. El recaudo neto puede diferir de las ventas por correcciones o anulaciones de otro periodo. Los gastos son solo los aprobados, desde todas las fuentes, incluidas compras; no son un cálculo de utilidad ni de saldo disponible.
- **Operación:** descuentos, anulaciones según el cobro original, pedidos abiertos e importes entregados sin pagar del periodo.
- **Metas:** metas semanales o mensuales que se cruzan con las fechas consultadas. Muestran el avance de su periodo completo, solo con todos los turnos. Se configuran en **Configuración → Metas**.

Las anulaciones posteriores actualizan las ventas históricas; las devoluciones permanecen en la fecha en que se registraron. Las bases y los traslados de dinero no son ventas. La consulta no modifica registros.

**Exportar dashboard** descarga un CSV con el resumen y los mismos resultados de evolución, turnos, productos y medios de pago para los filtros aplicados.

## Validación

`tests/dashboard.test.ts` cubre descuentos por línea, estados de tickets, sustituciones, devoluciones de otro periodo, límites de día en Colombia, mezclas, filtros de turno, gastos aprobados, comparación, agrupación mensual, metas y rangos inválidos. `tests/e2e/dashboard.spec.ts` comprueba ventas reales del entorno aislado, filtros, exportación, acceso por rol y adaptación al ancho de escritorio y celulares.
