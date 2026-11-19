import { addDays, businessDay } from './business-date.ts';
import type { Shift, Size } from './types.ts';

export function suggestedCupCharge(
  sizes: Size[],
  expected: Record<string, number>,
  counted: Record<string, number>,
) {
  const priceByVolume = new Map<number, number>();
  for (const size of sizes) {
    if (!size.active || !size.cups || size.alcoholPrice === null) continue;
    priceByVolume.set(size.ounces, Math.max(priceByVolume.get(size.ounces) ?? 0, size.alcoholPrice));
  }
  return sizes.reduce((amount, size) => {
    const article = `cup:${size.id}`;
    const missing = Math.max(0, (expected[article] ?? 0) - (counted[article] ?? 0));
    return amount + missing * (priceByVolume.get(size.ounces) ?? size.alcoholPrice ?? 0);
  }, 0);
}

export function recoveredAmount(review: Shift['closingReview']): number {
  return (review?.recoveries ?? []).reduce((total, recovery) => total + recovery.amount, 0);
}

export function fortnight(day = businessDay()) {
  const firstHalf = Number(day.slice(8)) <= 15;
  const month = day.slice(0, 7);
  const nextMonth = addDays(`${month}-28`, 4).slice(0, 7);
  return {
    from: `${month}-${firstHalf ? '01' : '16'}`,
    until: firstHalf ? `${month}-16` : `${nextMonth}-01`,
  };
}
