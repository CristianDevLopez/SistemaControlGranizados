import { useState } from 'react';
import { permissionLabels } from '../domain/access.ts';
import { articles } from '../domain/engine.ts';
import type { ChangeRecord, Request } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { Badge, Empty, Panel, money } from './components.tsx';

const labels: Record<string, string> = {
  active: 'Activo',
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
  schedule: 'Automática por horario',
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

function Difference({ change }: { change: ChangeRecord }) {
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
      if (['alcoholPrice', 'plainPrice', 'fixedPrice'].includes(key)) return money(value);
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

export function ChangeLog() {
  const app = useApp();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const { state, actor } = app.data!;
  if (actor.role !== 'admin') return null;
  const pending = state.requests.filter(
    (request) => request.type === 'change' && request.status === 'pending' && request.change,
  );
  const history = state.audit
    .filter((entry) => entry.change)
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
  const resolve = async (request: Request, approve: boolean) => {
    setBusy(request.id);
    setError('');
    try {
      const result = await app.run('resolve_change', { requestId: request.id, approve });
      if (!result.approvalPending) app.toast(result.message);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <div className="page-stack">
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <Panel title="Pendientes de aprobación">
        {!pending.length && <Empty title="No hay propuestas pendientes" />}
        <div className="requests-list">
          {pending.map((request) => {
            const change = request.change!;
            const own = request.by === actor.id;
            const voted = change.votes.some((vote) => vote.by === actor.id);
            return (
              <article className="request-card" key={request.id}>
                <div className="request-head">
                  <h3>{change.label}</h3>
                  <Badge tone="orange">
                    {change.votes.length} de {change.requiredApprovals}{' '}
                    {change.requiredApprovals === 1 ? 'aprobación' : 'aprobaciones'}
                  </Badge>
                </div>
                <p>
                  {change.proposedBy.name} · {date(change.proposedBy.at)}
                </p>
                <Difference change={change} />
                {change.votes.length > 0 && <p>Aprobó {change.votes.map((vote) => vote.name).join(', ')}.</p>}
                <div className="button-row">
                  {!own && !voted && (
                    <button
                      disabled={!!busy}
                      className="button primary small"
                      onClick={() => void resolve(request, true)}
                    >
                      Aprobar
                    </button>
                  )}
                  <button
                    disabled={!!busy}
                    className="button secondary small"
                    onClick={() => void resolve(request, false)}
                  >
                    {own ? 'Retirar propuesta' : 'Rechazar'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </Panel>
      <Panel title="Cambios aplicados">
        {!history.length && <Empty title="Aún no hay cambios registrados" />}
        <div className="requests-list">
          {history.map((entry) => {
            const change = entry.change!;
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
                <Difference change={change} />
              </details>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
