# Revisión de cuadre e inventario — 14 de noviembre de 2026

Publicado el 14 de noviembre de 2026: migraciones de permisos y revisión de cierre aplicadas, función `dexter` versión 13 activa y frontend de producción disponible en [Dexter’s Granizados](https://dexter-granizados.vercel.app). Se verificó que los registros de pedidos, pagos, inventario, conteos y turnos no cambiaron durante la publicación.

## Empleado

1. En **Turno y caja**, solicita la apertura y espera la autorización del administrador. Si vuelve el mismo responsable, cuenta el efectivo y los vasos sueltos. El administrador puede agregar artículos al autorizar. El cambio de responsable exige un conteo completo.
2. Para cerrar, registra el efectivo y los artículos del turno. Debajo del efectivo se muestran las ventas de cada cuenta, incluida Nequi. Pulsa **Enviar primer conteo**.
3. Si hay diferencias, el segundo conteo muestra los valores esperados y recupera los datos del primero. Vuelve a contar y deja una nota si sigue habiendo diferencias.
4. Verifica los medios de pago, reparte el efectivo y envía el cierre a aprobación.

Los arqueos sorpresa conservan su conteo a ciegas.

## Arqueo general y próxima apertura

En **Turno y caja**, un administrador puede elegir **Iniciar arqueo sorpresa** en el turno abierto o **Programar arqueo de apertura** para el siguiente turno del local. Los modos son **Completo**, **Solo efectivo** y **Personalizado**. El arqueo completo verifica efectivo, cuentas de transferencia y existencias físicas como bolsas selladas, paquetes y vasos sueltos. El líquido de la máquina se omite.

Para entregar el inventario verificado a un nuevo responsable, abre **Conteos registrados → Revisar conteo → Ajustar inventario al conteo**. Confirma las existencias físicas actuales y registra el motivo. El ajuste conserva el conteo y sus diferencias originales. Es un movimiento de inventario, independiente del efectivo y de los faltantes reportados al personal.

## Administrador

En **Turno y caja → Cierres pendientes de aprobación**, abre **Revisar y aprobar cierre**. Reconfirma los importes y vasos del momento del cierre, revisa los comprobantes y documenta las correcciones. Los cambios de ventas o gastos siguen sus operaciones administrativas existentes; corregir un importe contado no crea ni modifica un pago.

Al aprobar se agrega una revisión vinculada al original y un movimiento de inventario por cada diferencia de vasos. El conteo original permanece intacto. Un faltante de cuatro vasos se descuenta una sola vez, de modo que no vuelva a aparecer en la siguiente apertura. Las correcciones de recetas, las mermas ya aprobadas y los ajustes de cierres anteriores se consideran para evitar duplicados, aun al revisar después de abrir otro turno.

El campo **Valor del faltante a reportar al empleado** sugiere el precio de venta con licor más alto de cada tamaño por la cantidad de vasos faltantes. Solo el administrador ve el importe y puede modificarlo al aprobar el cierre. El valor confirmado queda vinculado al turno y al motivo de la revisión.

En **Turno y caja → Faltantes y descuentos por quincena**, filtra por empleado y registra el importe descontado efectivamente y su fecha. Se permiten recuperaciones parciales hasta agotar el saldo. El registro **Ventas por mermas de empleado** conserva quién lo registró y a qué cuadre corresponde. Representa el descuento ya aplicado en la liquidación externa.

La aprobación no confirma automáticamente que el efectivo se entregó o que una transferencia llegó. Las solicitudes de remanente sin ejecutar se actualizan con el efectivo reconfirmado; si ya no hay remanente, quedan canceladas y se conserva su registro. Las entregas ejecutadas permanecen intactas.

## Merma de líquido

En **Inventario → Merma de líquido por quincena**, selecciona una fecha para consultar la primera o segunda mitad del mes por sabor. El informe muestra bolsas abiertas, onzas servidas, mermas aprobadas y saldos al inicio y al corte. Si hay líquido pendiente de verificar, se muestra un saldo estimado y queda abierta la diferencia. El umbral configurado tiene prioridad sobre la referencia histórica. Esta última usa hasta seis quincenas previas, con al menos dos periodos medibles y excluye diferencias del tamaño de una bolsa. El aviso de bolsa se activa desde el 90 % del volumen configurado para su revisión.

Si el consumo supera el volumen registrado, contrasta las existencias con un conteo físico de bolsas selladas y verifica cuándo se abrió la bolsa en uso. Registra una apertura anterior desde **Revisar turnos** cuando se pueda confirmar su fecha y sabor. Si falta esa evidencia, documenta el conteo y usa la corrección aprobada de Inventario según sea necesario. En adelante, registra cada bolsa al momento de abrirla y agrega bolsas selladas al conteo de apertura cuando quieras verificar las existencias.

## Mostrador y cortesías

Cuando el saldo teórico de vasos del tamaño seleccionado llega a cero o es negativo, Mostrador ofrece **Registrar apertura de paquete**. La apertura se registra allí mismo, sin ir a Inventario. Usa las unidades configuradas (20 por defecto), pide confirmar que el paquete anterior está vacío cuando corresponde y conserva las diferencias previas. El aviso recuerda registrar una apertura ya realizada físicamente; no inventa una apertura ni bloquea por sí solo la venta.

Las cortesías entregadas ya descuentan vasos y líquido, incluidos todos los sabores de un combinado. Emitir o validar el código no consume inventario; el consumo ocurre al registrar la entrega. Las pruebas verifican también el canje parcial y la conservación de códigos no utilizados.

## Aplicación al servicio

Aplicar las migraciones pendientes, incluida `supabase/migrations/20261114200017_closing_review.sql`, y actualizar juntos la función `dexter` y el frontend. La migración agrega la validación del rol de aprobación en los commits serializados; no modifica conteos ni ventas anteriores, no agrega tablas y mantiene las funciones limitadas a `service_role`.

Los cierres históricos sin aprobación aparecen pendientes y pueden revisarse individualmente. El servidor recalcula los importes de cada conteo. Cuando exige un segundo conteo, valida que la comparación siga vigente antes de aceptar el cierre.

## Cierres archivados

Los cierres archivados se ocultan de **Conteos registrados**, **Cierres pendientes de aprobación** y **Diferencias para revisar**. En Turno y caja, **Mostrar cierres archivados** permite consultar su conteo original y el motivo del archivo. El servidor rechaza su aprobación para evitar ajustes tardíos sobre el inventario ya conciliado.

El archivo conserva conteos, ventas, pagos, movimientos, bases de apertura y exportaciones. No cambia el estado cerrado del turno ni representa una aprobación. La marca se conserva en `Shift.closingArchive`, con fecha, responsable, motivo y referencia al cierre posterior aprobado.

El 14 de noviembre de 2026 se archivaron, por solicitud del titular, los cierres del 13 de noviembre a las 13:39 y del 14 de noviembre a las 14:25 (hora de Colombia). Sigue vigente el del 14 a las 17:47, revisado a las 17:51. La operación quedó auditada; se verificó que las huellas de pedidos, pagos, entregas, inventario, conteos, gastos y transferencias permanecieran iguales. El respaldo y la verificación están en `.local/archive-closings-20261114/`, fuera del repositorio público.

Validación local: `npm run check`, `npm run build`, `npm run format:check`, `deno check --config supabase/functions/deno.json supabase/functions/dexter/index.ts` y las pruebas Playwright de operación, caja, transferencias y arqueo. Todos los datos de prueba se ejecutan en PGlite aislado.
