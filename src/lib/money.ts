/**
 * Interpreta un monto en pesos colombianos escrito por una persona. Los pesos son enteros, así que
 * `.` y `,` siempre son separadores de miles: "150.000", "150,000", "$ 150.000" y "150000" valen
 * 150000. Devuelve null cuando no hay dígitos (campo vacío).
 */
export function parseMoney(text: unknown): number | null {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** Texto editable para un monto: 150000 → "150.000". */
export function moneyText(value: unknown): string {
  const amount = typeof value === 'number' ? value : parseMoney(value);
  return amount === null || !Number.isFinite(amount) ? '' : new Intl.NumberFormat('es-CO').format(amount);
}
