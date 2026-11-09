# Despliegue y operación

## Entornos

- Desarrollo: checkout local, `.env.local` con URL y clave **publicable** del proyecto exclusivo de Dexter.
- Pruebas automatizadas: PGlite aislado; servidor `127.0.0.1:5180` y PWA compilada en `.local/e2e-dist`. No usan datos del proyecto real.
- Preparación del negocio: Supabase `nglfyhcrpxuuqqnaeevf`. No habilitar ventas reales hasta cargar catálogo y completar el ensayo.
- Producción: proyecto Vercel del negocio y Supabase Dexter. Para un entorno permanente de pruebas, crear otro proyecto vacío con las mismas migraciones y sus propias claves. La configuración es independiente; no mezclar bases.

## Vercel

Publicada para revisión en **https://dexter-granizados.vercel.app**, bajo `cristiandevlopez@gmail.com`, equipo `crisdevlopez` (Dev), proyecto `dexter-granizados`. El titular eligió Hobby gratuito; no se activó ningún plan de pago. [Vercel restringe Hobby al uso personal no comercial](https://vercel.com/docs/limits/fair-use-guidelines). Resolver esa condición de alojamiento antes de operar el negocio.

1. La CLI ya está conectada y este directorio está vinculado al proyecto. En otro equipo, iniciar sesión con `npx vercel login` y vincular con `npx vercel link --yes --scope crisdevlopez --project dexter-granizados`.
2. `VITE_SUPABASE_URL=https://nglfyhcrpxuuqqnaeevf.supabase.co` y `VITE_SUPABASE_PUBLISHABLE_KEY` están configuradas en los tres destinos de Vercel. Solo son valores públicos; no se subieron claves de servicio, sesiones ni códigos de arranque.
3. `vercel.json` fija preset Vite, instalación `npm ci`, build `npm run build` y salida `dist`. Actualizar con `npx vercel deploy --prod --yes --scope crisdevlopez`. El destino denominado production por Vercel es la publicación web; la operación del negocio sigue pendiente de habilitación.
4. La función de Supabase usa el dominio publicado como `APP_URL` predeterminada y lo incluye en los orígenes permitidos. También permite los dos orígenes locales para esta etapa de revisión. Las variables de servidor `APP_URL` y `ALLOWED_ORIGINS` permiten sustituir esos valores por entorno; en producción definitiva, limitar los orígenes a los dominios usados allí. Auth tiene como Site URL `https://dexter-granizados.vercel.app` y admite el destino exacto `/recuperar-contrasena` para los enlaces de recuperación.
5. Se verificaron HTTPS, archivos PWA y CORS: origen publicado aceptado, dominio ajeno rechazado y lectura anónima bloqueada. Falta validar acceso real con MFA/dispositivo y el ensayo completo con el equipo de caja.

`vercel.json` configura las rutas de SPA, encabezados y evita cachear `sw.js`. La actualización se ofrece cuando no hay turno abierto ni pendientes locales. Las pruebas usan el modo `e2e`; **no desplegar ese modo** ni su directorio.

## Migraciones y función

```powershell
supabase login
supabase link --project-ref nglfyhcrpxuuqqnaeevf
supabase db push
supabase functions deploy dexter --no-verify-jwt
```

El `--no-verify-jwt` solo desactiva la comprobación genérica del gateway: la función implementa su propia autenticación y autorización, necesarias para el acceso con PIN y la configuración inicial. Las rutas protegidas verifican el JWT con Supabase Auth; admin requiere `aal2`. La única ruta pública sin credenciales que muestra información es `health`. PIN y configuración tienen límites de intentos y credenciales propias.

La función usa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY` provistos por el entorno. Configurar los otros secretos con `supabase secrets set --env-file <archivo privado>`. Nunca añadir `VITE_` a una clave privada. Ver `.env.example`.

## Activación privada de superadministrador

Reservada para `cristiandevlopez@gmail.com`. La cuenta administradora del cliente mantiene su rol habitual. La migración `superadmin_access` añade una reserva privada con RLS y una función limitada a `service_role`; los roles de negocio siguen siendo admin, encargado y apoyo.

1. Aplicar todas las migraciones y preparar con `npm run superadmin -- --email cristiandevlopez@gmail.com --prepare`. Para otro dominio, añadir `--url https://dominio`.
2. Ejecutar `.local/superadmin-setup.sql` exclusivamente en el proyecto correspondiente. Solo renueva una reserva aún sin activar para el mismo correo.
3. Abrir `.local/acceso-superadmin.html` en el equipo del titular. El enlace privado vence en 24 horas y se usa una sola vez. El token viaja en el fragmento y se elimina de la barra al abrir. Los archivos `.local` no se publican.
4. Elegir nombre y contraseña (14–200 caracteres) y activar TOTP. El superadministrador entra directamente: no registra equipos, cajas ni PIN offline.
5. Para volver a ingresar, elegir **Administrador** e introducir el correo, contraseña y TOTP. Solo esta identidad recibe **Vista de la aplicación**.

El gateway identifica al superadministrador con su perfil reservado, JWT validado con Auth y MFA. El `session_id` firmado proporciona un contexto interno de auditoría creado automáticamente. No se solicita un nombre de equipo, PIN o código de dispositivo; el contexto no aparece en Dispositivos registrados y no admite convertirse en equipo principal. El titular puede iniciar su propia caja como administrador conectado, conservando su identidad y la sesión que realizó cada operación. Los demás roles mantienen su validación de dispositivo y token.

La vista **Administrador** permite operar el catálogo y la configuración con la identidad real del titular. Un solo admin activo puede agregar sabores, modificar precios y parámetros, crear promociones y metas; los cambios se guardan directamente y conservan responsable e histórico. No se usa la cuenta de otro administrador para operar.

Las vistas **Encargado** y **Apoyo** son de consulta. Adaptan identidad, menús y datos visibles, conservando la sesión real. Las escrituras se bloquean en el estado de la app, en la API del navegador y en el gateway con `X-Preview-Role`. Hay que terminar y sincronizar pendientes antes de cambiar de vista. Volver a Superadministrador recupera la vista completa y descarta los formularios de la vista anterior. Al recargar o salir se abandona la vista elegida. Las aprobaciones de operaciones financieras conservan sus reglas.

La función `dexter_superadmin` reclama la reserva y crea el perfil en una transacción, borrando hash y vencimiento al completarla. Los intentos concurrentes no dejan cuentas Auth huérfanas. La creación genérica de usuarios rechaza el correo reservado. Los administradores de negocio no pueden modificar ni asignar este acceso o sus dispositivos; sus listados y exportaciones omiten la identidad privada. El privilegio se elimina del caché offline.

## Inicio de caja por un administrador

En **Turno y caja → Iniciar caja**, un admin con conexión y MFA indica la base inicial y confirma. El turno queda abierto y autorizado por ese mismo usuario; a continuación se presenta el conteo de apertura. Si existe un saldo físico anterior, se utiliza ese saldo en lugar de reemplazarlo con una base nueva.

Esto también funciona desde Superadministrador y desde su vista Administrador, sin registrar una caja física. El admin puede cobrar, contar y cerrar su propio turno conectado, incluso tras volver a ingresar con su cuenta. Las operaciones conservan el usuario y la sesión real que las hizo. Solo puede existir un turno abierto, solicitado o provisional a la vez **por local**; un admin no pasa a ser cajero del turno de otra persona por tener ese rol. Ver [locales y mensualidades](MULTILOCALES.md) para selección, solicitudes y gestión del desarrollador.

El encargado sigue solicitando apertura desde el equipo principal para que un admin la autorice. La contingencia offline conserva el registro del equipo principal y la autorización presencial existente; abrir directamente como admin requiere conexión.

## Recuperación de contraseña

El acceso de administrador incluye **Olvidé mi contraseña**. Los administradores conectados pueden abrir la recuperación desde su perfil sin cerrar la sesión. Supabase envía el enlace; la aplicación verifica la sesión y exige el TOTP existente antes de cambiar la contraseña. No se elimina el MFA ni se usan rutas de servidor que cambien contraseñas con privilegios de servicio.

Configurar en **Authentication → URL Configuration**:

- **Site URL:** `https://dexter-granizados.vercel.app`.
- **Redirect URLs:** incluir exactamente `https://dexter-granizados.vercel.app/recuperar-contrasena`, conservando los destinos legítimos existentes.

La plantilla de recuperación debe usar `{{ .ConfirmationURL }}` para conservar el destino solicitado. El correo predeterminado de Supabase tiene límites de prueba y restricciones de destinatarios; para usuarios del negocio fuera del equipo de Supabase, configurar el SMTP del negocio. No se activa un proveedor de pago automáticamente.

La respuesta a la solicitud es genérica, exista o no la cuenta. Se manejan límites de envío y enlaces vencidos. La nueva contraseña se envía directamente a Supabase Auth: no se guarda en IndexedDB, la cola de operaciones, exportaciones ni auditoría del negocio. Las pruebas sustituyen los endpoints de Auth y nunca envían correos ni cambian contraseñas del proyecto real.

## Telegram

Configurar un bot del negocio y los IDs de los chats de gastos, anulaciones, mermas y transferencias. La cola mantiene estado y reintentos; un fallo no bloquea caja. La función despacha tras los comandos y desde **Control → Avisos → Reintentar**. No hay envíos configurados hasta introducir token y destinos. Las aprobaciones siempre se realizan dentro de la app.

## Jornada de ensayo

1. Registrar y autorizar turno, contar apertura sin consultar esperados y abrir una bolsa/paquete reales de ensayo.
2. Crear pedidos desde apoyo y caja; realizar entrega parcial, cobro y entrega pendiente; registrar degustación sin venta.
3. Probar promoción con varios tamaños, cupón por QR/manual y segundo intento de canje rechazado.
4. Desconectar wifi y datos, vender, cerrar y reabrir la PWA offline con PIN; conectar y comprobar un solo pago y consumo por operación.
5. Hacer arqueo sorpresa, separar el efectivo de la planilla, presentar conteo e ingresar después cada folio con foto.
6. Anular con otro admin y corregir conservando o reemplazando la entrega física según corresponda. Comprobar la diferencia de dinero real.
7. Recibir mercancía parcial y dañada, revisar cruce; aprobar o rechazar los gastos y mermas con soporte.
8. Cerrar con base retenida y remanente. Ejecutar entrega/consignación y confirmar con otro usuario. Abrir el siguiente día y comprobar el saldo físico.
9. Exportar CSV y ejecutar el ensayo de recuperación de respaldo antes de habilitar producción.

## Incidentes

- **Conflicto al sincronizar:** conservar el dispositivo y exportar su cola. El admin revisa la solicitud; registra el hecho correcto con sus soportes, lo vincula o descarta con explicación y luego reintenta. No volver a cobrar por un mensaje de espera.
- **Dispositivo desactivado:** la API lo rechaza en cada operación conectada. Los pendientes permanecen locales para conciliación por un admin; no se deben borrar los datos del navegador.
- **Cierre y aprobación tardía:** el conteo original no cambia. El movimiento aprobado se conserva aparte y la apertura toma el efectivo físico que quedó, considerando salidas realmente ejecutadas.
- **Consignación diferente:** queda en disputa. El dinero no se considera utilidad ni gasto por estar bajo custodia de un admin.
- **Pérdida del equipo desconectado:** el servidor no puede recuperar registros que nunca recibió. El panel permite una exportación local adicional; volver a conectar y sincronizar con frecuencia.

Supervisar cola de sincronización, fotos pendientes, errores de funciones, avisos de Telegram y resultado del respaldo. Los logs no deben contener PIN, tokens, contraseñas ni fotos.
