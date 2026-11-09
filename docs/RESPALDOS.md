# Respaldo independiente y recuperación

## Estado de activación

Se incluyen scripts, cifrado, verificación de integridad, retención y workflow. **El respaldo externo no está activado**: faltan bucket S3 y credenciales del negocio, conexión de base de datos y clave de cifrado. No se ha ejecutado una restauración del proyecto real a otro proyecto Supabase. La prueba automatizada restaura una base PGlite con el mismo esquema y una foto desde el formato cifrado.

## Política implementada

- Copia diaria completa de los esquemas de negocio, autenticación y metadatos de archivos, con PostgreSQL `pg_dump` formato custom. Incluye ACL/RLS y funciones.
- Copia horaria de la base completa y manifiesto de fotos. Las fotos sin cambios se reutilizan por hash en almacenamiento independiente. Es más conservador que depender de una cadena incremental de base de datos.
- Fotos privadas respaldadas aparte del dump. Un respaldo de la base de datos no contiene los binarios de Supabase Storage.
- AES-256-GCM con clave independiente de 32 bytes; autenticación del cifrado, manifiesto SHA-256 por archivo y cifrado S3 AES256 adicional.
- Conservar las 30 copias diarias y 12 mensuales más recientes; 168 horarias. Los objetos de fotos se conservan para no romper respaldos históricos; su eliminación requiere revisar todas las referencias conservadas. Hay que presupuestar ese crecimiento.
- Alertas de fallo mediante webhook y resultado del workflow. El workflow solo se ejecuta al definir `DEXTER_BACKUPS_ENABLED=true`.

## Configurar

1. Crear un bucket S3 independiente del proveedor de base de datos y bajo cuenta de Dexter, bloquear acceso público y habilitar versionado. Limitar la identidad de respaldo a listar, leer, escribir y borrar únicamente el prefijo `dexter/v1/`. La clave de cifrado se conserva también fuera del repositorio y de esa cuenta S3.
2. Preparar un runner con Node 24 y PostgreSQL cliente 17 o superior. En el workflow ya está prevista la instalación del cliente.
3. Guardar como secretos del entorno `production-backup`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`, `BACKUP_ENCRYPTION_KEY` y `BACKUP_ALERT_URL`. Ver `.env.example`. No enviar estos valores por chat ni ponerlos en Vercel frontend.
4. Obtener la conexión de Postgres desde el panel Connect de Supabase, preferiblemente Session pooler; no usar Transaction pooler para un dump.
5. Generar `BACKUP_ENCRYPTION_KEY` con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` en una terminal privada; guardarla en el gestor de secretos y una copia de recuperación.
6. Ejecutar `npm run backup -- --daily`. Comprobar que termina con `ok:true` y aparece el objeto cifrado. Verificar un ensayo antes de habilitar el horario.

La programación del workflow es horaria al minuto 17; la copia de las 05 UTC es diaria. Cada copia diaria actualiza también la copia mensual correspondiente; se conserva la última diaria disponible de cada mes. GitHub Actions puede retrasar o no ejecutar una programación; hay que observar los resultados y usar un scheduler dedicado si se requiere un RPO contractual de una hora. No hay garantía de recuperar lo que todavía reside solo en un dispositivo offline.

## Ensayar una restauración

1. Elegir un manifiesto completo de S3, por ejemplo `dexter/v1/daily/2026-10-23.enc`.
2. Ejecutar `npm run restore -- --object=<ruta>`. Descifra y verifica dump, manifiesto y todas las fotos sin modificar ninguna base.
3. Crear un proyecto Supabase vacío, distinto de la fuente, con versión compatible de PostgreSQL. Configurar `RESTORE_DATABASE_URL`, `RESTORE_SUPABASE_URL`, `RESTORE_SERVICE_ROLE_KEY` y `RESTORE_CONFIRM=DEXTER_ENSAYO` en un archivo privado o el entorno del runner.
4. Ejecutar el mismo comando con `--apply`. El script rechaza una URL que coincide con la fuente y un destino que ya contiene tablas Dexter. Importa el dump y vuelve a subir los archivos al bucket privado.
5. Configurar secretos de Edge Functions, Auth, MFA/recuperación, dominios y despliegue de la función en el destino. Los JWT del proyecto anterior no se consideran válidos automáticamente. Los secretos de integración no están en el dump y se recuperan desde su gestor.
6. Verificar número de pedidos, suma de pagos, movimientos de inventario, cierres, relaciones, permisos/RLS y hash de las fotos. Probar acceso real, una operación y lectura de evidencias. Registrar el resultado del ensayo y el tiempo empleado.

El dump incluye esquemas gestionados de Auth/Storage: el ensayo en Supabase separado es obligatorio antes del arranque y después de cambios del proveedor. Las configuraciones externas, publicaciones o claves de cifrado del proveedor pueden requerir pasos adicionales. No se sobrescribe producción como parte de este procedimiento.

Referencias oficiales: [respaldos de Supabase](https://supabase.com/docs/guides/platform/backups), [restauración y migración](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [migración de usuarios Auth](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects).
