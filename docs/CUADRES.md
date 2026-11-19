# Revisión de cuadre e inventario — 14 de noviembre de 2026

Publicado el 14 de noviembre de 2026: migraciones de permisos y revisión de cierre aplicadas, función `dexter` versión 13 activa y frontend de producción disponible en [Dexter’s Granizados](https://dexter-granizados.vercel.app). Se verificó que los registros de pedidos, pagos, inventario, conteos y turnos no cambiaron durante la publicación.

## Empleado

1. En **Turno y caja → Cerrar y contar caja**, cuenta el efectivo y los vasos sueltos de cada tamaño. Verifica las ventas netas de cada cuenta, incluida Nequi; no registres el saldo bancario total.
2. Pulsa **Revisar cuadre**. La comparación muestra lo registrado, lo esperado y cuánto falta o sobra en cada concepto. Las transferencias se mantienen separadas del efectivo.
3. Corrige los campos y vuelve a revisar. Cambiar cualquier dato invalida la comparación anterior.
4. Si todo coincide, pulsa **Enviar cuadre a revisión**. Si persisten diferencias, confirma que revisaste el conteo y pulsa **Enviar provisional a revisión**.

Todo cierre espera aprobación administrativa, incluso si coincide. Sin conexión se permite enviar un cierre provisional, indicando que todavía no se verificaron los saldos; se compara al sincronizar. El turno queda bloqueado para el trabajador después del envío. Los arqueos sorpresa mantienen su conteo ciego.

## Administrador

En **Turno y caja → Cierres pendientes de aprobación**, abre **Revisar y aprobar cierre**. Reconfirma los importes y vasos del momento del cierre, revisa los comprobantes y documenta las correcciones. Los cambios de ventas o gastos siguen sus operaciones administrativas existentes; corregir un importe contado no crea ni modifica un pago.

Al aprobar se agrega una revisión vinculada al original y un movimiento de inventario por cada diferencia de vasos. El conteo original permanece intacto. Un faltante de cuatro vasos se descuenta una sola vez, de modo que no vuelva a aparecer en la siguiente apertura. Las correcciones de recetas, las mermas ya aprobadas y los ajustes de cierres anteriores se consideran para evitar duplicados, aun al revisar después de abrir otro turno.

El campo **Valor del faltante a reportar al empleado** sugiere el precio de venta con licor más alto de cada tamaño por la cantidad de vasos faltantes. Solo el administrador ve el importe y puede modificarlo al aprobar el cierre. El valor confirmado queda vinculado al turno y al motivo de la revisión.

En **Turno y caja → Faltantes y descuentos por quincena**, filtra por empleado y registra el importe descontado efectivamente y su fecha. Se permiten recuperaciones parciales hasta agotar el saldo. El registro **Ventas por mermas de empleado** conserva quién lo registró y a qué cuadre corresponde. Representa el descuento ya aplicado en la liquidación externa.

La aprobación no confirma automáticamente que el efectivo se entregó o que una transferencia llegó. Las solicitudes de remanente sin ejecutar se actualizan con el efectivo reconfirmado; si ya no hay remanente, quedan canceladas y se conserva su registro. Las entregas ejecutadas permanecen intactas.

## Merma de líquido

En **Inventario → Merma de líquido por quincena**, selecciona una fecha para consultar la primera o segunda mitad del mes por sabor. El informe muestra bolsas abiertas, onzas servidas, mermas aprobadas y saldos al inicio y al corte. Si hay líquido pendiente de verificar, se muestra un saldo estimado y queda abierta la diferencia. El umbral configurado tiene prioridad sobre la referencia histórica. Esta última usa hasta seis quincenas previas, con al menos dos periodos medibles y excluye diferencias del tamaño de una bolsa. El aviso de bolsa se activa desde el 90 % del volumen configurado para su revisión.

## Mostrador y cortesías

Cuando el saldo teórico de vasos del tamaño seleccionado llega a cero o es negativo, Mostrador ofrece **Registrar apertura de paquete**. La apertura se registra allí mismo, sin ir a Inventario. Usa las unidades configuradas (20 por defecto), pide confirmar que el paquete anterior está vacío cuando corresponde y conserva las diferencias previas. El aviso recuerda registrar una apertura ya realizada físicamente; no inventa una apertura ni bloquea por sí solo la venta.

Las cortesías entregadas ya descuentan vasos y líquido, incluidos todos los sabores de un combinado. Emitir o validar el código no consume inventario; el consumo ocurre al registrar la entrega. Las pruebas verifican también el canje parcial y la conservación de códigos no utilizados.

## Aplicación al servicio

Aplicar las migraciones pendientes, incluida `supabase/migrations/20261114200017_closing_review.sql`, y actualizar juntos la función `dexter` y el frontend. La migración agrega la validación del rol de aprobación en los commits serializados; no modifica conteos ni ventas anteriores, no agrega tablas y mantiene las funciones limitadas a `service_role`.

Los cierres históricos sin aprobación aparecen pendientes y pueden revisarse individualmente. Los clientes anteriores conservan la posibilidad de enviar su formato de cierre; la interfaz actual exige la comparación previa cuando hay conexión. El servidor siempre recalcula los importes y valida que una comparación enviada siga vigente.
