import { permissionLabels } from './access.ts';
import {
  DomainError,
  type Actor,
  type Audit,
  type ChangeRecord,
  type Command,
  type Device,
  type Profile,
  type Promotion,
  type Result,
  type State,
} from './types.ts';

export interface ApprovalAccess {
  profiles: Profile[];
  devices: Device[];
  privateOwnerId?: string;
}

type Operation = { state: State; result: Result };
type Run = (state: State, command: Command, actor: Actor, receivedAt: string) => Operation;
type Values = Pick<ChangeRecord, 'label' | 'before' | 'after' | 'access'>;

const protectedTypes = new Set<Command['type']>([
  'save_size',
  'save_promotion',
  'set_approval_requirement',
  'change_access',
  'adjust_count_inventory',
  'correct_inventory',
  'initialize_stock',
]);

function check(condition: unknown, message: string, code = 'VALIDATION'): asserts condition {
  if (!condition) throw new DomainError(message, code);
}

function requiresChangeApproval(state: State, { type, payload }: Command): boolean {
  if (state.settings[0].v4Enabled && type === 'save_promotion') return false;
  if (payload.reviewClosing === true) {
    const shift = state.shifts.find(
      (item) =>
        item.id === payload.shiftId && item.closingReview?.status === 'pending' && !item.closingArchive,
    );
    const request = state.requests.find(
      (item) => item.id === payload.requestId && item.type === 'damage' && item.status === 'pending',
    );
    check(
      shift &&
        ((['open_bag', 'open_package'].includes(type) && payload.correction === true) ||
          (type === 'resolve_request' &&
            request &&
            (request.referenceId === shift.id ||
              (!request.referenceId &&
                shift.openedAt &&
                shift.closedAt &&
                request.at >= shift.openedAt &&
                request.at <= shift.closedAt)))),
      'La corrección debe corresponder a un cierre pendiente.',
    );
    return false;
  }
  return (
    protectedTypes.has(type) ||
    (type === 'configure' && payload.reviewParameters === true) ||
    (type === 'resolve_request' &&
      payload.approve === true &&
      state.requests.some((request) => request.id === payload.requestId && request.type === 'damage')) ||
    ((type === 'open_bag' || type === 'open_package') && payload.correction === true)
  );
}

function accessValues(state: State, command: Command, actor: Actor, access?: ApprovalAccess): Values {
  check(access, 'El cambio de acceso requiere verificar el equipo del local.', 'FORBIDDEN');
  const { kind, targetId, active, primary, role, permissions } = command.payload;
  check(active === undefined || typeof active === 'boolean', 'Estado de acceso inválido.');
  if (kind === 'user') {
    const target = access.profiles.find((user) => user.id === targetId);
    check(target && target.id !== access.privateOwnerId, 'Usuario no disponible.', 'FORBIDDEN');
    check(
      role === undefined || role === 'admin' || role === 'encargado' || role === 'apoyo',
      'Rol inválido.',
    );
    check(role === undefined || target.id !== actor.id, 'Otro admin debe cambiar tu rol.', 'FORBIDDEN');
    check(primary === undefined, 'Selecciona un dispositivo para el equipo principal.');
    check(
      active !== false || (role === undefined && permissions === undefined),
      'Desactiva el usuario en una operación independiente.',
    );
    const before = { role: target.role, active: target.active, permissions: target.permissions ?? {} };
    const after = {
      role: role ?? before.role,
      active: active ?? before.active,
      permissions: before.permissions,
    };
    if (permissions !== undefined) {
      check(after.role !== 'admin', 'El rol administrador conserva sus facultades.');
      check(
        permissions &&
          typeof permissions === 'object' &&
          !Array.isArray(permissions) &&
          Object.entries(permissions).every(
            ([key, value]) => Object.hasOwn(permissionLabels, key) && typeof value === 'boolean',
          ),
        'Permisos inválidos.',
      );
      after.permissions = permissions as NonNullable<Profile['permissions']>;
    }
    if (target.active && target.role === 'admin' && (!after.active || after.role !== 'admin'))
      check(
        access.profiles.some((user) => user.id !== target.id && user.active && user.role === 'admin'),
        'Debe quedar al menos un admin activo.',
      );
    const verb = active === false ? 'Desactivar usuario' : active === true ? 'Activar usuario' : 'Permisos';
    return { label: `${verb} · ${target.name}`, access: kind, before, after };
  }
  check(kind === 'device', 'Tipo de acceso inválido.');
  const target = access.devices.find((device) => device.id === targetId);
  check(target && target.userId !== access.privateOwnerId, 'Dispositivo no disponible.', 'FORBIDDEN');
  check(role === undefined && permissions === undefined, 'Opciones de dispositivo inválidas.');
  check(primary === undefined || primary === true, 'Equipo principal inválido.');
  check(active !== false || primary === undefined, 'Desactiva el equipo en una operación independiente.');
  const before = { active: target.active, primary: target.primary };
  const after = {
    active: active ?? before.active,
    primary: active === false ? false : (primary ?? (before.active && before.primary)),
  };
  if (primary === true) {
    check(after.active, 'Dispositivo no disponible.');
    check(
      !state.shifts.some((shift) => ['open', 'requested', 'provisional'].includes(shift.status)),
      'Cierra y sincroniza el turno antes de cambiar el equipo principal.',
    );
  }
  const verb =
    active === false
      ? 'Desactivar dispositivo'
      : active === true
        ? 'Activar dispositivo'
        : 'Equipo principal';
  const priorPrimary =
    primary === true ? access.devices.find((device) => device.active && device.primary) : undefined;
  return {
    label: `${verb} · ${target.name}`,
    access: kind,
    before: {
      ...before,
      ...(primary === true
        ? { primaryDevice: priorPrimary ? { id: priorPrimary.id, name: priorPrimary.name } : null }
        : {}),
    },
    after: { ...after, ...(primary === true ? { primaryDevice: { id: target.id, name: target.name } } : {}) },
  };
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const entries = Object.entries(left).filter(([, value]) => value !== undefined);
  return (
    entries.length === Object.values(right).filter((value) => value !== undefined).length &&
    entries.every(
      ([key, value]) => Object.hasOwn(right, key) && equal(value, (right as Record<string, unknown>)[key]),
    )
  );
}

function promotionValues(promotion?: Promotion) {
  if (!promotion) return null;
  const { at: _at, by: _by, redemptions: _redemptions, version: _version, ...settings } = promotion;
  return settings;
}

function stockDelta(state: State, candidate: Operation, command: Command) {
  const delta: Record<string, number> = {};
  for (const movement of candidate.state.stock.slice(state.stock.length)) {
    if (movement.eventId !== command.id) continue;
    delta[movement.article] = (delta[movement.article] ?? 0) + movement.quantity;
  }
  return delta;
}

function changeValues(
  state: State,
  candidate: Operation,
  command: Command,
  actor: Actor,
  access?: ApprovalAccess,
): Values {
  const { referenceId } = candidate.result;
  if (command.type === 'change_access') return accessValues(state, command, actor, access);
  if (command.type === 'configure') {
    const before = state.settings[0];
    const after = candidate.state.settings[0];
    const keys = (Object.keys(after) as (keyof typeof after)[]).filter(
      (key) => key !== 'version' && !equal(before[key], after[key]),
    );
    return {
      label: 'Parámetros de operación',
      before: Object.fromEntries(keys.map((key) => [key, before[key]])),
      after: Object.fromEntries(keys.map((key) => [key, after[key]])),
    };
  }
  if (command.type === 'save_size') {
    const before = state.sizes.find((size) => size.id === referenceId);
    const after = candidate.state.sizes.find((size) => size.id === referenceId);
    return {
      label: `Precio y composición · ${after?.name}`,
      before: before ? { ...before } : null,
      after: after ? { ...after } : null,
    };
  }
  if (command.type === 'save_promotion') {
    const before = promotionValues(state.promotions.find((promo) => promo.id === referenceId));
    const after = promotionValues(candidate.state.promotions.find((promo) => promo.id === referenceId));
    return { label: `Promoción · ${after?.name}`, before, after };
  }
  if (command.type === 'set_approval_requirement') {
    return {
      label: 'Aprobaciones requeridas',
      before: { required: state.settings[0].requiredChangeApprovals ?? 1 },
      after: { required: candidate.state.settings[0].requiredChangeApprovals },
    };
  }
  const delta = stockDelta(state, candidate, command);
  const before = Object.fromEntries(Object.keys(delta).map((article) => [article, 0]));
  for (const movement of state.stock)
    if (Object.hasOwn(before, movement.article)) before[movement.article] += movement.quantity;
  const after = Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, before[key] + value]));
  const request = state.requests.find((entry) => entry.id === command.payload.requestId);
  const notes = command.payload.notes ?? request?.notes;
  return { label: 'Corrección de inventario', before, after: { ...after, ...(notes ? { notes } : {}) } };
}

function event(candidate: Operation, command: Command): Audit {
  return candidate.state.audit.find((entry) => entry.eventId === command.id)!;
}

export function applyChangeApproval(
  state: State,
  command: Command,
  actor: Actor,
  receivedAt: string,
  access: ApprovalAccess | undefined,
  run: Run,
): Operation {
  const governed = requiresChangeApproval(state, command);
  if (!governed && command.type !== 'resolve_change' && command.type !== 'approve_closing')
    return run(state, command, actor, receivedAt);
  const candidate = run(state, command, actor, receivedAt);
  const committed = state.audit.find((entry) => entry.eventId === command.id);
  if (committed) return candidate;

  if (command.type === 'resolve_change') {
    check(command.payload.offline !== true, 'La aprobación requiere conexión.', 'FORBIDDEN');
    const proposal = candidate.state.requests.find((request) => request.id === command.payload.requestId);
    check(
      proposal?.type === 'change' && proposal.change && proposal.status === 'pending',
      'Propuesta pendiente no disponible.',
    );
    const change = proposal.change;
    const audit = event(candidate, command);
    audit.referenceId = proposal.id;
    check(typeof command.payload.approve === 'boolean', 'Selecciona aprobar o rechazar.');
    const finish = (status: 'approved' | 'rejected') => {
      proposal.status = status;
      proposal.reviewedBy = actor.id;
      proposal.reviewedAt = receivedAt;
    };
    if (!command.payload.approve) {
      finish('rejected');
      audit.detail = 'Propuesta rechazada.';
      return {
        state: candidate.state,
        result: { ...candidate.result, referenceId: proposal.id, message: audit.detail },
      };
    }
    check(proposal.by !== actor.id, 'Otro administrador debe aprobar tu propuesta.', 'FORBIDDEN');
    check(!change.votes.some((vote) => vote.by === actor.id), 'Ya aprobaste esta propuesta.');
    const activeAdmin = (key: string) =>
      !access || access.profiles.some((user) => user.id === key && user.active && user.role === 'admin');
    check(activeAdmin(proposal.by), 'La propuesta la hizo un administrador que ya no tiene acceso activo.');
    change.votes = [
      ...change.votes.filter((vote) => activeAdmin(vote.by)),
      { by: actor.id, name: actor.name, at: receivedAt },
    ];
    if (change.votes.length < change.requiredApprovals) {
      audit.detail = 'Aprobación registrada. El cambio sigue pendiente.';
      return {
        state: candidate.state,
        result: {
          ...candidate.result,
          referenceId: proposal.id,
          message: audit.detail,
          approvalPending: true,
        },
      };
    }
    const execution = {
      ...command,
      type: change.command.type,
      configVersion: state.settings[0].version,
      shiftId: change.command.shiftId,
      payload: change.command.payload,
    };
    const applied = run(state, execution, actor, receivedAt);
    const appliedValues = changeValues(state, applied, execution, { ...actor, id: proposal.by }, access);
    const unchanged = change.inventoryDelta
      ? equal(change.inventoryDelta, stockDelta(state, applied, execution))
      : equal(change.before, appliedValues.before) && equal(change.after, appliedValues.after);
    check(
      unchanged,
      'Los datos cambiaron desde la propuesta. Recházala y crea otra con los valores actuales.',
    );
    finish('approved');
    applied.state.requests = applied.state.requests.map((request) =>
      request.id === proposal.id ? proposal : request,
    );
    const appliedEvent = event(applied, execution);
    appliedEvent.change = {
      ...appliedValues,
      kind: execution.type,
      proposedBy: change.proposedBy,
      votes: change.votes,
    };
    if (execution.type === 'change_access') appliedEvent.referenceId = String(execution.payload.targetId);
    return {
      state: applied.state,
      result: {
        ...applied.result,
        referenceId: appliedEvent.referenceId,
        message: 'Cambio aprobado y aplicado.',
      },
    };
  }

  const closingStockAdjustment =
    command.type === 'approve_closing' &&
    !state.shifts.some((shift) => shift.id === command.payload.shiftId && shift.closingFlow) &&
    state.stock.length !== candidate.state.stock.length;
  if (!governed && !closingStockAdjustment) return candidate;
  check(
    actor.role === 'admin' && actor.online && command.payload.offline !== true,
    'Esta operación requiere un administrador con conexión.',
    'FORBIDDEN',
  );
  const values = changeValues(state, candidate, command, actor, access);
  const inventoryChange = values.label === 'Corrección de inventario';
  if (!inventoryChange) check(!equal(values.before, values.after), 'No hay cambios para guardar.');
  const audit = event(candidate, command);
  const proposedBy = { by: actor.id, name: actor.name, at: receivedAt };
  const record = { ...values, kind: command.type, proposedBy, votes: [] };
  if (command.type === 'change_access' && command.payload.active === false) {
    audit.change = record;
    audit.referenceId = String(command.payload.targetId);
    return {
      state: candidate.state,
      result: { ...candidate.result, referenceId: audit.referenceId, message: 'Acceso desactivado.' },
    };
  }

  const proposal = structuredClone(state);
  const storedCommand =
    command.type === 'save_promotion'
      ? { ...command, payload: { ...command.payload, id: candidate.result.referenceId } }
      : command;
  const inventoryDelta = inventoryChange ? stockDelta(state, candidate, command) : undefined;
  proposal.requests.push({
    id: command.id,
    type: 'change',
    by: actor.id,
    at: receivedAt,
    status: 'pending',
    referenceId: candidate.result.referenceId,
    notes: values.label,
    change: {
      ...record,
      command: storedCommand,
      requiredApprovals: state.settings[0].requiredChangeApprovals ?? 1,
      inventoryDelta,
    },
  });
  const message = 'Propuesta enviada. Consulta su estado en Revisiones.';
  proposal.audit.push({
    ...audit,
    action: 'propose_change',
    detail: message,
    referenceId: command.id,
    inventoryAdjustment: undefined,
  });
  return {
    state: proposal,
    result: { ...candidate.result, referenceId: command.id, message, approvalPending: true },
  };
}
