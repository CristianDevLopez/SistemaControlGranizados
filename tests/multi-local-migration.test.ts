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
    for (const file of migrations.filter((f) => !f.includes('multi_local')))
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
    for (const file of migrations.filter((f) => f.includes('multi_local')))
      await db.exec(await readFile(new URL(file, folder), 'utf8'));
    const after = (await db.query<any>('select public.dexter_read_state() as value')).rows[0].value;
    expect(after).toEqual(before);
    expect(after.revision).toBe(17);
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
    ).toEqual(before);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
}, 60000);
