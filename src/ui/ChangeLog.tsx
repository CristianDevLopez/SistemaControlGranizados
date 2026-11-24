import { useState } from 'react';
import { permissionLabels } from '../domain/access.ts';
import { articles, eventId } from '../domain/engine.ts';
import type { ChangeRecord, Request, Settings } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { Badge, Empty, Panel, money, stateNames } from './components.tsx';

const labels: Record<string, string> = {
  active: 'Activo',
  bagOunces: 'Onzas por bolsa',
  cashLimit: 'Alerta de efectivo',
  closingResponseDays: 'Días para responder al cierre',
  cupPackageUnits: 'Vasos por paquete',
  checkoutText: 'Texto en caja',
  limitedSchedule: 'Restricción de días u horas',
  maxClosingBase: 'Base máxima de cierre',
  'candy:cintas': 'Precio de cintas',
  'candy:bonbon': 'Precio de bonbon',
  'candy:chicles': 'Precio de chicles',
  'candy:gomitas': 'Precio del par de gomitas',
  'candy:todos': 'Precio de todos los dulces',
  alcohol: 'Tipo de producto',
  alcoholPrice: 'Precio con licor',
  beers: 'Coronitas por unidad',
  cups: 'Vasos por unidad',
  days: 'Días',
  delivery: 'Aplicación',
  effect: 'Beneficio',
  endsAt: 'Fin de vigencia',
  endTime: 'Hora de fin',
  fixedPrice: 'Precio promocional',
  flavorIds: 'Sabores',
  maxRedemptions: 'Cupo',
  name: 'Nombre',
  notes: 'Motivo',
  ounces: 'Onzas efectivas',
  pay: 'Unidades a pagar',
  permissions: 'Permisos individuales',
  plainPrice: 'Precio sin licor',
  primary: 'Equipo principal',
  primaryDevice: 'Equipo principal de caja',
  required: 'Aprobaciones requeridas',
  role: 'Rol',
  sizeIds: 'Tamaños',
  stackable: 'Acumulable',
  startsAt: 'Inicio de vigencia',
  startTime: 'Hora de inicio',
  steps: 'Salto de tamaño',
  take: 'Unidades a llevar',
};
const options: Record<string, string> = {
  admin: 'Administrador',
  encargado: 'Encargado',
  apoyo: 'Apoyo',
  all: 'Con o sin licor',
  yes: 'Con licor',
  no: 'Sin licor',
  schedule: 'Seleccionable en el cobro',
  coupon: 'Con cupón',
  fixed: 'Precio fijo',
  upgrade: 'Tamaño superior',
  nxm: 'Lleva N, paga M',
  free: 'Producto gratis',
};
const date = (value: string) =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

function Difference({ change }: { change: Pick<ChangeRecord, 'before' | 'after'> }) {
  const { state } = useApp().data!;
  const before = change.before ?? {},
    after = change.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !['id', 'rank'].includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  const inventory = new Map(articles(state).map((article) => [article.id, article.name]));
  const catalog = new Map([...state.sizes, ...state.flavors].map((entry) => [entry.id, entry.name]));
  const formatValue = (key: string, value: unknown) => {
    if (value === undefined) return '—';
    if (value === null)
      return key === 'maxRedemptions' ? 'Sin límite' : key === 'primaryDevice' ? 'Ninguno' : 'Por definir';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (typeof value === 'number') {
      if (
        ['alcoholPrice', 'plainPrice', 'fixedPrice', 'cashLimit', 'maxClosingBase'].includes(key) ||
        key.startsWith('candy:')
      )
        return money(value);
      return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(value);
    }
    if (Array.isArray(value)) {
      if (key === 'days')
        return (
          value.map((day) => ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][day]).join(', ') || 'Todos'
        );
      return value.map((id) => catalog.get(id) ?? String(id)).join(', ') || 'Todos';
    }
    if (key === 'permissions' && typeof value === 'object') {
      const overrides = Object.entries(value);
      return (
        overrides
          .map(
            ([permission, allowed]) =>
              `${permissionLabels[permission as keyof typeof permissionLabels]} (${allowed ? 'sí' : 'no'})`,
          )
          .join(' · ') || 'Permisos del rol'
      );
    }
    if (key === 'primaryDevice' && typeof value === 'object' && 'name' in value) return String(value.name);
    if (typeof value === 'string') {
      if (key === 'startsAt' || key === 'endsAt') return date(value);
      return options[value] ?? value;
    }
    return String(value);
  };
  if (!keys.length) return null;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campo</th>
            <th>Antes</th>
            <th>Después</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <th scope="row">{inventory.get(key) ?? labels[key] ?? key}</th>
              <td>{formatValue(key, before[key])}</td>
              <td>{formatValue(key, after[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChangeRequestCard({ request }: { request: Request }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { actor } = app.data!;
  const change = request.change!;
  const own = request.by === actor.id;
  const voted = change.votes.some((vote) => vote.by === actor.id);
  const resolve = async (approve: boolean) => {
    setBusy(true);
    setError('');
    try {
      const result = await app.run('resolve_change', { requestId: request.id, approve });
      if (!result.approvalPending) app.toast(result.message);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="request-card">
      <div className="request-head">
        <div>
          <Badge tone={request.status === 'pending' ? 'orange' : 'neutral'}>
            {stateNames[request.status]}
          </Badge>
          <h3>{change.label}</h3>
        </div>
        <Badge tone="orange">
          {change.votes.length} de {change.requiredApprovals}{' '}
          {change.requiredApprovals === 1 ? 'aprobación' : 'aprobaciones'}
        </Badge>
      </div>
      <p>
        {change.proposedBy.name} · {date(change.proposedBy.at)}
      </p>
      <Difference change={change} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {change.votes.length > 0 && <p>Aprobó {change.votes.map((vote) => vote.name).join(', ')}.</p>}
      {request.status === 'pending' && (
        <div className="button-row">
          {!own && !voted && (
            <button disabled={!!busy} className="button primary small" onClick={() => void resolve(true)}>
              Aprobar
            </button>
          )}
          <button disabled={!!busy} className="button secondary small" onClick={() => void resolve(false)}>
            {own ? 'Retirar propuesta' : 'Rechazar'}
          </button>
        </div>
      )}
    </article>
  );
}

export function ChangeLog() {
  const { state, actor, profiles } = useApp().data!;
  if (actor.role !== 'admin') return null;
  const additionalActions: Record<string, string> = {
    configure: 'Parámetros',
    save_flavor: 'Sabores',
    save_size: 'Tamaños',
    save_promotion: 'Promociones',
    save_supply: 'Insumos · Unidad y saldo inicial',
    save_location: 'Cuentas y custodia',
    issue_coupon: 'Cupones y cortesías',
    create_user: 'Usuarios · Creación',
    reset_pin: 'Usuarios · Cambio de PIN',
    register_device: 'Dispositivos · Registro',
    invite_device: 'Dispositivos · Invitación',
    superadmin_session: 'Dispositivos · Sesión web',
    approve_closing: 'Inventario · Conciliación de cierre',
  };
  const history = state.audit
    .filter((entry) => entry.change || additionalActions[entry.action])
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
  return (
    <div className="page-stack">
      <Panel title="Cambios aplicados">
        {!history.length && <Empty title="Aún no hay cambios registrados" />}
        <div className="requests-list">
          {history.map((entry) => {
            const actorName = profiles.find((person) => person.id === entry.by)?.name ?? 'Usuario archivado';
            const parameter =
              entry.action === 'configure'
                ? (state.parameters.find((item) => item.id === eventId({ id: entry.eventId }, 'parameter')) ??
                  state.parameters.find(
                    (item) => item.by === entry.by && item.at === entry.at && item.kind === 'catalog',
                  ))
                : undefined;
            const parameters = (record: unknown) => {
              const settings = (record as { settings?: Settings } | undefined)?.settings;
              if (!settings) return null;
              const { candyPrices, ...values } = settings;
              return {
                ...values,
                ...Object.fromEntries(
                  Object.entries(candyPrices ?? {}).map(([id, value]) => [`candy:${id}`, value]),
                ),
              };
            };
            const change = entry.change ?? {
              kind: entry.action,
              label: additionalActions[entry.action],
              votes: [],
              proposedBy: { by: entry.by, at: entry.at, name: actorName },
              before: parameters(parameter?.before),
              after: parameters(parameter?.after),
            };
            return (
              <details className="request-card" key={entry.id}>
                <summary>
                  <strong>{change.label}</strong> · {date(entry.receivedAt)}
                </summary>
                <p>
                  {change.votes.length ? 'Propuso' : 'Registró'} {change.proposedBy.name}.
                </p>
                {change.votes.map((vote) => (
                  <p key={vote.by}>
                    Aprobó {vote.name} · {date(vote.at)}.
                  </p>
                ))}
                {entry.detail && <p>{entry.detail}</p>}
                <Difference change={change} />
              </details>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
