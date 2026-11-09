import { it, expect } from 'vitest';
import { csv, exportZip } from '../src/lib/export.ts';
import { unzipSync, strFromU8 } from 'fflate';
import { fixture, order, NOW } from './support/fixture.ts';
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
