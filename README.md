# Dexter’s · Mostrador

PWA para uno o varios locales por propietario, con una caja operativa por local, pedidos con entregas parciales, continuidad offline del equipo principal y administración remota. React, TypeScript, Vite, Dexie y Supabase. Interfaz en español; dinero en pesos enteros, fechas UTC y visualización de Colombia.

### Cambios solicitados por Dexter’s el 19 de noviembre de 2026

- El empleado usa Mostrador, Pedidos del turno, Inventario y Turno. La apertura y el cierre se validan en el servidor con conexión y permiten un solo recuento. Los pedidos del equipo principal conservan la contingencia offline.
- El administrador verifica transferencias, consulta ambos conteos y gestiona diferencias desde **Revisar turnos**. Los cambios de precios, promociones, inventario y permisos requieren la aprobación de otro administrador. El número de aprobaciones se configura en **Configuración** y el historial se consulta en **Registro de cambios**.
- Desde **Revisar turnos → Elegir arqueo de referencia**, un administrador selecciona el arqueo real del 18 de noviembre. Los registros operativos anteriores quedan disponibles bajo **Período de ensayo**, las existencias parten del conteo elegido y las ventas históricas siguen en **Ventas**. La selección corresponde al local activo.

### Ajustes operativos preparados el 13 de noviembre de 2026

Permisos individuales por local y guía de perfiles; pedidos de apoyo identificados en caja; bloqueo de movimientos de trabajadores tras cerrar; cuadre por efectivo y cada cuenta configurada; cortesías con condiciones conservadas, acumulación configurable, QR compartible y canje parcial de varios códigos; imágenes de sabores, orden alfabético y filtro con/sin licor. Incluye controles en interfaz, gateway y PostgreSQL. Estos cambios están preparados para revisión local, **sin desplegar ni cargar datos en producción**. Consultar [aplicación y compatibilidad](docs/AJUSTES-OPERATIVOS.md) y el [manual actualizado](docs/manuales/manual-administradores-empleados.md).

### Locales y mensualidades

El propietario solicita locales desde **Locales y mensualidades → Solicitar local**. El desarrollador, con su acceso privado de Superadministrador, configura la tarifa en COP y la fecha de inicio y activa cada local desde ese mismo panel. Puede registrar otros propietarios con una cuenta nueva o existente; cada negocio comienza con un primer local pendiente de activación.

Cada local separa caja, turnos, inventario, catálogo, ventas, personal, evidencias, exportaciones y sincronización. Una misma cuenta propietaria accede a todos sus locales con **Local de trabajo**. Los administradores y empleados del equipo se asignan al local donde se crean. Los cobros mensuales, abonos, referencias y saldos se registran manualmente por local; el propietario consulta sus mensualidades y el desarrollador registra los pagos.

La migración conserva el negocio existente como **Local principal**, activo, sin inventar una tarifa ni generar cobros. Ver [operación, modelo de datos y despliegue](docs/MULTILOCALES.md).

Manual para el equipo: [abrir el HTML interactivo](docs/manuales/manual-administradores-empleados.html), autónomo y disponible sin conexión, o consultar [la fuente Markdown](docs/manuales/manual-administradores-empleados.md).

## Probar la aplicación

Para incorporar un desarrollador, consultar [accesos y configuración local](docs/COLABORACION.md). Para desarrollar sin credenciales ni tocar la base real: `npm run dev:local` (sandbox en http://127.0.0.1:5174, ver la misma guía).

Publicación para revisión: **https://dexter-granizados.vercel.app**. Cuenta `cristiandevlopez@gmail.com`, equipo `crisdevlopez`, proyecto `dexter-granizados`. Se mantuvo el plan gratuito Hobby por decisión del titular. La restricción de ese plan a uso personal no comercial debe resolverse antes de operar el negocio.

```powershell
npm ci
npm run dev
```

Abrir la URL que imprime Vite. La configuración pública de este equipo ya apunta al proyecto **Dexter's Granizados**, referencia `nglfyhcrpxuuqqnaeevf`, en la organización **Granizados**. Las migraciones y la función `dexter` están desplegadas. El proyecto anterior ControlApp se mantiene en **CristianDevLopez's Org**, con accesos independientes.

No hay sabores, usuarios ni ventas de demostración en la base real. Los precios iniciales sí provienen de la hoja Supuestos del presupuesto: 12/16/20/24 oz; con licor $14.000/$17.000/$19.500/$23.000; sin licor $10.000/$12.000/$14.500/$17.000. La nevera de 3 litros queda inactiva hasta completar su configuración.

### Acceso privado de superadministrador

Reservado para `cristiandevlopez@gmail.com`. Se activa mediante un enlace privado de un solo uso, eligiendo contraseña; después se ingresa por **Administrador**, sin registrar equipos, cajas ni PIN offline. El acceso general no muestra una opción de superadministrador.

Solo esta identidad ve **Vista de la aplicación** con las opciones Superadministrador, Administrador, Encargado de caja y Apoyo de mostrador. La vista Administrador opera con la identidad real del titular y usa las mismas aprobaciones que el equipo. Las vistas de Encargado y Apoyo son de consulta. **Volver a superadministrador** recupera la vista completa sin cambiar de cuenta.

Los administradores del negocio no ven este acceso en Equipo y accesos ni pueden asignarlo, desactivarlo o modificar sus dispositivos. La reserva privada admite una sola identidad. El privilegio exige conexión; no se guarda en el respaldo offline. Ver [activación y operación](docs/OPERACION.md).

### Recuperar la contraseña

El acceso de administrador admite Google o correo y contraseña, sin Authenticator. Ver [configuración de Google y retiro de factores anteriores](docs/ACCESO.md).

En **Administrador → Olvidé mi contraseña**, introducir el correo de la cuenta. También se puede abrir **Recuperar mi contraseña** desde el botón del perfil estando conectado. El enlace lleva a `/recuperar-contrasena`: verifica el enlace del correo y permite elegir y confirmar una contraseña de 14–200 caracteres. No solicita la contraseña anterior ni cambia roles o permisos. Los enlaces inválidos o vencidos permiten solicitar uno nuevo.

El destino de recuperación debe figurar en **Supabase → Authentication → URL Configuration**. Ver [operación](docs/OPERACION.md) para la configuración del correo.

### Primer administrador del negocio

1. En el acceso, elegir **Configurar primer administrador**.
2. Abrir localmente `.local/bootstrap-token.txt`. Es un código privado de un solo uso; no debe subirse al repositorio ni enviarse a empleados.
3. Elegir nombre, correo y contraseña de al menos 14 caracteres.
4. Registrar el navegador del admin. Crear los otros administradores y empleados en **Configuración → Equipo y accesos**.
5. Generar el código de registro del equipo de caja. En ese navegador, el encargado entra con usuario, PIN y código. El código vence en 15 minutos y se usa una vez. El PIN queda vinculado a ese usuario para el respaldo offline.

Un administrador conectado puede iniciar su propia caja desde **Turno y caja → Iniciar caja**. El encargado abre su turno desde **Turno** y presenta un conteo ciego. Si los dos intentos tienen diferencias, el administrador recibe un aviso en la app y decide si autoriza las ventas o solicita un arqueo.

Para preparar otro entorno vacío: `npm run bootstrap -- --prepare` genera el código y un SQL con su hash en `.local/bootstrap.sql`. Ejecutar ese SQL únicamente en el proyecto nuevo. Si ya existe un admin, no habilita otro código. No ejecutar de nuevo en esta instalación sin necesitar una recuperación del arranque.

## Funciones incluidas

- Dashboard del administrador con ventas netas, tickets, promedio, unidades, comparación temporal, evolución, productos, turnos, recaudo, gastos y metas; filtros por mes, fechas y turno, y exportación CSV. Ver [indicadores y criterios de cálculo](docs/DASHBOARD.md).
- Pedidos simultáneos, entregas parciales, cobro exclusivo del responsable y **Cobrar y entregar**.
- Degustaciones por sabor con una onza de merma esperada. Conserva los pedidos sin venta.
- Turnos autorizados, conteos ciegos, cierres con base retenida, remanentes, arqueos sorpresa y planillas con folio y hora original.
- Inventario por movimientos para bolsas, paquetes, vasos y coronitas. Los administradores ven los negativos y configuran la ventana y tolerancia de líquido por sabor.
- Compras y envíos, recepción ciega con fotografías, recepciones parciales, cruce contra lo enviado y gastos vinculados.
- Anulación completa, aprobación de otro admin y ticket sustituto vinculado; traslado del pago anterior, diferencia o reembolso y conservación de la entrega física.
- Traslados del dinero del negocio a cajas o cuentas bajo custodia de admins. Solicitud, ejecución, tránsito y confirmación separados; discrepancias en disputa. Reembolsos y utilidades requieren tres votos de admins distintos.
- Constructor de precio fijo, upgrades de uno/dos tamaños, N×M y producto gratis con cupón. Cupones aleatorios con QR, vencimiento y canje único transaccional. No se capturan datos del cliente.
- Bandejas de aprobaciones y conflictos de sincronización, metas, histórico, auditoría y exportación CSV relacionada en ZIP con diccionario.
- Preparación de Telegram y respaldo cifrado en S3 independiente. Su activación requiere las credenciales del negocio: no se simula su funcionamiento.

## Offline y conciliación

Primero se intenta wifi y luego datos compartidos. En una desconexión total, el **equipo principal** concentra las modificaciones. El apoyo conserva la consulta y necesita conexión para compartir cambios.

Cada operación y su pendiente se guardan juntos en una transacción IndexedDB. La sincronización usa el mismo UUID en todos los reintentos. Se ejecuta al recuperar conexión, al abrir la sesión, periódicamente mientras la app está visible y mediante el botón de sincronización. Cerrar o recargar la PWA conserva la cola local. Para reabrir offline, usar **Entrar sin conexión** con el PIN previamente registrado.

El administrador aplica cupones con conexión. El dispositivo principal usa el catálogo y las promociones horarias guardadas durante una desconexión. El servidor valida usuario y dispositivo al sincronizar. Un precio de una versión anterior queda identificado para revisión. Los conteos ciegos de apertura y cierre requieren conexión para verificar las diferencias en el servidor.

Un conflicto de caja queda conservado localmente y genera una solicitud de conciliación. La cola espera hasta que el admin vincule la operación correcta o explique su descarte. Si el servidor rechaza una cortesía por cuota agotada, no se emite ningún código: el intento queda en **Operaciones no aplicadas** y el siguiente pendiente puede sincronizarse. El panel permite exportar pendientes y rechazos con sus referencias. Un reintento conserva el identificador original y no equivale a un cobro confirmado.

Durante un arqueo, el sistema bloquea pedidos, entregas y cobros. Se usa papel y se mantiene separado el efectivo posterior al corte. Al terminar, un admin ingresa cada pedido con folio único, turno, hora y foto. Se conservan los conteos originales y se genera una conciliación.

El PIN local permite volver a entrar en un turno que ya se abrió. La revocación remota llega al dispositivo cuando recupera la conexión.

## Seguridad y datos

El navegador no puede leer ni escribir directamente las tablas de negocio. Todas tienen RLS y permisos directos revocados; la función de servidor verifica JWT con Auth, usuario activo, dispositivo y permisos por operación. El cliente de servicio nunca adopta sesiones de empleados. Las claves de servicio solo viven en servidor.

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
