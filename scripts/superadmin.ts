import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1]?.trim().toLowerCase();
if (!args.includes('--email') || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error('Indica --email correo-del-titular.');
const appUrl = new URL(
  args.includes('--url') ? args[args.indexOf('--url') + 1] : 'https://dexter-granizados.vercel.app',
);
if (appUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(appUrl.hostname))
  throw new Error('La activación requiere HTTPS.');
const token = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(token).digest('hex');
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const expiresAt = new Date(Date.now() + 86400000).toISOString();
const sql = `insert into private.superadmin_access(email, setup_hash, expires_at)
values (${literal(email)}, ${literal(hash)}, ${literal(expiresAt)})
on conflict(singleton) do update set setup_hash=excluded.setup_hash, expires_at=excluded.expires_at
where superadmin_access.user_id is null and superadmin_access.email=excluded.email;`;
if (!args.includes('--prepare')) {
  if (!process.env.DATABASE_URL) throw new Error('Configura DATABASE_URL o usa --prepare.');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(sql);
    if (!result.rowCount) throw new Error('El acceso ya está activado o reservado para otro correo.');
  } finally {
    await client.end();
  }
}
appUrl.hash = new URLSearchParams({ 'activar-superadmin': token }).toString();
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
await mkdir('.local', { recursive: true });
await writeFile('.local/superadmin-setup.sql', sql, { mode: 0o600 });
await writeFile(
  '.local/acceso-superadmin.html',
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu acceso privado · Dexter’s</title><style>body{font:16px system-ui;max-width:600px;margin:12vh auto;padding:24px;color:#183b3f;line-height:1.6}a{display:inline-block;background:#194b4b;color:white;padding:14px 24px;border-radius:8px;text-decoration:none}</style><h1>Tu acceso privado</h1><p>Reservado para <strong>${escapeHtml(email)}</strong>.</p><p>Elige tu contraseña (mínimo 14 caracteres) y activa el doble factor con tu aplicación de autenticación. Después podrás alternar entre las vistas de administrador, encargado y apoyo.</p><p><a href="${escapeHtml(appUrl.href)}" rel="noreferrer">Activar mi acceso de superadministrador</a></p><p>Este enlace se usa una sola vez y vence el ${escapeHtml(new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' }).format(new Date(expiresAt)))} (Colombia). Es privado: no lo compartas con el negocio.</p><p>Después de activarlo, entra por Administrador con tu correo, contraseña y doble factor.</p></html>`,
  { mode: 0o600 },
);
console.log(
  'Activación privada en .local/acceso-superadmin.html. SQL preparado en .local/superadmin-setup.sql. Vigencia: 24 horas; un solo uso.',
);
