# Dexter’s · Mostrador

PWA para uno o varios locales por propietario, con una caja operativa por local, pedidos con entregas parciales, continuidad offline del equipo principal y administración remota. React, TypeScript, Vite, Dexie y Supabase. Interfaz en español; dinero en pesos enteros, fechas UTC y visualización de Colombia.

### Locales y mensualidades

El propietario solicita locales desde **Locales y mensualidades → Solicitar local**. El desarrollador, con su acceso privado de Superadministrador, configura la tarifa en COP y la fecha de inicio y activa cada local desde ese mismo panel. Puede registrar otros propietarios con una cuenta nueva o existente; cada negocio comienza con un primer local pendiente de activación.

Cada local separa caja, turnos, inventario, catálogo, ventas, personal, evidencias, exportaciones y sincronización. Una misma cuenta propietaria accede a todos sus locales con **Local de trabajo**. Los administradores y empleados del equipo se asignan al local donde se crean. Los cobros mensuales, abonos, referencias y saldos se registran manualmente por local; el propietario consulta sus mensualidades y el desarrollador registra los pagos.

La migración conserva el negocio existente como **Local principal**, activo, sin inventar una tarifa ni generar cobros. Ver [operación, modelo de datos y despliegue](docs/MULTILOCALES.md).

## Probar la aplicación

Para incorporar un desarrollador, consultar [accesos y configuración local](docs/COLABORACION.md).

Publicación para revisión: **https://dexter-granizados.vercel.app**. Cuenta `cristiandevlopez@gmail.com`, equipo `crisdevlopez`, proyecto `dexter-granizados`. Se mantuvo el plan gratuito Hobby por decisión del titular. La restricción de ese plan a uso personal no comercial debe resolverse antes de operar el negocio.

```powershell
npm ci
npm run dev
```

Abrir la URL que imprime Vite. La configuración pública de este equipo ya apunta al proyecto **Dexter's Granizados**, referencia `nglfyhcrpxuuqqnaeevf`, en la organización **Granizados**. Las migraciones y la función `dexter` están desplegadas. El proyecto anterior ControlApp se mantiene en **CristianDevLopez's Org**, con accesos independientes.

No hay sabores, usuarios ni ventas de demostración en la base real. Los precios iniciales sí provienen de la hoja Supuestos del presupuesto: 12/16/20/24 oz; con licor $14.000/$17.000/$19.500/$23.000; sin licor $10.000/$12.000/$14.500/$17.000. La nevera de 3 litros queda inactiva hasta completar su configuración.

### Acceso privado de superadministrador

Reservado para `cristiandevlopez@gmail.com`. Se activa mediante un enlace privado de un solo uso, eligiendo contraseña y doble factor; después se ingresa por **Administrador**, sin registrar equipos, cajas ni PIN offline. El acceso general no muestra una opción de superadministrador.

Solo esta identidad ve **Vista de la aplicación**: Superadministrador, Administrador, Encargado de caja y Apoyo de mostrador. **Administrador** permite agregar productos y guardar precios, promociones, parámetros y metas directamente, con la identidad real del titular y sin aprobación de otro admin. Los administradores del negocio también pueden guardar esos cambios por sí mismos. Las vistas de Encargado y Apoyo son de consulta y bloquean cambios en cliente y servidor; para caja se prioriza al encargado del turno cuando existe. **Volver a superadministrador** recupera la vista completa sin cambiar de cuenta.

Los administradores del negocio no ven este acceso en Equipo y accesos ni pueden asignarlo, desactivarlo o modificar sus dispositivos. La reserva privada admite una sola identidad. El privilegio exige conexión y MFA; no se guarda en el respaldo offline. Ver [activación y operación](docs/OPERACION.md).

### Recuperar la contraseña

En **Administrador → Olvidé mi contraseña**, introducir el correo de la cuenta. También se puede abrir **Recuperar mi contraseña** desde el botón del perfil estando conectado. El enlace lleva a `/recuperar-contrasena`: verifica el doble factor cuando ya está configurado y permite elegir y confirmar una contraseña de 14–200 caracteres. No solicita la contraseña anterior ni cambia roles o permisos. Los enlaces inválidos o vencidos permiten solicitar uno nuevo.

El destino de recuperación debe figurar en **Supabase → Authentication → URL Configuration**. Ver [operación](docs/OPERACION.md) para la configuración del correo.

### Primer administrador del negocio

1. En el acceso, elegir **Configurar primer administrador**.
2. Abrir localmente `.local/bootstrap-token.txt`. Es un código privado de un solo uso; no debe subirse al repositorio ni enviarse a empleados.
3. Elegir nombre, correo y contraseña de al menos 14 caracteres. Activar el doble factor con una aplicación de autenticación.
4. Registrar el navegador del admin. Crear los otros administradores y empleados en **Configuración → Equipo y accesos**.
5. Generar el código de registro del equipo de caja. En ese navegador, el encargado entra con usuario, PIN y código. El código vence en 15 minutos y se usa una vez. El PIN queda vinculado a ese usuario para el respaldo offline.

Un administrador conectado puede abrir su propia caja desde **Turno y caja → Iniciar caja**, indicar la base inicial y presentar el conteo, sin autorización de otro admin. El turno y su autorización quedan a su nombre; se conserva el saldo físico anterior cuando existe. Si entra el encargado, solicita el turno desde el equipo de caja y un admin lo autoriza. Los códigos de registro y las autorizaciones offline solo se generan con MFA y conexión.

Para preparar otro entorno vacío: `npm run bootstrap -- --prepare` genera el código y un SQL con su hash en `.local/bootstrap.sql`. Ejecutar ese SQL únicamente en el proyecto nuevo. Si ya existe un admin, no habilita otro código. No ejecutar de nuevo en esta instalación sin necesitar una recuperación del arranque.

## Funciones incluidas

- Pedidos simultáneos, entregas parciales, cobro exclusivo del responsable y **Cobrar y entregar**.
- Degustaciones por sabor: una onza y una copita; conserva pedidos sin venta.
- Turnos autorizados, conteos ciegos, cierres con base retenida, remanentes, arqueos sorpresa y planillas con folio y hora original.
- Inventario por movimientos; bolsas, paquetes, vasos, copitas y coronitas. Saldos negativos visibles. Daños sujetos a revisión y tolerancia configurable de líquido, con medición de línea base.
- Compras y envíos, recepción ciega con fotografías, recepciones parciales, cruce contra lo enviado y gastos vinculados.
- Anulación completa, aprobación de otro admin y ticket sustituto vinculado; traslado del pago anterior, diferencia o reembolso y conservación de la entrega física.
- Traslados del dinero del negocio a cajas o cuentas bajo custodia de admins. Solicitud, ejecución, tránsito y confirmación separados; discrepancias en disputa. Reembolsos y utilidades requieren tres votos de admins distintos.
- Constructor de precio fijo, upgrades de uno/dos tamaños, N×M y producto gratis con cupón. Cupones aleatorios con QR, vencimiento y canje único transaccional. No se capturan datos del cliente.
- Bandejas de aprobaciones y conflictos de sincronización, metas, histórico, auditoría y exportación CSV relacionada en ZIP con diccionario.
- Preparación de Telegram y respaldo cifrado en S3 independiente. Su activación requiere las credenciales del negocio: no se simula su funcionamiento.

## Offline y conciliación

Primero se intenta wifi y luego datos compartidos. En una desconexión total, el **equipo principal** concentra las modificaciones. El apoyo conserva la consulta y necesita conexión para compartir cambios.

Cada operación y su pendiente se guardan juntos en una transacción IndexedDB. La sincronización usa el mismo UUID en todos los reintentos. Se ejecuta al recuperar conexión, al abrir la sesión, periódicamente mientras la app está visible y mediante el botón de sincronización. Cerrar o recargar la PWA conserva la cola local. Para reabrir offline, usar **Entrar sin conexión** con el PIN previamente registrado.

Los cupones y beneficios con límites globales necesitan conexión. Offline se usan catálogo y promociones horarias descargados. El servidor valida usuario y dispositivo al sincronizar; un precio de una versión anterior queda identificado para revisión. El cierre offline queda provisional en el dispositivo y se valida al cargarlo al servidor.

Una operación rechazada queda conservada localmente y genera una solicitud remota. Se detiene la cola en ese punto. El admin registra la operación correcta, la vincula al conflicto o explica su descarte; después la caja puede continuar. En ningún caso se modifica el comando original o se considera cobrada una operación por el simple hecho de reintentarla. El panel permite exportar los pendientes como respaldo local.

Durante un arqueo, el sistema bloquea pedidos, entregas y cobros. Se usa papel y se mantiene separado el efectivo posterior al corte. Al terminar, un admin ingresa cada pedido con folio único, turno, hora y foto. Se conservan los conteos originales y se genera una conciliación.

La autorización offline de apertura se habilita presencialmente en caja con un PIN de contingencia de un admin. Es un permiso cifrado, de un solo uso, con vigencia de siete días y validación posterior. No implica revocación remota inmediata mientras el dispositivo sigue desconectado.

## Seguridad y datos

El navegador no puede leer ni escribir directamente las tablas de negocio. Todas tienen RLS y permisos directos revocados; la función de servidor verifica JWT con Auth, MFA, usuario activo, dispositivo y permisos por operación. El cliente de servicio nunca adopta sesiones de empleados. Las claves de servicio solo viven en servidor.

Las transacciones de servidor se serializan por revisión y bloquean la fila de control. Los comandos tienen recibo único; el canje y el cobro se confirman en la misma transacción. Pagos, consumos, entregas, conteos, recepciones, auditoría y versiones son registros inmutables; las correcciones agregan relaciones y movimientos nuevos.

Las fotos se comprimen sin metadatos y se suben al bucket privado `evidence` mediante permisos temporales. El servidor verifica formato, tamaño y hash; las lecturas requieren autorización. Las sesiones/PIN de contingencia, claves y respaldos locales no se incluyen en Git ni en Vercel.

## Validar

```powershell
npm run check
npm run build
npx playwright install chromium webkit
npm run test:e2e
deno check --config supabase/functions/deno.json supabase/functions/dexter/index.ts
npm run graph:status
```

Vitest prueba el dominio, PostgreSQL real mediante PGlite, RLS y permisos, idempotencia, concurrencia de cupones y restauración de una base y una fotografía cifradas. Playwright utiliza un servidor **aislado de loopback** y una compilación `e2e`; nunca carga sus datos en Supabase real. Recorre Chrome, WebKit con viewport de iPhone y Chromium con viewport de Android. Incluye recarga offline real mediante el service worker. La compilación normal no habilita el adaptador de pruebas.

La emulación no sustituye el ensayo de instalación, cámara y uso en iPhone, Android y tablet físicos. La restauración de prueba automatizada tampoco sustituye el ensayo del destino S3 y un proyecto Supabase separado, que requiere las credenciales del negocio.

CodeGraph está instalado e indexado y se usó para navegar dependencias de caja, sincronización y permisos. `npm run graph` actualiza el índice; `.codegraph/` no se publica. Se aplicaron las skills de CodeGraph, Supabase y Sites para navegación, backend y construcción local de la interfaz. La skill de carta pública de cafetería no se aplicó porque añade un flujo sin acceso y funciones fuera del alcance de este POS.

## Publicar

Ver [despliegue y operación](docs/OPERACION.md) y [respaldos y restauración](docs/RESPALDOS.md). Vercel está conectado y la publicación HTTPS responde correctamente. Las variables públicas de Supabase están configuradas en Vercel y el servidor admite el dominio publicado. El repositorio incluye `vercel.json`, preset Vite, instalación reproducible y reglas SPA/PWA. La publicación no activa los avisos de Telegram ni el respaldo externo S3.

Antes de operar: cargar sabores reales, responsables, cuentas receptoras, inventario y saldos físicos; confirmar topes y tolerancia; realizar una jornada de ensayo y revisar las diferencias. La configuración inicial de límites es provisional y editable.
