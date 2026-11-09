import { describe, it, expect } from 'vitest';
import { moneyText, parseMoney } from '../src/lib/money.ts';

describe('montos escritos en pesos', () => {
  it.each([
    ['150000', 150000],
    ['150.000', 150000],
    ['150,000', 150000],
    ['$ 150.000', 150000],
    ['$150.000', 150000],
    [' 20.000 ', 20000],
    ['1.500.000', 1500000],
    ['0', 0],
  ])('"%s" vale %i', (text, value) => {
    expect(parseMoney(text)).toBe(value);
  });

  it.each(['', '   ', 'abc', '$', undefined, null])('%j queda vacío', (text) => {
    expect(parseMoney(text)).toBeNull();
  });

  it('rechaza cifras fuera del rango seguro', () => {
    expect(parseMoney('9'.repeat(20))).toBeNull();
  });

  it('muestra los montos con punto de miles para editarlos', () => {
    expect(moneyText(150000)).toBe('150.000');
    expect(moneyText('20000')).toBe('20.000');
    expect(moneyText('')).toBe('');
    expect(moneyText(undefined)).toBe('');
  });
});
