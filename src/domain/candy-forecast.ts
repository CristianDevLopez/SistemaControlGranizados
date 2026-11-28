import type { State } from './types.ts';
import { businessDay } from './business-date.ts';
import { articles, stockBalances } from './engine.ts';
export function inventoryForecast(state: State, at: string) {
  const day = businessDay(at),
    today = Date.parse(day + 'T12:00:00Z');
  return articles(state).map((c) => {
    const recent = state.stock.filter(
      (m) =>
        m.article === c.id &&
        [
          'delivery',
          'candy_sale',
          'merma_served',
          'closing_sale',
          'open_supply',
          'open_package',
          'open_bag',
        ].includes(m.reason) &&
        m.quantity < 0 &&
        Date.parse(m.at) >= today - 28 * 86400000,
    );
    const total = -recent.reduce((n, m) => n + m.quantity, 0);
    const observed = recent.length
      ? Math.min(
          28,
          Math.max(
            1,
            Math.ceil(
              (today - Math.min(...recent.map((m) => Date.parse(businessDay(m.at) + 'T12:00:00Z')))) /
                86400000,
            ) + 1,
          ),
        )
      : 28;
    const fallback = total / observed;
    const balance = stockBalances(state)[c.id] ?? 0;
    let remaining = balance,
      days = 0;
    if (total > 0)
      for (; days < 365; days++) {
        const weekday = new Date(today + days * 86400000).getUTCDay();
        const matching = recent.filter(
          (m) => new Date(businessDay(m.at) + 'T12:00:00Z').getUTCDay() === weekday,
        );
        const occurrences = Array.from({ length: observed }, (_, i) =>
          new Date(today - i * 86400000).getUTCDay(),
        ).filter((day) => day === weekday).length;
        const average = matching.length
          ? -matching.reduce((n, m) => n + m.quantity, 0) / Math.max(1, occurrences)
          : fallback;
        remaining -= average;
        if (remaining <= 0) break;
      }
    return {
      ...c,
      remaining: balance,
      days: total ? days : null,
      until: total ? new Date(today + days * 86400000).toISOString().slice(0, 10) : null,
    };
  });
}
