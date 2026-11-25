import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react';
import { isShiftCashier, shiftBlocksSales } from '../domain/access.ts';
import { cashExpected, locationBalance, openingExpectedCash, salesByMethod } from '../domain/engine.ts';
import type { CommandType, Transfer } from '../domain/types.ts';
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
import { EvidenceButton } from './EvidenceButton.tsx';

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
  const ownOptions = locations
    .filter((location) => location.custodianId === actor.id)
    .map(({ id, name }) => ({ value: id, label: name }));
  const ownNequi = nequi.filter((location) => location.custodianId === actor.id);
  const drawerOrigin =
    active &&
    isShiftCashier({ ...actor, online: app.online }, active) &&
    !shiftBlocksSales(active) &&
    !state.settings[0].auditId
      ? { value: `cash:${active.id}`, label: 'Caja del turno' }
      : undefined;
  const origins = [...(drawerOrigin ? [drawerOrigin] : []), ...ownOptions];
  const canExecute = (transfer: Transfer) => {
    if (transfer.status !== 'requested') return false;
    const ownsSource =
      drawerOrigin?.value === transfer.from || ownOptions.some((item) => item.value === transfer.from);
    if (transfer.type !== 'transfer')
      return (
        transfer.recipientId !== actor.id &&
        (transfer.from === 'treasury' ? ownOptions.length > 0 : ownsSource)
      );
    return (
      ownsSource &&
      locations.some((item) => item.id === transfer.to && item.custodianId === transfer.recipientId)
    );
  };
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
        evidenceId: shipment.evidenceId,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const [form, setForm] = useState<{
    title: string;
    fields: Field[];
    command: CommandType;
    extra?: Record<string, unknown>;
    newTransfer?: boolean;
  } | null>(null);
  const [movementDestination, setMovementDestination] = useState('');

  const newMovement = (withdrawal: boolean) => {
    setMovementDestination('');
    setForm({
      title: withdrawal ? 'Registrar retiro de Nequi' : 'Registrar movimiento de dinero',
      command: 'execute_transfer',
      newTransfer: true,
      fields: [
        {
          name: 'from',
          label: 'Origen',
          type: 'select',
          required: true,
          options: withdrawal ? ownNequi.map(({ id, name }) => ({ value: id, label: name })) : origins,
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
                    label="Ventas netas por transferencia en el turno"
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
              {!!ownNequi.length && !!physical.length && (
                <button className="button secondary" disabled={!app.online} onClick={() => newMovement(true)}>
                  Retiro de Nequi a efectivo
                </button>
              )}
              <button
                className="button secondary"
                disabled={!app.online || !locations.length || !origins.length}
                onClick={() => newMovement(false)}
              >
                <Plus size={16} />
                Nuevo movimiento
              </button>
              <button
                className="button secondary"
                disabled={!app.online || !locations.length}
                onClick={() =>
                  setForm({
                    title: 'Solicitar salida por utilidad',
                    command: 'request_transfer',
                    extra: { type: 'profit', from: 'treasury' },
                    fields: [
                      { name: 'to', label: 'Destino', type: 'select', required: true, options },
                      { name: 'amount', label: 'Monto', type: 'money', min: 1, required: true },
                      { name: 'notes', label: 'Concepto', type: 'textarea', required: true },
                    ],
                  })
                }
              >
                Solicitar utilidad
              </button>
            </div>
          )
        }
      >
        <p className="muted">
          Entre cuentas bajo tu custodia, el traslado queda confirmado al ejecutarlo. Si el destino pertenece
          a otro administrador, ese custodio confirma la recepción.
        </p>
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
                      <td>
                        {transfer.blindReceipt
                          ? 'Conteo a ciegas'
                          : money(
                              transfer.receiptCorrection
                                ? (transfer.receivedAmount ?? transfer.amount)
                                : transfer.amount,
                            )}
                        {transfer.receiptCorrection && (
                          <small>
                            Recepción corregida · Antes {money(transfer.receiptCorrection.previousAmount)}
                          </small>
                        )}
                      </td>
                      <td>
                        {transfer.status === 'requested' && <small>Solicitó: {byName(transfer.by)}</small>}
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
                          {transfer.status === 'in_transit' ? 'Ejecutado' : stateNames[transfer.status]}
                        </Badge>
                        {transfer.status === 'in_transit' && <small>Pendiente de recepción</small>}
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
                          {canExecute(transfer) && (
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
                                            options: ownOptions,
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
                              Registrar ejecución
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
            fields={
              form.newTransfer
                ? [
                    ...form.fields,
                    {
                      name: 'evidenceId',
                      label: 'Comprobante',
                      type: 'photo',
                      required: locations.some(
                        (item) => item.id === movementDestination && item.type === 'bank',
                      ),
                    },
                  ]
                : form.fields
            }
            submit={form.newTransfer ? 'Registrar movimiento' : 'Guardar'}
            onCancel={() => setForm(null)}
            onValuesChange={form.newTransfer ? (values) => setMovementDestination(values.to) : undefined}
            onSubmit={async (values) => {
              const result = await app.run(form.command, { ...form.extra, ...values }, { onlineOnly: true });
              app.toast(form.newTransfer ? result.message : 'Registro guardado.');
              setForm(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
