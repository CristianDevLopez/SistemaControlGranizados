import { assert, articles, eventId, money, quantity, stockBalances } from './engine.ts';
import { hasPermission, isShiftCashier } from './access.ts';
import { candies, candyRecipe, additionRecipe, componentCost, expenseCategories } from './v4-catalog.ts';
import type { Actor, Command, Count, Order, State } from './types.ts';
import type { Merma } from './v4-types.ts';
import { closingProposal, resolveClosing } from './v4-closing.ts';

export type V4Context = { state: State; command: Command; actor: Actor; at: string };
export function v4Note(value: unknown) {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= 1500,
    'Escribe un motivo de hasta 1500 caracteres.',
  );
  return value.trim();
}
export function v4Move(
  ctx: V4Context,
  article: string,
  amount: number,
  reason: string,
  referenceId: string,
  tag = '',
) {
  if (Math.abs(amount) < 0.0000001) return;
  assert(Number.isFinite(amount), 'Cantidad inválida.');
  assert(
    articles(ctx.state).some((a) => a.id === article),
    'Artículo desconocido.',
  );
  ctx.state.stock.push({
    id: eventId(ctx.command, ['v4', reason, referenceId, article, tag].join(':')),
    article,
    quantity: amount,
    reason,
    referenceId,
    at: ctx.at,
    by: ctx.actor.id,
    eventId: ctx.command.id,
  });
}
export function v4Notify(ctx: V4Context, type: string, text: string, referenceId?: string) {
  ctx.state.notifications.push({
    id: eventId(ctx.command, 'v4:notice:' + type + ':' + (referenceId ?? '')),
    channel: type.includes('gasto') ? 'gastos' : type.includes('traslado') ? 'transferencias' : 'mermas',
    type,
    text,
    referenceId,
    at: ctx.at,
    status: 'pending',
    attempts: 0,
  });
}
export function addMerma(ctx: V4Context, data: Omit<Merma, 'state' | 'recoveries' | 'history'>) {
  const id = eventId(ctx.command, 'merma:' + data.sourceId + ':' + data.article);
  if (ctx.state.requests.some((r) => r.id === id)) return;
  ctx.state.requests.push({
    id,
    type: 'difference',
    by: ctx.actor.id,
    at: ctx.at,
    status: 'approved',
    notes: 'Merma de ' + data.type,
    merma: {
      ...data,
      state: 'open',
      recoveries: [],
      history: [{ by: ctx.actor.id, at: ctx.at, notes: 'Registrada' }],
    },
  });
}
export function countMermas(ctx: V4Context, count: Count, sourceId: string) {
  const differences = { ...count.differences, ...(count.difference ? { cash: count.difference } : {}) };
  for (const [article, delta] of Object.entries(differences)) {
    if (delta >= 0) continue;
    const size = ctx.state.sizes.find((s) => article === 'cup:' + s.id);
    const flavors = ctx.state.flavors.filter((f) => f.active);
    const components: Record<string, number> = size
      ? Object.fromEntries([
          ...flavors.map((f) => ['liquid:' + f.id, (size.ounces * -delta) / Math.max(1, flavors.length)]),
          ...Object.entries(count.candyRecipes?.[size.id] ?? candyRecipe(ctx.state, size.id)).map(
            ([id, n]) => [id, n * -delta],
          ),
        ])
      : {};
    for (const [key, value] of Object.entries(components))
      v4Move(ctx, key, -value, 'merma_served', sourceId, article);
    const costs =
      article === 'cash'
        ? [1]
        : [
            componentCost(ctx.state, article, count.at),
            ...Object.entries(components).map(([key, q]) => {
              const cost = componentCost(ctx.state, key, count.at);
              return cost === null ? null : (cost * q) / -delta;
            }),
          ];
    addMerma(ctx, {
      type: 'Cierre',
      article,
      quantity: -delta,
      costMissing: costs.some((c) => c === null),
      unitCost: costs.reduce<number>((sum, c) => sum + (c ?? 0), 0),
      saleValue: article === 'cash' ? 1 : (size?.alcoholPrice ?? size?.plainPrice ?? 0),
      shiftId: count.shiftId,
      sourceId,
      components,
    });
  }
}
function orderCandy(state: State, order?: Order) {
  const result: Record<string, number> = {};
  if (!order || order.voidInventoryRestoredAt || order.status === 'cancelled') return result;
  const add = (recipe: Record<string, number>, n: number) =>
    Object.entries(recipe).forEach(([id, q]) => (result[id] = (result[id] ?? 0) + q * n));
  for (const line of order.lines)
    add(
      line.candyRecipe ?? candyRecipe(state, line.sizeId),
      Math.max(
        line.delivered,
        order.status === 'paid' || order.status === 'void_requested' ? line.quantity : 0,
      ),
    );
  if (order.status === 'paid' || order.status === 'void_requested') {
    if (order.additionConsumption) add(order.additionConsumption, 1);
    else
      for (const addition of order.additions ?? [])
        add(additionRecipe(state, addition.id), addition.quantity);
  }
  if (order.inventoryTransferred && order.replacesId) {
    const previous = state.orders.find((o) => o.id === order.replacesId);
    if (previous)
      for (const [id, q] of Object.entries(orderCandy(state, previous)))
        result[id] = Math.max(0, (result[id] ?? 0) - q);
  }
  return result;
}
export function finishV4(before: State, state: State, command: Command, actor: Actor, at: string) {
  if (!state.settings[0].v4Enabled || before.audit.some((a) => a.eventId === command.id)) return;
  const ctx = { state, command, actor, at };
  for (const order of state.orders) {
    const old = before.orders.find((o) => o.id === order.id);
    if (JSON.stringify(old) === JSON.stringify(order)) continue;
    for (const line of order.lines)
      if (line.delivered || order.status === 'paid')
        line.candyRecipe ??= structuredClone(candyRecipe(state, line.sizeId));
    if (order.status === 'paid' && !order.additionConsumption) {
      order.additionConsumption = {};
      for (const a of order.additions ?? [])
        for (const [id, q] of Object.entries(additionRecipe(state, a.id)))
          order.additionConsumption[id] = (order.additionConsumption[id] ?? 0) + q * a.quantity;
    }
    if (!(command.type === 'v4' && command.payload.action === 'closing_resolve')) {
      const priorUsage = orderCandy(before, old),
        nextUsage = orderCandy(state, order);
      const consumed = old?.candyConsumption ?? {};
      const nextConsumption: Record<string, number> = {};
      for (const id of new Set([
        ...Object.keys(consumed),
        ...Object.keys(priorUsage),
        ...Object.keys(nextUsage),
      ])) {
        nextConsumption[id] = Math.max(0, (consumed[id] ?? 0) + (nextUsage[id] ?? 0) - (priorUsage[id] ?? 0));
        v4Move(ctx, id, (consumed[id] ?? 0) - nextConsumption[id], 'candy_sale', order.id);
      }
      order.candyConsumption = nextConsumption;
    }
    if (order.status === 'paid' && old?.status !== 'paid')
      order.componentCosts ??= Object.fromEntries(
        articles(state).map((a) => [a.id, componentCost(state, a.id, order.paidAt ?? at)]),
      );
  }
  for (const expense of state.expenses.filter((e) => !before.expenses.some((old) => old.id === e.id))) {
    const category = expenseCategories(state).find((c) => c.name === expense.category);
    if (category) {
      assert(
        actor.role === 'admin' || !category.adminOnly,
        'Esta categoría solo está disponible para administradores.',
        'FORBIDDEN',
      );
      expense.classification = structuredClone(category);
      if (category.group === 'Otros') {
        assert(
          ['Costo', 'Gasto'].includes(String(command.payload.nature)) &&
            ['Fijo', 'Variable'].includes(String(command.payload.behavior)),
          'Elige costo o gasto y fijo o variable para Otros.',
        );
        expense.classification.nature = command.payload.nature as 'Costo' | 'Gasto';
        expense.classification.behavior = command.payload.behavior as 'Fijo' | 'Variable';
      }
    }
    const ids = command.payload.shipmentIds;
    if (Array.isArray(ids)) {
      assert(
        ids.every((id) => state.shipments.some((s) => s.id === id)),
        'Envío desconocido.',
      );
      expense.shipmentIds = [...new Set(ids as string[])];
    }
  }
  for (const shift of state.shifts) {
    const previous = before.shifts.find((s) => s.id === shift.id);
    if (shift.status === 'closed' && previous?.status !== 'closed' && !shift.v4EmployeeAdjusted) {
      const count = state.counts.find((c) => c.id === shift.closingCountId);
      if (count) {
        for (const [article, delta] of Object.entries(count.differences ?? {}))
          v4Move(ctx, article, delta, 'v4_employee_count', count.id);
        shift.v4EmployeeAdjusted = true;
      }
    }
  }
  for (const request of [...state.requests]) {
    const old = before.requests.find((r) => r.id === request.id);
    if (
      request.type === 'damage' &&
      request.status === 'approved' &&
      old?.status !== 'approved' &&
      request.article &&
      request.quantity
    )
      addMerma(ctx, {
        type: 'Daños',
        article: request.article,
        quantity: request.quantity,
        unitCost: componentCost(state, request.article, at) ?? 0,
        costMissing: componentCost(state, request.article, at) === null,
        saleValue: 0,
        sourceId: request.id,
      });
  }
  for (const order of state.orders.filter(
    (o) =>
      o.status === 'unpaid_incident' &&
      before.orders.find((old) => old.id === o.id)?.status !== 'unpaid_incident',
  ))
    addMerma(ctx, {
      type: 'Cierre',
      article: 'cash',
      quantity: order.total,
      unitCost: 1,
      saleValue: 1,
      shiftId: order.shiftId,
      orderId: order.id,
      sourceId: order.id,
    });
  const newCounts = state.counts.filter(
    (c) => c.kind === 'closing' && !c.revisesId && !before.counts.some((old) => old.id === c.id),
  );
  for (const count of newCounts) {
    count.candyRecipes = Object.fromEntries(
      state.sizes.map((s) => [s.id, structuredClone(candyRecipe(state, s.id))]),
    );
    const differences = [
      ...Object.entries(count.differences ?? {})
        .filter(([, n]) => n !== 0)
        .map(([id, n]) => (n > 0 ? '+' : '') + n + ' ' + (count.itemLabels?.[id] ?? id)),
      ...(count.difference ? [(count.difference > 0 ? '+' : '') + count.difference + ' COP'] : []),
    ];
    const notices = state.notifications.filter(
      (n) => !before.notifications.some((old) => old.id === n.id) && n.channel === 'mermas',
    );
    if (!notices.length)
      v4Notify(
        ctx,
        'cierre',
        'Cierre enviado · ' + (differences.join(', ') || 'sin diferencias'),
        count.shiftId,
      );
    else {
      notices[0].type = 'cierre';
      notices[0].referenceId = count.shiftId;
      notices[0].text = 'Cierre enviado · ' + (differences.join(', ') || 'sin diferencias');
    }
  }
  if (command.type === 'create_shipment')
    v4Notify(
      ctx,
      'envio_creado',
      'Va en camino un envío desde ' + String(command.payload.from),
      state.shipments.at(-1)?.id,
    );
  for (const notice of state.notifications.filter((n) => !before.notifications.some((o) => o.id === n.id))) {
    if (!notice.type) {
      const types: Record<string, string> = {
        expense: 'gasto_pendiente',
        create_shipment: 'envio_creado',
        request_void: 'anulacion',
        report_damage: 'daño',
        submit_blind_count: command.payload.kind === 'closing' ? 'cierre' : 'apertura_diferencias',
        count: 'cierre',
        request_transfer: 'traslado',
        confirm_transfer: 'traslado_diferencias',
        pay: 'caja_tope',
      };
      notice.type = types[command.type] ?? notice.channel;
      notice.referenceId = (command.payload.shiftId ??
        command.payload.requestId ??
        command.payload.transferId ??
        command.payload.orderId) as string | undefined;
    }
  }
  if (
    command.type === 'v4' &&
    ['closing_proposal', 'closing_resolve', 'reconcile'].includes(String(command.payload.action))
  ) {
    const audit = state.audit.find((a) => a.eventId === command.id);
    if (audit) {
      const proposal = state.shifts.find((s) => s.id === command.payload.shiftId)?.v4Reviews?.at(-1);
      audit.detail = String(command.payload.action) + ' · ' + String(command.payload.notes ?? '');
      audit.change = {
        kind: 'v4',
        label: proposal ? 'Cierre · versión ' + proposal.version : 'Conciliación de merma',
        before: proposal
          ? { conteoEmpleado: state.counts.find((c) => c.id === proposal.employeeCountId) }
          : null,
        after: proposal
          ? { conteo: proposal.count, correcciones: proposal.corrections, estado: proposal.status }
          : null,
        proposedBy: { by: proposal?.by ?? actor.id, name: actor.name, at: proposal?.at ?? at },
        votes: proposal?.reviewedBy
          ? [{ by: proposal.reviewedBy, name: actor.name, at: proposal.reviewedAt! }]
          : [],
      };
    }
  }
  for (const notice of state.notifications.filter(
    (n) =>
      n.referenceId &&
      (!n.resolved ||
        (command.type === 'v4' &&
          command.payload.action === 'closing_resolve' &&
          command.payload.shiftId === n.referenceId)),
  )) {
    const target = state.requests.find((r) => r.id === notice.referenceId);
    const shift = state.shifts.find((s) => s.id === notice.referenceId);
    const transfer = state.transfers.find((t) => t.id === notice.referenceId);
    if (
      (target &&
        (target.merma ? ['reconciled', 'lost'].includes(target.merma.state) : target.status !== 'pending')) ||
      (shift?.closingReview?.status === 'approved' && shift.v4Reviews?.at(-1)?.status !== 'pending') ||
      (shift &&
        command.type === 'v4' &&
        command.payload.action === 'closing_resolve' &&
        command.payload.shiftId === shift.id) ||
      transfer?.status === 'confirmed'
    )
      notice.resolved = {
        by: actor.name,
        at,
        eventId: command.id,
        ...(shift?.v4Reviews?.at(-1)?.status === 'rejected'
          ? { outcome: 'Propuesta rechazada · por corregir' }
          : {}),
      };
  }
}
export function applyV4(ctx: V4Context): { referenceId?: string; message: string } {
  const { state, command, actor, at } = ctx;
  const p = command.payload as Record<string, any>;
  assert(actor.online, 'Esta operación requiere conexión.', 'ONLINE_REQUIRED');
  if (p.action === 'start_closing') {
    const shift = state.shifts.find((s) => s.id === p.shiftId && s.status === 'open');
    assert(
      shift && isShiftCashier(actor, shift) && hasPermission(actor, 'shifts'),
      'Solo la caja del turno puede iniciar el cierre.',
      'FORBIDDEN',
    );
    shift.v4ClosingStarted = true;
    return { message: 'Ventas en pausa. Puedes registrar inventario, daños y gastos.' };
  }
  if (p.action === 'receive') {
    assert(hasPermission(actor, 'inventory'), 'Sin permiso para recibir mercancía.', 'FORBIDDEN');
    receive(ctx);
    return {
      message: 'Lo que llegó bien ya está en el inventario. Los dañados y lo que faltó los revisa un admin.',
    };
  }
  assert(actor.role === 'admin', 'Esta operación requiere un administrador.', 'FORBIDDEN');
  const config = (state.settings[0].v4 ??= {});
  switch (p.action) {
    case 'configure': {
      for (const key of ['lowStockDays', 'lossDays', 'candyTolerance'] as const)
        if (p[key] !== undefined)
          config[key] = quantity(p[key], key, key === 'candyTolerance' ? 1 : 365, key === 'candyTolerance');
      if (p.telegram) {
        assert(Array.isArray(p.telegram.groups) && p.telegram.groups.length <= 20, 'Grupos inválidos.');
        assert(
          p.telegram.groups.every(
            (g: any) =>
              typeof g.id === 'string' &&
              typeof g.name === 'string' &&
              g.name.length <= 100 &&
              /^-?\d+$/.test(g.chatId),
          ),
          'Nombre o identificador de grupo inválido.',
        );
        assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(p.telegram.dailyTime), 'Hora inválida.');
        assert(
          p.telegram.rules &&
            Object.values(p.telegram.rules).every(
              (r: any) =>
                typeof r.enabled === 'boolean' && p.telegram.groups.some((g: any) => g.id === r.groupId),
            ),
          'Destino de aviso inválido.',
        );
        config.telegram = {
          dailyTime: p.telegram.dailyTime,
          groups: p.telegram.groups.map((g: any) => ({ id: g.id, name: g.name, chatId: g.chatId })),
          rules: Object.fromEntries(
            Object.entries(p.telegram.rules).map(([key, r]) => [
              key,
              { enabled: (r as any).enabled, groupId: (r as any).groupId },
            ]),
          ),
        };
      }
      break;
    }
    case 'candy': {
      const id = String(p.id || 'supply:' + eventId(command, 'candy'));
      assert(id.startsWith('supply:'), 'Identificador inválido.');
      const list = structuredClone(candies(state));
      const candy = {
        id,
        name: v4Note(p.name),
        unit: p.unit,
        perBag: quantity(p.perBag, 'Contenido por bolsa', 1000000),
        cost: money(p.cost, 'Costo de bolsa', true),
      };
      assert(['unidades', 'oz', 'g'].includes(candy.unit), 'Unidad inválida.');
      const index = list.findIndex((c) => c.id === id);
      if (index < 0) list.push(candy);
      else list[index] = candy;
      config.candies = list;
      break;
    }
    case 'recipe': {
      const entries = Object.entries(p.recipe ?? {}) as [string, unknown][];
      assert(
        entries.every(
          ([id, n]) =>
            candies(state).some((c) => c.id === id) && typeof n === 'number' && Number.isFinite(n) && n >= 0,
        ),
        'Receta inválida.',
      );
      if (p.sizeId) {
        assert(
          state.sizes.some((s) => s.id === p.sizeId),
          'Tamaño desconocido.',
        );
        (config.recipes ??= {})[p.sizeId] = Object.fromEntries(entries) as Record<string, number>;
      } else {
        assert(
          ['cintas', 'bonbon', 'chicles', 'gomitas', 'todos'].includes(p.additionId),
          'Adición desconocida.',
        );
        (config.additionRecipes ??= {})[p.additionId] = Object.fromEntries(entries) as Record<string, number>;
      }
      break;
    }
    case 'categories': {
      assert(
        Array.isArray(p.categories) && p.categories.length > 0 && p.categories.length <= 100,
        'Categorías inválidas.',
      );
      assert(
        p.categories.every(
          (c: any) =>
            typeof c.name === 'string' &&
            c.name.trim() &&
            typeof c.group === 'string' &&
            c.group.trim() &&
            ['Costo', 'Gasto'].includes(c.nature) &&
            ['Fijo', 'Variable'].includes(c.behavior),
        ),
        'Clasificación inválida.',
      );
      config.expenseCategories = structuredClone(p.categories);
      state.settings[0].expenseCategories = p.categories
        .filter((c: any) => !c.adminOnly)
        .map((c: any) => c.name);
      break;
    }
    case 'migrate_expenses': {
      assert(!config.expensesMigratedAt, 'La reclasificación ya fue aplicada.');
      for (const expense of state.expenses) {
        const match = expenseCategories(state).find(
          (c) => c.name === (p.overrides?.[expense.id] ?? expense.category),
        );
        expense.classification = match ?? {
          name: expense.category,
          group:
            expense.category === 'Insumos'
              ? 'Mercancía e insumos'
              : expense.category === 'Transporte'
                ? 'Logística'
                : 'Operación',
          nature: expense.category === 'Insumos' || expense.category === 'Transporte' ? 'Costo' : 'Gasto',
          behavior: 'Variable',
        };
      }
      config.expensesMigratedAt = at;
      break;
    }
    case 'link_logistics': {
      const expense = state.expenses.find((e) => e.id === p.expenseId);
      assert(expense?.classification?.group === 'Logística', 'Selecciona un gasto de logística.');
      assert(
        Array.isArray(p.shipmentIds) &&
          p.shipmentIds.every((id: string) => state.shipments.some((s) => s.id === id)),
        'Envíos desconocidos.',
      );
      expense.shipmentIds = [...new Set<string>(p.shipmentIds)];
      break;
    }
    case 'review_receipt':
      reviewReceipt(ctx);
      break;
    case 'reconcile':
      reconcile(ctx);
      break;
    case 'closing_proposal':
      closingProposal(ctx);
      break;
    case 'closing_resolve':
      resolveClosing(ctx);
      break;
    case 'candy_count':
      candyCount(ctx);
      break;
    case 'test_notice':
      v4Notify(ctx, 'prueba', 'Mensaje de prueba de Dexter’s');
      break;
    default:
      throw new Error('Acción desconocida.');
  }
  return { message: 'Cambio guardado.' };
}
function receive(ctx: V4Context) {
  const { state, command, actor, at } = ctx,
    p = command.payload as Record<string, any>;
  const shipment = state.shipments.find((s) => s.id === p.shipmentId && s.status !== 'received');
  assert(shipment, 'Envío pendiente no disponible.');
  const previous = state.receipts.filter((r) => r.shipmentId === shipment.id);
  const items: Record<string, number> = {},
    damaged: Record<string, number> = {},
    expected: Record<string, number> = {},
    photos: Record<string, string[]> = {};
  const missing: Record<string, 'later' | 'lost'> = {};
  for (const line of shipment.items) {
    const prior = previous.reduce(
      (n, r) =>
        n +
        (r.items[line.article] ?? 0) +
        (r.missing?.[line.article] === 'lost'
          ? Math.max(0, (r.expected?.[line.article] ?? 0) - (r.items[line.article] ?? 0))
          : 0),
      0,
    );
    const remaining = Math.max(0, line.quantity - prior),
      input = p.lines?.[line.article] ?? {};
    const good = quantity(input.good ?? 0, 'Llegaron bien', remaining, true),
      bad = quantity(input.damaged ?? 0, 'Dañados', remaining - good, true);
    assert(
      line.article.startsWith('liquid:') || (Number.isInteger(good) && Number.isInteger(bad)),
      'Las unidades y bolsas recibidas deben ser enteras.',
    );
    expected[line.article] = remaining;
    items[line.article] = good + bad;
    damaged[line.article] = bad;
    photos[line.article] = Array.isArray(input.photos) ? input.photos : [];
    assert(!bad || photos[line.article].length > 0, 'Adjunta al menos una foto por artículo dañado.');
    assert(
      photos[line.article].every((id) =>
        state.attachments.some(
          (a) => a.id === id && a.status === 'uploaded' && (a.by === actor.id || actor.role === 'admin'),
        ),
      ),
      'Foto no disponible.',
    );
    if (good + bad < remaining) {
      assert(input.missing === 'later' || input.missing === 'lost', 'Indica si lo faltante viene después.');
      missing[line.article] = input.missing;
      if (input.missing === 'lost') v4Note(p.notes);
    }
  }
  assert(
    Object.values(items).some((n) => n > 0) || Object.values(missing).includes('lost'),
    'Registra una recepción o faltante definitivo.',
  );
  const id = eventId(command, 'receipt');
  state.receipts.push({
    id,
    shipmentId: shipment.id,
    by: actor.id,
    at,
    items,
    damaged,
    expected,
    photos,
    missing,
    v4: true,
    evidenceId: Object.values(photos).flat()[0] ?? '',
    notes: String(p.notes ?? ''),
  });
  for (const [article, total] of Object.entries(items))
    v4Move(
      ctx,
      article,
      (total - damaged[article]) * (candies(state).find((c) => c.id === article)?.perBag ?? 1),
      'receipt',
      id,
    );
  shipment.status = Object.entries(expected).every(
    ([article, n]) => items[article] >= n || missing[article] === 'lost',
  )
    ? 'received'
    : 'partial';
  const hasIssues = Object.values(damaged).some((n) => n > 0) || Object.values(missing).includes('lost');
  v4Notify(
    ctx,
    hasIssues ? 'recepcion_diferencias' : 'recepcion_completa',
    hasIssues ? 'Mercancía recibida con novedades' : 'Mercancía recibida completa',
    id,
  );
}
function reviewReceipt(ctx: V4Context) {
  const { state, actor, at } = ctx,
    p = ctx.command.payload as Record<string, any>;
  const receipt = state.receipts.find((r) => r.id === p.receiptId && r.v4);
  assert(receipt, 'Recepción no disponible.');
  assert(receipt.by !== actor.id, 'Otro administrador debe revisar tu recepción.', 'FORBIDDEN');
  const article = String(p.article),
    bad = receipt.damaged[article] ?? 0;
  assert(Object.hasOwn(receipt.items, article), 'Artículo no recibido.');
  assert(!receipt.reviewed?.[article], 'Esta línea ya se revisó.');
  const good = quantity(p.good ?? 0, 'Dañados corregidos a buenos', bad, true),
    notes = v4Note(p.notes);
  const factor = candies(state).find((c) => c.id === article)?.perBag ?? 1;
  v4Move(ctx, article, good * factor, 'receipt_correction', receipt.id);
  const shipment = state.shipments.find((s) => s.id === receipt.shipmentId)!;
  const lost =
    receipt.missing?.[article] === 'lost'
      ? Math.max(0, (receipt.expected?.[article] ?? 0) - (receipt.items[article] ?? 0))
      : 0;
  if (bad - good + lost > 0)
    addMerma(ctx, {
      type: 'Transporte',
      article,
      quantity: (bad - good + lost) * factor,
      unitCost: (shipment.items.find((i) => i.article === article)?.unitCost ?? 0) / factor,
      saleValue: 0,
      receiptId: receipt.id,
      sourceId: receipt.id,
    });
  (receipt.reviewed ??= {})[article] = { by: actor.id, at, good, notes };
  v4Notify(ctx, 'recepcion_resuelta', 'Recepción revisada por ' + actor.name, receipt.id);
  for (const n of state.notifications.filter((n) => n.referenceId === receipt.id))
    n.resolved = { by: actor.name, at };
}
function reconcile(ctx: V4Context) {
  const { state, command, actor, at } = ctx,
    p = command.payload as Record<string, any>;
  const request = state.requests.find((r) => r.id === p.mermaId && r.merma && !r.merma.superseded);
  assert(request?.merma, 'Merma no disponible.');
  const m = request.merma,
    notes = v4Note(p.notes);
  if (p.kind === 'loss' || p.kind === 'reopen') {
    m.state = p.kind === 'loss' ? 'lost' : 'open';
    m.history.push({ by: actor.id, at, notes });
  } else if (p.kind === 'empty') {
    assert(m.article.startsWith('cup:') && !m.emptyCup, 'Selecciona una merma de vaso servido.');
    const recovered = m.recoveries.filter((r) => r.kind === 'product').reduce((n, r) => n + r.quantity, 0);
    for (const [id, q] of Object.entries(m.components ?? {}))
      v4Move(ctx, id, q * (1 - recovered / m.quantity), 'merma_empty', request.id);
    m.emptyCup = true;
    const cupCost = componentCost(state, m.article, request.at);
    m.unitCost = cupCost ?? 0;
    m.costMissing = cupCost === null;
    for (const recovery of m.recoveries)
      if (recovery.kind === 'product') recovery.amount = recovery.quantity * m.unitCost;
    m.history.push({ by: actor.id, at, notes });
  } else {
    assert(m.state === 'open' || m.state === 'partial', 'Reabre la merma antes de conciliar.');
    const recovered = m.recoveries.reduce((n, r) => n + r.quantity, 0);
    const qty = quantity(
      m.article === 'cash' && p.kind === 'money' ? p.amount : p.quantity,
      'Cantidad recuperada',
      Math.max(0, m.quantity - recovered),
    );
    const amount = p.kind === 'money' ? money(p.amount, 'Dinero recibido') : qty * m.unitCost;
    if (p.kind === 'product') {
      assert(m.article !== 'cash', 'El efectivo se recupera como dinero.');
      if (p.surplusCountId) {
        const count = state.counts.find((c) => c.id === p.surplusCountId);
        const used = state.requests
          .flatMap((r) => (r.merma?.article === m.article ? r.merma.recoveries : []))
          .filter((r) => r.from === p.surplusCountId)
          .reduce((n, r) => n + r.quantity, 0);
        assert(
          count && (count.differences?.[m.article] ?? 0) - used >= qty,
          'El sobrante disponible no cubre la recuperación.',
        );
      } else v4Move(ctx, m.article, qty, 'merma_recovery', request.id);
      if (!m.emptyCup)
        for (const [id, q] of Object.entries(m.components ?? {}))
          v4Move(ctx, id, (q * qty) / m.quantity, 'merma_components_returned', request.id);
    } else {
      assert(p.kind === 'money', 'Acción de conciliación inválida.');
      const active = state.shifts.find((s) => s.status === 'open'),
        cash = p.destination === 'cash';
      assert(
        cash ? !!active : state.locations.some((l) => l.id === p.destination && l.active),
        'Selecciona una cuenta activa.',
      );
      if (m.orderId) {
        const order = state.orders.find((o) => o.id === m.orderId);
        assert(
          order &&
            order.status === 'unpaid_incident' &&
            amount <=
              order.total -
                state.payments.filter((x) => x.orderId === order.id).reduce((n, x) => n + x.amount, 0),
          'El pago supera el saldo del pedido.',
        );
        state.payments.push({
          id: eventId(command, 'recovery-payment'),
          orderId: order.id,
          shiftId: cash ? active!.id : order.shiftId,
          cashierId: actor.id,
          amount,
          type: 'cash',
          method: cash ? 'cash' : 'transfer',
          accountId: cash ? undefined : p.destination,
          at,
          eventId: command.id,
        });
        if (
          state.payments.filter((x) => x.orderId === order.id).reduce((n, x) => n + x.amount, 0) >=
          order.total
        ) {
          order.status = 'paid';
          order.paidAt = at;
          order.cashierId = actor.id;
          order.version++;
        }
      } else
        state.transfers.push({
          id: eventId(command, 'recovery'),
          by: actor.id,
          recipientId: cash
            ? active!.cashierId
            : state.locations.find((l) => l.id === p.destination)!.custodianId,
          from: 'merma:' + request.id,
          to: cash ? 'cash:' + active!.id : p.destination,
          amount,
          status: 'confirmed',
          at,
          executedAt: at,
          confirmedAt: at,
          confirmedBy: actor.id,
          receivedAmount: amount,
          notes: 'Recuperación de merma · ' + notes,
          type: 'transfer',
          votes: [],
        });
    }
    m.recoveries.push({
      id: eventId(command, 'reconciliation'),
      by: actor.id,
      at,
      kind: p.kind,
      quantity: qty,
      amount,
      notes,
      from: p.surplusCountId ?? v4Note(p.from),
    });
    m.state = recovered + qty >= m.quantity ? 'reconciled' : 'partial';
  }
  v4Notify(ctx, 'merma_conciliada', 'Merma conciliada por ' + actor.name, request.id);
}
function candyCount(ctx: V4Context) {
  const { state, command, actor, at } = ctx,
    p = command.payload as Record<string, any>;
  const candy = candies(state).find((c) => c.id === p.article);
  assert(candy, 'Dulce desconocido.');
  const bags = quantity(p.bags ?? 0, 'Bolsas cerradas', 1000000, true);
  assert(Number.isInteger(bags), 'Indica bolsas enteras.');
  const fraction = p.fraction === undefined ? undefined : quantity(p.fraction, 'Fracción', 1, true);
  const units =
    fraction !== undefined
      ? fraction * candy.perBag
      : quantity(p.units ?? 0, 'Unidades abiertas', candy.perBag, true);
  const counted = bags * candy.perBag + units,
    expected = stockBalances(state)[candy.id] ?? 0;
  const old = state.counts.filter((c) => Object.hasOwn(c.items, candy.id)).at(-1);
  const entries = state.stock.filter((m) => m.article === candy.id && (!old || m.at > old.at));
  const consumption = -entries
    .filter((m) => m.reason === 'candy_sale' || m.reason === 'merma_served')
    .reduce((n, m) => n + m.quantity, 0);
  const excess = expected - counted,
    tolerance = state.settings[0].v4?.candyTolerance ?? 0.1;
  const id = eventId(command, 'candy-count');
  state.counts.push({
    id,
    kind: 'audit',
    by: actor.id,
    at,
    items: { [candy.id]: counted },
    expectedItems: { [candy.id]: expected },
    differences: { [candy.id]: -excess },
    notes: String(p.notes ?? ''),
  });
  v4Move(ctx, candy.id, -excess, 'candy_count', id);
  if (excess > Math.max(0, consumption * tolerance)) {
    addMerma(ctx, {
      type: 'Dulces',
      article: candy.id,
      quantity: excess,
      unitCost: componentCost(state, candy.id, at) ?? 0,
      saleValue: 0,
      sourceId: id,
    });
    v4Notify(ctx, 'daño', 'Lo que no cuadra · ' + candy.name, id);
  }
}
