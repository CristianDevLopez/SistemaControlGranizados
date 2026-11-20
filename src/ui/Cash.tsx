import { useRef, useState } from 'react';
import { Plus, ClipboardCheck, ShieldCheck, Wallet } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { parseMoney } from '../lib/money.ts';
import { api } from '../lib/api.ts';
import {
  blindCountArticles,
  countArticles,
  countPaymentMethods,
  cashExpected,
  salesByMethod,
} from '../domain/engine.ts';
import { hasPermission, isShiftCashier, shiftBlocksSales } from '../domain/access.ts';
import { closingArchive, inRehearsalPeriod, visibleCounts } from '../domain/closing-archive.ts';
import { transferAccountName } from './payment-labels.ts';
import type { ClosingPreview, CommandType, Count, Shift } from '../domain/types.ts';
import { AuditSetupDialog, CountReviewDialog, auditModeLabels } from './CashAudit.tsx';
import { ClosingComparison, closingHasDifferences, type ClosingValues } from './ClosingReview.tsx';
import {
  Badge,
  Empty,
  FieldsForm,
  Modal,
  MoneyInput,
  Panel,
  Stat,
  date,
  money,
  stateNames,
  type Field,
} from './components.tsx';
export function CountDialog({
  kind,
  shift,
  onClose,
}: {
  kind: 'opening' | 'closing' | 'audit';
  shift: Shift;
  onClose: () => void;
}) {
  const app = useApp(),
    { state, actor } = app.data!;
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [skip, setSkip] = useState(false),
    [draft, setDraft] = useState<ClosingValues | null>(null),
    [preview, setPreview] = useState<ClosingPreview | null>(null);
  const changes = useRef(0);
  const differences = !!draft && !!preview && closingHasDifferences(draft, preview);
  const list = countArticles(state, kind);
  const paymentMethods = countPaymentMethods(state, shift.id, kind);
  const request = kind === 'audit' ? state.settings[0].auditRequest : undefined;
  const openingAudit = request?.opening === true;
  const countsCash = request?.cash ?? true;
  const checklist =
    kind === 'audit' && !openingAudit
      ? []
      : ((kind === 'closing' ? state.settings[0].closingChecklist : state.settings[0].openingChecklist) ??
        []);
  return (
    <Modal
      title={
        openingAudit
          ? 'Arqueo de apertura'
          : kind === 'opening'
            ? 'Conteo de apertura'
            : kind === 'closing'
              ? 'Cierre de caja'
              : 'Arqueo sorpresa'
      }
      onClose={onClose}
    >
      <p className="modal-intro">
        {kind === 'closing'
          ? 'Ingresa el conteo y revisa la comparación antes de enviarlo al administrador.'
          : 'Cuenta antes de ver lo esperado. Se conservará este registro original y cualquier revisión posterior.'}
        {kind === 'closing' &&
          ' Verifica los cobros del turno por cada cuenta, no el saldo total de la cuenta. Cuenta solo los vasos restantes del paquete abierto de cada tamaño; si no hay vasos sueltos, registra 0.'}
      </p>
      <form
        className="fields-form"
        onChange={(e) => {
          if ((e.target as unknown as HTMLInputElement).name === 'confirmDifferences') return;
          changes.current++;
          setDraft(null);
          setPreview(null);
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const form = new FormData(e.currentTarget);
          try {
            const items = Object.fromEntries(list.map((x) => [x.id, Number(form.get(x.id))]));
            if (kind === 'closing' && !draft) {
              const values = {
                cash: parseMoney(form.get('cash')) ?? 0,
                items,
                payments: Object.fromEntries(
                  paymentMethods.map(({ id }) => [id, parseMoney(form.get(id), true) ?? 0]),
                ),
              };
              const version = changes.current;
              if (app.online) {
                await app.sync();
                const expected = await api<ClosingPreview>('closing-preview', { shiftId: shift.id });
                if (changes.current !== version) return;
                setPreview(expected);
              }
              setDraft(values);
              return;
            }
            await app.run(kind === 'audit' ? 'finish_audit' : 'count', {
              kind,
              shiftId: shift.id,
              ...(kind === 'audit' ? { auditId: state.settings[0].auditId } : {}),
              cash: skip || !countsCash ? undefined : parseMoney(form.get('cash')),
              items,
              ...(kind === 'closing' || kind === 'audit'
                ? {
                    payments: Object.fromEntries(
                      paymentMethods.map(({ id }) => [id, parseMoney(form.get(id), true)]),
                    ),
                  }
                : {}),
              skip,
              retained: parseMoney(form.get('retained')) ?? 0,
              locationId: form.get('locationId') || undefined,
              notes: form.get('notes'),
              checklist: Object.fromEntries(
                checklist.map((_, index) => [index, form.get(`check:${index}`) === 'on']),
              ),
              ...(kind === 'closing' && preview ? { preview } : {}),
            });
            app.toast(
              kind === 'closing'
                ? 'Cuadre enviado. Pendiente de aprobación administrativa.'
                : 'Conteo registrado. Las diferencias quedan para revisión.',
            );
            onClose();
          } catch (e) {
            setError((e as Error).message);
            setDraft(null);
            setPreview(null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {checklist.map((task, index) => (
          <label className="check-inline" key={index}>
            <input name={`check:${index}`} type="checkbox" required={!skip} />
            {task}
          </label>
        ))}
        {kind === 'opening' && state.settings[0].skipOpeningCount && (
          <label className="check-inline">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            Omitir por contingencia y dejar pendiente
          </label>
        )}
        {!skip && (
          <>
            {countsCash && (
              <label className="field">
                <span>Efectivo contado *</span>
                <MoneyInput name="cash" required placeholder="Cuenta el efectivo real" />
              </label>
            )}
            {paymentMethods.map(({ id, account }) => {
              const label = `${openingAudit ? 'Saldo de apertura' : 'Transferencias verificadas'} · ${transferAccountName(account)} *`;
              return (
                <label className="field" key={id}>
                  <span>{label}</span>
                  <MoneyInput name={id} ariaLabel={label} required allowNegative />
                  <small>
                    {openingAudit
                      ? 'Verifica el saldo de la cuenta al abrir la caja.'
                      : 'Resta las devoluciones a los cobros del turno en esta cuenta. Si no hubo movimientos, registra 0.'}
                  </small>
                </label>
              );
            })}
            <div className="count-list">
              {list.map((x) => (
                <label key={x.id}>
                  <span>
                    {x.name}
                    <small>{kind === 'closing' ? 'unidades restantes del paquete abierto' : x.unit}</small>
                  </span>
                  <input
                    aria-label={x.name}
                    name={x.id}
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    required
                    placeholder="Contado"
                  />
                </label>
              ))}
            </div>
          </>
        )}
        {kind === 'closing' && (
          <>
            <label className="field">
              <span>Efectivo reservado para la siguiente apertura *</span>
              <MoneyInput name="retained" required />
              <small>
                El remanente se solicita entregar o consignar. Solicitarlo no confirma que haya salido.
              </small>
            </label>
            <label className="field">
              <span>Destino del remanente</span>
              <select name="locationId">
                <option value="">Seleccionar si hay remanente…</option>
                {state.locations
                  .filter((x) => x.active && x.custodianId !== actor.id)
                  .map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name} · {x.type === 'bank' ? 'Consignación' : 'Efectivo'}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <label className="field">
          <span>Novedades</span>
          <textarea name="notes" maxLength={1500} placeholder="Explica cualquier contingencia del conteo" />
        </label>
        {draft && kind === 'closing' && (
          <div className="closing-review wide">
            <h3>Revisión previa del cuadre</h3>
            {preview ? (
              <>
                <ClosingComparison
                  values={draft}
                  preview={preview}
                  labels={Object.fromEntries(list.map((a) => [a.id, a.name]))}
                />
                <p>
                  {differences
                    ? 'Revisa los valores y corrige los campos si hace falta. Puedes enviarlo provisionalmente si las diferencias continúan.'
                    : 'Todo coincide. El administrador debe verificar y aprobar el cierre.'}
                </p>
              </>
            ) : (
              <p className="notice warning">
                Sin conexión: no se pueden verificar los saldos del sistema. El cierre será provisional y se
                revisará al sincronizar.
              </p>
            )}
            {(differences || !preview) && (
              <label className="check-inline">
                <input type="checkbox" name="confirmDifferences" required />
                Revisé el conteo y deseo enviarlo provisionalmente al administrador
              </label>
            )}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            {busy
              ? 'Procesando…'
              : kind !== 'closing'
                ? 'Registrar conteo'
                : !draft
                  ? 'Revisar cuadre'
                  : differences || !preview
                    ? 'Enviar provisional a revisión'
                    : 'Enviar cuadre a revisión'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
type EmployeeCountKind = 'opening' | 'closing' | 'opening_audit' | 'audit';

function BlindCountDialog({
  kind,
  shift,
  onClose,
}: {
  kind: EmployeeCountKind;
  shift: Shift;
  onClose: () => void;
}) {
  const app = useApp();
  const { state } = app.data!;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request =
    kind === 'opening_audit'
      ? shift.blindOpening?.audit
      : kind === 'audit'
        ? state.settings[0].auditRequest
        : null;
  const list = blindCountArticles(state).filter((a) => !request || request.items.includes(a.id));
  const cash = request?.cash !== false || (kind === 'audit' && !list.length);
  const attempt =
    (kind === 'opening' && shift.blindOpening?.status === 'recount') ||
    (kind === 'closing' && shift.blindClosing?.status === 'recount')
      ? 2
      : 1;
  const title =
    kind === 'opening_audit' || (kind === 'audit' && state.settings[0].auditRequest?.opening)
      ? 'Arqueo de apertura'
      : kind === 'audit'
        ? 'Arqueo sorpresa'
        : kind === 'opening'
          ? 'Conteo de apertura'
          : 'Conteo de cierre';
  const checklist =
    kind === 'audit' && state.settings[0].auditRequest?.opening && !shift.openingCountId
      ? (state.settings[0].openingChecklist ?? [])
      : [];
  return (
    <Modal title={attempt === 2 ? `${title} · Recuento` : title} onClose={onClose}>
      <form
        className="fields-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          const data = new FormData(event.currentTarget);
          const payload = {
            shiftId: shift.id,
            cash: cash ? parseMoney(data.get('cash')) : undefined,
            items: Object.fromEntries(list.map((a) => [a.id, Number(data.get(a.id))])),
          };
          try {
            const result = await app.run(
              kind === 'opening_audit'
                ? 'submit_blind_opening_audit'
                : kind === 'audit'
                  ? 'finish_audit'
                  : 'submit_blind_count',
              {
                ...payload,
                ...(kind === 'opening_audit'
                  ? { auditId: request?.id }
                  : kind === 'audit'
                    ? {
                        auditId: state.settings[0].auditId,
                        checklist: Object.fromEntries(
                          checklist.map((_, index) => [index, data.get(`check:${index}`) === 'on']),
                        ),
                      }
                    : { kind, attempt }),
              },
              { onlineOnly: true },
            );
            app.toast(kind === 'audit' ? 'Arqueo registrado.' : result.message);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {checklist.map((task, index) => (
          <label className="check-inline" key={index}>
            <input name={`check:${index}`} type="checkbox" required />
            {task}
          </label>
        ))}
        {cash && (
          <label className="field">
            <span>Efectivo contado *</span>
            <MoneyInput name="cash" required />
          </label>
        )}
        <div className="count-list">
          {list.map((article) => (
            <label key={article.id}>
              <span>
                {article.name}
                <small>
                  {article.id.startsWith('cup:')
                    ? 'Vasos sueltos del paquete abierto'
                    : article.id.startsWith('package:')
                      ? 'Paquetes cerrados'
                      : article.id.startsWith('sealed_bag:')
                        ? 'Bolsas selladas'
                        : article.unit}
                </small>
              </span>
              <input
                aria-label={article.name}
                name={article.id}
                type="number"
                min="0"
                max="1000000"
                step="1"
                inputMode="numeric"
                required
              />
            </label>
          ))}
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy || !app.online}>
            {busy ? 'Enviando…' : 'Enviar conteo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function employeeShiftStatus(shift: Shift) {
  const opening = shift.blindOpening?.status;
  if (
    opening === 'review' ||
    opening === 'audit' ||
    opening === 'authorized' ||
    (shift.closingReview?.status !== 'approved' &&
      (shift.blindClosing?.status === 'review' || shift.closingReview?.status === 'pending'))
  )
    return 'En revisión';
  if (opening === 'reviewed' || shift.closingReview?.status === 'approved') return 'Revisado';
  if (shift.blindClosing?.status === 'matched' || opening === 'matched') return 'Coincidió';
  return shift.status === 'closed' || shift.status === 'provisional' ? 'En revisión' : undefined;
}

function EmployeeCash() {
  const app = useApp();
  const { state, actor } = app.data!;
  const shifts = state.shifts.filter((s) => s.cashierId === actor.id);
  const active = shifts.find((s) => ['open', 'requested', 'provisional'].includes(s.status));
  const opening = active?.blindOpening?.status;
  const recount = active?.blindClosing?.status === 'recount';
  const auditId = state.settings[0].auditId;
  const owns = hasPermission(actor, 'shifts') && isShiftCashier(actor, active);
  const canStart = actor.primary && actor.role !== 'apoyo' && hasPermission(actor, 'shifts');
  const [count, setCount] = useState<EmployeeCountKind | null>(null);
  const [prompt, setPrompt] = useState<NonNullable<typeof state.shiftReviewPrompt>[number] | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [handoff, setHandoff] = useState<'request' | string | null>(null);
  const destinations = state.transferDestinations ?? [];
  const pendingHandoff = state.cashHandoffs?.find((item) => item.id === handoff);
  const canHandoff =
    active?.status === 'open' &&
    isShiftCashier(actor, active) &&
    hasPermission(actor, 'transfers') &&
    !shiftBlocksSales(active) &&
    !auditId;
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <h2>Turno</h2>
        {!active && canStart && (
          <button
            className="button primary"
            disabled={starting || !app.online}
            onClick={async () => {
              setStarting(true);
              setError('');
              try {
                await app.run('request_shift', {}, { onlineOnly: true });
                setCount('opening');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setStarting(false);
              }
            }}
          >
            <Plus size={17} />
            {starting ? 'Iniciando…' : 'Abrir turno'}
          </button>
        )}
      </div>
      {!app.online && canStart && (
        <div className="notice info">Conéctate para abrir, contar o cerrar el turno.</div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {active && (
        <Panel title="Turno actual">
          <div className="shift-summary">
            <div className="large-icon">
              <Wallet size={26} />
            </div>
            <div>
              <h3>{actor.name}</h3>
              <p>{date(active.openedAt ?? active.requestedAt)}</p>
            </div>
            <Badge
              tone={active.status === 'open' && !shiftBlocksSales(active) && !auditId ? 'green' : 'orange'}
            >
              {opening === 'review'
                ? 'En revisión'
                : shiftBlocksSales(active) || auditId
                  ? 'Conteo pendiente'
                  : stateNames[active.status]}
            </Badge>
          </div>
          {opening === 'review' && (
            <p className="notice warning">
              Las ventas están en pausa mientras un administrador revisa la apertura.
            </p>
          )}
          {active.status === 'open' && owns && (
            <div className="button-row">
              {opening === 'audit' ? (
                <button
                  className="button primary"
                  disabled={!app.online}
                  onClick={() => setCount('opening_audit')}
                >
                  Presentar arqueo de apertura
                </button>
              ) : auditId ? (
                <button className="button primary" disabled={!app.online} onClick={() => setCount('audit')}>
                  Presentar arqueo
                </button>
              ) : (
                <>
                  {(opening === 'pending' ||
                    opening === 'recount' ||
                    (!opening && !active.openingCountId && !recount)) && (
                    <button
                      className="button primary"
                      disabled={!app.online}
                      onClick={() => setCount('opening')}
                    >
                      {opening === 'recount' ? 'Volver a contar la apertura' : 'Contar apertura'}
                    </button>
                  )}
                  {(!shiftBlocksSales(active) || recount) && (
                    <button
                      className="button primary"
                      disabled={!app.online}
                      onClick={() => setCount('closing')}
                    >
                      {recount ? 'Volver a contar el cierre' : 'Cerrar turno'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </Panel>
      )}
      {active?.status === 'open' && (
        <Panel title="Transferencias registradas">
          {state.transferSummary?.length ? (
            <div className="stats-grid">
              {state.transferSummary.map(({ name, amount }, index) => (
                <Stat key={index} label={name} value={money(amount)} />
              ))}
            </div>
          ) : (
            <Empty title="Sin transferencias en este turno" />
          )}
        </Panel>
      )}
      {canHandoff && (destinations.length > 0 || !!state.cashHandoffs?.length) && (
        <Panel
          title="Entregas de efectivo desde caja"
          action={
            destinations.length > 0 && (
              <button
                className="button small secondary"
                disabled={!app.online}
                onClick={() => setHandoff('request')}
              >
                Solicitar traslado
              </button>
            )
          }
        >
          {state.cashHandoffs?.map((item) => (
            <div className="notice info" key={item.id}>
              <span>
                {destinations.find((destination) => destination.id === item.to)?.name ?? 'Destino registrado'}{' '}
                · {money(item.amount)} · {stateNames[item.status]}
              </span>
              {item.status === 'requested' && (
                <button
                  className="button small secondary"
                  disabled={!app.online}
                  onClick={() => setHandoff(item.id)}
                >
                  Registrar entrega
                </button>
              )}
            </div>
          ))}
        </Panel>
      )}
      {handoff && canHandoff && (
        <Modal
          title={handoff === 'request' ? 'Solicitar traslado desde caja' : 'Registrar entrega de efectivo'}
          onClose={() => setHandoff(null)}
        >
          <FieldsForm
            fields={
              handoff === 'request'
                ? [
                    {
                      name: 'to',
                      label: 'Destino',
                      type: 'select',
                      required: true,
                      options: destinations.map(({ id, name }) => ({ value: id, label: name })),
                    },
                    { name: 'amount', label: 'Monto', type: 'money', required: true },
                    { name: 'notes', label: 'Concepto', required: true },
                  ]
                : [
                    {
                      name: 'delivered',
                      label: 'Confirmo que entregué el efectivo',
                      type: 'checkbox',
                      required: true,
                    },
                    {
                      name: 'evidenceId',
                      label: 'Comprobante',
                      type: 'photo',
                      required: destinations.some(
                        (item) => item.id === pendingHandoff?.to && item.needsEvidence,
                      ),
                    },
                  ]
            }
            onCancel={() => setHandoff(null)}
            onSubmit={async (values) => {
              const result =
                handoff === 'request'
                  ? await app.run('request_transfer', { ...values, shiftId: active.id })
                  : await app.run('execute_transfer', { transferId: handoff, evidenceId: values.evidenceId });
              app.toast(result.message);
              setHandoff(null);
            }}
          />
        </Modal>
      )}
      {!!state.shiftReviewPrompt?.length && (
        <Panel title="Solicitudes de explicación">
          {state.shiftReviewPrompt.map((request) => (
            <div className="notice info" key={request.id}>
              <span>
                {request.notes} · {date(request.at)}
              </span>
              <button className="button secondary" disabled={!app.online} onClick={() => setPrompt(request)}>
                Responder
              </button>
            </div>
          ))}
        </Panel>
      )}
      <Panel title="Mis turnos">
        {shifts.some(employeeShiftStatus) ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Inicio</th>
                  <th>Cierre</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {[...shifts]
                  .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
                  .map((shift) => {
                    const status = employeeShiftStatus(shift);
                    return status ? (
                      <tr key={shift.id}>
                        <td>{date(shift.openedAt ?? shift.requestedAt)}</td>
                        <td>{date(shift.closedAt)}</td>
                        <td>{status}</td>
                      </tr>
                    ) : null;
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Aún no hay turnos en tu historial" />
        )}
      </Panel>
      {count && active?.status === 'open' && owns && (
        <BlindCountDialog
          key={`${count}:${opening}:${active.blindClosing?.status}`}
          kind={count}
          shift={active}
          onClose={() => setCount(null)}
        />
      )}
      {prompt && (
        <Modal title="Responder solicitud" onClose={() => setPrompt(null)}>
          <p>{prompt.notes}</p>
          <FieldsForm
            fields={[{ name: 'notes', label: 'Explicación', type: 'textarea', required: true }]}
            onCancel={() => setPrompt(null)}
            onSubmit={async ({ notes }) => {
              await app.run('answer_shift_review', { requestId: prompt.id, notes }, { onlineOnly: true });
              app.toast('Explicación enviada.');
              setPrompt(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

export function Cash() {
  const { actor } = useApp().data!;
  return actor.role === 'admin' ? <AdminCash /> : <EmployeeCash />;
}

function AdminCash() {
  const app = useApp(),
    { state, actor, profiles } = app.data!;
  const active = state.shifts.find((x) => ['open', 'requested', 'provisional'].includes(x.status)),
    admin = actor.role === 'admin',
    owns = hasPermission(actor, 'shifts') && isShiftCashier({ ...actor, online: app.online }, active),
    directOpening = admin && app.online;
  const { auditId, auditRequest, nextOpeningAudit } = state.settings[0];
  const openingAudit = auditRequest?.opening === true;
  const sales = admin && active?.status === 'open' ? salesByMethod(state, active.id) : undefined;
  const [count, setCount] = useState<'opening' | 'closing' | 'audit' | null>(null),
    [auditSetup, setAuditSetup] = useState<'current' | 'next_opening' | null>(null),
    [reviewCount, setReviewCount] = useState<Count | null>(null),
    [showArchived, setShowArchived] = useState(false),
    [form, setForm] = useState<{
      title: string;
      fields: Field[];
      type: CommandType;
      extra?: Record<string, unknown>;
    } | null>(null),
    [error, setError] = useState('');
  const act = async (type: CommandType, payload: Record<string, unknown> = {}) => {
    try {
      await app.run(type, payload);
      app.toast('Registro guardado.');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const counts = visibleCounts(state, showArchived);
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>Turno y efectivo</h2>
          <p>Una caja, un responsable y cada entrega confirmada.</p>
        </div>
        {!active && (admin || (actor.primary && actor.role !== 'apoyo')) && (
          <button
            className="button primary"
            disabled={!hasPermission(actor, 'shifts') || (admin && !app.online && !actor.primary)}
            onClick={() =>
              directOpening
                ? setForm({
                    title: 'Iniciar caja',
                    type: 'request_shift',
                    fields: [
                      {
                        name: 'base',
                        label: 'Base inicial (se utilizará el saldo físico anterior cuando exista)',
                        type: 'money',
                        value: 0,
                        min: 0,
                        required: true,
                      },
                    ],
                  })
                : void act('request_shift')
            }
          >
            <Plus size={17} />
            {directOpening || (admin && !actor.primary) ? 'Iniciar caja' : 'Solicitar turno'}
          </button>
        )}
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <Panel
        title="Turno actual"
        action={
          admin && (
            <button
              className="button secondary"
              disabled={!app.online}
              onClick={() => setAuditSetup('next_opening')}
            >
              {nextOpeningAudit ? 'Editar arqueo de apertura' : 'Programar arqueo de apertura'}
            </button>
          )
        }
      >
        {admin && nextOpeningAudit && (
          <p className="notice info">
            Próxima apertura · Arqueo {auditModeLabels[nextOpeningAudit.mode].toLowerCase()}
          </p>
        )}
        {active ? (
          <>
            <div className="shift-summary">
              <div className="large-icon">
                <Wallet size={26} />
              </div>
              <div>
                <h3>{profiles.find((x) => x.id === active.cashierId)?.name}</h3>
                <p>{date(active.openedAt ?? active.requestedAt)}</p>
              </div>
              <Badge tone={active.status === 'open' ? 'green' : 'orange'}>{stateNames[active.status]}</Badge>
            </div>
            <div className="button-row">
              {active.status === 'requested' && admin && (
                <button
                  className="button primary"
                  onClick={() =>
                    setForm({
                      title: 'Autorizar turno',
                      type: 'authorize_shift',
                      extra: { shiftId: active.id },
                      fields: [
                        {
                          name: 'base',
                          label: 'Base inicial (se utilizará el saldo físico anterior cuando exista)',
                          type: 'money',
                          value: 0,
                          min: 0,
                          required: true,
                        },
                      ],
                    })
                  }
                >
                  <ShieldCheck size={17} />
                  Autorizar apertura
                </button>
              )}
              {active.status === 'requested' && !app.online && owns && <OfflineOpening shiftId={active.id} />}
              {active.status === 'open' && owns && !auditId && (
                <>
                  {!active.openingCountId && (
                    <button className="button secondary" onClick={() => setCount('opening')}>
                      <ClipboardCheck size={17} />
                      Contar apertura
                    </button>
                  )}
                  <button className="button primary" onClick={() => setCount('closing')}>
                    Cerrar y contar caja
                  </button>
                </>
              )}
              {active.status === 'open' && admin && !auditId && !shiftBlocksSales(active) && (
                <button
                  className="button secondary"
                  disabled={!app.online}
                  onClick={() => setAuditSetup('current')}
                >
                  <ClipboardCheck size={17} />
                  Iniciar arqueo sorpresa
                </button>
              )}
              {auditId && owns && (
                <button className="button primary" disabled={!app.online} onClick={() => setCount('audit')}>
                  {openingAudit ? 'Presentar arqueo de apertura' : 'Presentar arqueo y reanudar'}
                </button>
              )}
            </div>
            {auditId && (
              <div className="notice warning">
                {openingAudit ? 'Arqueo de apertura pendiente.' : 'Arqueo sorpresa en curso.'}{' '}
                {owns
                  ? 'Ingresa los conteos solicitados por el administrador.'
                  : 'El responsable del turno debe presentar el conteo solicitado.'}
              </div>
            )}
            {active.status === 'open' && !active.openingCountId && !openingAudit && (
              <div className="notice warning">Conteo de apertura pendiente.</div>
            )}
            {sales && (
              <>
                <div className="stats-grid">
                  <Stat label="Efectivo esperado" value={money(cashExpected(state, active.id))} />
                  <Stat
                    label="Gastos sin aprobar"
                    value={money(
                      state.expenses
                        .filter(
                          (x) => x.shiftId === active.id && x.status === 'pending' && x.source === 'cash',
                        )
                        .reduce((n, x) => n + x.amount, 0),
                    )}
                  />
                  <Stat label="Base del turno" value={money(active.base)} />
                  <Stat label="Cobrado en efectivo" value={money(sales.cash)} />
                </div>
              </>
            )}
          </>
        ) : (
          <Empty
            title="Sin turno abierto"
            description={
              admin
                ? 'Puedes iniciar tu propia caja directamente, sin autorización de otro admin. Después registra el conteo de apertura.'
                : 'El encargado solicita la apertura y un admin la autoriza.'
            }
          />
        )}
      </Panel>
      <Panel title="Conteos registrados">
        {visibleCounts(state).length < state.counts.length && (
          <label>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />{' '}
            Mostrar conteos archivados y del período de ensayo
          </label>
        )}
        {counts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Conteo</th>
                  <th>Contado / verificado</th>
                  {admin && (
                    <>
                      <th>Esperado original</th>
                      <th>Diferencia original</th>
                    </>
                  )}
                  <th>Responsable</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...counts].reverse().map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.kind === 'opening' ? 'Apertura' : c.kind === 'closing' ? 'Cierre' : 'Arqueo'}
                      {c.blindAttempt && <small>{c.blindAttempt === 1 ? 'Primer conteo' : 'Recuento'}</small>}
                      {inRehearsalPeriod(state, c.at) && <small>Período de ensayo</small>}
                      <small>{date(c.at)}</small>
                      {c.kind === 'closing' && (
                        <small>
                          {closingArchive(state, c)
                            ? 'Archivado'
                            : c.revisesId
                              ? 'Revisión administrativa'
                              : state.shifts.find((s) => s.closingCountId === c.id)?.closingReview?.status ===
                                  'approved'
                                ? 'Aprobado'
                                : 'Pendiente de aprobación'}
                        </small>
                      )}
                      {closingArchive(state, c) && (
                        <small>
                          {closingArchive(state, c)!.notes} · Archivado el{' '}
                          {date(closingArchive(state, c)!.at)}
                        </small>
                      )}
                    </td>
                    <td>
                      {c.cash === undefined
                        ? c.kind === 'audit' || c.auditId
                          ? 'Efectivo no solicitado'
                          : 'Omitido'
                        : money(c.cash)}
                      {Object.entries(c.payments ?? {}).map(([key, amount]) => (
                        <small key={key}>
                          {c.paymentLabels?.[key] ?? key}: {money(amount)}
                        </small>
                      ))}
                    </td>
                    {admin && (
                      <>
                        <td>
                          {c.expectedCash === undefined ? '—' : money(c.expectedCash)}
                          {Object.entries(c.expectedPayments ?? {}).map(([key, amount]) => (
                            <small key={key}>
                              {c.paymentLabels?.[key] ?? key}: {money(amount)}
                            </small>
                          ))}
                        </td>
                        <td className={c.difference ? 'negative' : ''}>
                          {c.difference === undefined ? '—' : money(c.difference)}
                          {Object.entries(c.paymentDifferences ?? {}).map(([key, amount]) => (
                            <small key={key} className={amount ? 'negative' : ''}>
                              {c.paymentLabels?.[key] ?? key}: {money(amount)}
                            </small>
                          ))}
                        </td>
                      </>
                    )}
                    <td>{profiles.find((x) => x.id === c.by)?.name}</td>
                    <td>
                      {admin && (
                        <button className="text-button" onClick={() => setReviewCount(c)}>
                          Revisar conteo
                        </button>
                      )}
                      <button
                        className="text-button"
                        disabled={!admin && state.shifts.find((s) => s.id === c.shiftId)?.status !== 'open'}
                        onClick={() =>
                          setForm({
                            title: 'Explicar diferencia',
                            type: 'explain_difference',
                            extra: { countId: c.id },
                            fields: [
                              { name: 'notes', label: 'Explicación', type: 'textarea', required: true },
                              { name: 'evidenceId', label: 'Evidencia opcional', type: 'photo' },
                            ],
                          })
                        }
                      >
                        Agregar explicación
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Aún no hay conteos" />
        )}
      </Panel>
      {count && active && (count === 'audit' ? auditId && owns : !auditId) && (
        <CountDialog
          key={count === 'audit' ? auditId : count}
          kind={count}
          shift={active}
          onClose={() => setCount(null)}
        />
      )}
      {admin &&
        (auditSetup === 'next_opening' || (auditSetup === 'current' && active?.status === 'open')) && (
          <AuditSetupDialog
            shift={auditSetup === 'current' ? active : undefined}
            onClose={() => setAuditSetup(null)}
          />
        )}
      {reviewCount && admin && <CountReviewDialog count={reviewCount} onClose={() => setReviewCount(null)} />}
      {form && (
        <Modal title={form.title} onClose={() => setForm(null)}>
          <FieldsForm
            fields={form.fields}
            onCancel={() => setForm(null)}
            onSubmit={async (values) => {
              await app.run(form.type, { ...form.extra, ...values });
              app.toast('Registro guardado.');
              setForm(null);
              if (form.type === 'request_shift' && admin) setCount(nextOpeningAudit ? 'audit' : 'opening');
            }}
          />
        </Modal>
      )}
    </div>
  );
}
function OfflineOpening({ shiftId }: { shiftId: string }) {
  const app = useApp(),
    [open, setOpen] = useState(false),
    [permits, setPermits] = useState<import('../lib/db.ts').OfflineAuthorizer[]>([]);
  return (
    <>
      <button
        className="button secondary"
        onClick={async () => {
          const { getMeta } = await import('../lib/db.ts');
          const all = (await getMeta<import('../lib/db.ts').OfflineAuthorizer[]>('offline-permits')) ?? [];
          setPermits(
            all.filter(
              (p) => p.branchId === app.data?.actor.branchId || (!p.branchId && app.data?.branch?.legacy),
            ),
          );
          setOpen(true);
        }}
      >
        Autorizar con admin presente
      </button>
      {open && (
        <Modal title="Apertura de contingencia" onClose={() => setOpen(false)}>
          <FieldsForm
            fields={[
              {
                name: 'permitId',
                label: 'Administrador presente',
                type: 'select',
                required: true,
                options: permits.map((p) => ({ value: p.id, label: p.name })),
              },
              { name: 'pin', label: 'PIN de contingencia', type: 'password', required: true },
            ]}
            onSubmit={async (v) => {
              await app.authorizeOffline(shiftId, v.pin, v.permitId);
              setOpen(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}
