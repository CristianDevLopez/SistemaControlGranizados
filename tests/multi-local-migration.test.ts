import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { admin, ids } from './support/fixture.ts';
it('la migración asigna el negocio existente al local principal sin reescribir sus eventos ni perder la revisión', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);grant usage on schema public to service_role;',
    );
    const folder = new URL('../supabase/migrations/', import.meta.url);
    const migrations = (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort();
    const multiLocalIndex = migrations.findIndex((f) => f.includes('multi_local'));
    for (const file of migrations.slice(0, multiLocalIndex))
      await db.exec(await readFile(new URL(file, folder), 'utf8'));
    await db.query('insert into auth.users(id,email) values($1,$2)', [admin.id, 'existing@test.invalid']);
    await db.query("insert into public.profiles(id,name,role) values($1,'Propietario existente','admin')", [
      admin.id,
    ]);
    const eventId = crypto.randomUUID();
    const event = { id: eventId, item: 'cups', quantity: 100, at: '2026-10-20T12:00:00Z', by: admin.id };
    await db.query('insert into public.stock(id,data,revision) values($1,$2,17)', [eventId, event]);
    await db.exec('update private.runtime set revision=17');
    const before = (await db.query<any>('select public.dexter_read_state() as value')).rows[0].value;
    for (const file of migrations.slice(multiLocalIndex))
      await db.exec(await readFile(new URL(file, folder), 'utf8'));
    const after = (await db.query<any>('select public.dexter_read_state() as value')).rows[0].value;
    expect(after.state.settings[0]).toMatchObject({
      v4Enabled: true,
      v4: { lossDays: 30, candyTolerance: 0.1 },
    });
    const comparable = structuredClone(after);
    delete comparable.state.settings[0].v4Enabled;
    delete comparable.state.settings[0].v4;
    comparable.revision--;
    expect(comparable).toEqual(before);
    expect(after.revision).toBe(18);
    expect((await db.query<any>('select snapshot from private.v4_rollout_backup')).rows[0].snapshot).toEqual(
      before,
    );
    expect(after.state.stock).toEqual([event]);
    const access = (
      await db.query<any>("select public.dexter_platform($1,'access','{}') as value", [admin.id])
    ).rows[0].value;
    expect(access.branches).toHaveLength(1);
    expect(access.branches[0]).toMatchObject({
      legacy: true,
      name: 'Local principal',
      monthlyFee: null,
      billingStart: null,
      isOwner: true,
      status: 'active',
    });
    expect(access.businesses[0].ownerId).toBe(admin.id);
    await db.exec('set role service_role');
    expect(
      (await db.query<any>('select public.dexter_branch_read_state($1) as value', [access.legacyBranchId]))
        .rows[0].value,
    ).toEqual(after);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
}, 60000);

it('convierte las bolsas existentes conservando la identidad de cada movimiento', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);grant usage on schema public to service_role;',
    );
    const folder = new URL('../supabase/migrations/', import.meta.url);
    const files = (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files.slice(0, -1)) await db.exec(await readFile(new URL(file, folder), 'utf8'));
    const branch = (await db.query<any>('select private.legacy_branch() as id')).rows[0].id;
    for (const article of ['supply:gomas-gusanitos', 'supply:bombones', 'supply:minichicles']) {
      const id = crypto.randomUUID();
      await db.query('insert into public.stock(id,branch_id,data)values($1,$2,$3)', [
        id,
        branch,
        {
          id,
          article,
          quantity: 20,
          reason: 'initial',
          at: '2026-11-01T12:00:00Z',
          by: admin.id,
          eventId: crypto.randomUUID(),
        },
      ]);
    }
    await db.exec(await readFile(new URL(files.at(-1)!, folder), 'utf8'));
    const result = await db.query<any>(
      "select data->>'article' as article,sum((data->>'quantity')::numeric)::float as quantity from public.stock group by 1 order by 1",
    );
    expect(result.rows).toEqual([
      { article: 'supply:bombones', quantity: 960 },
      { article: 'supply:gomas-gusanitos', quantity: 2000 },
      { article: 'supply:minichicles', quantity: 700 },
    ]);
    expect(
      (await db.query<any>("select count(*)::int as n from public.stock where id::text<>data->>'id'")).rows[0]
        .n,
    ).toBe(0);
  } finally {
    await db.close();
  }
}, 60000);
