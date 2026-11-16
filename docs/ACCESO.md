# Acceso con Google o contraseña

Los administradores, incluido el superadministrador, pueden entrar con Google o con su correo y contraseña existentes. No se solicitan códigos de Authenticator. El acceso con Google no crea perfiles de negocio, asigna locales ni concede permisos: el servidor exige un perfil activo registrado y conserva las validaciones de local y dispositivo. Los empleados mantienen su usuario y PIN.

Estado del 14 de noviembre de 2026: frontend y gateway publicados, tres factores TOTP retirados de tres administradores y registro/verificación TOTP deshabilitados en Supabase. La URL de retorno de Google está permitida. Google sigue pendiente del Client ID y Client Secret; hasta configurarlos, el botón informa que se use correo y contraseña sin abandonar la aplicación.

## Configuración de Google

1. Crear un cliente OAuth de tipo **Aplicación web** en Google Auth Platform, con los permisos básicos `openid`, correo y perfil. Configurar audiencia y consentimiento para las cuentas que usarán la aplicación.
2. Origen autorizado: `https://dexter-granizados.vercel.app`. URI de redirección autorizada: `https://nglfyhcrpxuuqqnaeevf.supabase.co/auth/v1/callback`.
3. En [Supabase → Proveedor Google](https://supabase.com/dashboard/project/nglfyhcrpxuuqqnaeevf/auth/providers?provider=Google), guardar el Client ID y Client Secret y habilitar Google. El secreto vive exclusivamente en Supabase.
4. En **Authentication → URL Configuration**, conservar la URL del sitio y agregar exactamente `https://dexter-granizados.vercel.app/?acceso=google` a las URL permitidas. Conservar también `/recuperar-contrasena`.
5. Probar con una cuenta administradora existente cuyo correo coincida. Supabase vincula las identidades con el mismo correo verificado; la aplicación conserva el ID del usuario y sus permisos. Una cuenta ajena o desactivada no obtiene acceso al negocio.

Referencia: [configuración oficial de Google en Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## Retirar los factores anteriores

Publicar frontend y función `dexter` juntos antes de deshabilitar TOTP, para evitar que una versión anterior siga pidiendo códigos. No se necesitan cambios en tablas ni políticas RLS.

En un entorno privado, con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del proyecto correcto:

```powershell
npx tsx scripts/disable-authenticator.ts
npx tsx scripts/disable-authenticator.ts --apply
```

La primera ejecución muestra cantidades sin modificar cuentas. La segunda elimina únicamente los factores TOTP de perfiles administradores y comprueba que no queden factores de ese tipo. No modifica contraseñas, roles ni datos operativos. Es necesario eliminar los factores existentes para que Supabase permita recuperar contraseñas sin exigir un nivel MFA anterior.

Deshabilitar inscripción y verificación TOTP en **Authentication → Multi-Factor**. Si se utiliza una plantilla de recuperación personalizada, evitar referencias al doble factor. El proyecto actual conserva la plantilla predeterminada: el plan gratuito con correo predeterminado no permite modificarla. Una PWA ya abierta debe aceptar la actualización o recargarse para cargar el nuevo acceso.

## Comprobación

`npm run check`, `npm run build` y `npx playwright test tests/e2e/admin-auth.spec.ts tests/e2e/recovery.spec.ts tests/e2e/superadmin.spec.ts`. Las pruebas usan cuentas y proveedores simulados; el ensayo final con Google real depende del cliente OAuth configurado.
