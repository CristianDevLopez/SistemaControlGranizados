import { useState } from 'react';
import { requestLabels } from '../domain/requests.ts';
import type { State } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { OwnClosing } from './OwnClosing.tsx';
import { Badge, Empty, FieldsForm, Modal, Panel, date, money, stateNames } from './components.tsx';

export function employeeRequestCount(state: State) {
  return (
    (state.shiftReviewPrompt?.length ?? 0) +
    (state.ownPaymentChanges?.filter((item) => item.status === 'pending').length ?? 0) +
    (state.ownRequests?.filter((item) => item.status === 'pending').length ?? 0) +
    (state.cashHandoffs?.filter((item) => ['requested', 'in_transit'].includes(item.status)).length ?? 0) +
    state.shifts.filter(
      (shift) =>
        shift.status === 'requested' ||
        shift.blindOpening?.status === 'audit' ||
        shift.closingReview?.status === 'pending' ||
        shift.closingReview?.status === 'returned' ||
        (!!shift.closingFlow?.responseDueAt && !shift.closingFlow.response),
    ).length +
    Number(!!state.settings[0].auditRequest)
  );
}

export function EmployeeRequests({ onShift }: { onShift: () => void }) {
  const app = useApp();
  const { state } = app.data!;
  const [prompt, setPrompt] = useState<NonNullable<typeof state.shiftReviewPrompt>[number]>();
  const submitted = [
    ...(state.ownPaymentChanges ?? []).map((item) => ({ ...item, type: 'payment_change' as const })),
    ...(state.ownRequests ?? []),
  ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const opening = state.shifts.find(
    (item) => item.status === 'requested' || item.blindOpening?.status === 'audit',
  );
  const audits = !!state.settings[0].auditRequest || opening?.blindOpening?.status === 'audit';
  const hasClosing = state.shifts.some(
    (item) =>
      item.closingReview?.status === 'pending' ||
      item.closingReview?.status === 'returned' ||
      item.closingFlow?.responseDueAt,
  );
  return (
    <div className="page-stack">
      {opening?.status === 'requested' && (
        <Panel title="Solicitud de apertura de turno">
          <p>Pendiente de autorización · {date(opening.requestedAt)}</p>
        </Panel>
      )}
      {audits && (
        <Panel title="Arqueo solicitado">
          <button className="button primary" onClick={onShift}>
            Ir a Mi turno para contar
          </button>
        </Panel>
      )}
      {!!state.cashHandoffs?.length && (
        <Panel title="Entregas de efectivo">
          {state.cashHandoffs.map((item) => (
            <p key={item.id}>
              {item.notes} · {money(item.amount)} · {stateNames[item.status]}
            </p>
          ))}
          <button className="button secondary" onClick={onShift}>
            Ver entregas en Mi turno
          </button>
        </Panel>
      )}
      {!!state.shiftReviewPrompt?.length && (
        <Panel title="Solicitudes de explicación">
          {state.shiftReviewPrompt.map((item) => (
            <div className="list-row" key={item.id}>
              <div>
                {item.notes}
                <small>{date(item.at)}</small>
              </div>
              <button className="button primary" disabled={!app.online} onClick={() => setPrompt(item)}>
                Responder
              </button>
            </div>
          ))}
        </Panel>
      )}
      <OwnClosing requestsOnly />
      <Panel title="Solicitudes enviadas">
        {submitted.length ? (
          <div className="requests-list">
            {submitted.map((item) => (
              <article className="request-card" key={item.id}>
                <Badge tone={item.status === 'pending' ? 'orange' : 'neutral'}>
                  {stateNames[item.status]}
                </Badge>
                <h3>{requestLabels[item.type]}</h3>
                {'orderNumber' in item && item.orderNumber && <p>Pedido #{item.orderNumber}</p>}
                <p>{item.notes}</p>
                {item.resolutionNotes && <p>{item.resolutionNotes}</p>}
                {item.at && <small>{date(item.at)}</small>}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={
              employeeRequestCount(state) || hasClosing
                ? 'Sin otras solicitudes enviadas'
                : 'Aún no tienes solicitudes'
            }
          />
        )}
      </Panel>
      {prompt && (
        <Modal title="Responder solicitud" onClose={() => setPrompt(undefined)}>
          <p>{prompt.notes}</p>
          <FieldsForm
            fields={[{ name: 'notes', label: 'Explicación', type: 'textarea', required: true }]}
            onCancel={() => setPrompt(undefined)}
            onSubmit={async ({ notes }) => {
              const result = await app.run(
                'answer_shift_review',
                { requestId: prompt.id, notes },
                { onlineOnly: true },
              );
              app.toast(result.message);
              setPrompt(undefined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
