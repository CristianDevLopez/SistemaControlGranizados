import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
await mkdir('.local', { recursive: true });
const token = randomBytes(32).toString('hex'),
  hash = createHash('sha256').update(token).digest('hex');
const sql = `insert into private.setup_tokens(token_hash) select '${hash}' where not exists(select 1 from public.profiles where role='admin');`;
await writeFile('.local/bootstrap-token.txt', token, { mode: 0o600 });
await writeFile('.local/bootstrap.sql', sql, { mode: 0o600 });
if (process.argv.includes('--prepare'))
  console.log(
    'Preparado: ejecuta .local/bootstrap.sql en el proyecto Dexter’s. El código privado está en .local/bootstrap-token.txt.',
  );
else {
  if (!process.env.DATABASE_URL) throw new Error('Configura DATABASE_URL o ejecuta con --prepare.');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const exists = await client.query("select 1 from public.profiles where role='admin' limit 1");
    if (exists.rowCount) throw new Error('Ya existe un administrador. No se habilitó otro código.');
    await client.query(sql);
    console.log(
      'Código de un solo uso creado en .local/bootstrap-token.txt. Úsalo en Configurar primer administrador.',
    );
  } finally {
    await client.end();
  }
}
