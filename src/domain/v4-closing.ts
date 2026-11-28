import { assert, articles, cashExpected, eventId, money, quantity } from './engine.ts';
import { v4Move, v4Note, v4Notify, countMermas, type V4Context } from './v4-runtime.ts';
import type { ClosingProposal } from './v4-types.ts';
import type { Order, State } from './types.ts';
import { candies } from './v4-catalog.ts';

export function closingProposal(ctx: V4Context) {
  const { state, command, actor, at } = ctx,
    p = command.payload as Record<string, any>;
  const shift = state.shifts.find((s) => s.id === p.shiftId && s.status === 'closed' && !s.closingArchive);
  assert(shift && shift.cashierId !== actor.id, 'Otro administrador debe revisar el cierre.', 'FORBIDDEN');
  assert(!shift.v4Reviews?.some((r) => r.status !== 'rejected'), 'El cierre ya tiene una propuesta vigente.');
  const employee = state.counts.find((c) => c.id === shift.closingCountId);
  assert(employee, 'Conteo original no disponible.');
  const notes = v4Note(p.notes),
    id = eventId(command, 'closing-proposal');
  const proposal: ClosingProposal = {
    id,
    commandId: command.id,
    openingIds: [],
    corrections: structuredClone(p.corrections ?? []),
    version: (shift.v4Reviews?.length ?? 0) + 1,
    by: actor.id,
    at,
    notes,
    status: 'approved',
    count: structuredClone(employee),
    employeeCountId: employee.id,
    stockIds: [],
    orderIds: [],
    paymentIds: [],
    before: { orders: [], payments: [], stock: [], packages: [], bags: [] },
    expected: {
      cash: cashExpected(state, shift.id, employee.cutoffAt ?? employee.at),
      items: { ...employee.expectedItems },
    },
    adjust: p.adjust !== false,
  };
  const cutoff = employee.receivedAt ?? employee.at;
  for (const movement of state.stock) {
    const audit = state.audit.find((a) => a.eventId === movement.eventId);
    const damage = state.requests.find(
      (r) => r.id === movement.referenceId && r.type === 'damage' && r.referenceId === shift.id,
    );
    if (
      damage &&
      movement.reason === 'approved_damage' &&
      audit &&
      audit.receivedAt > cutoff &&
      Object.hasOwn(proposal.expected.items, movement.article)
    )
      proposal.expected.items[movement.article] += movement.quantity;
  }
  const oldStock = new Set(state.stock.map((m) => m.id)),
    oldOrders = new Set(state.orders.map((o) => o.id)),
    oldPayments = new Set(state.payments.map((x) => x.id));
  const corrections = Array.isArray(p.corrections) ? p.corrections : [];
  assert(corrections.length <= 100, 'Demasiadas correcciones.');
  const references = corrections.flatMap((c: Record<string, any>) =>
    c.orderId ? ['order:' + c.orderId] : c.openingId ? ['opening:' + c.openingId] : [],
  );
  assert(
    new Set(references).size === references.length,
    'Incluye una sola corrección por venta o apertura en cada propuesta.',
  );
  for (let index = 0; index < corrections.length; index++) {
    const c = corrections[index];
    v4Note(c.notes);
    if (c.kind === 'opening_add') {
      assert(
        !candies(state).some((candy) => candy.id === c.article),
        'Los dulces no requieren registrar apertura de bolsa.',
      );
      assert(c.at >= shift.openedAt! && c.at <= (shift.closedAt ?? at), 'La hora debe pertenecer al turno.');
      const openingId = eventId(command, 'closing-opening:' + index);
      if (c.article.startsWith('package:')) {
        const size = state.sizes.find((s) => c.article === 'package:' + s.id);
        assert(size, 'Tamaño desconocido.');
        v4Move(ctx, c.article, -1, 'closing_opening', id, String(index));
        v4Move(
          ctx,
          'cup:' + size.id,
          state.settings[0].cupPackageUnits,
          'closing_opening',
          id,
          String(index),
        );
        state.packages.push({
          id: openingId,
          sizeId: size.id,
          units: state.settings[0].cupPackageUnits,
          by: actor.id,
          openedAt: c.at,
          shiftId: shift.id,
        });
      } else if (c.article.startsWith('sealed_bag:')) {
        const flavor = state.flavors.find((f) => c.article === 'sealed_bag:' + f.id);
        assert(flavor, 'Sabor desconocido.');
        v4Move(ctx, c.article, -1, 'closing_opening', id, String(index));
        v4Move(ctx, 'liquid:' + flavor.id, state.settings[0].bagOunces, 'closing_opening', id, String(index));
        state.bags.push({
          id: openingId,
          flavorId: flavor.id,
          ounces: state.settings[0].bagOunces,
          by: actor.id,
          openedAt: c.at,
          shiftId: shift.id,
        });
      } else v4Move(ctx, c.article, -quantity(c.quantity ?? 1), 'closing_opening', id, String(index));
      proposal.openingIds.push(openingId);
      proposal.status = 'pending';
    } else if (c.kind === 'opening_remove' || c.kind === 'opening_move') {
      const pack = state.packages.find((x) => x.id === c.openingId),
        bag = state.bags.find((x) => x.id === c.openingId);
      const opening = pack ?? bag;
      assert(opening && !opening.voidedAt && opening.shiftId === shift.id, 'Apertura no disponible.');
      if (pack) proposal.before.packages.push(structuredClone(pack));
      if (bag) proposal.before.bags.push(structuredClone(bag));
      const closed = pack ? 'package:' + pack.sizeId : 'sealed_bag:' + bag!.flavorId;
      const opened = pack ? 'cup:' + pack.sizeId : 'liquid:' + bag!.flavorId;
      const amount = pack ? pack.units : bag!.ounces;
      v4Move(ctx, closed, 1, 'closing_opening_removed', id, String(index));
      v4Move(ctx, opened, -amount, 'closing_opening_removed', id, String(index));
      opening.voidedAt = at;
      if (c.kind === 'opening_move') {
        const target = state.shifts.find((s) => s.id === c.targetShiftId);
        assert(
          target && target.id !== shift.id && c.at >= target.openedAt! && c.at <= (target.closedAt ?? at),
          'Turno y hora de destino inválidos.',
        );
        const moved = {
          ...opening,
          id: eventId(command, 'moved-opening:' + index),
          shiftId: target.id,
          openedAt: c.at,
          voidedAt: undefined,
        };
        if (pack) state.packages.push(moved as State['packages'][number]);
        else state.bags.push(moved as State['bags'][number]);
        proposal.openingIds.push(moved.id);
        // Trasladar el registro explica otro turno, sin volver a abrir físicamente el insumo.
      }
      proposal.status = 'pending';
    } else if (c.kind === 'sale_add') {
      const size = state.sizes.find((s) => s.id === c.sizeId && s.active);
      assert(size, 'Tamaño desconocido.');
      const flavors =
        c.flavorId === 'bomba'
          ? state.flavors.filter((f) => f.active && f.alcohol === !!c.alcohol)
          : state.flavors.filter((f) => f.id === c.flavorId && f.active);
      assert(flavors.length, 'Selecciona un sabor activo.');
      assert(
        flavors.every((f) => f.alcohol === !!c.alcohol),
        'El sabor debe corresponder al tipo con o sin licor elegido.',
      );
      const price = c.alcohol ? size.alcoholPrice : size.plainPrice;
      assert(price !== null && price > 0, 'Precio no configurado.');
      const oid = eventId(command, 'closing-order:' + index),
        lineId = eventId(command, 'closing-line:' + index);
      const order: Order = {
        id: oid,
        number: oid.slice(0, 8).toUpperCase(),
        shiftId: shift.id,
        sellerId: actor.id,
        lines: [
          {
            id: lineId,
            bomba: c.flavorId === 'bomba',
            flavorId: flavors[0].id,
            flavorIds: flavors.map((f) => f.id),
            sizeId: size.id,
            quantity: 1,
            delivered: 1,
            listPrice: price,
            unitPrice: price,
            discount: 0,
            consumptionIds: [],
            recipe: { ounces: size.ounces, cups: size.cups, beers: size.beers },
            candyRecipe: employee.candyRecipes?.[size.id],
          },
        ],
        tastings: [],
        status: 'paid',
        createdAt: employee.at,
        paidAt: employee.at,
        total: price,
        version: 1,
        origin: 'app',
        addedAtClosing: true,
      };
      state.orders.push(order);
      v4Move(ctx, size.cups ? 'cup:' + size.id : 'nevera', -1, 'closing_sale', oid);
      for (const flavor of flavors)
        v4Move(ctx, 'liquid:' + flavor.id, -size.ounces / flavors.length, 'closing_sale', oid);
      if (c.alcohol && size.beers) v4Move(ctx, 'coronita', -size.beers, 'closing_sale', oid);
      const transfer = c.method === 'transfer';
      assert(
        !transfer || state.locations.some((l) => l.id === c.accountId && l.active && l.type === 'bank'),
        'Selecciona una cuenta bancaria.',
      );
      assert(!transfer || c.verified === true, 'Verifica el ingreso de la transferencia.');
      state.payments.push({
        id: eventId(command, 'closing-payment:' + index),
        orderId: oid,
        shiftId: shift.id,
        cashierId: actor.id,
        amount: price,
        type: 'cash',
        method: transfer ? 'transfer' : 'cash',
        accountId: transfer ? c.accountId : undefined,
        at: employee.at,
        eventId: command.id,
      });
      if (!transfer) proposal.expected.cash += price;
      proposal.status = 'pending';
    } else if (c.kind === 'sale_void' || c.kind === 'payment') {
      const order = state.orders.find(
        (o) => o.id === c.orderId && o.shiftId === shift.id && o.status === 'paid',
      );
      assert(order, 'Venta no disponible.');
      proposal.before.orders.push(structuredClone(order));
      const payments = state.payments.filter((x) => x.orderId === order.id);
      if (c.kind === 'sale_void') {
        order.status = 'voided';
        order.voidInventoryRestoredAt = at;
        for (const item of state.stock.filter(
          (m) => m.referenceId === order.id && m.quantity < 0 && m.reason !== 'candy_sale',
        ))
          v4Move(ctx, item.article, -item.quantity, 'closing_void', id, item.id);
        for (const payment of payments) {
          state.payments.push({
            ...payment,
            id: eventId(command, 'void:' + payment.id),
            amount: -payment.amount,
            type: 'refund',
            at: employee.at,
            eventId: command.id,
            reversesId: payment.id,
          });
          if ((payment.method ?? 'cash') === 'cash') proposal.expected.cash -= payment.amount;
        }
        proposal.status = 'pending';
      } else {
        assert(c.method === 'cash' || c.method === 'transfer', 'Medio inválido.');
        assert(
          c.method === 'cash' ||
            state.locations.some((l) => l.id === c.accountId && l.active && l.type === 'bank'),
          'Cuenta desconocida.',
        );
        assert(c.method !== 'transfer' || c.verified === true, 'Verifica el ingreso de la transferencia.');
        for (const payment of payments.filter((x) => !x.reversesId)) {
          const oldCash = (payment.method ?? 'cash') === 'cash';
          proposal.before.payments.push(structuredClone(payment));
          payment.method = c.method;
          payment.accountId = c.method === 'transfer' ? c.accountId : undefined;
          proposal.expected.cash +=
            (c.method === 'cash' ? payment.amount : 0) - (oldCash ? payment.amount : 0);
        }
      }
      order.version++;
    } else assert(c.kind === 'note', 'Corrección desconocida.');
  }
  for (const movement of state.stock.filter((m) => !oldStock.has(m.id)))
    if (Object.hasOwn(employee.items, movement.article)) {
      proposal.expected.items[movement.article] =
        (proposal.expected.items[movement.article] ?? 0) + movement.quantity;
      v4Move(ctx, movement.article, -movement.quantity, 'closing_explanation', id, movement.id);
    }
  proposal.count = {
    ...structuredClone(employee),
    id: eventId(command, 'admin-count'),
    by: actor.id,
    at,
    revisesId: employee.id,
    notes,
    expectedCash: proposal.expected.cash,
    expectedItems: proposal.expected.items,
  };
  if (p.cash !== undefined && p.cash !== null && p.cash !== '') {
    const cash = money(p.cash, 'Conteo de efectivo', true);
    if (cash !== employee.cash) proposal.status = 'pending';
    proposal.count.cash = cash;
  }
  for (const [article, value] of Object.entries(p.items ?? {})) {
    assert(Object.hasOwn(employee.items, article), 'Artículo no incluido en el conteo.');
    const n = quantity(value, 'Conteo del administrador', 1000000, true);
    if (n !== employee.items[article]) proposal.status = 'pending';
    proposal.count.items[article] = n;
    v4Move(ctx, article, n - employee.items[article], 'admin_count', id);
  }
  if (p.expectedPreview)
    assert(
      p.expectedPreview.cash === proposal.expected.cash &&
        Object.entries(proposal.expected.items).every(([id, n]) => p.expectedPreview.items?.[id] === n),
      'El cierre cambió. Revisa de nuevo la propuesta.',
      'CLOSING_CHANGED',
    );
  proposal.count.differences = Object.fromEntries(
    Object.entries(proposal.count.items).map(([article, n]) => [
      article,
      n - (proposal.expected.items[article] ?? 0),
    ]),
  );
  proposal.count.difference = (proposal.count.cash ?? 0) - proposal.expected.cash;
  state.counts.push(proposal.count);
  countMermas(ctx, proposal.count, id);
  proposal.stockIds = state.stock.filter((m) => !oldStock.has(m.id)).map((m) => m.id);
  proposal.orderIds = state.orders.filter((o) => !oldOrders.has(o.id)).map((o) => o.id);
  proposal.paymentIds = state.payments.filter((x) => !oldPayments.has(x.id)).map((x) => x.id);
  (shift.v4Reviews ??= []).push(proposal);
  shift.closingReview = {
    status: 'approved',
    countId: proposal.count.id,
    by: actor.id,
    at,
    ...(!proposal.adjust ? { inventoryVerification: { status: 'pending' as const } } : {}),
  };
  if (!proposal.adjust)
    state.settings[0].nextOpeningAudit = {
      mode: 'full',
      cash: true,
      items: articles(state).map((a) => a.id),
      payments: [],
      by: actor.id,
      at,
    };
  v4Notify(
    ctx,
    'cierre_resuelto',
    'Cierre confirmado por ' +
      actor.name +
      (proposal.status === 'pending' ? ' · pendiente de otro admin' : ''),
    shift.id,
  );
}
export function resolveClosing(ctx: V4Context) {
  const { state, command, actor, at } = ctx,
    p = command.payload as Record<string, any>;
  const shift = state.shifts.find((s) => s.id === p.shiftId),
    proposal = shift?.v4Reviews?.at(-1);
  assert(shift && proposal?.status === 'pending', 'Propuesta pendiente no disponible.');
  assert(proposal.by !== actor.id, 'Otro administrador debe resolver tu propuesta.', 'FORBIDDEN');
  assert(shift.cashierId !== actor.id, 'No puedes confirmar tu propio cierre.', 'FORBIDDEN');
  proposal.reviewedBy = actor.id;
  proposal.reviewedAt = at;
  proposal.reviewNotes = v4Note(p.notes);
  if (p.approve === true) proposal.status = 'approved';
  else {
    assert(p.approve === false, 'Selecciona aprobar o rechazar.');
    proposal.status = 'rejected';
    for (const item of state.stock.filter((m) => m.eventId === proposal.commandId))
      v4Move(ctx, item.article, -item.quantity, 'closing_rejected', proposal.id, item.id);
    for (const opening of [...state.bags, ...state.packages].filter((o) =>
      proposal.openingIds.includes(o.id),
    ))
      opening.voidedAt = at;
    for (const previous of proposal.before.packages)
      state.packages[state.packages.findIndex((o) => o.id === previous.id)] = previous;
    for (const previous of proposal.before.bags)
      state.bags[state.bags.findIndex((o) => o.id === previous.id)] = previous;
    for (const order of state.orders.filter((o) => proposal.orderIds.includes(o.id)))
      order.status = 'cancelled';
    for (const old of proposal.before.orders) {
      const index = state.orders.findIndex((o) => o.id === old.id);
      state.orders[index] = { ...old, version: state.orders[index].version + 1 };
    }
    for (const payment of state.payments.filter((x) => proposal.paymentIds.includes(x.id)))
      state.payments.push({
        ...payment,
        id: eventId(command, 'reject:' + payment.id),
        amount: -payment.amount,
        at,
        eventId: command.id,
        reversesId: payment.id,
        type: payment.amount > 0 ? 'refund' : 'cash',
      });
    for (const old of proposal.before.payments)
      state.payments[state.payments.findIndex((x) => x.id === old.id)] = old;
    for (const request of state.requests.filter((r) => r.merma?.sourceId === proposal.id))
      request.merma!.superseded = true;
    shift.closingReview = { status: 'pending', notes: 'Por corregir · ' + proposal.reviewNotes };
  }
  v4Notify(
    ctx,
    'cierre_resuelto',
    p.approve ? 'Propuesta de cierre aprobada' : 'Propuesta rechazada · por corregir',
    shift.id,
  );
}
