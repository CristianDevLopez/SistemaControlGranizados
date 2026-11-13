import { it, expect } from 'vitest';
import { csv, exportZip } from '../src/lib/export.ts';
import { unzipSync, strFromU8 } from 'fflate';
import { fixture, order, NOW, run, ids } from './support/fixture.ts';
it('exporta textos peligrosos para Excel como texto y conserva reembolsos numéricos', () => {
  const text = csv([
    { notes: '=HYPERLINK("x")', amount: -14000, other: '-1+2', name: 'Texto con "comillas"\ny salto' },
  ]);
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("'=HYPERLINK");
  expect(text).toContain('"-14000"');
  expect(text).toContain("'-1+2");
  expect(text).toContain('""comillas""');
});
it('incluye relaciones de líneas, degustaciones, parámetros históricos y diccionario en ZIP', () => {
  const { state } = order(fixture());
  const files = unzipSync(exportZip({ state, profiles: [], devices: [], exportedAt: NOW, schemaVersion: 1 }));
  for (const key of [
    'orders.csv',
    'order_lines.csv',
    'tastings.csv',
    'parameters.csv',
    'diccionario.csv',
    'manifest.json',
  ])
    expect(files[key]).toBeDefined();
  expect(strFromU8(files['order_lines.csv'])).toContain(state.orders[0].id);
  expect(JSON.parse(strFromU8(files['manifest.json'])).displayTimeZone).toBe('America/Bogota');
});
it('exporta los sabores del combinado para reconstruir sus proporciones', () => {
  const initial = fixture();
  const { state } = run(initial, 'create_order', {
    lines: [{ flavorIds: [ids.flavor, ids.plain], sizeId: initial.sizes[0].id, quantity: 1 }],
  });
  const files = unzipSync(exportZip({ state, profiles: [], devices: [], exportedAt: NOW, schemaVersion: 1 }));
  const lines = strFromU8(files['order_lines.csv']);
  expect(lines).toContain('"flavorIds"');
  expect(lines).toContain(ids.flavor);
  expect(lines).toContain(ids.plain);
  expect(lines).toContain('""ounces"":12');
});

it('incluye el cuadre por cuenta y sus diferencias originales en la exportación', () => {
  const initial = fixture();
  const key = `transfer:${ids.location}`;
  const { state } = run(initial, 'count', {
    kind: 'closing',
    shiftId: ids.shift,
    cash: 20000,
    retained: 20000,
    items: Object.fromEntries(initial.sizes.filter((s) => s.cups > 0).map((s) => [`cup:${s.id}`, 0])),
    payments: { [key]: 1000 },
  });
  const files = unzipSync(exportZip({ state, profiles: [], devices: [], exportedAt: NOW, schemaVersion: 1 }));
  const counts = strFromU8(files['counts.csv']);
  expect(counts).toContain('"expectedPayments"');
  expect(counts).toContain('"paymentDifferences"');
  expect(counts).toContain(key);
  expect(counts).toContain('Cuenta de prueba');
  expect(counts).toContain('""' + key + '"":1000');
});
