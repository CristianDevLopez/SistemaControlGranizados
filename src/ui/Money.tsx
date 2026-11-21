import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react';
import { cashExpected, locationBalance, openingExpectedCash, salesByMethod } from '../domain/engine.ts';
import type { CommandType } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import {
  Badge,
  Empty,
  FieldsForm,
  Modal,
  Panel,
  Stat,
  date,
  money,
  stateNames,
  type Field,
} from './components.tsx';
import { isNequiAccount, transferAccountName } from './payment-labels.ts';
import { EvidenceButton } from './Purchasing.tsx';

export function Money({ transferId }: { transferId?: string } = {}) {
  const app = useApp();
  const { actor, profiles, state } = app.data!;
  const transfers = state.transfers.filter((item) => !transferId || item.id === transferId);
  const active = state.shifts.find((shift) => shift.status === 'open');
  const sales = active ? salesByMethod(state, active.id) : undefined;
  const drawer = active ? cashExpected(state, active.id) : openingExpectedCash(state);
  const locations = state.locations.filter((location) => location.active);
  const nequi = locations.filter((location) => location.type === 'bank' && isNequiAccount(location));
  const physical = locations.filter((location) => location.type === 'treasury');
  const options = locations.map(({ id, name }) => ({ value: id, label: name }));
  const byName = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? 'Administrador';
  const locationName = (id: string) =>
    id.startsWith('cash:')
      ? 'Caja del turno'
      : id === 'treasury'
        ? 'Caja o cuenta del negocio'
        : id === 'personal'
          ? 'Bolsillo personal'
          : (state.locations.find((location) => location.id === id)?.name ?? 'Destino registrado');
  const nequiIds = new Set(
    state.locations
      .filter((location) => location.type === 'bank' && isNequiAccount(location))
      .map(({ id }) => id),
  );
  const cashIds = new Set(
    state.locations.filter((location) => location.type === 'treasury').map(({ id }) => id),
  );
  const profits = new Map<string, Map<string, number>>();
  for (const transfer of state.transfers) {
    if (transfer.type !== 'profit' || transfer.status !== 'confirmed') continue;
    const destinations = profits.get(transfer.recipientId) ?? new Map<string, number>();
    destinations.set(transfer.to, (destinations.get(transfer.to) ?? 0) + transfer.amount);
    profits.set(transfer.recipientId, destinations);
  }
  const paidPurchases = new Set(state.expenses.map((expense) => expense.shipmentId));
  const expenses = new Set(state.expenses.map((expense) => expense.id));
  const outlays = [
    ...state.expenses.map((expense) => ({
      ...expense,
      title: expense.shipmentId ? 'Compra de insumos' : expense.category,
      payer:
        expense.source === 'cash'
          ? 'Caja del turno'
          : expense.source === 'personal'
            ? `Bolsillo de ${byName(expense.by)}`
            : locationName(expense.locationId ?? 'treasury'),
    })),
    ...state.shipments
      .filter((shipment) => !expenses.has(shipment.expenseId ?? '') && !paidPurchases.has(shipment.id))
      .map((shipment) => ({
        id: shipment.id,
        at: shipment.at,
        title: 'Compra de insumos',
        amount: shipment.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0),
        supplier: shipment.supplier,
        payer: 'Pago sin registrar',
        status: undefined,
        evidenceId: undefined,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const [form, setForm] = useState<{
    title: string;
    fields: Field[];
    command: CommandType;
    extra?: Record<string, unknown>;
  } | null>(null);

  const newMovement = (withdrawal: boolean) => {
    setForm({
      title: withdrawal ? 'Registrar retiro de Nequi' : 'Solicitar movimiento de dinero',
      command: 'request_transfer',
      extra: { shiftId: active?.id },
      fields: [
        {
          name: 'from',
          label: 'Origen',
          type: 'select',
          required: true,
          options: withdrawal
            ? nequi.map(({ id, name }) => ({ value: id, label: name }))
            : [...(active ? [{ value: `cash:${active.id}`, label: 'Caja del turno' }] : []), ...options],
        },
        {
          name: 'to',
          label: withdrawal ? 'Destino en efectivo' : 'Destino registrado',
          type: 'select',
          required: true,
          options: withdrawal ? physical.map(({ id, name }) => ({ value: id, label: name })) : options,
        },
        { name: 'amount', label: 'Monto', type: 'money', min: 1, required: true },
        { name: 'notes', label: 'Concepto', type: 'textarea', required: true },
        ...(withdrawal
          ? []
          : [
              {
                name: 'type',
                label: 'Tipo',
                type: 'select' as const,
                value: 'transfer',
                options: [
                  { value: 'transfer', label: 'Traslado dentro del negocio' },
                  { value: 'profit', label: 'Salida por utilidad (requiere tres aprobaciones)' },
                ],
              },
            ]),
      ],
    });
  };

  return (
    <div className="page-stack">
      {!transferId && (
        <>
          <div className="page-toolbar">
            <h2>Dinero</h2>
          </div>
          <Panel title="Saldos por ubicación">
            {drawer === null && !state.locations.length ? (
              <Empty title="Sin saldos registrados" />
            ) : (
              <div className="stats-grid">
                {drawer !== null && (
                  <Stat
                    label="Efectivo del turno"
                    value={money(drawer)}
                    note={active ? 'Caja del turno · Según registros' : 'Último saldo físico registrado'}
                  />
                )}
                {state.locations.map((location) => (
                  <Stat
                    key={location.id}
                    label={`Saldo en ${location.type === 'bank' ? transferAccountName(location) : location.name}`}
                    value={money(locationBalance(state, location.id))}
                    note={`Custodia de ${byName(location.custodianId)}${location.active ? '' : ' · Inactiva'}`}
                  />
                ))}
                {sales && (
                  <Stat
                    label="Cobrado por transferencia en el turno"
                    value={money(sales.transfer)}
                    note={Object.entries(sales.byAccount)
                      .map(([id, amount]) => `${locationName(id)}: ${money(amount)}`)
                      .join(' · ')}
                  />
                )}
              </div>
            )}
          </Panel>
        </>
      )}
      <Panel
        title="Entregas, retiros y consignaciones"
        action={
          !transferId && (
            <div className="button-row">
              {!!nequi.length && !!physical.length && (
                <button className="button secondary" disabled={!app.online} onClick={() => newMovement(true)}>
                  Retiro de Nequi a efectivo
                </button>
              )}
              <button
                className="button secondary"
                disabled={!app.online || !locations.length}
                onClick={() => newMovement(false)}
              >
                <Plus size={16} />
                Nuevo movimiento
              </button>
            </div>
          )
        }
      >
        {transfers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Movimiento</th>
                  <th>Origen y destino</th>
                  <th>Monto</th>
                  <th>Responsables</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {transfers
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((transfer) => (
                    <tr key={transfer.id}>
                      <td>
                        <strong>
                          {transfer.type === 'reimbursement'
                            ? 'Reembolso'
                            : transfer.type === 'profit'
                              ? 'Utilidad'
                              : nequiIds.has(transfer.from) && cashIds.has(transfer.to)
                                ? 'Retiro de Nequi'
                                : 'Traslado'}
                        </strong>
                        <small>{date(transfer.at)}</small>
                        <small>{transfer.notes}</small>
                      </td>
                      <td>
                        {locationName(transfer.from)} → {locationName(transfer.to)}
                      </td>
                      <td>{transfer.blindReceipt ? 'Conteo a ciegas' : money(transfer.amount)}</td>
                      <td>
                        <small>Solicitó: {byName(transfer.by)}</small>
                        {transfer.executedBy && (
                          <small>Registró la entrega: {byName(transfer.executedBy)}</small>
                        )}
                        {transfer.status === 'in_transit' && (
                          <small>A cargo de {byName(transfer.executedBy ?? transfer.by)}</small>
                        )}
                        <small>
                          {transfer.confirmedBy ? 'Recibió' : 'Recibe'} {byName(transfer.recipientId)}
                        </small>
                        {transfer.cancellation && (
                          <small>Motivo de anulación: {transfer.cancellation.notes}</small>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            transfer.status === 'confirmed'
                              ? 'green'
                              : transfer.status === 'disputed'
                                ? 'red'
                                : 'orange'
                          }
                        >
                          {stateNames[transfer.status]}
                        </Badge>
                        {transfer.type !== 'transfer' && (
                          <small>{transfer.votes.length}/3 aprobaciones</small>
                        )}
                      </td>
                      <td>
                        <div className="table-actions">
                          {transfer.evidenceId && !transfer.blindReceipt && (
                            <EvidenceButton id={transfer.evidenceId} />
                          )}
                          {transfer.status === 'requested' &&
                            transfer.type !== 'transfer' &&
                            !transfer.votes.includes(actor.id) && (
                              <button
                                className="button small secondary"
                                disabled={!app.online}
                                onClick={() =>
                                  setForm({
                                    title: 'Aprobar salida',
                                    command: 'approve_payout',
                                    extra: { transferId: transfer.id },
                                    fields: [
                                      {
                                        name: 'evidenceId',
                                        label: 'Comprobante',
                                        type: 'photo',
                                        required: !transfer.evidenceId,
                                      },
                                    ],
                                  })
                                }
                              >
                                Aprobar
                              </button>
                            )}
                          {transfer.status === 'requested' && transfer.recipientId !== actor.id && (
                            <button
                              className="button small secondary"
                              disabled={
                                !app.online || (transfer.type !== 'transfer' && transfer.votes.length < 3)
                              }
                              onClick={() =>
                                setForm({
                                  title: 'Registrar entrega o consignación',
                                  command: 'execute_transfer',
                                  extra: { transferId: transfer.id },
                                  fields: [
                                    ...(transfer.from === 'treasury'
                                      ? [
                                          {
                                            name: 'from',
                                            label: 'Cuenta o caja que paga',
                                            type: 'select' as const,
                                            required: true,
                                            options,
                                          },
                                        ]
                                      : []),
                                    {
                                      name: 'evidenceId',
                                      label: 'Comprobante o evidencia',
                                      type: 'photo',
                                      required:
                                        state.locations.some(
                                          (location) =>
                                            location.id === transfer.to && location.type === 'bank',
                                        ) || transfer.type !== 'transfer',
                                    },
                                  ],
                                })
                              }
                            >
                              <ArrowUpRight size={15} />
                              Ejecutado
                            </button>
                          )}
                          {transfer.status === 'in_transit' &&
                            transfer.recipientId === actor.id &&
                            transfer.by !== actor.id &&
                            transfer.executedBy !== actor.id && (
                              <button
                                className="button small primary"
                                disabled={!app.online}
                                onClick={() =>
                                  setForm({
                                    title: 'Confirmar recepción',
                                    command: 'confirm_transfer',
                                    extra: { transferId: transfer.id },
                                    fields: [
                                      {
                                        name: 'receivedAmount',
                                        label: 'Monto recibido',
                                        type: 'money',
                                        min: 0,
                                        required: true,
                                      },
                                    ],
                                  })
                                }
                              >
                                <ArrowDownLeft size={15} />
                                Confirmar
                              </button>
                            )}
                          {transfer.type === 'transfer' &&
                            (transfer.status === 'requested' ||
                              (transfer.status === 'in_transit' &&
                                (!transfer.from.startsWith('cash:') ||
                                  transfer.from === `cash:${active?.id}`))) && (
                              <button
                                className="button small secondary"
                                disabled={!app.online}
                                onClick={() =>
                                  setForm({
                                    title: 'Anular traslado',
                                    command: 'cancel_transfer',
                                    extra: { transferId: transfer.id },
                                    fields: [
                                      ...(transfer.status === 'in_transit'
                                        ? [
                                            {
                                              name: 'cashRestored',
                                              label:
                                                'Confirmo que el dinero sigue en el origen o ya fue devuelto',
                                              type: 'checkbox' as const,
                                              required: true,
                                            },
                                          ]
                                        : []),
                                      {
                                        name: 'notes',
                                        label: 'Motivo de la anulación',
                                        type: 'textarea',
                                        required: true,
                                      },
                                    ],
                                  })
                                }
                              >
                                Anular
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sin movimientos registrados" />
        )}
      </Panel>
      {!transferId && (
        <>
          <Panel title="Origen de compras y gastos">
            {outlays.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Pagado con</th>
                      <th>Valor</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outlays.map((outlay) => (
                      <tr key={outlay.id}>
                        <td>
                          <strong>
                            {outlay.title} · {outlay.supplier}
                          </strong>
                          <small>{date(outlay.at)}</small>
                        </td>
                        <td>{outlay.payer}</td>
                        <td>{money(outlay.amount)}</td>
                        <td>
                          {outlay.status && stateNames[outlay.status]}
                          {outlay.evidenceId && <EvidenceButton id={outlay.evidenceId} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Sin compras ni gastos registrados" />
            )}
          </Panel>
          <Panel title="Utilidades retiradas por socio">
            {profits.size ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Socio</th>
                      <th>Total recibido</th>
                      <th>Destino de los retiros confirmados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...profits].map(([beneficiary, destinations]) => (
                      <tr key={beneficiary}>
                        <td>{byName(beneficiary)}</td>
                        <td>{money([...destinations.values()].reduce((sum, amount) => sum + amount, 0))}</td>
                        <td>
                          {[...destinations].map(([destination, amount]) => (
                            <small key={destination}>
                              {locationName(destination)} · {money(amount)}
                            </small>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Sin retiros de utilidad confirmados" />
            )}
          </Panel>
        </>
      )}
      {form && (
        <Modal title={form.title} onClose={() => setForm(null)}>
          <FieldsForm
            fields={form.fields}
            onCancel={() => setForm(null)}
            onSubmit={async (values) => {
              await app.run(form.command, { ...form.extra, ...values }, { onlineOnly: true });
              app.toast('Registro guardado.');
              setForm(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
