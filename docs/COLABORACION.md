# Incorporación de un colaborador

Verificado el 9 de noviembre de 2026. Aplicación publicada: https://dexter-granizados.vercel.app. Backend: **Dexter's Granizados**, proyecto Supabase `nglfyhcrpxuuqqnaeevf`. **ControlApp es otro proyecto**.

## Ejecutar el frontend en local

1. Instalar Node.js 24 LTS y Git.
2. Aceptar la invitación de GitHub y clonar el [repositorio privado](https://github.com/CristianDevLopez/SistemaControlGranizados):

```powershell
git clone https://github.com/CristianDevLopez/SistemaControlGranizados.git
cd SistemaControlGranizados
```

3. Crear `.env.local` en la raíz con estas dos variables:

```dotenv
VITE_SUPABASE_URL=https://nglfyhcrpxuuqqnaeevf.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<clave publicable del proyecto Dexter>
```

4. Ejecutar:

```powershell
npm ci
npm run dev -- --port 5173 --strictPort
```

5. Abrir http://127.0.0.1:5173. Utilizar una cuenta propia de la aplicación, creada por un administrador, y completar MFA y registro de dispositivo según su rol.

Esto ejecuta el frontend local contra el backend ya desplegado. Los cambios que permita su cuenta afectan la misma base que usa la web publicada. Para experimentar con datos o migraciones, utilizar un proyecto Supabase separado. El endpoint `health` y CORS para `http://127.0.0.1:5173` respondieron correctamente en la verificación.

El archivo `.local/OneTwoDan.env.local` del equipo del titular contiene solo las dos variables públicas, listo para compartir por privado. El colaborador debe guardarlo como `.env.local`. No enviar el `.env.local` original completo: también contiene `VERCEL_OIDC_TOKEN`.

## Accesos necesarios

| Acceso            | Cuándo hace falta                           | Permiso o dato                                                                      |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| GitHub            | Clonar, crear ramas y colaborar             | Invitación a `OneTwoDan` con escritura; autenticar con su propia cuenta             |
| Aplicación        | Probar flujos protegidos                    | Cuenta individual con el rol necesario; contraseña y MFA propios                    |
| Panel de Supabase | Modificar SQL, migraciones o Edge Functions | Invitación por correo con rol Developer                                             |
| Vercel            | Administrar el alojamiento o publicar       | Acceso individual al equipo si el plan lo permite; no hace falta para `npm run dev` |

En Supabase, invitar desde [Team de la organización](https://supabase.com/dashboard/org/tkanuegliaftmkkgslvl/team). Los roles limitados a un proyecto requieren Team o Enterprise; un rol de organización alcanza todos sus proyectos, incluido ControlApp. Confirmar ese alcance antes de invitar. Ver [permisos oficiales](https://supabase.com/docs/guides/platform/access-control).

El README registra Vercel Hobby. Ese plan no incluye colaboración de equipo; si se mantiene, el titular puede publicar los cambios revisados. Ver [planes de Vercel](https://vercel.com/docs/plans/hobby). No se ha cambiado el plan ni enviado una invitación a Vercel.

Los permisos de GitHub, Supabase y la aplicación son independientes. La cuenta privada de superadministrador está reservada al titular; no compartir esa sesión ni sus códigos.

## Credenciales adicionales, según el trabajo

- **Solo frontend contra el backend existente:** únicamente las dos variables públicas y su cuenta de la aplicación. La clave publicable identifica la aplicación; no sustituye el inicio de sesión.
- **Backend remoto:** usar su propia cuenta de Supabase y autenticación personal de CLI. No necesita recibir el token personal del titular. Los secretos existentes de las funciones permanecen en servidor.
- **Backend independiente:** configurar sus propias claves y conexión en el entorno de desarrollo. Los nombres previstos están en `.env.example`; consultar [operación](OPERACION.md).
- **Telegram:** `TELEGRAM_BOT_TOKEN` y los cuatro `TELEGRAM_*_CHAT_ID`, solo si implementará o probará esa integración. Buscar en el gestor de secretos o la configuración de la función; el token se administra mediante BotFather.
- **Respaldos S3:** `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_ALERT_URL` y, si aplica, `S3_ENDPOINT`. Solo si administrará respaldos; consultar [respaldos y restauración](RESPALDOS.md). La existencia del workflow no confirma que esas credenciales estén configuradas.

Las claves `service_role` o secretas son exclusivas del servidor y nunca deben llevar prefijo `VITE_`. Ver [claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys). Para secretos que deba recibir, utilizar un gestor de contraseñas con acceso compartido o enlace privado temporal.

## Verificación de cambios

```powershell
npm run check
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

Las pruebas automatizadas usan PGlite y el servidor de pruebas aislado; no necesitan contraseñas de la base desplegada. Trabajar en ramas y revisar los cambios antes de publicarlos.
