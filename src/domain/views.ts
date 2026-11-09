import { redactState } from './engine.ts';
import type { Actor, Role, Snapshot } from './types.ts';

export const roleLabels: Record<Role, string> = {
  admin: 'Administrador',
  encargado: 'Encargado de caja',
  apoyo: 'Apoyo de mostrador',
};

export function isReadOnlyView(role: Role | null) {
  return role === 'encargado' || role === 'apoyo';
}

export function rolePreview(snapshot: Snapshot, role: Role): Snapshot {
  if (!snapshot.actor.superAdmin) throw new Error('Acceso exclusivo de superadministrador.');
  if (role === 'admin')
    return {
      ...snapshot,
      actor: { ...snapshot.actor, superAdmin: false, offlineAdminId: undefined },
      state: redactState(snapshot.state, snapshot.actor),
      offlineAuthorizers: undefined,
    };
  const active = snapshot.state.shifts.find((s) => ['open', 'requested', 'provisional'].includes(s.status));
  const candidates = snapshot.profiles.filter(
    (p) => p.active && p.role === role && p.id !== snapshot.actor.id,
  );
  const target = candidates.find((p) => p.id === active?.cashierId) ?? candidates[0];
  const device =
    snapshot.devices.find(
      (d) => d.active && d.userId === target?.id && (role !== 'encargado' || d.primary),
    ) ?? snapshot.devices.find((d) => d.active && d.userId === target?.id);
  const actor: Actor = {
    ...snapshot.actor,
    ...(target ?? { name: roleLabels[role] }),
    role,
    superAdmin: false,
    deviceId: device?.id ?? snapshot.actor.deviceId,
    primary: role === 'encargado',
    aal: 'aal1',
    offlineAdminId: undefined,
  };
  return {
    ...snapshot,
    actor,
    state: redactState(snapshot.state, actor),
    profiles: snapshot.profiles.filter((p) => p.id !== snapshot.actor.id),
    devices: snapshot.devices.filter((d) => d.userId !== snapshot.actor.id && d.userId === actor.id),
    offlineAuthorizers: undefined,
  };
}
