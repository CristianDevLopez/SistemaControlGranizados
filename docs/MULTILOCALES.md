# Locales, propietarios y mensualidades

## Operación

La cuenta propietaria puede gestionar varios locales con el mismo correo, contraseña y MFA. Cada local conserva su catálogo, inventario, caja, turnos, personal, ventas, compras, promociones, metas, evidencias e histórico. Se permite una caja operativa a la vez **en cada local**. Los destinos de dinero de **Cuentas y custodia** pertenecen al local seleccionado.

El selector **Local de trabajo** cambia de local. Las pestañas del navegador mantienen su selección de forma independiente. Cambiar exige conexión y terminar la sincronización; los conflictos y fotografías pendientes deben resolverse antes. La aplicación registra un acceso de administración por local cuando hace falta. El personal entra con los equipos y permisos del local al que fue asignado.

## Solicitud y activación

1. El propietario abre **Locales y mensualidades → Solicitar local**, elige su negocio e introduce nombre y ubicación.
2. El local aparece **Pendiente de activación**, con una operación vacía y tarifa por configurar. Su catálogo inicial tiene los tamaños y precios de referencia de la aplicación, sin copiar información de otro cliente.
3. El desarrollador entra con su acceso privado de **Superadministrador**, abre **Locales y mensualidades → Configurar y activar**, indica mensualidad e inicio de cobro y cambia el estado a **Activo**.
4. El propietario selecciona el local, configura productos e inventario y registra su personal.

El desarrollador también puede **Registrar propietario** usando una cuenta administrativa existente o creando una nueva con correo y contraseña inicial de 14–200 caracteres. Se crea su negocio y un primer local pendiente. El acceso del propietario comprende automáticamente todos los locales de su negocio; ningún administrador del negocio puede asignarse acceso de desarrollador.

Los estados disponibles son pendiente, activo, suspendido y archivado. Se consulta el histórico de locales inactivos, pero no se registran operaciones. Suspender o archivar exige cerrar los turnos solicitados, abiertos o provisionales. No hay eliminación de históricos ni suspensión automática por deuda. Como en el modelo offline anterior, un equipo desconectado no recibe revocaciones remotas hasta volver a conectarse.

## Mensualidades y pagos

La tarifa es individual por local, en pesos colombianos enteros. El valor **0** indica una exención explícita; una tarifa vacía indica que falta configurarla. El local migrado permanece activo con tarifa e inicio sin definir, sin generar deudas por este cambio.

El desarrollador registra cada mensualidad desde la tarjeta del local. Cada cobro corresponde a un **mes calendario completo**, sin prorrateo automático; el primer periodo permitido es el mes de inicio de cobro. Se elige una fecha de vencimiento. Solo existe un cobro por local y mes: repetir la solicitud devuelve el mismo registro. Cambiar la tarifa conserva los importes de las mensualidades ya registradas y aplica la nueva tarifa a los cobros que se registren después.

Para recibir dinero se registra un **pago manual**, con importe, fecha y referencia. Se permiten abonos parciales; no se permite superar el saldo. El identificador de la operación evita duplicados al reintentar. El saldo y el estado —pendiente, parcial, pagado o vencido— se calculan a partir de los pagos registrados. El propietario consulta exclusivamente las mensualidades y pagos de sus negocios.

Una mensualidad sin pagos puede anularse indicando el motivo; se conserva el registro y su periodo reservado. No se anulan mensualidades con pagos. Los pagos y la auditoría son inmutables. No se integra una pasarela, no se retira dinero de cuentas y no se generan cobros de forma automática.

## Aislamiento y persistencia

- `private.businesses`: propietario de cada negocio; `private.branches`: locales y condiciones de cobro; `private.branch_members`: roles y acceso por local.
- Cada tabla de operación, dispositivo y recibo de comando tiene `branch_id`. Los UUID siguen siendo únicos globalmente. Las relaciones entre pedidos, turnos, pagos, entregas, recepciones y líneas usan claves foráneas compuestas con el local.
- `private.branch_runtime` mantiene una revisión y bloqueo independientes por local. La apertura de turnos, el dispositivo principal, folios y códigos de cupón se restringen por local.
- El gateway verifica la identidad, MFA, pertenencia al local y dispositivo antes de operar. El encabezado `X-Branch-Id` selecciona el contexto; no concede permisos. Los comandos nuevos también incluyen `branchId` y se rechazan si pertenecen a otro local. Los comandos previos sin ese campo solo pueden sincronizarse en el local migrado.
- Las RPC `dexter_branch_*` solo admiten `service_role`, mantienen `SECURITY INVOKER` y verifican el contexto. Las tablas públicas siguen bloqueadas para `anon` y `authenticated`; todas las tablas nuevas de plataforma tienen RLS y residen en el esquema privado. No se usan metadatos editables del usuario para autorizar.
- IndexedDB v2 conserva los datos anteriores, asocia su cola al local principal y separa colas, fotografías, caché y PIN por local y usuario. El último contexto del navegador se guarda como preferencia; cada pestaña mantiene su propia selección. El privilegio de desarrollador y la lista global de clientes no se guardan en el caché offline.
- La exportación ZIP conserva los CSV operativos y añade el local al `manifest.json`, con versión de esquema 2. El respaldo completo existente incluye todos los locales, propietarios, suscripciones y evidencias porque respalda `public`, `private` y el bucket privado.

La migración no modifica los JSON de los eventos existentes ni sus UUID. Asigna los registros originales al local principal y elige como propietario al primer administrador activo del negocio, excluyendo al desarrollador. Los accesos existentes se convierten en membresías del local principal. Si aún no existe un administrador del negocio, el arranque inicial vincula su cuenta al negocio.

Las funciones antiguas se conservan como puentes exclusivos del local principal; nunca agregan información de otros locales. Esto permite actualizar el servidor después de la migración sin ampliar el acceso del código anterior.

## Despliegue y verificación

1. Cerrar y sincronizar las cajas; conservar un respaldo de la instalación. No borrar IndexedDB ni pendientes de los dispositivos.
2. Aplicar `20261028123803_multi_local.sql` y `20261028123931_multi_local_access_policy.sql` al proyecto **Dexter's Granizados**, después de las migraciones existentes. No aplicar a ControlApp. Si el proveedor asigna otra versión al aplicar la migración, usar ese mismo prefijo en el archivo local.
3. Desplegar la función `dexter` con sus dependencias actualizadas y la configuración Deno existente. La autenticación se valida dentro del gateway, como antes.
4. Publicar el frontend y actualizar la PWA al terminar la operación pendiente.
5. Verificar que el local principal mantiene su catálogo, auditoría, usuarios, dispositivos y revisión, y que no se crearon locales o mensualidades de prueba en la base real. Verificar `health` 200 y snapshot anónimo 401.

Pruebas automatizadas aisladas: migración de datos preexistentes sin cambios en los eventos, solicitudes y activación, separación entre empresas, cajas y revisiones independientes, comandos de otro local rechazados, exportación por local, mensualidades sin duplicación, abonos, límites de saldo, conservación de tarifas históricas, protección de RPCs y caché. Los recorridos de navegador cubren escritorio, iPhone y Android.

Los avisos Telegram se despachan por el local de la operación. Las variables generales existentes siguen correspondiendo solo al local principal. Para otro local, configurar `TELEGRAM_BRANCH_<UUID_SIN_GUIONES_EN_MAYUSCULAS>_BOT_TOKEN` y los sufijos `_GASTOS_CHAT_ID`, `_ANULACIONES_CHAT_ID`, `_MERMAS_CHAT_ID` y `_TRANSFERENCIAS_CHAT_ID`. Sin configuración específica, no se envían sus avisos a los chats de otro negocio.

Referencias de seguridad: [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security). La instalación conserva el aviso previo de Auth sobre [protección de contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); los permisos del esquema privado se verifican por separado, porque sus tablas no se exponen a los roles del navegador.
