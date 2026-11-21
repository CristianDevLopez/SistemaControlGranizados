import { DomainError } from './types.ts';

export const candyAdditions = [
  { id: 'cintas', name: 'Cintas', unitPrice: 500 },
  { id: 'bonbon', name: 'Bonbon', unitPrice: 500 },
  { id: 'chicles', name: 'Chicles', unitPrice: 500 },
  { id: 'gomitas', name: 'Par de gomitas', unitPrice: 500 },
  { id: 'todos', name: 'Todos los dulces', unitPrice: 2000 },
] as const;

export type CandyId = (typeof candyAdditions)[number]['id'];
export type CandyPrices = Partial<Record<CandyId, number>>;
export type CandyAddition = { id: CandyId; name: string; unitPrice: number; quantity: number };

export function configuredAdditions(prices?: CandyPrices) {
  return candyAdditions.map((item) => ({ ...item, unitPrice: prices?.[item.id] ?? item.unitPrice }));
}

export function priceAdditions(input: unknown, prices?: CandyPrices): CandyAddition[] {
  if (!Array.isArray(input) || input.length > candyAdditions.length)
    throw new DomainError('Adiciones inválidas.');
  const seen = new Set<string>();
  return input.map((item) => {
    const addition = configuredAdditions(prices).find(({ id }) => id === item?.id);
    const quantity = item?.quantity;
    if (!addition || seen.has(addition.id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 500)
      throw new DomainError('Adición o cantidad inválida.');
    seen.add(addition.id);
    return { ...addition, quantity };
  });
}

export function additionsTotal(additions: CandyAddition[] = []): number {
  return additions.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
}
