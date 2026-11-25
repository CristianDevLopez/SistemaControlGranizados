# Despliegue y operación

## Entornos

- Desarrollo: checkout local, `.env.local` con URL y clave **publicable** del proyecto exclusivo de Dexter.
- Pruebas automatizadas: PGlite aislado; servidor `127.0.0.1:5180` y PWA compilada en `.local/e2e-dist`. No usan datos del proyecto real.
- Preparación del negocio: Supabase `nglfyhcrpxuuqqnaeevf`. No habilitar ventas reales hasta cargar catálogo y completar el ensayo.
- Producción: proyecto Vercel del negocio y Supabase Dexter. Para un entorno permanente de pruebas, crear otro proyecto vacío con las mismas migraciones y sus propias claves. La configuración es independiente; no mezclar bases.

## Vercel

El 25 de noviembre de 2026 se publicaron los gastos desde cuentas administrativas, la recepción de envíos a ciegas desde caja y el registro directo de traslados por el custodio del origen. Se verificaron la web de producción, el service worker y la función `dexter` versión 39. La publicación no requirió migraciones.

El 24 de noviembre de 2026 se publicó el catálogo de sabores con las diez fotos, el cálculo de vuelto en el mostrador y el historial de promociones. El cajero solicita autorización para abrir caja y el primer conteo de cierre se hace a ciegas. Si hay diferencias, el segundo recupera los valores ingresados y muestra los esperados. Se verificaron el bundle público, las fotos precargadas por la PWA y la función `dexter` versión 36. La entrega no requirió migraciones.

El 23 de noviembre de 2026 se publicó la lectura acotada de operaciones del mostrador y la escritura de los registros que cambian. La migración `20261124010827_dexter_counter_state` agregó una lectura separada para la función `dexter` versión 34. Se verificó que la API anterior conserva su contrato, que el candidato y el dominio público sirven el mismo bundle y que los reintentos automáticos se espacian ante fallos temporales.

El 23 de noviembre de 2026 se publicó el reintento de operaciones interrumpidas por un timeout de base de datos. La función `dexter` versión 32 devuelve `RETRY_SYNC` y la PWA recupera conflictos antiguos de este tipo cuando el servidor no tiene una revisión registrada. Se verificó el candidato antes de promoverlo y después se comprobó el mismo bundle en el dominio público. No se aplicaron migraciones.

El 23 de noviembre de 2026 se publicó la corrección de la base de apertura. Dexter usa el efectivo aprobado en el último cierre y resta el remanente que ya salió de caja. La función `dexter` versión 31, el dominio de producción y el service worker se verificaron tras el despliegue. No se aplicaron migraciones.

El 22 de noviembre de 2026 se publicó el aviso persistente de actualización y la instalación con registros locales pendientes. La función `dexter` versión 29 impide reabrir los conflictos archivados del incidente. En el local principal se archivaron 28 intentos de sincronización de tres pedidos y se verificó que la bandeja quedó en cero. Se conservaron los pedidos, pagos, entregas e inventario registrados. No se aplicaron migraciones.

El 22 de noviembre de 2026 se publicó la revisión conjunta de operaciones de un pedido y la actualización de la PWA con conflictos ya recibidos por el servidor. Se verificaron el dominio de producción, el service worker y la función `dexter` versión 28. El despliegue no requirió migraciones.

El 21 de noviembre de 2026 se publicó la corrección de sincronización y envío a caja con la función `dexter` versión 27. Se verificaron el dominio de producción, el bundle, la PWA y la respuesta de salud. El despliegue no requirió migraciones.

El 21 de noviembre de 2026 se publicó Dexter v3. La migración `20261121174910_dexter_operacion_v3` está aplicada y la función `dexter` está activa en Supabase (versión 23). Se verificaron el dominio de producción, el bundle v3, la PWA y el endpoint de salud.

Actualización del 14 de noviembre de 2026: migraciones de permisos y revisión de cierres aplicadas, función `dexter` versión 13 activa y frontend de producción publicado. Se verificaron el dominio, el bundle con los controles nuevos, el backend correcto y la actualización PWA. Los registros del negocio conservan sus huellas antes y después del despliegue. Ver [cuadres e inventario](CUADRES.md) y [validación](VALIDACION.md).

Publicada para revisión en **https://dexter-granizados.vercel.app**, bajo `cristiandevlopez@gmail.com`, equipo `crisdevlopez` (Dev), proyecto `dexter-granizados`. El titular eligió Hobby gratuito; no se activó ningún plan de pago. [Vercel restringe Hobby al uso personal no comercial](https://vercel.com/docs/limits/fair-use-guidelines). Resolver esa condición de alojamiento antes de operar el negocio.

1. La CLI ya está conectada y este directorio está vinculado al proyecto. En otro equipo, iniciar sesión con `npx vercel login` y vincular con `npx vercel link --yes --scope crisdevlopez --project dexter-granizados`.
2. `VITE_SUPABASE_URL=https://nglfyhcrpxuuqqnaeevf.supabase.co` y `VITE_SUPABASE_PUBLISHABLE_KEY` están configuradas en los tres destinos de Vercel. Solo son valores públicos; no se subieron claves de servicio, sesiones ni códigos de arranque.
3. `vercel.json` fija el preset Vite, la instalación con `npm ci`, la compilación con `npm run build` y la salida en `dist`. Publicar con el flujo de candidato y promoción que se describe abajo.
4. La función de Supabase usa el dominio publicado como `APP_URL` predeterminada y lo incluye en los orígenes permitidos. También permite los dos orígenes locales para esta etapa de revisión. Las variables de servidor `APP_URL` y `ALLOWED_ORIGINS` permiten sustituir esos valores por entorno; en producción definitiva, limitar los orígenes a los dominios usados allí. Auth tiene como Site URL `https://dexter-granizados.vercel.app` y admite el destino exacto `/recuperar-contrasena` para los enlaces de recuperación.
5. Se verificaron HTTPS, archivos PWA y CORS: origen publicado aceptado, dominio ajeno rechazado y lectura anónima bloqueada. Falta validar acceso real con Google o contraseña y dispositivo y el ensayo completo con el equipo de caja.

`vercel.json` configura las rutas de la app y la revalidación de `sw.js`. Dexter busca actualizaciones al abrir, al volver a primer plano, al recuperar conexión y cada minuto mientras está visible. Cuando la versión ya se descargó, **Actualizar app** aparece en la cabecera incluso con el turno abierto. La app conserva la cola y las fotos guardadas en el equipo y retoma la sincronización al volver a abrir. Para pasar desde una versión anterior que no muestra el aviso, cierra todas las ventanas y pestañas de Dexter y vuelve a abrir en el mismo navegador. Las pruebas usan el modo `e2e`; **no desplegar ese modo** ni su directorio.

### Publicación con candidato y promoción

1. Preparar una copia con el código que se va a publicar. Ejecutar `npm run check`, `npm run build` y las pruebas de navegador del flujo afectado. Para cambios de caja o sincronización, comprobar una venta entre dos equipos con historial acumulado, un reintento sin duplicados y la actualización de la PWA con un turno abierto y operaciones pendientes. Las pruebas usan PGlite y datos de ejemplo.
2. Guardar el ID del despliegue activo (`npx vercel inspect dexter-granizados.vercel.app --scope crisdevlopez`). Si cambia la función de Supabase, guardar su código activo con `supabase functions download dexter --use-api --workdir <directorio-vacío> --project-ref nglfyhcrpxuuqqnaeevf`. Validar que la función nueva acepta los comandos de la versión web activa y su cola antes de publicarla. Cuando haya cambios de esquema, aplicar primero las migraciones compatibles con las versiones activa y nueva.
3. Crear el candidato de Vercel con la configuración de producción y conservar el dominio en el despliegue activo. Tomar la URL del resultado.

   ```powershell
   npx vercel deploy --prod --skip-domain --yes --scope crisdevlopez
   ```

4. Al cambiar la función, publicarla y comprobar primero su salud. Verificar la web candidata y guardar el nombre del bundle que devuelve el script. Usar `-ProtectedDeployment` para la URL protegida de Vercel. Si la CLI crea un secreto de bypass para la comprobación, retirarlo al terminar desde la configuración de protección del proyecto.

   ```powershell
   $bundle = ./scripts/verify-release.ps1 -WebOrigin $candidato -ProtectedDeployment
   ```

5. Promover el candidato validado y comprobar que el dominio público sirve ese mismo bundle. Si falla la verificación de la web, volver al despliegue anterior con `npx vercel rollback <id-anterior> --yes --scope crisdevlopez` y verificar de nuevo. Si falla la función, volver a publicar su código anterior mientras el esquema siga siendo compatible.

   ```powershell
   npx vercel promote $candidato --yes --scope crisdevlopez
   ./scripts/verify-release.ps1 -ExpectedBundle $bundle
   ```

## Migraciones y función

```powershell
supabase login
supabase link --project-ref nglfyhcrpxuuqqnaeevf
supabase db push
supabase functions deploy dexter --no-verify-jwt
```

El `--no-verify-jwt` solo desactiva la comprobación genérica del gateway: la función implementa su propia autenticación y autorización, necesarias para el acceso con PIN y la configuración inicial. Las rutas protegidas verifican el JWT con Supabase Auth; admin requiere un perfil activo con rol administrativo. La única ruta pública sin credenciales que muestra información es `health`. PIN y configuración tienen límites de intentos y credenciales propias.

La función usa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY` provistos por el entorno. Configurar los otros secretos con `supabase secrets set --env-file <archivo privado>`. Nunca añadir `VITE_` a una clave privada. Ver `.env.example`.

## Activación privada de superadministrador

Reservada para `cristiandevlopez@gmail.com`. La cuenta administradora del cliente mantiene su rol habitual. La migración `superadmin_access` añade una reserva privada con RLS y una función limitada a `service_role`; los roles de negocio siguen siendo admin, encargado y apoyo.

1. Aplicar todas las migraciones y preparar con `npm run superadmin -- --email cristiandevlopez@gmail.com --prepare`. Para otro dominio, añadir `--url https://dominio`.
2. Ejecutar `.local/superadmin-setup.sql` exclusivamente en el proyecto correspondiente. Solo renueva una reserva aún sin activar para el mismo correo.
3. Abrir `.local/acceso-superadmin.html` en el equipo del titular. El enlace privado vence en 24 horas y se usa una sola vez. El token viaja en el fragmento y se elimina de la barra al abrir. Los archivos `.local` no se publican.
4. Elegir nombre y contraseña (14–200 caracteres). El superadministrador entra directamente: no registra equipos, cajas ni PIN offline.
5. Para volver a ingresar, elegir **Administrador** e introducir Google o el correo y contraseña. Solo esta identidad recibe **Vista de la aplicación**.

El gateway identifica al superadministrador con su perfil reservado, JWT validado con Auth. El `session_id` firmado proporciona un contexto interno de auditoría creado automáticamente. No se solicita un nombre de equipo, PIN o código de dispositivo; el contexto no aparece en Dispositivos registrados y no admite convertirse en equipo principal. El titular puede iniciar su propia caja como administrador conectado, conservando su identidad y la sesión que realizó cada operación. Los demás roles mantienen su validación de dispositivo y token.

La vista **Administrador** permite operar el catálogo y la configuración con la identidad real del titular. Un solo admin activo puede agregar sabores, modificar precios y parámetros, crear promociones y metas; los cambios se guardan directamente y conservan responsable e histórico. No se usa la cuenta de otro administrador para operar.

Las vistas **Encargado** y **Apoyo** son de consulta. Adaptan identidad, menús y datos visibles, conservando la sesión real. Las escrituras se bloquean en el estado de la app, en la API del navegador y en el gateway con `X-Preview-Role`. Hay que terminar y sincronizar pendientes antes de cambiar de vista. Volver a Superadministrador recupera la vista completa y descarta los formularios de la vista anterior. Al recargar o salir se abandona la vista elegida. Las aprobaciones de operaciones financieras conservan sus reglas.

La función `dexter_superadmin` reclama la reserva y crea el perfil en una transacción, borrando hash y vencimiento al completarla. Los intentos concurrentes no dejan cuentas Auth huérfanas. La creación genérica de usuarios rechaza el correo reservado. Los administradores de negocio no pueden modificar ni asignar este acceso o sus dispositivos; sus listados y exportaciones omiten la identidad privada. El privilegio se elimina del caché offline.

## Inicio de caja por un administrador

En **Turno y caja → Iniciar caja**, un admin con conexión indica la base inicial y confirma. El turno queda abierto y autorizado por ese mismo usuario; a continuación se presenta el conteo de apertura. Si existe un saldo físico anterior, se utiliza ese saldo en lugar de reemplazarlo con una base nueva.

Esto también funciona desde Superadministrador y desde su vista Administrador, sin registrar una caja física. El admin puede cobrar, contar y cerrar su propio turno conectado, incluso tras volver a ingresar con su cuenta. Las operaciones conservan el usuario y la sesión real que las hizo. Solo puede existir un turno abierto, solicitado o provisional a la vez **por local**; un admin no pasa a ser cajero del turno de otra persona por tener ese rol. Ver [locales y mensualidades](MULTILOCALES.md) para selección, solicitudes y gestión del desarrollador.

El encargado sigue solicitando apertura desde el equipo principal para que un admin la autorice. La contingencia offline conserva el registro del equipo principal y la autorización presencial existente; abrir directamente como admin requiere conexión.

## Compras, gastos y traslados de dinero

- Para pagar un gasto desde una cuenta del negocio, un administrador entra a **Compras y gastos → Registrar gasto**, elige **Cuenta administrativa o caja principal** y selecciona la cuenta que pagó. Puede registrarlo con o sin turno abierto. Cuando lo aprueba un administrador distinto del custodio de la cuenta, Dexter descuenta el gasto de esa cuenta y el gasto queda fuera del cuadre de caja.
- Para un envío de Medellín con destino a Tarazá, el administrador abre **Compras y gastos → Compra y envío** con el local de Tarazá seleccionado. Elige **Medellín · crea envío**, anota proveedor, artículos, cantidades y costos y guarda. El envío aparece en el local seleccionado y el inventario se actualiza con la recepción.
- Cuando llega la mercancía, el responsable del turno en Tarazá, con permiso de inventario y conexión, abre **Compras y gastos → Recibir a ciegas** en el envío del proveedor. Cuenta el total físico de cada artículo, registra cuántos de ese total están dañados, adjunta una foto y confirma. Por ejemplo, de 10 unidades que llegan, con 2 dañadas, registra 10 recibidas y 2 dañadas. Dexter suma las 8 utilizables al inventario. Si faltan unidades, el envío queda parcial y la siguiente entrega se registra sobre el mismo envío. El administrador ve el cruce en **Recepciones y cruces**.
- El encargado registra la salida desde **Mi turno → Registrar traslado** después de entregar o consignar el efectivo. El administrador usa **Dinero → Nuevo movimiento** para mover fondos de sus cuentas, o de la caja si es el responsable del turno activo. Se pide comprobante cuando el destino es bancario. El movimiento queda ejecutado al guardarlo y el custodio del destino confirma cuánto recibió. Si ambas ubicaciones están bajo la misma custodia, la confirmación es automática. Los pagos de utilidades y los reembolsos históricos conservan su proceso de autorización.

## Recuperación de contraseña

El acceso de administrador incluye **Olvidé mi contraseña**. Los administradores conectados pueden abrir la recuperación desde su perfil sin cerrar la sesión. Supabase envía el enlace; la aplicación verifica la sesión antes de cambiar la contraseña. No solicita Authenticator ni usa rutas de servidor que cambien contraseñas con privilegios de servicio.

Configurar en **Authentication → URL Configuration**:

- **Site URL:** `https://dexter-granizados.vercel.app`.
- **Redirect URLs:** incluir exactamente `https://dexter-granizados.vercel.app/recuperar-contrasena`, conservando los destinos legítimos existentes.

La plantilla de recuperación debe usar `{{ .ConfirmationURL }}` para conservar el destino solicitado. El correo predeterminado de Supabase tiene límites de prueba y restricciones de destinatarios; para usuarios del negocio fuera del equipo de Supabase, configurar el SMTP del negocio. No se activa un proveedor de pago automáticamente.

La respuesta a la solicitud es genérica, exista o no la cuenta. Se manejan límites de envío y enlaces vencidos. La nueva contraseña se envía directamente a Supabase Auth: no se guarda en IndexedDB, la cola de operaciones, exportaciones ni auditoría del negocio. Las pruebas sustituyen los endpoints de Auth y nunca envían correos ni cambian contraseñas del proyecto real.

## Telegram

Configurar un bot del negocio y los IDs de los chats de gastos, anulaciones, mermas y transferencias. La cola mantiene estado y reintentos; un fallo no bloquea caja. La función despacha tras los comandos y desde **Control → Avisos → Reintentar**. No hay envíos configurados hasta introducir token y destinos. Las aprobaciones siempre se realizan dentro de la app.

## Jornada de ensayo

El cierre muestra el efectivo esperado, los cobros netos por cuenta, los vasos sueltos y paquetes cerrados por tamaño, y los insumos elegidos para el turno. El empleado puede guardar un borrador y volver tras registrar un movimiento. El conteo de apertura y los arqueos siguen a ciegas. Otro administrador confirma el cierre para habilitar el siguiente turno. Si confirma sin ajustar inventario, la próxima apertura exige un arqueo completo y su aprobación se vincula al cierre anterior.

1. Registrar y autorizar turno, contar apertura sin consultar esperados y abrir una bolsa/paquete reales de ensayo.
2. Crear pedidos desde apoyo y caja; realizar entrega parcial, cobro y entrega pendiente; registrar degustación sin venta.
3. Probar promoción con varios tamaños, cupón por QR/manual y segundo intento de canje rechazado.
4. Desconectar wifi y datos, vender, cerrar y reabrir la PWA offline con PIN; conectar y comprobar un solo pago y consumo por operación.
5. Como admin, solicitar un arqueo sorpresa seleccionando los ítems. Como responsable del turno, presentar solo los conteos solicitados; separar el efectivo posterior de la planilla. Como admin, revisar los resultados y diferencias contra el corte original e ingresar después cada folio con foto.
6. Anular con otro admin y corregir conservando o reemplazando la entrega física según corresponda. Comprobar la diferencia de dinero real.
7. Recibir mercancía parcial y dañada, revisar cruce; aprobar o rechazar los gastos y mermas con soporte.
8. Cerrar con base retenida y remanente. El custodio de destino confirma el traslado contando a ciegas. Otro administrador puede confirmar el cierre con el traslado en camino. Abrir el siguiente día y comprobar el saldo físico.
9. Exportar CSV y ejecutar el ensayo de recuperación de respaldo antes de habilitar producción.

## Incidentes

- **Tiempo de espera de la base de datos.** Dexter conserva la operación en la cola y la reintenta con la misma referencia, aumentando la pausa si persiste el fallo. **Sincronizar ahora** permite pedir un intento inmediato. Si una versión anterior dejó un timeout **Por conciliar** y el servidor no tiene una revisión registrada, actualizar en el mismo navegador recupera la cola en orden. Conservar los datos del navegador y evitar repetir cobros pendientes. En Supabase, revisar el código y la fase de los eventos `Temporary database failure` para ubicar el retraso de lectura, guardado o actualización de la vista.
- **Conflicto al sincronizar un pedido.** Los pedidos independientes siguen sincronizando, respetando el orden de cierres y otras operaciones compartidas. Al recibir un conflicto, el servidor también recibe las operaciones pendientes del mismo pedido para revisión conjunta. En **Revisiones → Sincronización**, el administrador verifica los soportes, vincula el registro correcto o descarta la operación con explicación. Evita repetir cobros que estén pendientes o en revisión.
- **Pedido de apoyo:** el borrador solo aparece a quien lo toma. **Enviar a caja** muestra la confirmación cuando el servidor lo pone a disposición de caja. Desde entonces, caja gestiona los cambios de productos. En caja, si se trabaja sin conexión, el mensaje de venta indica que quedó guardada en ese equipo y pendiente de sincronizar.
- **Cortesía rechazada por cuota agotada:** el código no se emitió. En la versión corregida, incluso los rechazos guardados por la versión anterior pasan a **Operaciones no aplicadas**; **Sincronizar ahora** envía los pendientes en orden. Para emitir esa cortesía, usar **Promociones → Solicitar cortesía adicional**, esperar la aprobación de otro administrador y seleccionarla al emitir. Si la versión anterior impide actualizar por el conflicto, exportar el respaldo local; una vez descargada la actualización, cerrar todas las ventanas y pestañas de la app y volver a abrirla en el mismo navegador, usuario y local. No borrar los datos ni repetir la operación pendiente.
- **Vigencia equivocada:** comprobar **Promociones → Cortesías y cupones emitidos**. Si la emisión fue rechazada y no hay código, corregir **Vence (hora de Colombia)** en el formulario o empezar una emisión nueva. Si el código aparece como **Vencido**, sí se emitió y cuenta en la cuota mensual del administrador que lo generó. No se edita ni se elimina el código emitido; si el beneficio sigue autorizado, se emite uno nuevo con la vigencia correcta, con aprobación adicional si ya no hay cuota.
- **Dispositivo desactivado:** la API lo rechaza en cada operación conectada. Los pendientes permanecen locales para conciliación por un admin; no se deben borrar los datos del navegador.
- **Cierre y aprobación tardía:** el conteo original no cambia. El movimiento aprobado se conserva aparte y la apertura toma el efectivo físico que quedó, considerando salidas realmente ejecutadas.
- **Consignación diferente:** queda en disputa. El dinero no se considera utilidad ni gasto por estar bajo custodia de un admin.
- **Pérdida del equipo desconectado:** el servidor no puede recuperar registros que nunca recibió. El panel permite una exportación local adicional; volver a conectar y sincronizar con frecuencia.

Supervisar cola de sincronización, fotos pendientes, errores de funciones, avisos de Telegram y resultado del respaldo. Los logs no deben contener PIN, tokens, contraseñas ni fotos.
