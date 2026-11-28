# Validación de Dexter’s V1

## Dexter v4: 28 de noviembre de 2026

- `npm run check`: **349 pruebas aprobadas en 42 archivos**, con TypeScript y migraciones completas en PGlite. Incluyen recetas de 24 oz y adiciones, Bomba, apertura omitida, rechazo y nueva propuesta sin alterar movimientos posteriores, corrección de recepción por cuatro unidades, flete de $80.000 sin duplicación, recuperación parcial y sobrante ya contado, costos históricos y corte colombiano de exportación. La conversión de bolsas se prueba con saldos existentes y verifica la identidad JSON/SQL de cada movimiento.
- Navegador: nombre del pedido sin guardado previo, reintentos, recarga offline, actualización PWA con pendientes, recepción 980/10/10, revisión de cierre, configuración, exportación y Versus de 12 a 16 comprobados en Chromium, iPhone WebKit y Android. También se comprueba la venta entre sesiones independientes de apoyo y caja. Los ensayos funcionales usan datos aislados.
- Deno y compilación de producción/PWA correctos. Se corrigieron durante la validación el bloqueo SQL antiguo de campañas y la generación de identificadores del movimiento de conversión. El primer intento de migración fue revertido transaccionalmente antes de aplicar la versión corregida y probada. Permanecen los avisos de tamaño de bundle/importación conocidos.
- Producción: candidato `dpl_7DHDfLsknSMxvjSgLU5dBVn3TSgu` promovido; bundle `/assets/index-Do5qa_Ej.js`, manifiesto y service worker comprobados en el dominio público. Función `dexter` **45**, 25 módulos descargados idénticos a los locales. Migración v4 aplicada y 341 avisos archivados con respaldo completo por local; se verificó identidad de 584 pedidos, 455 pagos y 15 turnos. Los saldos de 20 bolsas equivalen a 2.000 gusanitos, 960 bombones y 700 oz de minichicles.
- Programador cada minuto activo. El mensaje técnico real al grupo `-5480458026` obtuvo `message_id=6`; la resolución editó ese mensaje y guardó `resolution_reply_id=16`, sin errores. Las pruebas SQL verifican cinco intentos, nuevo ciclo manual, concurrencia, deduplicación y versiones de resolución. No se cerró un turno del negocio para simular una prueba.
- Asesor de seguridad sin errores de base de datos; conserva avisos de configuración de Auth sobre contraseñas filtradas y opciones MFA. El bypass temporal de automatización de Vercel fue retirado. El cliente debe completar su ensayo operativo con el personal; ver [lista de prueba](V4-PRUEBAS-CLIENTE.md). Los costos históricos ausentes se identifican, no se presentan como costos completos.

## Disputas y conteos finales: 25 de noviembre de 2026

- `npm run check`: 328 pruebas aprobadas en 38 archivos, con todas las migraciones sobre PGlite. Se verifica que solo el receptor corrige o declina una disputa, que los reintentos no duplican saldos y que declinar restituye el monto completo al origen. Los conteos finales 0, 12 y 25 sustituyen el conteo del cajero y dejan el inventario en ese total, conservando el original. Las propuestas de inventario fijan saldos finales, incluido cero, tras aprobación.
- 21 recorridos Playwright aprobados en Chromium, iPhone WebKit y Android: corrección y devolución de disputas, propuesta de saldo final y aprobación del cuadre, recuperación del timeout sin duplicados, cobros entre dos equipos y actualización PWA con operaciones pendientes.
- Compilación de producción/PWA, comprobación Deno, Prettier y `git diff --check` correctos. Permanecen los avisos conocidos de tamaño de bundles e importaciones dinámicas también estáticas.
- Migración `20261125211500_transfer_dispute_resolution` aplicada en producción; RPC con `SECURITY INVOKER`, ejecución exclusiva de servicio y validación del receptor comprobadas mediante SQL. Función `dexter` versión 40 activa; el motor descargado coincide por SHA-256 con el probado. Candidato promovido y dominio público verificado con el bundle `/assets/index-Bc6JKT4T.js`, PWA correcta, salud HTTP 200, CORS y snapshot anónimo rechazado. Despliegue anterior: `dpl_7DFoysYBmZFr4KzagLfM6LAXx2Bo`; copia de su función en `.local/release-disputas-backup`.

## Revisión de cuadre: 14 de noviembre de 2026

- **254 pruebas aprobadas** en 27 archivos con `npm run check`, incluidas las migraciones completas sobre PGlite aislado. Se verifican comparación desactualizada, aprobación obligatoria, corrección de efectivo/base/cuentas/vasos, conservación de originales, autorización administrativa y MFA, permisos SQL de servicio, reintentos sin duplicados, ajuste tardío de cierres anteriores y mermas/recetas ya corregidas.
- **27 recorridos distintos de navegador aprobados** en escritorio Chromium, iPhone WebKit y Android Chromium. La primera ejecución finalizó con 24/24 de operación, caja, transferencias y arqueo. Después se agregó el agotamiento de 20 vasos: los tres recorridos nuevos y los tres de revisión/aprobación se ejecutaron de nuevo, 6/6 aprobados. La prueba de paquetes espera la sincronización antes de consultar el estado persistido. La instalación inicial de navegadores de Playwright se completó en este equipo antes de validar estos resultados.
- TypeScript, compilación de producción/PWA, Deno, Prettier y `git diff --check` correctos. Capturas revisadas de la comparación de escritorio y de la aprobación móvil. Permanecen los avisos conocidos de tamaño de bundles e importaciones dinámicas también estáticas.
- Se conservan el conteo ciego de arqueo, los movimientos ejecutados y las diferencias originales. Las cortesías entregadas descuentan vasos y líquido. El valor del faltante reportado al empleado se registra manualmente; no existe ejecución de nómina.
- A solicitud del usuario se aplicaron las migraciones pendientes de permisos y revisión de cierre y se publicó `dexter` versión 13 en el proyecto del negocio. Las huellas de pedidos, pagos, stock, conteos y turnos coinciden antes y después. Se verificaron las columnas de permisos, las dos migraciones y seis funciones exclusivas de servicio sin `SECURITY DEFINER`. Salud pública HTTP 200, solicitudes de datos/cuadre sin sesión HTTP 401 y preflight CORS del dominio del negocio HTTP 204. El asesor de seguridad mantiene únicamente el aviso previo de [protección contra contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Frontend publicado en producción y alias del negocio verificado con HTTP 200. El bundle servido contiene las nuevas funciones de comparación/aprobación y apertura de paquetes, apunta a Supabase Dexter y no contiene la configuración de pruebas. Manifiesto y service worker HTTP 200; `sw.js` conserva `Cache-Control: no-cache`. Ver [revisión de cuadres](CUADRES.md). Manual Markdown y HTML actualizados; las exportaciones Word anteriores no se regeneraron.
- La suite completa comprende **111 recorridos**. Una ejecución de CI pasó los 111 y otra detectó un fallo intermitente al decodificar el PNG de un QR: el detector de cámara confundía algunos patrones válidos. Se reprodujo el código exacto y se corrigió la prueba usando el modo `PURE_BARCODE`, previsto para PNG monocromos sin rotación ni perspectiva. Se conservan la lectura del PNG real, la comparación exacta del código y el canje parcial; se añadieron siete patrones de regresión y dos imágenes inválidas. Una revisión independiente decodificó los 201 patrones de un corpus con cero fallos usando ese modo. No se alteraron el generador de producción ni el lector de cámara.
- Dos revisiones independientes de solo lectura: una sobre dinero, inventario, remanentes y autorización (sin errores verificables encontrados en ese alcance), y otra sobre el diagnóstico/corrección de QR y la integridad de sus pruebas. No se realizaron operaciones de prueba sobre datos reales.

## Ajustes operativos: 13 de noviembre de 2026 (sin desplegar)

- **228 pruebas de código aprobadas** en 24 archivos con `npm run check`. Se ejecutaron todas las migraciones en PostgreSQL PGlite aislado. Cubren permisos individuales por local, revocación en la persistencia, cierre definitivo/provisional, referencias a turnos anteriores, conteos por cuentas activas e históricas, beneficios conservados, acumulación, canje parcial, pagos mixtos y ausencia de dinero o saldos negativos por cortesías.
- **99 recorridos existentes aprobados** en Chromium de escritorio, iPhone WebKit y Android Chromium. Los **nueve recorridos nuevos** se repitieron sobre la compilación final: **9/9 aprobados** con `npx playwright test tests/e2e/operacion.spec.ts`. La ejecución completa tuvo seis fallos de expectativas anteriores en dos recorridos (etiquetas de botones y espacio del formato monetario). Tras corregirlos, los nueve recorridos nuevos pasaron sobre la compilación final. Se verificaron pedidos entre dos sesiones, guía y edición de permisos, subida/visualización de foto, filtro de licor, cuadre por cuenta y sus diferencias, QR realmente decodificado con ZXing, canje de dos entre tres códigos y detalle de los códigos aplicados visible para caja.
- TypeScript, compilación de producción/PWA, `deno check`, Prettier y `git diff --check` correctos. Se revisaron capturas de escritorio y móvil. Continúan los avisos conocidos sobre tamaño de los bundles e importaciones dinámicas que también son estáticas.
- La migración `20261113203835_operational_permissions_courtesies.sql` conserva los datos y roles anteriores, añade permisos con valores por defecto compatibles y mantiene RPC de servicio con `SECURITY INVOKER`, RLS y acceso de navegador revocado. La lectura de imágenes de sabores no habilita la lectura de evidencias ajenas.
- Integración sobre `main` (`e19a66b`): se conservan los arqueos selectivos, las cuentas de pago, el conteo de vasos sueltos y los sabores combinados del PR #8, sin duplicar el modelo del cuadre. Las cortesías directas también guardan su opción de acumulación.
- Manual HTML autónomo actualizado desde el Markdown final: 18 capítulos, ocho guías y cinco capturas integradas. Validado en escritorio, tablet y móvil: perfil, búsqueda, teclado, navegación, desplegables, impresión, imágenes y lectura sin conexión; sin errores JavaScript ni solicitudes externas.
- No se desplegó frontend, función ni migración, ni se modificaron datos reales. Sigue pendiente aplicar la revisión y probar cámara/compartir en dispositivos físicos; ver [guía de aplicación](AJUSTES-OPERATIVOS.md). El manual fuente Markdown está actualizado; las exportaciones Word anteriores permanecen identificadas como tales en esa guía.

## Varios locales y mensualidades: 28 de octubre de 2026

- **89 pruebas de código aprobadas**, con TypeScript correcto. Incluyen migración del negocio existente sin alterar sus eventos, actualización de IndexedDB v1 conservando PIN, comandos y fotografías, propietarios independientes, solicitudes y activación por desarrollador, aislamiento de cajas, revisiones, exportaciones y comandos, abonos y cobros sin duplicación.
- **48 recorridos de navegador aprobados** en escritorio, iPhone y Android. Se reforzaron y repitieron los recorridos de locales con conflictos pendientes y dos pestañas independientes; las comprobaciones adicionales de operación offline y cambio de local también pasaron en los tres navegadores. Se revisaron capturas del panel de desarrollador y del propietario en escritorio y móvil.
- Compilación de producción, Deno y formato correctos. Las pruebas usan exclusivamente la base PGlite aislada; no se crearon locales, cobros, pagos ni ventas ficticios en el proyecto real.
- Migraciones `20261028123803_multi_local` y `20261028123931_multi_local_access_policy` aplicadas en Dexter. La revisión **4** y el hash del estado operativo antes y después de la migración coinciden; permanecen 2 perfiles, 3 dispositivos y 1 recibo de comando. Solo existe el local principal, activo, sin tarifa ni inicio de cobro; no se generaron mensualidades ni pagos.
- Función `dexter` versión **9** activa. `health` responde 200 con `version: 2` y `multiLocal: true`. Las RPC nuevas y el esquema privado se mantienen inaccesibles para `anon` y `authenticated`; se confirmó el acceso del propietario real. Las políticas privadas de denegación son explícitas.
- Publicación Vercel `dpl_4SzryLgACJt2T52aPn9cKwhKF22Q` en estado **READY**, con alias `https://dexter-granizados.vercel.app`.
- El asesor de seguridad conserva el aviso previo sobre [protección de contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Los detalles de operación y cobro están en [MULTILOCALES.md](MULTILOCALES.md).

## Apertura de caja por un administrador: 27 de octubre de 2026

- **79 pruebas de código y 42 pruebas de navegador aprobadas**, con TypeScript, Deno, compilación de producción y formato correctos. Los recorridos se ejecutaron en escritorio, iPhone y Android.
- El dominio, el gateway y PostgreSQL permiten que un admin conectado abra y autorice su propio turno sin otro admin. Se conserva el conteo de apertura, la base anterior y la identidad real en la auditoría.
- Pruebas aisladas de ciclo completo con admin y superadmin: apertura con un solo admin activo, reintento sin duplicados, conteos, cobro, cierre, remanente y base del siguiente turno. Se comprueban también sesiones nuevas del titular, rechazo del cobro por otro admin, exigencia de MFA y una sola apertura aceptada ante dos solicitudes simultáneas.
- La RPC de persistencia mantiene `SECURITY INVOKER`, acceso exclusivo de servicio y la validación del responsable del turno. La consulta de roles y las escrituras de otros usuarios mantienen sus restricciones.
- Migración `20261027180017_admin_cash_opening` aplicada y función `dexter` versión 8 activa. Se verificaron los permisos de la RPC, `health` HTTP 200 y rechazo del snapshot anónimo con HTTP 401. El asesor de seguridad no encontró avisos nuevos; conserva el aviso anterior sobre protección contra contraseñas filtradas.
- Publicación Vercel `dpl_HucBupFWM3cv2EPyD8znxLqXCt1j` READY con HTTPS 200. Se actualizó la PWA en Edge y se comprobó **Turno y caja → Iniciar caja** habilitado en la sesión real de Cristian como Superadministrador. El ciclo con operaciones se probó exclusivamente en la base aislada.

## Edición administrativa: 27 de octubre de 2026

- **73 pruebas de código aprobadas**, con TypeScript correcto. Se verifica que tanto un admin del negocio como el titular pueden guardar sabores, precios, parámetros, promociones y metas siendo el único administrador activo, sin generar solicitudes de aprobación y con su identidad en el histórico y la auditoría.
- La vista Administrador del titular permite editar conservando su usuario real. Las vistas de Encargado y Apoyo siguen bloqueando escrituras en cliente y servidor.
- **36 recorridos de navegador verificados** en escritorio, iPhone y Android. Se comprobaron guardado directo con admin y titular, sincronización, responsable en el histórico y persistencia tras recargar. Los nueve recorridos de acceso y vistas se repitieron correctamente después de ajustar la espera del menú en las pruebas móviles; los otros 27 recorridos de caja y recuperación también pasaron.
- Compilación de producción y formato correctos.
- Publicación Vercel `dpl_6zBHJrAdm2afjNKGu7nF77xzQSsM` en estado READY, alias del negocio y respuesta HTTPS 200 verificados. Al recargar la sesión real se mostró el acceso; el guardado autenticado se validó en el entorno aislado descrito arriba.

## Recuperación de contraseña: 27 de octubre de 2026

- **71 pruebas de código y 36 pruebas de navegador aprobadas** en escritorio, iPhone y Android. Se probaron solicitud de correo, doble factor conservado, código TOTP inválido, confirmación de contraseña, enlaces vencidos y recuperación desde una sesión abierta.
- Compilación de producción y formato correctos. La nueva contraseña se envía directamente a Auth; no se incluye en comandos, IndexedDB ni exportaciones.
- Configuración real de Auth guardada en el proyecto Dexter: Site URL del negocio y destino exacto `https://dexter-granizados.vercel.app/recuperar-contrasena`. Una comprobación HTTP de enlace inválido devuelve 303 a ese destino, con el rechazo correspondiente, y ya no redirige a localhost.
- Publicación HTTPS verificada y solicitud real de recuperación aceptada desde Edge. Auth registró el envío para la cuenta del titular; la nueva contraseña la introduce y confirma el usuario desde su correo. Las pruebas de cambios de contraseña usan únicamente endpoints simulados.

## Corrección: 27 de octubre de 2026

- **61 pruebas aprobadas**, con TypeScript, formato y Deno correctos. Se comprueba la entrada del superadministrador sin credenciales de equipo, reutilización del contexto de su sesión Auth, MFA obligatorio y rechazo de sesiones incompletas o asignadas a otro usuario.
- El acceso privado no puede registrar o convertirse en caja principal. Los roles del negocio siguen necesitando dispositivo y token. El contexto de auditoría no aparece como equipo físico en el panel.
- **24 pruebas de navegador aprobadas** en escritorio, iPhone y Android, incluidas la entrada sin equipo y la continuidad de la operación y el respaldo offline de caja.
- Función `dexter` versión 7 publicada. La sesión real de Cristian abrió el panel y el selector de superadministrador al recargar, sin registrar caja ni PIN. La base confirmó que el acceso privado no es caja principal.

## Actualización: 26 de octubre de 2026

- TypeScript y **58 pruebas** de dominio, base de datos y API aprobadas. Incluyen identidad exclusiva, MFA obligatorio, correo reservado, bloqueo de reasignación/desactivación, activación vencida o repetida, concurrencia sin usuarios huérfanos, privilegios reales de `service_role` y consulta sin escrituras.
- Suite completa de navegador: **21 pruebas aprobadas** en escritorio, iPhone y Android. Tras ampliar la activación privada, se verificaron además los **9 recorridos de acceso y vistas** en esos tres perfiles.
- Compilación de producción, service worker y comprobación Deno correctas. La navegación por roles conserva la identidad real, oculta la administración a encargado/apoyo, descarta formularios al cambiar de vista y bloquea cambios de negocio.
- Supabase: reserva privada para el correo confirmado, función `dexter` versión 6 activa, tabla y RPC sin acceso desde el navegador y política explícita de denegación. La activación real queda a cargo del titular, quien elige su contraseña y TOTP; no se crearon cuentas ni operaciones de prueba en el negocio.
- Asesor de seguridad: sin hallazgos nuevos de esta actualización. Sigue presente el aviso previo sobre [protección contra contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- La activación privada se guarda únicamente en `.local/acceso-superadmin.html`, excluida de Git y Vercel. El enlace es de un solo uso y vence en 24 horas. El token se elimina de la URL al abrir la pantalla.

## Registro original del 23 de octubre

Fecha: 23 de octubre de 2026. Entorno local Windows, Node 24. Los datos de las pruebas están aislados del proyecto real.

## Resultado de código y datos

- `npm run check`: **48 pruebas aprobadas** en siete archivos; TypeScript sin errores.
- `npm run build`: compilación de producción y service worker generados; 14 recursos disponibles offline.
- `npm run format:check`: formato verificado.
- `deno check`: función de servidor verificada con el SDK configurado.
- `git diff --check`: sin errores de espacios.
- CodeGraph: instalado, utilizado para navegación y con el índice actualizado.

La compilación avisa del tamaño de algunos bundles. No impidió los recorridos funcionales; la carga inicial se beneficia de una futura separación de módulos. La PWA guarda esos recursos después de la instalación.

## Cobertura comprobada

El dominio y PostgreSQL se prueban con PGlite: entregas parciales y pago separados, degustaciones, permisos por rol/dispositivo, conteos ciegos, arqueo y ventas desde papel, cierres provisionales, dinero en tránsito, tres aprobaciones para reembolsos, correcciones sin doble cobro/consumo y cupones conservados en su ticket original.

Se verifican promociones con precios distintos, varios grupos N×M y cupones, no acumulación sobre la misma unidad, cupos globales, reglas históricas y validación actual de cupones. Dos canjes simultáneos producen un solo canje aceptado. Un reintento con el mismo UUID no duplica pagos ni entregas.

Las pruebas de fotografías confirman el hash y la ruta definitiva privada. Reutilizar un enlace temporal o repetir la confirmación no cambia la evidencia final. La persistencia local usa bytes para resolver el fallo observado al guardar Blob en WebKit.

La restauración automatizada recupera una base completa de ensayo y una imagen JPEG desde un archivo cifrado AES-256-GCM con manifiesto SHA-256. También rechaza una clave incorrecta y contenido alterado. Se prueba la retención de las copias más recientes y la exportación CSV, incluidas relaciones, diccionario y protección contra fórmulas de hoja de cálculo en textos.

## Navegadores

La suite completó **15 pruebas aprobadas**: cinco recorridos en cada uno de tres perfiles, Chrome de escritorio, WebKit con iPhone 13 y Chromium con Pixel 7. Comprueba venta de tres acciones, persistencia y sincronización tras una recarga totalmente offline, navegación adaptable, conteo ciego y subida de una evidencia asociada a una anulación.

El navegador de pruebas usa el mismo gateway y motor del dominio sobre una base PostgreSQL aislada. Auth y el transporte de archivos se sustituyen por adaptadores de ensayo. Esto no equivale a validar MFA y Storage con usuarios reales en el proyecto del negocio.

## Proyecto Supabase real

Proyecto: `nglfyhcrpxuuqqnaeevf`, Dexter's Granizados, CristianDevLopez's Org.

- Migraciones aplicadas y sus versiones locales alineadas con el historial remoto.
- Función `dexter` activa; health responde correctamente.
- Acceso anónimo al gateway protegido y a las tablas de negocio: **HTTP 401**.
- Asesor automático de seguridad: sin hallazgos en la revisión realizada.
- Bucket `evidence` privado.
- Cero usuarios, sabores y pedidos de prueba. Cinco tamaños configurados: los cuatro precios confirmados y la nevera inactiva.

## Publicación web

- URL: **https://dexter-granizados.vercel.app**.
- Cuenta `cristiandevlopez@gmail.com`, equipo `crisdevlopez`, proyecto `dexter-granizados`; plan Hobby gratuito elegido por el titular, sin activar pagos.
- Compilación en Vercel completada; variables públicas de Supabase configuradas. Sesiones, claves privadas, código inicial y documentos del cliente excluidos del paquete de despliegue.
- Página de acceso, ruta SPA, manifest, service worker e icono: HTTP 200. `sw.js` se sirve con `Cache-Control: no-cache`.
- Función de Supabase versión 5: health HTTP 200; preflight desde el dominio publicado HTTP 204; dominio ajeno HTTP 403; snapshot anónimo HTTP 401.
- Acceso publicado inspeccionado visualmente. La configuración inicial del primer administrador está disponible; no se crearon usuarios ni ventas ficticias para la comprobación.

## Pendientes de habilitación

1. Crear el primer administrador con el código privado local, activar MFA y registrar equipos reales.
2. Cargar sabores, responsables, cuentas, inventario y saldos físicos; confirmar límites, checklists y tolerancia.
3. Resolver el alojamiento para uso comercial: [Hobby se limita al uso personal no comercial](https://vercel.com/docs/limits/fair-use-guidelines). La publicación de revisión no habilita la operación del negocio.
4. Configurar secretos y destinos de Telegram; bucket, credenciales, clave y alertas de S3; repositorio/runner para los workflows.
5. Ensayar instalación, cámara y jornada completa en teléfonos y tablet físicos.
6. Restaurar el respaldo externo en un proyecto Supabase separado y verificar Auth, MFA, saldos, permisos y fotografías antes de producción.

El respaldo S3 y los avisos de Telegram no se consideran activos por existir su código o configuración. Vercel sí está publicado y fue comprobado por HTTPS.

## Avance v4 del 28 de noviembre de 2026

- `npm run check`: 39 archivos, 330 pruebas aprobadas.
- `npm run build`: compilación de producción correcta.
- Nombre editado al cambiar productos y adiciones, recarga y sincronización offline: aprobado en Chromium, Safari móvil y Android.
- Actualización de la PWA con operaciones pendientes: aprobada en los tres proyectos de navegador.
- Exportación, avisos y auditoría desde Configuración, incluida descarga del ZIP: aprobado en los tres proyectos.
- Regresiones de conteo final, cierres del día colombiano y gasto durante el cierre: aprobadas en Chromium.
- Pruebas específicas del primer aviso de cierre y de eliminación de credenciales en errores de Telegram: aprobadas.
- Candidato y producción verificaron el bundle `/assets/index-Dc-fHs6D.js`, manifiesto, service worker, salud, CORS y rechazo de lectura anónima. El motor y gateway descargados del servidor coinciden byte por byte con las fuentes locales.
- El alcance pendiente de la v4 está registrado en OPERACION.md. La entrega efectiva de un cierre nuevo al grupo de Telegram sigue pendiente de configuración y validación integral.
