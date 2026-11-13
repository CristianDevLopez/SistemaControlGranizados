import { DomainError, type Coupon, type OrderLine, type Promotion, type State } from './types.ts';
import { hasAlcohol, lineFlavorIds } from './flavors.ts';

interface Unit {
  line: OrderLine;
  index: number;
  price: number;
}
interface Offer {
  mask: bigint;
  prices: number[];
  promotion: Promotion;
  coupon?: Coupon;
  gain: number;
}
export interface Quote {
  lines: OrderLine[];
  total: number;
  coupons: string[];
  promotionUses: Record<string, number>;
  unusedCodes?: string[];
  applications?: { code: string; lineId: string; quantity: number; unitAmount: number }[];
}
export function lineTotal(line: OrderLine): number {
  return line.listPrice * line.quantity - line.discount;
}

export function isScheduled(p: Promotion, at: string): boolean {
  if (!p.active || at < p.startsAt || at >= p.endsAt) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const get = (name: string) => parts.find((x) => x.type === name)?.value ?? '';
  let day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const time = `${get('hour')}:${get('minute')}`;
  const overnight = p.startTime > p.endTime;
  if (overnight && time < p.endTime) day = (day + 6) % 7;
  return (
    (p.days.length === 0 || p.days.includes(day)) &&
    (p.startTime === p.endTime ||
      (overnight ? time >= p.startTime || time <= p.endTime : time >= p.startTime && time <= p.endTime))
  );
}

export function eligible(p: Promotion, u: OrderLine, state: State): boolean {
  const flavors = lineFlavorIds(u);
  return (
    flavors.every((id) => state.flavors.some((flavor) => flavor.id === id)) &&
    (!p.sizeIds.length || p.sizeIds.includes(u.sizeId)) &&
    (p.allowMixed !== false || flavors.length === 1) &&
    (!p.flavorIds.length || flavors.every((id) => p.flavorIds.includes(id))) &&
    (p.alcohol === 'all' || (p.alcohol === 'yes') === hasAlcohol(u, state.flavors))
  );
}

function priceFor(p: Promotion, u: Unit, state: State): number {
  if (p.effect === 'free') return 0;
  if (p.effect === 'fixed') return Math.min(u.price, p.fixedPrice ?? u.price);
  if (p.effect === 'upgrade') {
    const size = state.sizes.find((x) => x.id === u.line.sizeId)!;
    const paid = state.sizes.find((x) => x.rank === size.rank - (p.steps ?? 1));
    if (!paid || size.beers > 0) return u.price;
    const alcohol = hasAlcohol(u.line, state.flavors);
    return Math.min(u.price, (alcohol ? paid.alcoholPrice : paid.plainPrice) ?? u.price);
  }
  return u.price;
}

/** Pure calculator shared by the register and the authoritative Edge Function. */
export function quoteOrder(
  state: State,
  original: OrderLine[],
  at: string,
  online: boolean,
  codes: string[] = [],
): Quote {
  const normalized = [...new Set(codes.map((x) => x.trim().toUpperCase()).filter(Boolean))];
  if (normalized.length > 10) throw new DomainError('Máximo diez cupones por pedido.');
  const exclusive = normalized.filter((code) => {
    const c = state.coupons.find((c) => c.code === code);
    return (c?.benefit ?? state.promotions.find((p) => p.id === c?.promotionId))?.stackable === false;
  });
  const candidates = [
    calculateQuote(
      state,
      original,
      at,
      online,
      normalized.filter((c) => !exclusive.includes(c)),
    ),
    ...exclusive.map((code) =>
      calculateQuote(
        { ...state, promotions: state.promotions.filter((p) => p.delivery === 'coupon') },
        original,
        at,
        online,
        [code],
      ),
    ),
  ];
  const best = candidates.reduce((a, b) => (b.total < a.total ? b : a));
  const used = state.coupons.filter((c) => best.coupons.includes(c.id));
  best.unusedCodes = normalized.filter((code) => !used.some((c) => c.code === code));
  best.applications = best.lines.flatMap((line) =>
    (line.appliedRules ?? []).flatMap((rule) => {
      const c = used.find((c) => c.id === rule.couponId);
      return c
        ? [{ code: c.code, lineId: line.id, quantity: rule.quantity, unitAmount: rule.unitAmount }]
        : [];
    }),
  );
  return best;
}

function calculateQuote(
  state: State,
  original: OrderLine[],
  at: string,
  online: boolean,
  codes: string[] = [],
): Quote {
  const lines = structuredClone(original);
  const units: Unit[] = lines.flatMap((line) =>
    Array.from({ length: line.quantity }, (_, index) => ({ line, index, price: line.listPrice })),
  );
  const base = units.map((u) => u.price);
  const chosen: (Promotion | undefined)[] = units.map(() => undefined);
  const schedules = state.promotions.filter(
    (p) =>
      p.delivery === 'schedule' &&
      isScheduled(p, at) &&
      (p.maxRedemptions === null || (online && p.redemptions < p.maxRedemptions)),
  );
  for (const p of schedules.filter(
    (x) => x.effect !== 'nxm' && x.effect !== 'free' && x.maxRedemptions === null,
  )) {
    // A global cap needs a serialized server decision, never an optimistic offline counter.
    let remaining = p.maxRedemptions === null ? Infinity : p.maxRedemptions - p.redemptions;
    for (let i = 0; i < units.length && remaining > 0; i++) {
      if (!eligible(p, units[i].line, state)) continue;
      const amount = priceFor(p, units[i], state);
      if (amount < base[i]) {
        base[i] = amount;
        chosen[i] = p;
        remaining--;
      }
    }
  }
  const offers: Offer[] = [];
  const addOffers = (p: Promotion, coupon?: Coupon) => {
    const indexes = units
      .map((_, i) => i)
      .filter((i) => eligible(p, units[i].line, state))
      .sort(
        (a, b) =>
          units[b].price - units[a].price ||
          units[a].line.id.localeCompare(units[b].line.id) ||
          units[a].index - units[b].index,
      );
    if (p.effect === 'nxm') {
      const take = p.take ?? 3,
        pay = p.pay ?? 2;
      let groups = 0;
      for (let start = 0; start + take <= indexes.length; start += take) {
        const ids = indexes.slice(start, start + take);
        const prices = units.map((u) => u.price);
        ids.forEach((id, j) => {
          prices[id] = j < pay ? units[id].price : 0;
        });
        const gain = ids.reduce((sum, id) => sum + base[id] - prices[id], 0);
        if (gain > 0)
          offers.push({
            mask: ids.reduce((m, id) => m | (1n << BigInt(id)), 0n),
            prices,
            promotion: p,
            coupon,
            gain,
          });
        groups++;
      }
    } else {
      indexes.forEach((i) => {
        const amount = priceFor(p, units[i], state),
          gain = base[i] - amount;
        if (gain > 0) {
          const prices = [...base];
          prices[i] = amount;
          offers.push({ mask: 1n << BigInt(i), prices, promotion: p, coupon, gain });
        }
      });
    }
  };
  schedules.filter((p) => p.effect === 'nxm').forEach((p) => addOffers(p));
  schedules.filter((p) => p.effect !== 'nxm' && p.maxRedemptions !== null).forEach((p) => addOffers(p));
  if (codes.length && !online) throw new DomainError('Los cupones requieren conexión.', 'ONLINE_REQUIRED');
  const courtesyCodes: string[] = [];
  for (const code of [...new Set(codes.map((x) => x.trim().toUpperCase()).filter(Boolean))]) {
    const coupon = state.coupons.find((x) => x.code === code);
    if (!coupon || coupon.status !== 'issued' || coupon.expiresAt <= at)
      throw new DomainError('Cupón inválido, vencido o ya redimido.', 'INVALID_COUPON');
    const current = state.promotions.find((x) => x.id === coupon.promotionId);
    const promotion = coupon.benefit
      ? {
          ...coupon.benefit,
          active: current?.active === true,
          redemptions: current?.redemptions ?? 0,
          maxRedemptions: current?.maxRedemptions ?? null,
        }
      : current;
    if (!promotion?.active || promotion.delivery !== 'coupon' || !isScheduled(promotion, at))
      throw new DomainError('La promoción del cupón no está vigente en este horario.');
    if (promotion.maxRedemptions !== null && promotion.redemptions >= promotion.maxRedemptions)
      throw new DomainError('La promoción alcanzó su límite.');
    if (promotion.courtesyOnly) {
      if (!lines.some((line) => eligible(promotion, line, state)))
        throw new DomainError(
          'La cortesía no corresponde al tamaño, tipo o sabores del pedido. Revisa los productos antes de canjearla.',
        );
      courtesyCodes.push(code);
    }
    addOffers(promotion, coupon);
  }
  offers.sort((a, b) => b.gain - a.gain || a.promotion.id.localeCompare(b.promotion.id));
  // Independent offers are collapsed by mask/coupon before searching; cart quantities are not capped.
  const seen = new Set<string>();
  const unique = offers.filter((o) => {
    const key = `${o.mask.toString(36)}|${o.coupon?.id ?? ''}|${o.promotion.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let bestGain = 0,
    best: Offer[] = [];
  const suffix = Array(unique.length + 1).fill(0) as number[];
  for (let i = unique.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + unique[i].gain;
  const search = (
    i: number,
    mask: bigint,
    coupons: Set<string>,
    picked: Offer[],
    gain: number,
    uses: Record<string, number>,
  ) => {
    if (gain > bestGain) {
      bestGain = gain;
      best = [...picked];
    }
    if (i >= unique.length || gain + suffix[i] <= bestGain) return;
    const available = (o: Offer) =>
      !(o.mask & mask) &&
      (!o.coupon || !coupons.has(o.coupon.id)) &&
      (o.promotion.maxRedemptions === null ||
        (uses[o.promotion.id] ?? 0) < o.promotion.maxRedemptions - o.promotion.redemptions);
    while (i < unique.length && !available(unique[i])) i++;
    if (i >= unique.length) return;
    // Two independent relaxations bound the remaining gain: one respects coupon
    // uniqueness, the other global promotion quotas. They only prune impossible improvements.
    let couponBound = 0;
    const couponBest = new Map<string, number>(),
      byPromo = new Map<string, Offer[]>();
    for (let j = i; j < unique.length; j++) {
      const o = unique[j];
      if (!available(o)) continue;
      if (o.coupon) couponBest.set(o.coupon.id, Math.max(couponBest.get(o.coupon.id) ?? 0, o.gain));
      else couponBound += o.gain;
      const group = byPromo.get(o.promotion.id) ?? [];
      group.push(o);
      byPromo.set(o.promotion.id, group);
    }
    couponBound += [...couponBest.values()].reduce((n, x) => n + x, 0);
    let promoBound = 0;
    for (const group of byPromo.values()) {
      const p = group[0].promotion,
        limit =
          p.maxRedemptions === null
            ? group.length
            : Math.max(0, p.maxRedemptions - p.redemptions - (uses[p.id] ?? 0));
      promoBound += group.slice(0, limit).reduce((n, o) => n + o.gain, 0);
    }
    if (gain + Math.min(couponBound, promoBound) <= bestGain) return;
    const offer = unique[i];
    if (!(offer.mask & mask) && (!offer.coupon || !coupons.has(offer.coupon.id))) {
      const next = new Set(coupons);
      if (offer.coupon) next.add(offer.coupon.id);
      search(i + 1, mask | offer.mask, next, [...picked, offer], gain + offer.gain, {
        ...uses,
        [offer.promotion.id]: (uses[offer.promotion.id] ?? 0) + 1,
      });
    }
    search(i + 1, mask, coupons, picked, gain, uses);
  };
  search(0, 0n, new Set(), [], 0, {});
  if (courtesyCodes.some((code) => !best.some((offer) => offer.coupon?.code === code)))
    throw new DomainError(
      'Cada código de cortesía necesita un vaso elegible distinto. Revisa los productos y códigos del pedido.',
    );
  const finalPrices = [...base];
  const couponIds = new Map<number, string>();
  const groupUses: Record<string, number> = {};
  best.forEach((offer) => {
    if (offer.promotion.effect === 'nxm' || offer.coupon)
      groupUses[offer.promotion.id] = (groupUses[offer.promotion.id] ?? 0) + 1;
    units.forEach((_, i) => {
      if (offer.mask & (1n << BigInt(i))) {
        finalPrices[i] = offer.prices[i];
        chosen[i] = offer.promotion;
        if (offer.coupon) couponIds.set(i, offer.coupon.id);
      }
    });
  });
  const promotionUses = { ...groupUses };
  units.forEach((_, i) => {
    const p = chosen[i];
    if (p && p.effect !== 'nxm' && !couponIds.has(i)) promotionUses[p.id] = (promotionUses[p.id] ?? 0) + 1;
  });
  lines.forEach((line) => {
    const indexes = units
      .map((u, i) => ({ u, i }))
      .filter((x) => x.u.line.id === line.id)
      .map((x) => x.i);
    line.discount = indexes.reduce((sum, i) => sum + units[i].price - finalPrices[i], 0);
    line.unitPrice = line.listPrice;
    line.appliedRules = [];
    for (const i of indexes) {
      const promotion = chosen[i];
      if (!promotion) continue;
      const couponId = couponIds.get(i),
        rule = line.appliedRules.find(
          (r) =>
            r.promotion.id === promotion.id &&
            r.promotion.version === promotion.version &&
            r.couponId === couponId &&
            r.unitAmount === finalPrices[i],
        );
      if (rule) rule.quantity++;
      else
        line.appliedRules.push({
          promotion: structuredClone(promotion),
          couponId,
          couponCode: state.coupons.find((c) => c.id === couponId)?.code,
          quantity: 1,
          unitAmount: finalPrices[i],
        });
    }
    line.promotionId = indexes.map((i) => chosen[i]?.id).find(Boolean);
    line.couponId = indexes.map((i) => couponIds.get(i)).find(Boolean);
    const p = state.promotions.find((x) => x.id === line.promotionId);
    if (p?.effect === 'upgrade')
      line.paidSizeId = state.sizes.find(
        (x) => x.rank === state.sizes.find((y) => y.id === line.sizeId)!.rank - (p.steps ?? 1),
      )?.id;
  });
  return {
    lines,
    total: finalPrices.reduce((sum, x) => sum + x, 0),
    coupons: [...new Set(best.flatMap((x) => (x.coupon ? [x.coupon.id] : [])))],
    promotionUses,
  };
}
