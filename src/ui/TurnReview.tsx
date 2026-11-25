import { orderedFlavors } from '../domain/flavors.ts';
import { useState } from 'react';
import { businessDay, periodStart } from '../domain/business-date.ts';
import { inRehearsalPeriod, rehearsalShift } from '../domain/closing-archive.ts';
import {
  compensatedInventory,
  approvedInventoryUpdatesSince,
  isLegacyCoolerArticle,
  stockBalances,
  usesCupPackages,
  countHasDifferences,
  blindCountArticles,
  currentPayments,
  paymentMethod,
  reviewedClosingCashInDrawer,
} from '../domain/engine.ts';
import { inventoryOpenings } from '../domain/inventory.ts';
import {
  closingNeedsReview,
  legacyOpeningNeedsReview,
  reconciledCount,
  reviewCounts,
  reviewIsPending,
  saleExplanations,
  shiftSales,
  shiftTransfers,
} from '../domain/turn-review.ts';
import type { CommandType, Count, Payment } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import {
  Badge,
  Empty,
  FieldsForm,
  Modal,
  Panel,
  date,
  localDateTime,
  money,
  stateNames,
  type Field,
} from './components.tsx';

import { ClosingApprovalDialog, ClosingConfirmation } from './ClosingReview.tsx';
import { CountReviewDialog } from './CashAudit.tsx';
import { InventoryComparison } from './Today.tsx';
import { MermaReport } from './MermaReport.tsx';
import { EvidenceButton } from './EvidenceButton.tsx';
import { ExpenseApproval } from './ExpenseApproval.tsx';

type Action = { title: string; command: CommandType; fields: Field[]; payload?: Record<string, unknown> };
const note = { name: 'notes', label: 'Nota', type: 'textarea', required: true } as const;
const digits = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

export function TurnReview({ shiftId, onClose }: { shiftId?: string; onClose?: () => void } = {}) {
  const app = useApp();
  const { state, profiles } = app.data!;
  const [selected, setSelected] = useState<string | null>(shiftId ?? null);
  const [action, setAction] = useState<Action | null>(null);
  const [history, setHistory] = useState('pending');
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('all');
  const [day, setDay] = useState(businessDay());
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [approvalCount, setApprovalCount] = useState<Count | null>(null);
  const [reviewCount, setReviewCount] = useState<Count | null>(null);
  const cutoff = state.settings[0].rehearsalBaseline;
  const candidateAudits = state.counts.filter(
    (count) =>
      count.kind === 'audit' &&
      Object.keys(count.items).length > 0 &&
      (!cutoff || (count.cutoffAt ?? count.at) > cutoff.at),
  );
  const pending = state.shifts.filter((shift) => reviewIsPending(state, shift));
  const rows = (
    history === 'pending'
      ? pending
      : state.shifts.filter((shift) =>
          history === 'rehearsal'
            ? rehearsalShift(state, shift)
            : !rehearsalShift(state, shift) && !shift.closingArchive,
        )
  )
    .filter((row) => {
      const counts = reviewCounts(state, row, history === 'rehearsal').filter(
        (count) => kind === 'all' || count.kind === kind,
      );
      const dates = counts.length
        ? counts.map((count) => count.cutoffAt ?? count.at)
        : kind === 'all'
          ? [row.closedAt ?? row.openedAt ?? row.requestedAt]
          : [];
      if (
        !dates.length ||
        (period !== 'all' &&
          !dates.some((at) => periodStart(businessDay(at), period) === periodStart(day, period)))
      )
        return false;
      if (status === 'review') return reviewIsPending(state, row);
      if (status === 'closed') return row.status === 'closed' && !reviewIsPending(state, row);
      if (status === 'difference') return counts.some(countHasDifferences);
      if (status === 'matched') return counts.some((count) => !countHasDifferences(count));
      return true;
    })
    .sort((a, b) => (b.openedAt ?? b.requestedAt).localeCompare(a.openedAt ?? a.requestedAt));
  const shift = state.shifts.find((item) => item.id === selected);
  const approvedCash = shift && reviewedClosingCashInDrawer(state, shift);
  const archived = !!shift && (rehearsalShift(state, shift) || !!shift.closingArchive);
  const counts = shift ? reviewCounts(state, shift, archived || history === 'rehearsal') : [];
  const filteredCounts = counts.filter((count) => kind === 'all' || count.kind === kind);
  const counted =
    counts.find((count) => count.id === shift?.closingCountId) ??
    counts.filter((count) => count.kind === 'closing' && !count.revisesId).at(-1);
  const explanations =
    shift && counted ? saleExplanations(state, reconciledCount(state, shift, counted)) : [];
  const sales = shift ? shiftSales(state, shift) : undefined;
  const openings = shift ? inventoryOpenings(state, shift) : [];
  const transfers = shift ? shiftTransfers(state, shift) : [];
  const awaitsVerification = transfers.some(
    (payment) => !shift?.operationsReview?.verifiedTransfers?.[payment.id],
  );
  const orders = state.orders.filter((order) => order.shiftId === shift?.id);
  const canReviewPayments = !archived && (!shift?.closingFlow || shift.closingReview?.status !== 'approved');
  const awaitsPaymentChanges = state.requests.some(
    (request) =>
      request.type === 'payment_change' &&
      request.status === 'pending' &&
      orders.some((order) => order.id === request.referenceId),
  );
  const orderName = (id: string) => orders.find((order) => order.id === id)?.number ?? id;
  const name = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? 'Usuario archivado';
  const locations = state.locations.filter(
    (item) => item.active && item.type === 'bank' && item.receivesSales,
  );
  const openingReview = shift?.blindOpening?.status;
  const priorShift =
    shift &&
    state.shifts
      .filter(
        (item) =>
          item.id !== shift.id &&
          item.closedAt &&
          item.closedAt <= shift.requestedAt &&
          !item.closingArchive &&
          !rehearsalShift(state, item),
      )
      .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0];
  const priorCount = state.counts.find(
    (item) => item.id === (priorShift?.closingReview?.countId ?? priorShift?.closingCountId),
  );
  const openingCount = state.counts.find(
    (item) => item.id === (shift?.blindOpening?.auditCountIds?.at(-1) ?? shift?.openingCountId),
  );
  const updatedOpeningItems = openingCount
    ? approvedInventoryUpdatesSince(state, openingCount)
    : new Set<string>();
  const liveBalances = openingCount && updatedOpeningItems.size ? stockBalances(state) : {};
  const requestAction = (
    title: string,
    method: string,
    fields: Field[],
    payload: Record<string, unknown> = {},
  ) =>
    setAction({
      title,
      command: 'review_shift',
      fields,
      payload: { action: method, shiftId: shift?.id, ...payload },
    });
  const fieldsForAudit = (): Field[] => [
    { name: 'cash', label: 'Incluir efectivo', type: 'checkbox' },
    {
      name: 'items',
      label: 'Artículos',
      type: 'multiselect',
      options: blindCountArticles(state).map((item) => ({ value: item.id, label: item.name })),
    },
  ];
  const correctPayment = (payment: Payment, requestId?: string) =>
    requestAction(
      'Corregir medio de pago',
      'correct_payment',
      [
        {
          name: 'method',
          type: 'select',
          label: 'Medio correcto',
          required: true,
          options: [
            { value: 'cash', label: 'Efectivo' },
            ...locations.map((location) => ({ value: `transfer:${location.id}`, label: location.name })),
          ],
        },
        note,
      ],
      { paymentId: payment.id, requestId },
    );
  const correction = (kind: 'open_bag' | 'open_package') =>
    setAction({
      title: kind === 'open_bag' ? 'Agregar apertura de bolsa' : 'Agregar apertura de paquete',
      command: kind,
      payload: {
        shiftId: shift?.id,
        correction: true,
        ...(shift?.closingReview?.status === 'pending' ? { reviewClosing: true } : {}),
      },
      fields: [
        {
          name: kind === 'open_bag' ? 'flavorId' : 'sizeId',
          label: kind === 'open_bag' ? 'Sabor' : 'Tamaño',
          type: 'select',
          required: true,
          options: (kind === 'open_bag'
            ? orderedFlavors(state.flavors)
            : state.sizes.filter(usesCupPackages)
          ).map((item) => ({ value: item.id, label: item.name })),
        },
        { name: 'openedAt', label: 'Fecha y hora de apertura (Colombia)', type: 'datetime-local' },
        note,
      ],
    });
  const run = async (command: CommandType, payload: Record<string, unknown>) => {
    setError('');
    try {
      const result = await app.run(command, payload, { onlineOnly: true });
      app.toast(result.message);
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  return (
    <div className="page-stack">
      {!shiftId && (
        <>
          <div className="page-toolbar">
            <div>
              <h2>Revisar turnos</h2>
              <p>Consulta conteos, verifica transferencias y resuelve diferencias de apertura y cierre.</p>
            </div>
            {candidateAudits.length > 0 && (
              <button
                className="button secondary"
                onClick={() =>
                  setAction({
                    command: 'archive_rehearsal',
                    title: 'Elegir arqueo de referencia',
                    fields: [
                      {
                        name: 'countId',
                        label: 'Arqueo de referencia',
                        type: 'select',
                        required: true,
                        options: candidateAudits.map((count) => ({
                          value: count.id,
                          label: `${date(count.at)} · ${name(count.by)}`,
                        })),
                      },
                    ],
                  })
                }
              >
                Elegir arqueo de referencia · Cambia la referencia de inventario
              </button>
            )}
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <Panel
            title="Turnos"
            action={
              <select
                aria-label="Filtrar turnos"
                value={history}
                onChange={(event) => setHistory(event.target.value)}
              >
                <option value="pending">Por revisar</option>
                <option value="recent">Recientes</option>
                {cutoff && <option value="rehearsal">Período de ensayo</option>}
              </select>
            }
          >
            <div className="table-toolbar">
              <label>
                Período{' '}
                <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                  <option value="all">Todo</option>
                  <option value="day">Día</option>
                  <option value="week">Semana</option>
                  <option value="month">Mes</option>
                </select>
              </label>
              {period !== 'all' && (
                <input
                  type="date"
                  aria-label="Fecha de referencia"
                  value={day}
                  onChange={(e) => e.target.value && setDay(e.target.value)}
                />
              )}
              <label>
                Estado{' '}
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    if (e.target.value !== 'review' && history === 'pending') setHistory('recent');
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="matched">Coincidió</option>
                  <option value="difference">Con diferencia</option>
                  <option value="review">En revisión</option>
                  <option value="closed">Cerrado</option>
                </select>
              </label>
              <label>
                Conteo{' '}
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="all">Todos</option>
                  <option value="opening">Apertura</option>
                  <option value="closing">Cierre</option>
                </select>
              </label>
            </div>
            {rows.length ? (
              <div className="requests-list">
                {rows.map((row) => (
                  <article key={row.id}>
                    <div>
                      <strong>{name(row.cashierId)}</strong>
                      <small>{date(row.openedAt ?? row.requestedAt)}</small>
                    </div>
                    <button className="button small secondary" onClick={() => setSelected(row.id)}>
                      Ver turno · No mueve inventario ni plata
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="Sin turnos en esta vista" />
            )}
          </Panel>
          <MermaReport
            onTurn={(id) => {
              setKind('all');
              setSelected(id);
            }}
          />
          <InventoryComparison state={state} day={day} />
        </>
      )}
      {shift && (
        <Modal title={`Turno de ${name(shift.cashierId)}`} onClose={onClose ?? (() => setSelected(null))}>
          <div className="detail-content turn-review">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <p>
              {date(shift.openedAt ?? shift.requestedAt)}
              {archived && ' · Archivado'}
            </p>
            {filteredCounts.map((count) => (
              <div key={count.id}>
                <CountDetails count={reconciledCount(state, shift, count)} original={count} />
                {shift.operationsReview?.countResolutions?.[count.id] && (
                  <p>Arqueo revisado · {shift.operationsReview.countResolutions[count.id].notes}</p>
                )}
                {!archived &&
                  count.kind === 'audit' &&
                  countHasDifferences(count) &&
                  !shift.operationsReview?.countResolutions?.[count.id] && (
                    <button
                      className="text-button"
                      onClick={() =>
                        requestAction('Cerrar diferencia de arqueo', 'resolve_count', [note], {
                          countId: count.id,
                        })
                      }
                    >
                      Cerrar diferencia de arqueo · No mueve inventario ni plata
                    </button>
                  )}
                {!archived &&
                  !shift.closingFlow &&
                  shift.closingCountId === count.id &&
                  shift.closingReview?.status === 'pending' && (
                    <button className="text-button" onClick={() => setApprovalCount(count)}>
                      Reconfirmar cuadre · Permite proponer ajustes de inventario
                    </button>
                  )}
                {Object.entries(
                  shift.operationsReview?.openingDifferences?.countId === count.id
                    ? shift.operationsReview.openingDifferences.items
                    : {},
                ).map(([key, item]) => (
                  <p key={key}>
                    {count.itemLabels?.[key] ?? key} · {item.difference > 0 ? '+' : ''}
                    {item.difference} ·
                    {item.lastFullCountAt
                      ? ` Diferencia desde el último conteo completo del ${date(item.lastFullCountAt)}`
                      : ' Primer conteo completo registrado'}
                  </p>
                ))}
                {Object.entries(count.inventoryDifferences ?? {}).map(([article, entry]) => {
                  const compensated = compensatedInventory(state, count, article);
                  return (
                    <p key={article}>
                      {count.itemLabels?.[article] ?? article} · {entry.quantity} · Costo unitario{' '}
                      {money(entry.unitCost)}
                      {' · Venta unitaria '}
                      {money(entry.saleValue)}
                      {compensated > 0 &&
                        ` · ${compensated === Math.abs(entry.quantity) ? 'Compensado' : 'Compensado parcialmente'} (${compensated}) · Neto ${entry.quantity - Math.sign(entry.quantity) * compensated}`}
                    </p>
                  );
                })}
                {!archived && (!shift.closingFlow || count.kind === 'audit') && (
                  <button className="text-button" onClick={() => setReviewCount(count)}>
                    Revisar conteo · Permite proponer ajustes de inventario
                  </button>
                )}
              </div>
            ))}
            {shift.closingFlow?.versions.map((version, index) => {
              const transfer = state.transfers.find((item) => item.id === version.transferId);
              return (
                <p key={version.at + index}>
                  Versión {index + 1} · {date(version.at)}
                  {!transfer?.blindReceipt && ` · Base ${money(version.retained)}`}
                  {transfer &&
                    ` · ${state.locations.find((item) => item.id === transfer.to)?.name ?? 'Destino'} · ${transfer.status === 'in_transit' ? 'En camino' : 'Recibido'}`}
                  {transfer &&
                    !transfer.blindReceipt &&
                    ` · ${transfer.receiptCorrection ? 'En el cuadre' : 'Enviado'} ${money(transfer.amount)}`}
                  {transfer?.receivedAmount !== undefined &&
                    ` · ${transfer.receiptCorrection ? 'Recepción corregida' : 'Recibido'} ${money(transfer.receivedAmount)}`}
                  {transfer?.status === 'disputed' &&
                    ` · Diferencia ${money(transfer.receivedAmount! - transfer.amount)}`}
                  {version.notes && ` · ${version.notes}`}
                </p>
              );
            })}
            {approvedCash !== undefined && (
              <p>Base aprobada para el siguiente turno · {money(approvedCash)}</p>
            )}
            {shift.closingFlow?.returns?.map((item) => (
              <p key={item.at}>
                Devuelto · {date(item.at)} · {item.notes}
              </p>
            ))}
            {shift.closingFlow?.response && (
              <p>
                Respuesta ·{' '}
                {
                  {
                    accepted: 'Acepto',
                    disagreed: 'No estoy de acuerdo',
                    unanswered: 'Sin respuesta',
                  }[shift.closingFlow.response.outcome]
                }{' '}
                · {shift.closingFlow.response.notes}
              </p>
            )}
            {!archived &&
              shift.closingFlow &&
              ['pending', 'returned'].includes(shift.closingReview?.status ?? '') &&
              counted && (
                <>
                  {awaitsVerification && <p>Verifica las transferencias del turno.</p>}
                  {awaitsPaymentChanges && <p>Resuelve los cambios de medio de pago.</p>}
                  <ClosingConfirmation
                    key={counted.id}
                    count={counted}
                    blocked={awaitsVerification || awaitsPaymentChanges}
                  />
                </>
              )}
            {shift.closingReview?.inventoryVerification?.status === 'pending' && (
              <p>Inventario por verificar en el próximo arqueo de apertura.</p>
            )}
            {shift.closingReview?.openingChecks?.map((check) => (
              <p key={check.countId}>
                Arqueo de apertura aprobado ·{' '}
                {Object.entries(check.differences)
                  .map(
                    ([key, amount]) =>
                      `${counted?.itemLabels?.[key] ?? key} ${amount > 0 ? '+' : ''}${amount}`,
                  )
                  .join(' · ') || 'Sin diferencias de inventario'}
                {check.cash ? ` · Efectivo ${money(check.cash)}` : ''}
              </p>
            ))}
            {!!explanations.length && (
              <div className="notice warning">
                {explanations.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </div>
            )}
            {shift.operationsReview?.resolution && (
              <p>
                <strong>
                  {
                    {
                      shortage: 'Faltante del negocio',
                      surplus: 'Sobrante del negocio',
                      matched: 'Coincidió tras la corrección',
                    }[shift.operationsReview.resolution.outcome]
                  }
                </strong>{' '}
                · {shift.operationsReview.resolution.notes}
              </p>
            )}
            {shift.operationsReview?.openingResolution && (
              <p>Apertura revisada · {shift.operationsReview.openingResolution.notes}</p>
            )}
            {shift.operationsReview?.camera && (
              <p>
                Revisar cámaras · {date(shift.operationsReview.camera.at)} ·{' '}
                {shift.operationsReview.camera.notes}
              </p>
            )}
            <details open>
              <summary>Transferencias del turno</summary>
              {transfers.length ? (
                <ul>
                  {transfers.map((payment) => {
                    const verified = shift.operationsReview?.verifiedTransfers?.[payment.id];
                    return (
                      <li key={payment.id}>
                        <strong>#{orderName(payment.orderId)}</strong>
                        {' · '}
                        {state.locations.find((location) => location.id === payment.accountId)?.name ??
                          'Transferencia'}{' '}
                        · {money(payment.amount)}
                        {payment.reference && ` · Ref. ${payment.reference}`}{' '}
                        {verified ? (
                          <Badge tone={verified.missing ? 'red' : 'green'}>
                            {verified.missing ? 'Marcada como no recibida por' : 'Verificada por'}{' '}
                            {name(verified.by)}
                          </Badge>
                        ) : (
                          <Badge tone="orange">Sin verificar</Badge>
                        )}{' '}
                        {canReviewPayments && (!verified || verified.missing) && (
                          <button
                            className="button small secondary"
                            onClick={() =>
                              void run('review_shift', {
                                shiftId: shift.id,
                                paymentId: payment.id,
                                action: 'verify_transfer',
                              })
                            }
                          >
                            Marcar verificada · No mueve plata
                          </button>
                        )}
                        {canReviewPayments && (!verified || !verified.missing) && (
                          <button
                            className="button small secondary"
                            onClick={() =>
                              void run('review_shift', {
                                shiftId: shift.id,
                                paymentId: payment.id,
                                action: 'verify_transfer',
                                missing: true,
                              })
                            }
                          >
                            No llegó · Registra faltante de plata
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>Sin transferencias registradas.</p>
              )}
            </details>
            <details open>
              <summary>Solicitudes y explicaciones</summary>
              {state.requests
                .filter(
                  (request) =>
                    (archived || !inRehearsalPeriod(state, request.at)) &&
                    ((request.type === 'shift_explanation' && request.referenceId === shift.id) ||
                      (request.type === 'payment_change' &&
                        orders.some((order) => order.id === request.referenceId)) ||
                      (request.type === 'difference' &&
                        counts.some((count) => count.id === request.referenceId))),
                )
                .map((request) => {
                  const payment = currentPayments(state.payments).find(
                    (item) => item.orderId === request.referenceId && item.amount > 0,
                  );
                  return (
                    <article key={request.id}>
                      <p>
                        <strong>
                          {request.type === 'payment_change'
                            ? `Cambio de pago · #${orderName(request.referenceId!)}`
                            : 'Explicación del turno'}
                        </strong>
                        {' · '}
                        {request.notes}
                      </p>
                      {request.response && (
                        <p>
                          {request.response.notes} · {date(request.response.at)}
                        </p>
                      )}
                      {request.resolutionNotes && <p>{request.resolutionNotes}</p>}
                      {!archived && request.type === 'difference' && request.status === 'pending' && (
                        <button
                          className="button small secondary"
                          onClick={() =>
                            void run('resolve_request', {
                              requestId: request.id,
                              approve: true,
                            })
                          }
                        >
                          Aceptar explicación · No mueve inventario ni plata
                        </button>
                      )}
                      {canReviewPayments &&
                        request.type === 'payment_change' &&
                        request.status === 'pending' && (
                          <button
                            className="button small secondary"
                            onClick={() =>
                              requestAction(
                                'Rechazar cambio de medio de pago',
                                'reject_payment_change',
                                [note],
                                { requestId: request.id },
                              )
                            }
                          >
                            Rechazar cambio · No mueve inventario ni plata
                          </button>
                        )}
                      {canReviewPayments &&
                        request.type === 'payment_change' &&
                        request.status === 'pending' &&
                        payment && (
                          <button
                            className="button small secondary"
                            onClick={() => correctPayment(payment, request.id)}
                          >
                            Aplicar cambio · Corrige el registro de plata
                          </button>
                        )}
                    </article>
                  );
                })}
            </details>
            <details open>
              <summary>Gastos y daños del turno</summary>
              {state.expenses
                .filter((item) => item.shiftId === shift.id)
                .map((item) => (
                  <div className="list-row" key={item.id}>
                    <span>
                      {item.category} · {money(item.amount)} · {stateNames[item.status]}
                      {item.notes && ` · ${item.notes}`}
                    </span>
                    <div className="button-row">
                      {item.evidenceId && <EvidenceButton id={item.evidenceId} />}
                      {!archived && (
                        <ExpenseApproval
                          expense={item}
                          label=" gasto"
                          onDecision={(approve) =>
                            void run('approve_expense', { expenseId: item.id, approve })
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
              {state.requests
                .filter(
                  (item) =>
                    item.type === 'damage' &&
                    (item.referenceId === shift.id ||
                      (!item.referenceId &&
                        !!shift.openedAt &&
                        item.at >= shift.openedAt &&
                        (!shift.closedAt || item.at <= shift.closedAt))),
                )
                .map((item) => (
                  <div className="list-row" key={item.id}>
                    <span>
                      Daño · {item.notes} · {stateNames[item.status]}
                    </span>
                    {!archived && item.status === 'pending' && (
                      <div className="button-row">
                        <button
                          className="button small primary"
                          onClick={() =>
                            void run('resolve_request', {
                              requestId: item.id,
                              approve: true,
                              ...(shift.closingReview?.status === 'pending'
                                ? { reviewClosing: true, shiftId: shift.id }
                                : {}),
                            })
                          }
                        >
                          Aprobar daño
                        </button>
                        <button
                          className="button small secondary"
                          onClick={() => void run('resolve_request', { requestId: item.id, approve: false })}
                        >
                          Rechazar daño
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </details>
            <details open>
              <summary>Inventario y ventas del turno</summary>
              {openings.map((item) => (
                <div className="list-row" key={item.id}>
                  <span>
                    {item.kind} · {item.article} · {date(item.openedAt)}
                  </span>
                  {!archived && shift.closingReview?.status !== 'approved' && (
                    <div className="button-row">
                      <button
                        className="button small secondary"
                        onClick={() =>
                          requestAction(
                            'Cambiar hora de apertura',
                            'correct_opening',
                            [
                              {
                                name: 'openedAt',
                                label: 'Fecha y hora de apertura (Colombia)',
                                type: 'datetime-local',
                                required: true,
                                value: localDateTime(new Date(item.openedAt)),
                              },
                              note,
                            ],
                            { openingId: item.id },
                          )
                        }
                      >
                        Cambiar hora
                      </button>
                      <button
                        className="button small secondary"
                        onClick={() =>
                          requestAction('Quitar apertura', 'correct_opening', [note], {
                            openingId: item.id,
                            remove: true,
                          })
                        }
                      >
                        Quitar
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {orderedFlavors(state.flavors)
                .filter(
                  (flavor) =>
                    openings.some((item) => item.kind === 'Bolsa' && item.flavorId === flavor.id) ||
                    sales?.ouncesByFlavor.has(flavor.id),
                )
                .map((flavor) => {
                  const bags = openings.filter(
                    (item) => item.kind === 'Bolsa' && item.flavorId === flavor.id,
                  );
                  const sold = sales?.ouncesByFlavor.get(flavor.id) ?? 0;
                  const opened = bags.reduce(
                    (sum, item) => sum + (item.kind === 'Bolsa' ? (item.ounces ?? 0) : 0),
                    0,
                  );
                  return (
                    <p key={flavor.id}>
                      {flavor.name} · {bags.length} bolsas abiertas · {digits.format(sold)} oz vendidas.
                      {bags.length >= 2 && opened > 0 && sold < opened / 2 && (
                        <strong> Conviene pedir un arqueo de este sabor.</strong>
                      )}
                    </p>
                  );
                })}
              {state.sizes
                .filter(
                  (size) =>
                    openings.some((item) => item.kind === 'Paquete' && item.sizeId === size.id) ||
                    sales?.cupsBySize.has(size.id),
                )
                .map((size) => (
                  <p key={size.id}>
                    {size.name} ·{' '}
                    {openings.filter((item) => item.kind === 'Paquete' && item.sizeId === size.id).length}{' '}
                    paquetes abiertos · {sales?.cupsBySize.get(size.id) ?? 0} vasos vendidos.
                  </p>
                ))}
            </details>
            {!archived && (
              <div className="button-row">
                {openingReview === 'review' && (
                  <>
                    {priorCount && (
                      <div className="notice info">
                        <strong>Diferencias del cierre anterior</strong>
                        <p>
                          {Object.entries(priorCount.differences ?? {})
                            .filter(([key, amount]) => !isLegacyCoolerArticle(key) && amount !== 0)
                            .map(
                              ([key, amount]) =>
                                `${priorCount.itemLabels?.[key] ?? key} ${amount > 0 ? '+' : ''}${amount}`,
                            )
                            .join(' · ') || 'Inventario sin diferencias'}
                        </p>
                        {!!priorCount.difference && <p>Efectivo · {money(priorCount.difference)}</p>}
                      </div>
                    )}
                    {openingCount && (
                      <button
                        className="button primary"
                        onClick={() =>
                          setAction({
                            title: 'Aprobar conteo de apertura',
                            command: 'review_blind_opening',
                            fields: [
                              ...Object.entries(openingCount.items)
                                .filter(([key]) => !isLegacyCoolerArticle(key))
                                .map(([key, value]): Field => ({
                                  name: key,
                                  label: openingCount.itemLabels?.[key] ?? key,
                                  type: 'number',
                                  value: updatedOpeningItems.has(key) ? undefined : value,
                                  hint: updatedOpeningItems.has(key)
                                    ? `Inventario aprobado: ${liveBalances[key] ?? 0}`
                                    : undefined,
                                  min: 0,
                                  max: 1000000,
                                  step: '1',
                                  required: !updatedOpeningItems.has(key),
                                })),
                              { ...note, required: false },
                            ],
                            payload: { shiftId: shift.id, action: 'approve_count' },
                          })
                        }
                      >
                        Aprobar apertura y ajustar inventario
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={!!shift.reconcileClosingId}
                      onClick={() =>
                        void run('review_blind_opening', { shiftId: shift.id, action: 'authorize' })
                      }
                    >
                      Autorizar ventas · No mueve inventario ni plata
                    </button>
                    <button
                      className="button secondary"
                      disabled={!!shift.reconcileClosingId}
                      onClick={() =>
                        setAction({
                          title: 'Pedir arqueo antes de vender',
                          command: 'review_blind_opening',
                          fields: [
                            { name: 'all', label: 'Arqueo completo', type: 'checkbox' },
                            ...fieldsForAudit(),
                          ],
                          payload: { shiftId: shift.id, action: 'request_audit' },
                        })
                      }
                    >
                      Pedir arqueo de apertura · No mueve inventario ni plata
                    </button>
                  </>
                )}
                {openingReview === 'authorized' && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      setAction({
                        title: 'Revisar diferencia de apertura',
                        command: 'review_blind_opening',
                        fields: [note],
                        payload: { shiftId: shift.id, action: 'resolve' },
                      })
                    }
                  >
                    Cerrar revisión de apertura · No mueve inventario ni plata
                  </button>
                )}
                {legacyOpeningNeedsReview(state, shift) && (
                  <button
                    className="button secondary"
                    onClick={() => requestAction('Cerrar revisión de apertura', 'resolve_opening', [note])}
                  >
                    Cerrar revisión de apertura · No mueve inventario ni plata
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => requestAction('Pedir explicación', 'ask_explanation', [note])}
                >
                  Pedir explicación · No mueve inventario ni plata
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    requestAction('Marcar para revisar cámaras', 'camera', [
                      {
                        name: 'cameraAt',
                        label: 'Fecha y hora (Colombia)',
                        type: 'datetime-local',
                        required: true,
                      },
                      note,
                    ])
                  }
                >
                  Revisar cámaras · No mueve inventario ni plata
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    setAction({
                      title: 'Pedir arqueo para el siguiente turno',
                      command: 'start_audit',
                      fields: [],
                      payload: { when: 'next_opening', mode: 'full' },
                    })
                  }
                >
                  Pedir arqueo para el siguiente turno · No mueve inventario ni plata
                </button>
                <button className="button secondary" onClick={() => correction('open_bag')}>
                  Agregar bolsa abierta
                </button>
                <button className="button secondary" onClick={() => correction('open_package')}>
                  Agregar paquete abierto
                </button>
                {canReviewPayments &&
                  currentPayments(state.payments).some(
                    (item) => item.shiftId === shift.id && item.amount > 0,
                  ) && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        requestAction('Corregir medio de pago', 'correct_payment', [
                          {
                            name: 'paymentId',
                            label: 'Pago',
                            type: 'select',
                            required: true,
                            options: currentPayments(state.payments)
                              .filter((item) => item.shiftId === shift.id && item.amount > 0)
                              .map((item) => ({
                                value: item.id,
                                label: `#${orderName(item.orderId)} · ${money(item.amount)} · ${paymentMethod(item) === 'cash' ? 'Efectivo' : 'Transferencia'}`,
                              })),
                          },
                          {
                            name: 'method',
                            label: 'Medio correcto',
                            type: 'select',
                            required: true,
                            options: [
                              { value: 'cash', label: 'Efectivo' },
                              ...locations.map((item) => ({
                                value: `transfer:${item.id}`,
                                label: item.name,
                              })),
                            ],
                          },
                          note,
                        ])
                      }
                    >
                      Corregir medio de pago · Corrige el registro de plata
                    </button>
                  )}
                {!shift.closingFlow && shift.status === 'closed' && closingNeedsReview(state, shift) && (
                  <button
                    className="button primary"
                    onClick={() =>
                      requestAction('Cerrar diferencia', 'resolve', [
                        {
                          name: 'outcome',
                          label: 'Resultado',
                          type: 'select',
                          required: true,
                          options: [
                            { value: 'shortage', label: 'Faltante del negocio' },
                            { value: 'surplus', label: 'Sobrante del negocio' },
                            { value: 'matched', label: 'Coincidió tras la corrección' },
                          ],
                        },
                        note,
                      ])
                    }
                  >
                    Cerrar diferencia · No mueve inventario ni plata
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
      {approvalCount && (
        <ClosingApprovalDialog count={approvalCount} onClose={() => setApprovalCount(null)} />
      )}
      {reviewCount && <CountReviewDialog count={reviewCount} onClose={() => setReviewCount(null)} />}
      {action && (
        <Modal title={action.title} onClose={() => setAction(null)}>
          <FieldsForm
            fields={action.fields}
            onCancel={() => setAction(null)}
            onSubmit={async (values) => {
              const payload = { ...action.payload, ...values };
              if (typeof payload.method === 'string' && payload.method.startsWith('transfer:')) {
                payload.accountId = payload.method.slice('transfer:'.length);
                payload.method = 'transfer';
              }
              for (const key of ['openedAt', 'cameraAt'])
                if (typeof payload[key] === 'string') {
                  if (payload[key]) payload[key] = `${payload[key]}:00-05:00`;
                  else delete payload[key];
                }
              const result = await app.run(action.command, payload, { onlineOnly: true });
              app.toast(result.message);
              setAction(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function CountDetails({ count, original }: { count: Count; original: Count }) {
  const rows = Object.entries(count.items)
    .filter(([key]) => !isLegacyCoolerArticle(key))
    .map(([key, value]) => ({
      key,
      label: count.itemLabels?.[key] ?? key,
      counted: digits.format(value),
      expected: digits.format(count.expectedItems?.[key] ?? 0),
      delta: digits.format(count.differences?.[key] ?? 0),
      original: digits.format(original.differences?.[key] ?? 0),
    }));
  for (const key of Object.keys(count.paymentDifferences ?? {})) {
    const counted = count.payments?.[key];
    const expected = count.expectedPayments?.[key];
    rows.push({
      key,
      label: count.paymentLabels?.[key] ?? key,
      counted: counted === undefined ? '—' : money(counted),
      expected: expected === undefined ? '—' : money(expected),
      delta: money(count.paymentDifferences![key]),
      original: money(original.paymentDifferences?.[key] ?? 0),
    });
  }
  if (count.cash !== undefined)
    rows.unshift({
      key: 'cash',
      label: 'Efectivo',
      counted: money(count.cash),
      expected: money(count.expectedCash ?? 0),
      delta: money(count.difference ?? 0),
      original: money(original.difference ?? 0),
    });
  return (
    <details open>
      <summary>
        {{ opening: 'Apertura', closing: 'Cierre', audit: 'Arqueo', receipt: 'Recepción' }[count.kind]}
        {count.revisesId
          ? count.inventoryDifferences || count.paymentDifferences
            ? ' · Revisión'
            : ' · Corrección'
          : count.blindAttempt && ` · Conteo ${count.blindAttempt}`}{' '}
        · {date(count.at)}
      </summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Contado</th>
              <th>Esperado</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{row.counted}</td>
                <td>{row.expected}</td>
                <td>
                  {row.delta}
                  {row.delta !== row.original && <small> Inicial {row.original}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
