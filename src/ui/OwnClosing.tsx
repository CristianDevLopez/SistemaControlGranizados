import { useState } from 'react';
import { businessDay } from '../domain/business-date.ts';
import { inRehearsalPeriod } from '../domain/closing-archive.ts';
import { closingNeedsRecount, countHasDifferences, paymentsByMethod } from '../domain/engine.ts';
import type { Count } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { FieldsForm, Modal, Panel, date, money, stateNames } from './components.tsx';

function differences(count: Count) {
  const label = (amount: number) => (amount < 0 ? 'Faltan' : 'Sobran');
  return (
    [
      ...(count.difference
        ? [`${label(count.difference)} ${money(Math.abs(count.difference))} en efectivo`]
        : []),
      ...Object.entries(count.differences ?? {})
        .filter(([, amount]) => amount !== 0)
        .map(([key, amount]) => `${label(amount)} ${Math.abs(amount)} · ${count.itemLabels?.[key] ?? key}`),
      ...Object.entries(count.paymentDifferences ?? {})
        .filter(([, amount]) => amount !== 0)
        .map(
          ([key, amount]) =>
            `${label(amount)} ${money(Math.abs(amount))} · ${count.paymentLabels?.[key] ?? 'Traslado o transferencia'}`,
        ),
    ].join(' · ') || 'Todo coincide'
  );
}

export function OwnClosing({ requestsOnly = false, day }: { requestsOnly?: boolean; day?: string } = {}) {
  const app = useApp();
  const { state, actor, profiles } = app.data!;
  const [editing, setEditing] = useState<string>();
  return state.shifts
    .filter(
      (shift) =>
        shift.cashierId === actor.id &&
        (!day ||
          shift.status === 'open' ||
          businessDay(shift.closedAt ?? shift.openedAt ?? shift.requestedAt) === day) &&
        (shift.blindOpening?.depth || shift.visibleClosing) &&
        !!shift.blindClosing &&
        !closingNeedsRecount(shift) &&
        (!requestsOnly ||
          shift.closingReview?.status === 'pending' ||
          shift.closingReview?.status === 'returned') &&
        !shift.closingArchive &&
        !inRehearsalPeriod(state, shift.closedAt ?? shift.requestedAt),
    )
    .slice()
    .reverse()
    .map((shift) => {
      const version = shift.closingFlow?.versions.at(-1);
      const count = state.counts.find(
        (item) =>
          item.id ===
          (shift.closingReview?.countId ?? version?.countId ?? shift.blindClosing?.countIds?.at(-1)),
      );
      if (!count) return null;
      const summary = state.ownTurnSummary?.find((item) => item.shiftId === shift.id);
      const recorded = actor.role === 'admin' ? paymentsByMethod(state, shift.id) : undefined;
      const totals =
        actor.role === 'admin'
          ? recorded!
          : { cash: summary?.payments[0]?.amount ?? 0, transfer: summary?.payments[1]?.amount ?? 0 };
      const transferAccounts =
        summary?.transferAccounts ??
        Object.entries(recorded?.byAccount ?? {}).map(([id, amount]) => ({
          name: state.locations.find((item) => item.id === id)?.name ?? 'Cuenta archivada',
          amount,
        }));
      const previous = state.transfers.find((item) => item.id === version?.transferId);
      const destinations =
        actor.role === 'admin'
          ? state.locations
              .filter(
                (location) =>
                  location.active &&
                  location.custodianId !== actor.id &&
                  profiles.some(
                    (person) =>
                      person.id === location.custodianId && person.active && person.role === 'admin',
                  ),
              )
              .map((location) => ({
                id: location.id,
                name: location.name,
                custodian: profiles.find((person) => person.id === location.custodianId)?.name,
              }))
          : (state.transferDestinations ?? []);
      const canEdit = shift.status === 'open' || !!shift.closingFlow?.returned;
      if (!canEdit && shift.closingReview?.status === 'approved') return null;
      return (
        <Panel key={shift.id} title={`Cierre · ${date(count.at)}`}>
          {canEdit && (
            <p className={countHasDifferences(count) ? 'notice danger' : 'notice success'} role="status">
              {countHasDifferences(count)
                ? 'Sigue sin cuadrar. Tu conteo ya se envió a los admins; espera su ayuda. Mientras tanto puedes hacer la entrega de efectivo.'
                : 'Tu conteo cuadra. Sigue con la entrega de efectivo.'}
            </p>
          )}
          <p>{differences(count)}</p>
          {shift.closingReview?.status === 'pending' && <p>Cierre pendiente de aprobación.</p>}
          {summary?.handoffs.map((item) => (
            <p key={item.id}>
              {item.destination}
              {item.custodian && ` · ${item.custodian}`} · {money(item.amount)} · {stateNames[item.status]}
            </p>
          ))}
          {shift.closingFlow?.returned && (
            <p className="notice warning">Tu cierre fue devuelto: {shift.closingFlow.returned.notes}</p>
          )}
          {shift.closingFlow?.response && <p>Respuesta registrada · {shift.closingFlow.response.notes}</p>}
          {canEdit && (
            <button className="button primary" disabled={!app.online} onClick={() => setEditing(shift.id)}>
              {shift.closingFlow?.returned ? 'Corregir y reenviar' : 'Repartir efectivo'}
            </button>
          )}
          {editing === shift.id && (
            <Modal title="Confirmar pagos y repartir efectivo" onClose={() => setEditing(undefined)}>
              <p>
                Efectivo registrado · {money(totals.cash)} · Transferencias registradas ·{' '}
                {money(totals.transfer)}
              </p>
              {transferAccounts.map((item, index) => (
                <p key={index}>
                  {item.name} · {money(item.amount)}
                </p>
              ))}
              <p>
                Efectivo contado · {money(count.cash ?? 0)} · Base máxima ·{' '}
                {money(state.settings[0].maxClosingBase ?? state.settings[0].cashLimit)}
              </p>
              <p>
                La base para el siguiente turno es{' '}
                {money(
                  Math.min(count.cash ?? 0, state.settings[0].maxClosingBase ?? state.settings[0].cashLimit),
                )}
                .
                {(count.cash ?? 0) > (state.settings[0].maxClosingBase ?? state.settings[0].cashLimit) &&
                  ` Debes enviar al menos ${money((count.cash ?? 0) - (state.settings[0].maxClosingBase ?? state.settings[0].cashLimit))}.`}
              </p>
              <FieldsForm
                fields={[
                  {
                    name: 'verified',
                    label: 'Confirmo ambos medios con los comprobantes del turno',
                    type: 'checkbox',
                    required: true,
                  },
                  { name: 'retained', label: 'Efectivo que dejas', type: 'money', min: 0, required: true },
                  { name: 'sent', label: 'Efectivo que envías', type: 'money', min: 0, required: true },
                  {
                    name: 'locationId',
                    label: 'Destino del traslado',
                    type: 'select',
                    options: [
                      { value: '', label: 'Sin traslado' },
                      ...destinations.map((item) => ({
                        value: item.id,
                        label: item.custodian ? `${item.name} · ${item.custodian}` : item.name,
                      })),
                    ],
                  },
                  ...(shift.closingFlow?.returned
                    ? [
                        ...Object.entries(count.items).map(([key, value]) => ({
                          name: key,
                          label: count.itemLabels?.[key] ?? key,
                          type: 'number' as const,
                          min: 0,
                          max: 1000000,
                          required: true,
                          value,
                        })),
                        {
                          name: 'notes',
                          label: 'Corrección realizada',
                          type: 'textarea' as const,
                          required: true,
                        },
                      ]
                    : []),
                ]}
                initial={{
                  retained: version?.retained,
                  sent: version?.sent ?? 0,
                  locationId:
                    previous?.to ??
                    summary?.handoffs.find((item) => item.id === version?.transferId)?.locationId ??
                    '',
                }}
                onCancel={() => setEditing(undefined)}
                submit="Enviar cierre"
                onSubmit={async (values) => {
                  const result = await app.run('submit_closing', {
                    ...values,
                    shiftId: shift.id,
                    countId: count.id,
                    cashTotal: totals.cash,
                    transferTotal: totals.transfer,
                    items: Object.fromEntries(
                      Object.keys(count.items)
                        .filter((key) => key in values)
                        .map((key) => [key, values[key]]),
                    ),
                  });
                  app.toast(result.message);
                  setEditing(undefined);
                }}
              />
            </Modal>
          )}
        </Panel>
      );
    });
}
