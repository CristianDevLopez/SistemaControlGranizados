import { describe, it, expect } from 'vitest';
import {
  applyCommand,
  cashExpected,
  colombiaMonth,
  effectiveAt,
  ONLINE_LAG_MS,
} from '../src/domain/engine.ts';
import type { Actor, CommandType, Promotion, State } from '../src/domain/types.ts';
import { NOW, ids, fixture, cashier, admin, cmd, run, countedItems } from './support/fixture.ts';

// La hora del dispositivo solo se acepta hacia adelante (ver effectiveAt en engine.ts).
const offline: Actor = { ...cashier, online: false };
const promo = (extra: Partial<Promotion> = {}): Promotion => ({
  id: crypto.randomUUID(),
  name: 'Promoción de prueba',
  effect: 'free',
  delivery: 'coupon',
  sizeIds: [],
  flavorIds: [],
  alcohol: 'all',
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2027-01-01T00:00:00.000Z',
  days: [],
  startTime: '00:00',
  endTime: '23:59',
  maxRedemptions: null,
  redemptions: 0,
  active: true,
  version: 1,
  by: ids.admin,
  at: NOW,
  ...extra,
});
function runAt(
  s: State,
  type: CommandType,
  payload: Record<string, unknown>,
  actor: Actor,
  at: string,
  receivedAt: string,
) {
  return applyCommand(
    s,
    cmd(type, payload, actor, { at, configVersion: s.settings[0].version }),
    actor,
    receivedAt,
  );
}
function sale(s: State, at: string, actor: Actor = cashier) {
  const created = runAt(
    s,
    'create_order',
    { lines: [{ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity: 1 }] },
    actor,
    at,
    at,
  );
  return runAt(created.state, 'pay', { orderId: created.result.referenceId, deliver: true }, actor, at, at)
    .state;
}

describe('hora de las operaciones', () => {
  it('un cierre con hora atrasada incluye todas las ventas del turno', () => {
    let s = fixture(); // turno abierto a las 14:00Z con base 20.000
    s = sale(s, '2026-10-23T16:00:00.000Z');
    s = sale(s, '2026-10-23T17:00:00.000Z');
    expect(cashExpected(s, ids.shift)).toBe(48000);
    const closed = runAt(
      s,
      'count',
      {
        kind: 'closing',
        payments: { [`transfer:${ids.location}`]: 0 },
        shiftId: ids.shift,
        cash: 20000,
        retained: 20000,
        items: countedItems(s),
      },
      cashier,
      '2026-10-23T15:00:00.000Z', // el dispositivo dice 15:00
      '2026-10-23T18:00:00.000Z',
    ).state;
    const count = closed.counts.find((x) => x.kind === 'closing')!;
    expect(count.expectedCash).toBe(48000);
    expect(count.difference).toBe(-28000);
    const audit = closed.audit.at(-1)!;
    expect(audit.reportedAt).toBe('2026-10-23T15:00:00.000Z');
    expect(Date.parse(audit.at)).toBeGreaterThanOrEqual(Date.parse('2026-10-23T17:00:00.000Z'));
  });

  it('el cierre offline también incluye las ventas que el equipo registró antes', () => {
    let s = fixture();
    s = sale(s, '2026-10-23T16:00:00.000Z', offline);
    const closed = runAt(
      s,
      'count',
      {
        kind: 'closing',
        payments: { [`transfer:${ids.location}`]: 0 },
        shiftId: ids.shift,
        cash: 34000,
        retained: 34000,
        items: countedItems(s),
      },
      offline,
      '2026-10-23T15:30:00.000Z',
      '2026-10-23T20:00:00.000Z',
    ).state;
    expect(closed.counts.find((x) => x.kind === 'closing')!.difference).toBe(0);
  });

  it('no se puede canjear un cupón vencido atrasando la hora', () => {
    let s = fixture();
    s.promotions = [promo()];
    s = run(
      s,
      'issue_coupon',
      {
        promotionId: s.promotions[0].id,
        code: 'ABCDEFGHJKLMNPQRSTUV',
        expiresAt: '2026-11-01T00:00:00.000Z',
      },
      admin,
    ).state;
    const created = run(s, 'create_order', {
      lines: [{ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity: 1 }],
    });
    expect(() =>
      runAt(
        created.state,
        'pay',
        { orderId: created.result.referenceId, codes: ['ABCDEFGHJKLMNPQRSTUV'] },
        cashier,
        '2026-10-30T16:00:00.000Z', // antes del vencimiento
        '2026-11-09T16:00:00.000Z', // el servidor sabe que ya venció
      ),
    ).toThrow('Cupón inválido, vencido o ya redimido.');
  });

  it('atrasar el cobro no aplica el precio de una promoción por horario', () => {
    const s = fixture();
    // 10:00–11:00 en Colombia = 15:00–16:00Z
    s.promotions = [
      promo({
        effect: 'fixed',
        delivery: 'schedule',
        fixedPrice: 5000,
        startTime: '10:00',
        endTime: '11:00',
      }),
    ];
    (s.parameters[0].after as { promotions: Promotion[] }).promotions = structuredClone(s.promotions);
    const created = runAt(
      s,
      'create_order',
      { lines: [{ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity: 1 }] },
      cashier,
      '2026-10-23T20:00:00.000Z',
      '2026-10-23T20:00:00.000Z',
    );
    const fullPrice = created.state.orders[0].total;
    const paid = runAt(
      created.state,
      'pay',
      { orderId: created.result.referenceId },
      cashier,
      '2026-10-23T15:30:00.000Z',
      '2026-10-23T20:05:00.000Z',
    ).state.orders[0];
    expect(paid.total).toBe(fullPrice);
    expect(paid.paidAt! >= paid.createdAt).toBe(true);
  });

  it('una operación offline conserva su hora real', () => {
    const s = fixture();
    const at = '2026-10-23T15:10:00.000Z';
    const r = runAt(
      s,
      'create_order',
      { lines: [{ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity: 1 }] },
      offline,
      at,
      '2026-10-23T19:00:00.000Z', // se sincronizó horas después
    );
    expect(r.state.orders[0].createdAt).toBe(at);
    expect(r.state.audit.at(-1)!.reportedAt).toBeUndefined();
  });

  it('un equipo no puede registrar algo antes de su último evento', () => {
    let s = fixture();
    s = runAt(
      s,
      'create_order',
      { lines: [{ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity: 1 }] },
      offline,
      '2026-10-23T17:00:00.000Z',
      '2026-10-23T19:00:00.000Z',
    ).state;
    const command = cmd('create_order', {}, offline, { at: '2026-10-23T16:00:00.000Z' });
    expect(effectiveAt(s, command, offline, '2026-10-23T19:00:00.000Z')).toBe('2026-10-23T17:00:00.000Z');
  });

  it('una operación en línea demorada queda anclada a la hora del servidor', () => {
    const receivedAt = '2026-10-23T18:00:00.000Z';
    const command = cmd('create_order', {}, cashier, { at: '2026-10-23T15:00:00.000Z' });
    expect(Date.parse(effectiveAt(fixture(), command, cashier, receivedAt))).toBe(
      Date.parse(receivedAt) - ONLINE_LAG_MS,
    );
    const recent = cmd('create_order', {}, cashier, { at: '2026-10-23T17:58:00.000Z' });
    expect(effectiveAt(fixture(), recent, cashier, receivedAt)).toBe(recent.at);
  });

  it('los eventos de seguridad no mueven la hora del equipo', () => {
    const s = fixture();
    s.audit.push({
      id: '90000000-0000-4000-8000-000000000001',
      eventId: '90000000-0000-4000-8000-000000000001',
      by: offline.id,
      deviceId: offline.deviceId,
      at: '2026-12-31T00:00:00.000Z',
      receivedAt: '2026-12-31T00:00:00.000Z',
      action: 'register_device',
      detail: 'Registro de equipo',
    });
    const command = cmd('create_order', {}, offline, { at: '2026-10-23T15:00:00.000Z' });
    expect(effectiveAt(s, command, offline, '2026-10-23T19:00:00.000Z')).toBe(command.at);
  });
});

describe('fechas en hora de Colombia', () => {
  it('el mes de Colombia empieza a las 05:00Z', () => {
    expect(colombiaMonth('2026-11-01T02:00:00.000Z')).toBe('2026-10');
    expect(colombiaMonth('2026-11-01T05:00:00.000Z')).toBe('2026-11');
  });

  it('la cuota de cortesías se cuenta por mes de Colombia y no se evade atrasando la hora', () => {
    let s = fixture();
    s.settings[0].courtesyQuota = 1;
    s.promotions = [promo({ endsAt: '2027-01-01T00:00:00.000Z' })];
    const issue = (state: State, code: string, at: string, receivedAt = at) =>
      runAt(
        state,
        'issue_coupon',
        { promotionId: state.promotions[0].id, code, expiresAt: '2026-12-15T00:00:00.000Z', courtesy: true },
        admin,
        at,
        receivedAt,
      );
    // 31 de octubre, 21:00 en Colombia: cuenta para octubre.
    s = issue(s, 'AAAAAAAAAAAAAAAA', '2026-11-01T02:00:00.000Z').state;
    s = issue(s, 'BBBBBBBBBBBBBBBB', '2026-11-09T12:00:00.000Z').state;
    expect(s.coupons.filter((c) => c.courtesy)).toHaveLength(2);
    expect(() =>
      issue(s, 'CCCCCCCCCCCCCCCC', '2026-10-15T12:00:00.000Z', '2026-11-09T12:05:00.000Z'),
    ).toThrow('La cuota se agotó');
  });

  it('las vigencias de promociones se guardan en UTC', () => {
    const s = run(
      fixture(),
      'save_promotion',
      {
        name: 'Tarde',
        effect: 'fixed',
        fixedPrice: 1000,
        delivery: 'schedule',
        startsAt: '2026-10-23T12:00:00-05:00',
        endsAt: '2026-10-24T00:00:00-05:00',
      },
      admin,
    ).state;
    expect(s.promotions.at(-1)).toMatchObject({
      startsAt: '2026-10-23T17:00:00.000Z',
      endsAt: '2026-10-24T05:00:00.000Z',
    });
  });
});
