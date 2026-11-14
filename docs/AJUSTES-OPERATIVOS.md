# Ajustes operativos del 13 de noviembre de 2026

Estado: implementación integrada sobre main para revisión en PR. No se aplicaron cambios ni datos de prueba al proyecto publicado.

## Cambios y compatibilidad

- Se conservan los roles `admin`, `encargado` y `apoyo`. Los permisos ausentes conservan el comportamiento del rol. Un administrador edita restricciones por trabajador y local desde Equipo y accesos. Apoyo nunca cobra, registra gastos ni mueve dinero; cobrar sigue exigiendo el responsable y dispositivo del turno. Se conserva `sellerId` al editar o cobrar el pedido del apoyo.
- Los turnos cerrados y provisionales quedan bloqueados para los trabajadores. Se comprueba el turno declarado y el de pedidos, conteos, gastos y movimientos referenciados, incluso al abrir un turno nuevo. Administradores conectados con MFA registran correcciones sin reescribir conteos, pagos ni movimientos inmutables. El remanente posterior al cierre lo registra un administrador.
- El cuadre guarda una fila por efectivo y por cuenta configurada que recibe ventas, más cuentas históricas del turno aunque estén desactivadas. Efectivo compara saldo físico; cada cuenta compara recaudo neto de ventas del turno, después de devoluciones. No representa el saldo completo de un banco ni incluye sus movimientos ajenos a ventas. Nombre, contado, esperado y diferencia quedan congelados en el conteo. Se conserva el formato de cuadre ya integrado en main (`payments`, `paymentLabels`, `expectedPayments` y `paymentDifferences`), el conteo ciego y los arqueos selectivos. Las devoluciones netas pueden dar recaudos negativos sin confundirlos con un saldo bancario.
- Las promociones de producto gratis nuevas exigen tamaños y sabores explícitos. Los cupones nuevos conservan una copia del beneficio y productos elegibles en el momento de emisión, incluso al editar después la promoción. El estado activo y límite global siguen consultándose. Los cupones anteriores sin copia conservan las reglas históricas. `stackable` ausente mantiene la acumulación existente en productos distintos. Las promociones antiguas sin tamaños/sabores pueden desactivarse sin alterar sus condiciones.
- Se elige la mejor combinación permitida de beneficios. Ningún producto recibe dos descuentos. Un cupón no acumulable compite como beneficio exclusivo del pedido, sin promociones de horario. Solo los códigos realmente aplicados se consumen con la venta. Tres cortesías pueden cubrir tres productos; una puede cubrir uno de dos, pagándose el otro por efectivo o transferencia; tres presentadas para dos productos dejan una sin canjear. Las cortesías nunca originan pagos negativos ni créditos; no se agregan a correcciones que arrastran dinero previamente pagado. Se conservan las reglas de transferencia de cupones originales en tickets sustitutos.
- Las imágenes usan los adjuntos privados y el proceso de compresión/subida existente. Cualquier usuario del local puede leer la imagen publicada de un sabor; las demás evidencias mantienen su autorización. Sin imagen o sin acceso a ella se conserva la ilustración del producto. El catálogo se ordena por nombre y filtra con/sin licor.
- La sincronización comparte la promesa de trabajo en curso: adjuntar una foto y guardar después el sabor espera la operación anterior y no informa erróneamente una validación pendiente.

## Aplicación pendiente

1. Revisar las diferencias y ejecutar las comprobaciones descritas abajo. Preparar un respaldo y ensayar primero en un entorno separado.
2. Aplicar `supabase/migrations/20261113203835_operational_permissions_courtesies.sql` mediante el flujo de migraciones del proyecto. Añade `permissions` a perfiles y membresías sin modificar roles ni eventos previos, actualiza sus RPC y agrega la revalidación de permisos/cierre al commit serializado. Las funciones son `SECURITY INVOKER` y solo de servicio; las tablas conservan RLS y los permisos directos revocados.
3. Actualizar la Edge Function `dexter` y después el frontend con esta revisión. El motor compartido, gateway y migración deben proceder de la misma revisión. No basta publicar solo el frontend.
4. Actualizar la PWA de caja al terminar y sincronizar el turno. Verificar guía de perfiles, permisos de cada trabajador y cuentas receptoras. Cargar fotografías reales y revisar condiciones de las cortesías antes de emitirlas.
5. En el entorno de ensayo, comprobar cámara y compartir archivos en teléfonos/tablets físicos; la prueba automatizada decodifica el QR generado pero no sustituye esa comprobación del dispositivo.

No se generaron imágenes, usuarios, cuentas ni ventas de demostración en la base real. El [manual HTML interactivo](manuales/manual-administradores-empleados.html) incluye las instrucciones finales y funciona sin conexión. El manual fuente actualizado es `docs/manuales/manual-administradores-empleados.md`; los Word de `entregables/manuales` son exportaciones anteriores y no forman parte de esta actualización.

## Validación reproducible aislada

```powershell
npm ci
npm run check
npm run build
npm run format:check
npx playwright install chromium webkit
npm run test:e2e
deno check --config supabase/functions/deno.json supabase/functions/dexter/index.ts
git diff --check
```

Vitest ejecuta migraciones completas sobre PostgreSQL PGlite aislado. `operations.test.ts` cubre roles/permisos, cierres definitivos y provisionales, referencias manipuladas, cuadre dinámico y los ejemplos de canje. `operations-server.test.ts` comprueba las solicitudes autenticadas, permisos por local y revalidación transaccional. Se mantienen las pruebas de concurrencia, canje único e idempotencia. `media.test.ts` comprueba acceso a imágenes de catálogo sin acceso a evidencias ajenas.

Playwright utiliza únicamente el servidor loopback y una compilación `e2e` con claves ficticias. `operacion.spec.ts` comprueba la entrega de pedidos entre sesiones, edición de permisos, imagen de sabor, filtro de licor, formulario de cuadre y lectura del QR generado con ZXing, seguida del canje parcial. Se ejecuta en escritorio Chromium, iPhone WebKit y Android Chromium. No se conecta al proyecto real.
