import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { articles, currentPayments, paymentMethod } from '../domain/engine.ts';
import { useApp } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { exportZip, downloadFile } from '../lib/export.ts';
import { inRehearsalPeriod } from '../domain/closing-archive.ts';
import {
  Badge,
  Empty,
  Panel,
  date,
  money,
  stateNames,
  Modal,
  FieldsForm,
  type Field,
} from './components.tsx';
import type { CommandType } from '../domain/types.ts';
import { adminRequests, requestCategories, requestLabels, shiftRequestLabel } from '../domain/requests.ts';
import { ChangeRequestCard } from './ChangeLog.tsx';
import { TurnReview } from './TurnReview.tsx';
import { Money } from './Money.tsx';
import { EvidenceButton } from './Purchasing.tsx';
export function Control() {
  const app = useApp(),
    { state, actor, profiles } = app.data!,
    [filter, setFilter] = useState('pending'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reconcile, setReconcile] = useState<{ requestId: string; approve: boolean } | null>(null);
  const [category, setCategory] = useState('all');
  const [shiftId, setShiftId] = useState<string>();
  const [transferId, setTransferId] = useState<string>();
  const [action, setAction] = useState<{
    title: string;
    command: CommandType;
    payload: Record<string, unknown>;
    fields: Field[];
  }>();
  const entries = adminRequests(state);
  const visible = entries.filter(
    (item) => (filter === 'all' || item.pending) && (category === 'all' || item.category === category),
  );
  const notifications = state.notifications.filter(
    (item) => !inRehearsalPeriod(state, item.at) && item.channel !== 'mermas',
  );
  const perform = async (command: CommandType, payload: Record<string, unknown>) => {
    setError('');
    try {
      const result = await app.run(command, payload, { onlineOnly: true });
      app.toast(result.message);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const resolve = async (requestId: string, approve: boolean) => {
    const request = state.requests.find((item) => item.id === requestId);
    if (request?.type === 'sync') {
      setReconcile({ requestId, approve });
      return;
    }
    try {
      const result = await app.run('resolve_request', { requestId, approve });
      app.toast(
        approve
          ? request?.type === 'void'
            ? result.message
            : 'Solicitud aprobada.'
          : 'Solicitud rechazada.',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="page-stack">
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <Panel
        title={`Bandeja de solicitudes · ${entries.filter((item) => item.pending).length} pendientes`}
        action={
          <div className="button-row">
            <select
              aria-label="Estado de la solicitud"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="pending">Pendientes</option>
              <option value="all">Todas</option>
            </select>
            <select
              aria-label="Tipo de solicitud"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">Todos los tipos</option>
              {Object.entries(requestCategories).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {visible.length ? (
          <div className="requests-list">
            {visible.map((entry) => {
              if (entry.source === 'request') {
                const request = entry.item;
                if (request.change) return <ChangeRequestCard key={request.id} request={request} />;
                const sale = ['payment_change', 'void', 'unpaid'].includes(request.type)
                  ? state.orders.find((order) => order.id === request.referenceId)
                  : undefined;
                const turn = state.shifts.find((shift) => shift.id === sale?.shiftId);
                const payment =
                  sale &&
                  currentPayments(state.payments).find((item) => item.orderId === sale.id && item.amount > 0);
                const own =
                  (request.type === 'void' &&
                    (request.by === actor.id ||
                      sale?.sellerId === actor.id ||
                      sale?.cashierId === actor.id ||
                      state.payments.some(
                        (item) => item.orderId === sale?.id && item.cashierId === actor.id,
                      ))) ||
                  (request.type === 'courtesy_excess' && request.by === actor.id);
                const paymentAction = (approve: boolean) => {
                  if (!turn) return;
                  setAction({
                    title: approve ? 'Aplicar cambio de medio de pago' : 'Rechazar cambio de medio de pago',
                    command: 'review_shift',
                    payload: {
                      shiftId: turn.id,
                      requestId: request.id,
                      action: approve ? 'correct_payment' : 'reject_payment_change',
                    },
                    fields: [
                      ...(approve
                        ? [
                            {
                              name: 'method',
                              label: 'Medio de pago correcto',
                              type: 'select' as const,
                              required: true,
                              options: [
                                { value: 'cash', label: 'Efectivo' },
                                ...state.locations
                                  .filter((item) => item.active && item.type === 'bank' && item.receivesSales)
                                  .map((item) => ({ value: `transfer:${item.id}`, label: item.name })),
                              ],
                            },
                          ]
                        : []),
                      { name: 'notes', label: 'Motivo', type: 'textarea', required: true },
                    ],
                  });
                };
                const ordinary = !['payment_change', 'shift_explanation', 'change'].includes(request.type);
                return (
                  <RequestCard
                    key={request.id}
                    title={requestLabels[request.type]}
                    status={request.status}
                    at={request.at}
                  >
                    <p>{request.notes}</p>
                    {sale && (
                      <p>
                        Pedido #{sale.number} · {money(sale.total)}
                      </p>
                    )}
                    {payment && request.type === 'payment_change' && (
                      <p>
                        Pago actual ·{' '}
                        {paymentMethod(payment) === 'cash'
                          ? 'Efectivo'
                          : (state.locations.find((item) => item.id === payment.accountId)?.name ??
                            'Transferencia')}
                      </p>
                    )}
                    {request.article && (
                      <p>
                        {articles(state).find((x) => x.id === request.article)?.name} · {request.quantity}
                      </p>
                    )}
                    {request.diagnosis && <p>{request.diagnosis}</p>}
                    {request.response && (
                      <p>
                        {request.response.notes} · {date(request.response.at)}
                      </p>
                    )}
                    {request.resolutionNotes && <p>{request.resolutionNotes}</p>}
                    <div className="request-footer">
                      <small>{profiles.find((person) => person.id === request.by)?.name}</small>
                      <div className="button-row">
                        {request.evidenceId && <EvidenceButton id={request.evidenceId} />}
                        {request.type === 'payment_change' && entry.pending && turn && (
                          <>
                            <button
                              className="button small secondary"
                              disabled={!app.online}
                              onClick={() => paymentAction(false)}
                            >
                              Rechazar
                            </button>
                            <button
                              className="button small primary"
                              disabled={
                                !app.online ||
                                !payment ||
                                (!!turn.closingFlow && turn.closingReview?.status === 'approved')
                              }
                              onClick={() => paymentAction(true)}
                            >
                              Aplicar cambio
                            </button>
                          </>
                        )}
                        {request.type === 'shift_explanation' && request.referenceId && (
                          <button
                            className="button small secondary"
                            onClick={() => setShiftId(request.referenceId)}
                          >
                            Ver turno
                          </button>
                        )}
                        {ordinary &&
                          entry.pending &&
                          (own ? (
                            <small>Debe revisarla otro admin</small>
                          ) : (
                            <>
                              {request.type !== 'difference' && (
                                <button
                                  className="button small secondary"
                                  disabled={!app.online}
                                  onClick={() => void resolve(request.id, false)}
                                >
                                  Rechazar
                                </button>
                              )}
                              <button
                                className="button small primary"
                                disabled={!app.online}
                                onClick={() => void resolve(request.id, true)}
                              >
                                {request.type === 'difference' ? 'Aceptar explicación' : 'Aprobar'}
                              </button>
                            </>
                          ))}
                      </div>
                    </div>
                  </RequestCard>
                );
              }
              if (entry.source === 'shift') {
                const shift = entry.item;
                const requested = shift.status === 'requested';
                return (
                  <RequestCard
                    key={shift.id}
                    title={shiftRequestLabel(shift)}
                    status={entry.pending ? 'pending' : 'reviewed'}
                    at={entry.at}
                  >
                    <p>{profiles.find((person) => person.id === shift.cashierId)?.name}</p>
                    {requested ? (
                      <button
                        className="button small primary"
                        disabled={!app.online}
                        onClick={() =>
                          setAction({
                            title: 'Autorizar turno',
                            command: 'authorize_shift',
                            payload: { shiftId: shift.id },
                            fields: [
                              {
                                name: 'base',
                                label: 'Base inicial si no hay saldo anterior',
                                type: 'money',
                                min: 0,
                                value: 0,
                                required: true,
                              },
                            ],
                          })
                        }
                      >
                        Autorizar apertura
                      </button>
                    ) : (
                      <button className="button small primary" onClick={() => setShiftId(shift.id)}>
                        Revisar turno
                      </button>
                    )}
                  </RequestCard>
                );
              }
              if (entry.source === 'expense') {
                const expense = entry.item;
                return (
                  <RequestCard
                    key={expense.id}
                    title={`Gasto · ${expense.category}`}
                    status={expense.status}
                    at={expense.at}
                  >
                    <p>
                      {expense.supplier} · {money(expense.amount)}
                    </p>
                    {expense.notes && <p>{expense.notes}</p>}
                    <div className="button-row">
                      {expense.evidenceId && <EvidenceButton id={expense.evidenceId} />}
                      {entry.pending &&
                        [false, true].map((approve) => (
                          <button
                            key={String(approve)}
                            className={`button small ${approve ? 'primary' : 'secondary'}`}
                            disabled={!app.online}
                            onClick={() =>
                              void perform('approve_expense', { expenseId: expense.id, approve })
                            }
                          >
                            {approve ? 'Aprobar' : 'Rechazar'}
                          </button>
                        ))}
                    </div>
                  </RequestCard>
                );
              }
              const transfer = entry.item;
              return (
                <RequestCard
                  key={transfer.id}
                  title={
                    transfer.type === 'profit'
                      ? 'Retiro de utilidades'
                      : transfer.type === 'reimbursement'
                        ? 'Reembolso'
                        : 'Traslado de efectivo'
                  }
                  status={transfer.status}
                  at={transfer.at}
                >
                  <p>
                    {transfer.notes}
                    {!transfer.blindReceipt && ` · ${money(transfer.amount)}`}
                  </p>
                  <button className="button small primary" onClick={() => setTransferId(transfer.id)}>
                    Ver movimiento
                  </button>
                </RequestCard>
              );
            })}
          </div>
        ) : (
          <Empty
            title={filter === 'pending' ? 'Sin solicitudes pendientes' : 'Sin solicitudes en esta vista'}
          />
        )}
      </Panel>
      <details>
        <summary>Exportación, avisos y auditoría</summary>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const payload = await api('export');
              downloadFile(
                new Uint8Array(exportZip(payload)).buffer,
                `dexter-exportacion-${new Date().toISOString().slice(0, 10)}.zip`,
                'application/zip',
              );
              app.toast('Exportación generada con archivos relacionados y diccionario.');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={17} />
          {busy ? 'Preparando…' : 'Exportar información'}
        </button>
        <Panel
          title="Avisos a administradores"
          action={
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api('notifications/retry', {});
                  app.toast('Reintento solicitado.');
                } catch (e) {
                  app.toast((e as Error).message);
                }
              }}
            >
              <RefreshCw size={15} />
              Reintentar
            </button>
          }
        >
          {notifications.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Aviso</th>
                    <th>Canal</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {[...notifications]
                    .reverse()
                    .slice(0, 100)
                    .map((n) => (
                      <tr key={n.id}>
                        <td>
                          {n.text}
                          <small>{date(n.at)}</small>
                          {n.lastError && <small>{n.lastError}</small>}
                        </td>
                        <td>{n.channel}</td>
                        <td>
                          <Badge tone={n.status === 'sent' ? 'green' : 'orange'}>
                            {n.status === 'sent' ? 'Enviado' : 'Pendiente'}
                          </Badge>
                          <small>{n.attempts} intentos</small>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Sin avisos por enviar" />
          )}
        </Panel>
        <Panel title="Rastro de auditoría">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Momento</th>
                  <th>Acción</th>
                  <th>Usuario</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {[...state.audit]
                  .reverse()
                  .slice(0, 150)
                  .map((a) => (
                    <tr key={a.id}>
                      <td>{date(a.at)}</td>
                      <td>{a.action}</td>
                      <td>{profiles.find((x) => x.id === a.by)?.name}</td>
                      <td>{a.detail}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </details>
      {shiftId && <TurnReview key={shiftId} shiftId={shiftId} onClose={() => setShiftId(undefined)} />}
      {transferId && (
        <Modal title="Detalle del movimiento" onClose={() => setTransferId(undefined)}>
          <Money transferId={transferId} />
        </Modal>
      )}
      {action && (
        <Modal title={action.title} onClose={() => setAction(undefined)}>
          <FieldsForm
            fields={action.fields}
            onCancel={() => setAction(undefined)}
            onSubmit={async ({ method: selected, ...values }) => {
              const [method, accountId] = String(selected ?? '').split(':');
              const result = await app.run(
                action.command,
                {
                  ...action.payload,
                  ...values,
                  ...(selected ? { method, accountId } : {}),
                },
                { onlineOnly: true },
              );
              app.toast(result.message);
              setAction(undefined);
            }}
          />
        </Modal>
      )}
      {reconcile && (
        <Modal title="Conciliar operación pendiente" onClose={() => setReconcile(null)}>
          <p className="modal-intro">
            Conserva el registro original. Si ocurrió una venta real, ingresa primero el pedido desde la
            planilla y vincúlalo aquí. Si el registro es incorrecto o repetido, explica por qué se descarta.
          </p>
          <FieldsForm
            fields={[
              {
                name: 'resolutionNotes',
                label: 'Explicación y verificación realizada',
                type: 'textarea',
                required: true,
              },
              ...(reconcile.approve
                ? [
                    {
                      name: 'resolutionId',
                      label: 'Registro correcto que sustituye esta operación',
                      type: 'select' as const,
                      required: true,
                      options: [
                        ...state.orders.map((o) => ({
                          value: o.id,
                          label: `Pedido #${o.number} · ${money(o.total)}`,
                        })),
                        ...state.counts.map((c) => ({ value: c.id, label: `Conteo · ${date(c.at)}` })),
                        ...state.expenses.map((e) => ({
                          value: e.id,
                          label: `Gasto · ${e.category} · ${money(e.amount)}`,
                        })),
                        ...state.transfers.map((t) => ({
                          value: t.id,
                          label: `Movimiento · ${money(t.amount)} · ${date(t.at)}`,
                        })),
                        ...state.receipts.map((r) => ({ value: r.id, label: `Recepción · ${date(r.at)}` })),
                      ],
                    },
                  ]
                : []),
            ]}
            onCancel={() => setReconcile(null)}
            submit={reconcile.approve ? 'Vincular y conciliar' : 'Descartar con explicación'}
            onSubmit={async (v) => {
              await app.run('resolve_request', { ...reconcile, ...v });
              setReconcile(null);
              app.toast('Conciliación registrada. La caja podrá continuar la sincronización.');
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function RequestCard({
  title,
  status,
  at,
  children,
}: {
  title: string;
  status: string;
  at: string;
  children: import('react').ReactNode;
}) {
  return (
    <article className="request-card">
      <div className="request-head">
        <div>
          <Badge tone={['pending', 'requested', 'in_transit'].includes(status) ? 'orange' : 'neutral'}>
            {stateNames[status] ?? (status === 'reviewed' ? 'Revisado' : status)}
          </Badge>
          <h3>{title}</h3>
        </div>
        <small>{date(at)}</small>
      </div>
      {children}
    </article>
  );
}
