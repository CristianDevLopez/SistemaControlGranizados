import { id, syncOrderId } from '../domain/engine.ts';
import { COLLECTIONS, type Collection, type Command, type State } from '../domain/types.ts';

export type StateChanges = Partial<Pick<State, Collection>>;

const counterCommands = new Set<Command['type']>([
  'create_order',
  'send_order',
  'update_order',
  'cancel_order',
  'deliver',
  'pay',
  'redeem_coupon',
  'taste',
  'update_tasting',
  'remove_tasting',
  'close_tastings',
]);

function optionalId(value: unknown): string | undefined {
  if (value === undefined) return;
  try {
    return id(value);
  } catch {
    return undefined;
  }
}

export function counterScope(command: Command) {
  const { payload } = command;
  if (
    !counterCommands.has(command.type) ||
    payload.origin === 'paper' ||
    ['countId', 'expenseId', 'transferId', 'requestId', 'from', 'syncAfterConflict', 'reviewClosing'].some(
      (key) => Object.hasOwn(payload, key),
    )
  )
    return;

  const orderId = optionalId(syncOrderId(command));
  if (!orderId) return;
  const lineIds = Array.isArray(payload.lines)
    ? payload.lines.slice(0, 100).flatMap((line) => optionalId(line?.id) ?? [])
    : [];
  const checkout = command.type === 'pay' || command.type === 'redeem_coupon';
  const codes =
    checkout && Array.isArray(payload.codes)
      ? payload.codes.slice(0, 10).flatMap((code) => (typeof code === 'string' ? [code.trim()] : []))
      : [];
  return {
    commandId: command.id,
    deviceId: command.deviceId,
    configVersion: command.configVersion,
    orderId,
    lineIds,
    shiftIds: [command.shiftId, payload.shiftId].flatMap((value) => optionalId(value) ?? []),
    checkout,
    codes,
    accountId: checkout ? optionalId(payload.accountId) : undefined,
  };
}

export type CounterScope = NonNullable<ReturnType<typeof counterScope>>;

export function counterNeedsFullState(state: StateChanges, scope: CounterScope) {
  return (
    scope.checkout &&
    state.orders?.some(
      (order) =>
        order.id === scope.orderId &&
        (order.paymentCredit !== undefined || order.replacesId || order.carriedCouponFromId),
    )
  );
}

export function counterState(state: StateChanges): State {
  return { ...Object.fromEntries(COLLECTIONS.map((key) => [key, []])), ...state } as State;
}

export function counterChanges(before: State, after: State): StateChanges {
  const changes: StateChanges = {};
  for (const key of COLLECTIONS) {
    const previous = new Map(before[key].map((item) => [item.id, item]));
    const changed = after[key].filter(
      (item) => JSON.stringify(item) !== JSON.stringify(previous.get(item.id)),
    );
    if (changed.length) Object.assign(changes, { [key]: changed });
  }
  return changes;
}
