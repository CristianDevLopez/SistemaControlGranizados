import { businessDay } from '../domain/business-date.ts';
import { shiftBlocksSales } from '../domain/access.ts';
import { inRehearsalPeriod, rehearsalRequest, visibleCounts } from '../domain/closing-archive.ts';
import { operatingShift } from '../domain/employee-view.ts';
import { countHasDifferences } from '../domain/engine.ts';
import { inventoryDiscrepancies, inventoryDiscrepanciesAt, inventoryOpenings } from '../domain/inventory.ts';
import { reconciledCount, shiftSales } from '../domain/turn-review.ts';
import type { Request, Shift, State } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { Badge, Empty, Panel, Stat, date, money } from './components.tsx';
import { CountDetails } from './TurnReview.tsx';

const signed = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6, signDisplay: 'exceptZero' });
const approvalLabels: Partial<Record<Request['type'], string>> = {
  void: 'Anulación de venta',
  damage: 'Daño o desperdicio',
  courtesy_excess: 'Cortesía adicional',
};
const shiftLabels: Record<Shift['status'], string> = {
  open: 'En curso',
  requested: 'Solicitado',
  provisional: 'Cierre provisional',
  closed: 'Cerrado',
};

function openingStatus(state: State, shift: Shift) {
  if (shift.blindOpening)
    return {
      pending: 'Pendiente de conteo',
      recount: 'En recuento',
      audit: 'En arqueo',
      review: 'En revisión',
      matched: 'Coincidió',
      authorized: 'Autorizada con diferencia',
      reviewed: 'Revisada',
    }[shift.blindOpening.status];
  const count = state.counts.find((item) => item.id === shift.openingCountId);
  if (count) return countHasDifferences(count) ? 'Con diferencia' : 'Coincidió';
  return shift.openingSkipped ? 'Conteo omitido' : 'Pendiente de conteo';
}

function InventoryComparison({ state, day }: { state: State; day: string }) {
  const yesterdayEnd = new Date(Date.parse(`${day}T00:00:00-05:00`) - 1).toISOString();
  const today = new Map(inventoryDiscrepancies(state).map((row) => [row.id, row]));
  const yesterday = inventoryDiscrepanciesAt(state, yesterdayEnd);
  const before = new Map((yesterday ?? []).map((row) => [row.id, row]));
  const differences = new Map([...before, ...today]);

  const display = (row: ReturnType<typeof inventoryDiscrepancies>[number] | undefined) =>
    row ? `${signed.format(row.amount)} ${row.unit}` : 'Sin diferencia detectada';
  return (
    <Panel title="Lo que no cuadra">
      {differences.size ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Artículo</th>
                <th>Hoy</th>
                <th>Ayer al cierre</th>
                <th>Qué revisar</th>
              </tr>
            </thead>
            <tbody>
              {[...differences.values()].map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.article}</th>
                  <td>{display(today.get(row.id))}</td>
                  <td>{yesterday ? display(before.get(row.id)) : '—'}</td>
                  <td>{today.get(row.id)?.explanation ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sin diferencias detectadas" />
      )}
    </Panel>
  );
}

export function Today() {
  const { state, profiles } = useApp().data!;
  const day = businessDay();
  const active = operatingShift(state);
  const shift =
    active ??
    state.shifts
      .filter((item) => {
        const at = item.closedAt ?? item.openedAt ?? item.requestedAt;
        return businessDay(at) === day && !inRehearsalPeriod(state, at);
      })
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  const sales = shift ? shiftSales(state, shift) : undefined;
  const openings = shift ? inventoryOpenings(state, shift) : [];
  const close = visibleCounts(state)
    .filter((count) => count.kind === 'closing' && businessDay(count.at) === day)
    .sort((a, b) => b.at.localeCompare(a.at) || (b.blindAttempt ?? 0) - (a.blindAttempt ?? 0))[0];
  const closeShift = close && state.shifts.find((item) => item.id === close.shiftId);
  const pending = state.requests
    .filter((request) => request.status === 'pending' && !rehearsalRequest(state, request))
    .flatMap((request) => {
      const label = request.change?.label ?? approvalLabels[request.type];
      return label ? [{ id: request.id, label, at: request.at }] : [];
    });
  const expenses = state.expenses
    .filter((expense) => expense.status === 'pending' && !inRehearsalPeriod(state, expense.at))
    .map((expense) => ({
      id: expense.id,
      label: `Gasto · ${expense.supplier || expense.category}`,
      at: expense.at,
    }));
  const payouts = state.transfers
    .filter(
      (transfer) =>
        transfer.type !== 'transfer' &&
        transfer.status === 'requested' &&
        transfer.votes.length < 3 &&
        !inRehearsalPeriod(state, transfer.at),
    )
    .map((transfer) => ({
      id: transfer.id,
      label: transfer.type === 'profit' ? 'Retiro de utilidades' : 'Reembolso',
      at: transfer.at,
    }));
  const approvals = [...pending, ...expenses, ...payouts].sort((a, b) => b.at.localeCompare(a.at));
  const paused = shiftBlocksSales(active);

  return (
    <div className="page-stack">
      <Panel
        title="Turno de hoy"
        action={
          shift && (
            <Badge tone={paused ? 'orange' : active ? 'green' : 'neutral'}>
              {paused ? 'En pausa' : shiftLabels[shift.status]}
            </Badge>
          )
        }
      >
        {shift && sales ? (
          <div className="stats-grid">
            <Stat
              label="Encargado de caja"
              value={profiles.find((profile) => profile.id === shift.cashierId)?.name ?? 'Usuario archivado'}
              note={
                shift.openedAt
                  ? `Desde ${date(shift.openedAt)}`
                  : `Solicitó el turno ${date(shift.requestedAt)}`
              }
            />
            <Stat label="Apertura" value={openingStatus(state, shift)} />
            <Stat
              label="Ventas del turno"
              value={money(sales.orders.reduce((total, order) => total + order.total, 0))}
              note={`${sales.orders.length} ${sales.orders.length === 1 ? 'pedido pagado' : 'pedidos pagados'}`}
            />
            <Stat label="Pendientes de aprobación" value={approvals.length} />
          </div>
        ) : (
          <Empty title="Sin turno hoy" />
        )}
      </Panel>
      <div className="two-columns">
        <Panel title="Aperturas del turno">
          {openings.length ? (
            openings.map((opening) => (
              <div className="list-row" key={opening.id}>
                <div>
                  <strong>
                    {opening.kind} · {opening.article}
                  </strong>
                  <small>{date(opening.openedAt)}</small>
                </div>
              </div>
            ))
          ) : (
            <Empty title="Sin aperturas registradas" />
          )}
        </Panel>
        <Panel title="Pendientes de aprobación">
          {approvals.length ? (
            approvals.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <small>{date(item.at)}</small>
                </div>
              </div>
            ))
          ) : (
            <Empty title="Sin aprobaciones pendientes" />
          )}
        </Panel>
      </div>
      <InventoryComparison state={state} day={day} />
      <Panel title="Último cuadre enviado">
        {close && closeShift ? (
          <div className="detail-content turn-review">
            <CountDetails count={reconciledCount(state, closeShift, close)} original={close} />
          </div>
        ) : (
          <Empty title="Sin cuadres enviados hoy" />
        )}
      </Panel>
    </div>
  );
}
