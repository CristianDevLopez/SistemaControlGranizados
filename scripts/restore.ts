import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { unseal, unpack, digest } from './backup-format.ts';
const env = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Falta ${key}.`);
  return v;
};
const object = process.argv.find((a) => a.startsWith('--object='))?.slice(9);
if (!object) throw new Error('Indica --object=dexter/v1/daily/<archivo>.enc');
const s3 = new S3Client({
    region: env('S3_REGION'),
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  }),
  secret = env('BACKUP_ENCRYPTION_KEY');
async function get(key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: env('S3_BUCKET'), Key: key }));
  if (!r.Body) throw new Error(`Respaldo inaccesible: ${key}`);
  return unseal(await r.Body.transformToByteArray(), secret);
}
const files = unpack(await get(object)),
  photos = JSON.parse(new TextDecoder().decode(files['storage.json'])) as {
    path: string;
    sha256: string;
    object: string;
    size: number;
  }[];
await mkdir('.local/restore', { recursive: true });
await writeFile('.local/restore/database.dump', files['database.dump']);
for (const photo of photos) {
  const bytes = await get(photo.object);
  if (digest(bytes) !== photo.sha256 || bytes.byteLength !== photo.size)
    throw new Error(`Foto corrupta: ${photo.path}`);
}
console.log(`Verificado: base de datos y ${photos.length} fotografías íntegras.`);
if (!process.argv.includes('--apply'))
  console.log(
    'Sin modificar destinos. Para restaurar en un proyecto vacío de ensayo, configura RESTORE_DATABASE_URL, RESTORE_SUPABASE_URL, RESTORE_SERVICE_ROLE_KEY y RESTORE_CONFIRM=DEXTER_ENSAYO; añade --apply.',
  );
else {
  if (env('RESTORE_CONFIRM') !== 'DEXTER_ENSAYO')
    throw new Error('El destino de restauración debe ser un entorno de ensayo explícito.');
  const target = env('RESTORE_DATABASE_URL'),
    targetUrl = env('RESTORE_SUPABASE_URL');
  const metadata = JSON.parse(new TextDecoder().decode(files['metadata.json']));
  if (
    targetUrl === metadata.project ||
    targetUrl === process.env.SUPABASE_URL ||
    target === process.env.DATABASE_URL
  )
    throw new Error('El destino coincide con la fuente. Usa un proyecto separado y vacío.');
  const pg = (await import('pg')).default,
    client = new pg.Client({ connectionString: target });
  await client.connect();
  try {
    const r = await client.query("select to_regclass('public.orders') as orders");
    if (r.rows[0].orders) throw new Error('El destino ya contiene Dexter. No se sobrescribirá.');
  } finally {
    await client.end();
  }
  const connection = new URL(target),
    databaseName = decodeURIComponent(connection.pathname.slice(1));
  const pgEnv = {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port || '5432',
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGSSLMODE: connection.searchParams.get('sslmode') ?? 'require',
  };
  await new Promise<void>((resolve, reject) => {
    const c = spawn(
      process.env.PG_RESTORE_PATH ?? 'pg_restore',
      [
        '--no-owner',
        '--exit-on-error',
        '--single-transaction',
        '--clean',
        '--if-exists',
        '--dbname=' + databaseName,
        '.local/restore/database.dump',
      ],
      { env: pgEnv, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true },
    );
    c.on('error', () => reject(new Error('Instala pg_restore versión 17 o superior.')));
    c.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('La restauración de PostgreSQL falló. No habilites este destino.')),
    );
  });
  const supabase = createClient(targetUrl, env('RESTORE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const photo of photos) {
    const bytes = await get(photo.object),
      mime = photo.path.endsWith('.png')
        ? 'image/png'
        : photo.path.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
    const { error } = await supabase.storage
      .from('evidence')
      .upload(photo.path, bytes, { contentType: mime, upsert: true });
    if (error) throw error;
  }
  console.log(
    'Restauración aplicada al entorno de ensayo. Verifica acceso, saldos y fotos antes de habilitarlo. Los secretos de servicios externos se configuran por separado.',
  );
}
