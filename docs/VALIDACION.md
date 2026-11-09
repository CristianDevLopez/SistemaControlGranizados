# Validación de Dexter’s V1

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
