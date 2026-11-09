import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { archive, digest, seal, retain } from './backup-format.ts';
const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name}.`);
  return v;
};
const secret = required('BACKUP_ENCRYPTION_KEY'),
  bucket = required('S3_BUCKET'),
  database = required('DATABASE_URL');
const s3 = new S3Client({
  region: required('S3_REGION'),
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
});
const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const day = new Date().toISOString().slice(0, 10),
  stamp = new Date().toISOString().replaceAll(':', '-'),
  daily = process.argv.includes('--daily'),
  monthly = daily,
  root = 'dexter/v1';
await mkdir('.local/backups', { recursive: true });
async function put(key: string, bytes: Uint8Array) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: seal(bytes, secret),
      ServerSideEncryption: 'AES256',
      ContentType: 'application/octet-stream',
    }),
  );
}
async function list(prefix: string) {
  const all: { key: string; at: Date }[] = [];
  let cursor: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: cursor }),
    );
    for (const item of r.Contents ?? [])
      if (item.Key && item.LastModified) all.push({ key: item.Key, at: item.LastModified });
    cursor = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (cursor);
  return all;
}
async function runDump() {
  const path = '.local/backups/database.dump';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.env.PG_DUMP_PATH ?? 'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--schema=public',
        '--schema=private',
        '--schema=supabase_migrations',
        '--schema=auth',
        '--schema=storage',
        `--file=${path}`,
      ],
      {
        env: { ...process.env, PGDATABASE: database },
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    let diagnostic = '';
    child.stderr.on('data', (chunk) => {
      diagnostic += chunk.toString();
    });
    child.on('error', () =>
      reject(new Error('No está disponible pg_dump. Instala PostgreSQL cliente 17 o superior.')),
    );
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `pg_dump falló (${code}). Revisa permisos y conectividad; el respaldo no fue marcado como completo.`,
            ),
          ),
    );
  });
  return readFile(path);
}
async function walk(prefix = ''): Promise<string[]> {
  const all: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage
      .from('evidence')
      .list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    for (const file of data ?? []) {
      if (!prefix && file.name === 'staging') continue;
      const path = prefix ? `${prefix}/${file.name}` : file.name;
      if (file.id) all.push(path);
      else all.push(...(await walk(path)));
    }
    if ((data ?? []).length < 100) break;
  }
  return all;
}
try {
  const databaseDump = await runDump();
  const photoManifest: { path: string; sha256: string; object: string; size: number }[] = [];
  // Content addressed encrypted objects let hourly manifests reuse unchanged photos.
  const existing = new Set((await list(`${root}/files/`)).map((x) => x.key));
  for (const path of await walk()) {
    const { data, error } = await supabase.storage.from('evidence').download(path);
    if (error || !data) throw error ?? new Error('Foto inaccesible.');
    const bytes = new Uint8Array(await data.arrayBuffer()),
      hash = digest(bytes),
      object = `${root}/files/${hash}.enc`;
    if (!existing.has(object)) await put(object, bytes);
    photoManifest.push({ path, sha256: hash, object, size: bytes.byteLength });
  }
  const bytes = archive({
    'database.dump': databaseDump,
    'storage.json': new TextEncoder().encode(JSON.stringify(photoManifest)),
    'metadata.json': new TextEncoder().encode(
      JSON.stringify({
        format: 1,
        project: process.env.SUPABASE_URL,
        at: stamp,
        fullDatabase: true,
        photos: photoManifest.length,
        dumpScope: ['public', 'private', 'auth', 'storage', 'supabase_migrations'],
      }),
    ),
  });
  const kind = daily ? 'daily' : 'hourly',
    object = `${root}/${kind}/${daily ? day : stamp.slice(0, 13)}.enc`;
  await put(object, bytes);
  if (monthly) await put(`${root}/monthly/${day.slice(0, 7)}.enc`, bytes);
  // Only completed manifests are retained. Photo GC must consider every retained manifest.
  for (const group of ['hourly', 'daily', 'monthly'] as const) {
    const expired = retain(await list(`${root}/${group}/`), group);
    for (let i = 0; i < expired.length; i += 1000)
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: expired.slice(i, i + 1000).map((x) => ({ Key: x.key })) },
        }),
      );
  }
  await writeFile(
    '.local/backups/last-success.json',
    JSON.stringify({ at: new Date().toISOString(), object, photos: photoManifest.length }),
  );
  console.log(JSON.stringify({ ok: true, kind, object, photos: photoManifest.length }));
} catch (error) {
  console.error('Respaldo fallido:', (error as Error).message);
  if (process.env.BACKUP_ALERT_URL)
    await fetch(process.env.BACKUP_ALERT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ application: 'Dexter', status: 'backup_failed', at: new Date().toISOString() }),
    }).catch(() => {});
  process.exitCode = 1;
}
