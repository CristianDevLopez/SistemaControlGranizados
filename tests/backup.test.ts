import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PgBackend } from './support/backend.ts';
import { archive, unpack, seal, unseal, digest, retain } from '../scripts/backup-format.ts';
it('restaura la base íntegra y una fotografía desde un respaldo cifrado', async () => {
  const source = await PgBackend.create();
  const before = await source.load(),
    snapshot = new Uint8Array(await (await source.db.dumpDataDir()).arrayBuffer()),
    photo = await readFile('public/dexter.jpg'),
    key = randomBytes(32).toString('hex');
  const payload = seal(archive({ 'database.tar.gz': snapshot, 'photos/fixture.jpg': photo }), key);
  await source.db.close();
  const recovered = unpack(unseal(payload, key));
  const restored = new PGlite({ loadDataDir: new Blob([new Uint8Array(recovered['database.tar.gz'])]) });
  try {
    const r = await restored.query<any>('select public.dexter_read_state() as value');
    expect(r.rows[0].value).toEqual(before);
    expect(digest(recovered['photos/fixture.jpg'])).toBe(digest(photo));
  } finally {
    await restored.close();
  }
}, 60000);
it('detecta corrupción y una clave de cifrado incorrecta', () => {
  const key = randomBytes(32).toString('hex'),
    data = seal(new Uint8Array([1, 2, 3]), key);
  expect(() => unseal(data, randomBytes(32).toString('hex'))).toThrow();
  data[data.length - 1] ^= 1;
  expect(() => unseal(data, key)).toThrow();
});
it('mantiene las 30 copias diarias y 12 mensuales más recientes aunque existan días sin copia', () => {
  const copies = Array.from({ length: 31 }, (_, i) => ({
    key: String(i),
    at: new Date(Date.now() - i * 40 * 86400000),
  }));
  expect(retain(copies, 'daily').map((c) => c.key)).toEqual(['30']);
  expect(retain(copies, 'monthly')).toHaveLength(19);
});
