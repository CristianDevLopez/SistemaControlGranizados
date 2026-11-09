import { initialState } from '../../src/domain/initial.ts';
import { applyCommand, articles } from '../../src/domain/engine.ts';
import type { Actor, Command, CommandType, State } from '../../src/domain/types.ts';
export const NOW = '2026-10-23T16:00:00.000Z';
export const ids = {
  admin: '10000000-0000-4000-8000-000000000001',
  other: '10000000-0000-4000-8000-000000000002',
  third: '10000000-0000-4000-8000-000000000003',
  cashier: '10000000-0000-4000-8000-000000000004',
  support: '10000000-0000-4000-8000-000000000005',
  owner: '10000000-0000-4000-8000-000000000006',
  device: '20000000-0000-4000-8000-000000000001',
  remote: '20000000-0000-4000-8000-000000000002',
  supportDevice: '20000000-0000-4000-8000-000000000003',
  ownerDevice: '20000000-0000-4000-8000-000000000004',
  flavor: '30000000-0000-4000-8000-000000000001',
  plain: '30000000-0000-4000-8000-000000000002',
  shift: '40000000-0000-4000-8000-000000000001',
  photo: '50000000-0000-4000-8000-000000000001',
  location: '60000000-0000-4000-8000-000000000001',
};
export const admin: Actor = {
  id: ids.admin,
  name: 'Administrador de prueba',
  role: 'admin',
  active: true,
  deviceId: ids.remote,
  primary: false,
  online: true,
  aal: 'aal2',
};
export const other: Actor = { ...admin, id: ids.other, name: 'Otro administrador' };
export const owner: Actor = {
  ...admin,
  id: ids.owner,
  name: 'Superadmin de prueba',
  deviceId: ids.ownerDevice,
  superAdmin: true,
};
export const cashier: Actor = {
  id: ids.cashier,
  name: 'Caja de prueba',
  username: 'caja',
  role: 'encargado',
  active: true,
  deviceId: ids.device,
  primary: true,
  online: true,
  aal: 'aal1',
};
export const support: Actor = {
  id: ids.support,
  name: 'Apoyo de prueba',
  username: 'apoyo',
  role: 'apoyo',
  active: true,
  deviceId: ids.supportDevice,
  primary: false,
  online: true,
  aal: 'aal1',
};
export function fixture(): State {
  const s = initialState();
  s.flavors = [
    { id: ids.flavor, name: 'Sabor de prueba con licor', alcohol: true, active: true },
    { id: ids.plain, name: 'Sabor de prueba sin licor', alcohol: false, active: true },
  ];
  s.shifts = [
    {
      id: ids.shift,
      cashierId: ids.cashier,
      deviceId: ids.device,
      status: 'open',
      requestedAt: '2026-10-23T14:00:00.000Z',
      openedAt: '2026-10-23T14:00:00.000Z',
      authorizedBy: ids.admin,
      base: 20000,
      openingSkipped: false,
    },
  ];
  s.attachments = [
    {
      id: ids.photo,
      by: ids.cashier,
      createdAt: NOW,
      name: 'soporte.jpg',
      mime: 'image/jpeg',
      size: 100,
      status: 'pending',
    },
  ];
  s.locations = [
    {
      id: ids.location,
      name: 'Cuenta de prueba',
      type: 'bank',
      custodianId: ids.admin,
      bank: 'Banco de prueba',
      account: 'solo-pruebas',
      active: true,
      openingBalance: 0,
    },
  ];
  s.parameters = [
    {
      id: '70000000-0000-4000-8000-000000000001',
      version: 1,
      kind: 'catalog',
      by: ids.admin,
      at: NOW,
      before: null,
      after: { sizes: structuredClone(s.sizes), flavors: structuredClone(s.flavors), promotions: [] },
    },
  ];
  return s;
}
let sequence = 0;
export function cmd(
  type: CommandType,
  payload: Record<string, unknown> = {},
  actor: Actor = cashier,
  extra: Partial<Command> = {},
): Command {
  return {
    id: crypto.randomUUID(),
    type,
    actorId: actor.id,
    deviceId: actor.deviceId,
    shiftId: ids.shift,
    at: NOW,
    configVersion: 1,
    sequence: ++sequence,
    payload,
    ...extra,
  };
}
export function run(
  s: State,
  type: CommandType,
  payload: Record<string, unknown> = {},
  actor: Actor = cashier,
) {
  return applyCommand(s, cmd(type, payload, actor, { configVersion: s.settings[0].version }), actor, NOW);
}
export function countedItems(s: State, n = 0) {
  return Object.fromEntries(
    articles(s)
      .filter((a) => !a.id.startsWith('liquid:'))
      .map((a) => [a.id, n]),
  );
}
export function order(s: State, qty = 1, flavorId = ids.flavor, sizeIndex = 0) {
  const a = run(s, 'create_order', { lines: [{ flavorId, sizeId: s.sizes[sizeIndex].id, quantity: qty }] });
  return { state: a.state, order: a.state.orders.find((o) => o.id === a.result.referenceId)! };
}
