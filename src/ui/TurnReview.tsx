import { useState } from 'react';
import { businessDay } from '../domain/business-date.ts';
import { inRehearsalPeriod, rehearsalShift } from '../domain/closing-archive.ts';
import { blindCountArticles, currentPayments, paymentMethod } from '../domain/engine.ts';
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
import { Badge, Empty, FieldsForm, Modal, Panel, date, money, type Field } from './components.tsx';

type Action = { title: string; command: CommandType; fields: Field[]; payload?: Record<string, unknown> };
const note = { name: 'notes', label: 'Nota', type: 'textarea', required: true } as const;
const digits = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

export function TurnReview() {
  const app = useApp();
  const { state, profiles } = app.data!;
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [history, setHistory] = useState('pending');
  const [error, setError] = useState('');
  const cutoff = state.settings[0].rehearsalBaseline;
  const candidateAudits = state.counts.filter(
    (count) => count.kind === 'audit' && businessDay(count.cutoffAt ?? count.at) === '2026-11-18',
  );
  const pending = state.shifts.filter((shift) => reviewIsPending(state, shift));
  const rows = (
    history === 'pending'
      ? pending
      : state.shifts.filter((shift) =>
          history === 'rehearsal'
            ? rehearsalShift(state, shift)
            : !rehearsalShift(state, shift) && (shift.status === 'closed' || reviewIsPending(state, shift)),
        )
  ).sort((a, b) => (b.openedAt ?? b.requestedAt).localeCompare(a.openedAt ?? a.requestedAt));
  const shift = state.shifts.find((item) => item.id === selected);
  const archived = !!shift && (rehearsalShift(state, shift) || !!shift.closingArchive);
  const counts = shift ? reviewCounts(state, shift, archived || history === 'rehearsal') : [];
  const counted = counts.filter((count) => count.kind === 'closing' && !count.revisesId).at(-1);
  const explanations =
    shift && counted ? saleExplanations(state, reconciledCount(state, shift, counted)) : [];
  const sales = shift ? shiftSales(state, shift) : undefined;
  const openings = shift ? inventoryOpenings(state, shift) : [];
  const transfers = shift ? shiftTransfers(state, shift) : [];
  const orders = state.orders.filter((order) => order.shiftId === shift?.id);
  const orderName = (id: string) => orders.find((order) => order.id === id)?.number ?? id;
  const name = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? 'Usuario archivado';
  const locations = state.locations.filter(
    (item) => item.active && item.type === 'bank' && item.receivesSales,
  );
  const openingReview = shift?.blindOpening?.status;
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
      title: kind === 'open_bag' ? 'Proponer apertura de bolsa' : 'Proponer apertura de paquete',
      command: kind,
      payload: { shiftId: shift?.id, correction: true, confirmEmpty: true },
      fields: [
        {
          name: kind === 'open_bag' ? 'flavorId' : 'sizeId',
          label: kind === 'open_bag' ? 'Sabor' : 'Tamaño',
          type: 'select',
          required: true,
          options: (kind === 'open_bag' ? state.flavors : state.sizes.filter((size) => size.cups > 0)).map(
            (item) => ({ value: item.id, label: item.name }),
          ),
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
      <div className="page-toolbar">
        <div>
          <h2>Revisar turnos</h2>
          <p>Consulta conteos, verifica transferencias y resuelve diferencias de apertura y cierre.</p>
        </div>
        {!cutoff && candidateAudits.length > 0 && (
          <button
            className="button secondary"
            onClick={() =>
              setAction({
                command: 'archive_rehearsal',
                title: 'Archivar período de ensayo',
                fields: [
                  {
                    name: 'countId',
                    label: 'Arqueo de referencia del 18 de noviembre de 2026',
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
            Elegir arqueo de referencia
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
        {rows.length ? (
          <div className="requests-list">
            {rows.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{name(row.cashierId)}</strong>
                  <small>{date(row.openedAt ?? row.requestedAt)}</small>
                </div>
                <button className="button small secondary" onClick={() => setSelected(row.id)}>
                  Ver turno
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="Sin turnos en esta vista" />
        )}
      </Panel>
      {shift && (
        <Modal title={`Turno de ${name(shift.cashierId)}`} onClose={() => setSelected(null)}>
          <div className="detail-content turn-review">
            <p>
              {date(shift.openedAt ?? shift.requestedAt)}
              {archived && ' · Archivado'}
            </p>
            {counts.map((count) => (
              <CountDetails key={count.id} count={reconciledCount(state, shift, count)} original={count} />
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
                          <Badge tone="green">Verificada por {name(verified.by)}</Badge>
                        ) : (
                          <Badge tone="orange">Sin verificar</Badge>
                        )}{' '}
                        {!archived && !verified && (
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
                            Marcar verificada
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
                        orders.some((order) => order.id === request.referenceId))),
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
                      {!archived && request.status === 'pending' && payment && (
                        <button
                          className="button small secondary"
                          onClick={() => correctPayment(payment, request.id)}
                        >
                          Aplicar cambio
                        </button>
                      )}
                    </article>
                  );
                })}
            </details>
            <details open>
              <summary>Inventario y ventas del turno</summary>
              {state.flavors
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
                    <button
                      className="button primary"
                      onClick={() =>
                        void run('review_blind_opening', { shiftId: shift.id, action: 'authorize' })
                      }
                    >
                      Autorizar ventas
                    </button>
                    <button
                      className="button secondary"
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
                      Pedir arqueo de apertura
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
                    Cerrar revisión de apertura
                  </button>
                )}
                {legacyOpeningNeedsReview(state, shift) && (
                  <button
                    className="button secondary"
                    onClick={() => requestAction('Cerrar revisión de apertura', 'resolve_opening', [note])}
                  >
                    Cerrar revisión de apertura
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => requestAction('Pedir explicación', 'ask_explanation', [note])}
                >
                  Pedir explicación
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
                  Revisar cámaras
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    setAction({
                      title: 'Pedir arqueo para el siguiente turno',
                      command: 'start_audit',
                      fields: [
                        {
                          name: 'mode',
                          label: 'Alcance',
                          type: 'select',
                          value: 'full',
                          required: true,
                          options: [
                            { value: 'full', label: 'Completo' },
                            { value: 'custom', label: 'Artículos específicos' },
                          ],
                        },
                        ...fieldsForAudit(),
                      ],
                      payload: { when: 'next_opening' },
                    })
                  }
                >
                  Pedir arqueo para el siguiente turno
                </button>
                <button className="button secondary" onClick={() => correction('open_bag')}>
                  Corregir apertura de bolsa
                </button>
                <button className="button secondary" onClick={() => correction('open_package')}>
                  Corregir apertura de paquete
                </button>
                {currentPayments(state.payments).some(
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
                            ...locations.map((item) => ({ value: `transfer:${item.id}`, label: item.name })),
                          ],
                        },
                        note,
                      ])
                    }
                  >
                    Corregir medio de pago
                  </button>
                )}
                {shift.status === 'closed' && closingNeedsReview(state, shift) && (
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
                    Cerrar diferencia
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
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

export function CountDetails({ count, original }: { count: Count; original: Count }) {
  const rows = Object.entries(count.items).map(([key, value]) => ({
    key,
    label: count.itemLabels?.[key] ?? key,
    counted: digits.format(value),
    expected: digits.format(count.expectedItems?.[key] ?? 0),
    delta: digits.format(count.differences?.[key] ?? 0),
    original: digits.format(original.differences?.[key] ?? 0),
  }));
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
        {count.blindAttempt && ` · Conteo ${count.blindAttempt}`} · {date(count.at)}
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
