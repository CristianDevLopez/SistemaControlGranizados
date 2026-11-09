import { useState } from 'react';
import { Check, Search, FilePlus2, Plus, Trash2, ArrowRightLeft } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import type { CommandType, Order } from '../domain/types.ts';
import { isShiftCashier } from '../domain/access.ts';
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
  utc,
  type Field,
} from './components.tsx';

export interface DraftLine {
  flavorId: string;
  sizeId: string;
  quantity: number;
  unitPrice?: number;
}
export function LinesEditor({
  value,
  onChange,
  prices = false,
}: {
  value: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  prices?: boolean;
}) {
  const { state } = useApp().data!;
  return (
    <div className="lines-editor">
      {value.map((line, i) => (
        <div key={i} className="edit-line">
          <label>
            Sabor
            <select
              required
              value={line.flavorId}
              onChange={(e) =>
                onChange(value.map((l, j) => (j === i ? { ...l, flavorId: e.target.value } : l)))
              }
            >
              <option value="">Seleccionar…</option>
              {state.flavors
                .filter((x) => x.active)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Tamaño
            <select
              required
              value={line.sizeId}
              onChange={(e) =>
                onChange(value.map((l, j) => (j === i ? { ...l, sizeId: e.target.value } : l)))
              }
            >
              <option value="">Seleccionar…</option>
              {state.sizes
                .filter((x) => x.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Unidades
            <input
              type="number"
              required
              min="1"
              max="500"
              value={line.quantity}
              onChange={(e) =>
                onChange(value.map((l, j) => (j === i ? { ...l, quantity: Number(e.target.value) } : l)))
              }
            />
          </label>
          {prices && (
            <label>
              Precio unitario cobrado
              <input
                type="number"
                required
                min="1"
                value={line.unitPrice ?? ''}
                onChange={(e) =>
                  onChange(value.map((l, j) => (j === i ? { ...l, unitPrice: Number(e.target.value) } : l)))
                }
              />
            </label>
          )}
          <button
            className="icon-button"
            type="button"
            aria-label="Eliminar línea"
            disabled={value.length === 1}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() =>
          onChange([
            ...value,
            { flavorId: '', sizeId: state.sizes.find((x) => x.active)?.id ?? '', quantity: 1 },
          ])
        }
      >
        <Plus size={15} />
        Agregar producto
      </button>
    </div>
  );
}
export function Orders() {
  const app = useApp(),
    { state, actor, profiles } = app.data!,
    [filter, setFilter] = useState('pending'),
    [query, setQuery] = useState(''),
    [details, setDetails] = useState<Order | null>(null),
    [replace, setReplace] = useState<Order | null>(null),
    [paper, setPaper] = useState(false),
    [error, setError] = useState(''),
    [form, setForm] = useState<{
      title: string;
      type: CommandType;
      fields: Field[];
      extra: Record<string, unknown>;
    } | null>(null);
  const canCash = isShiftCashier(
    { ...actor, online: app.online },
    state.shifts.find((s) => s.status === 'open'),
  );
  const rows = [...state.orders]
    .reverse()
    .filter(
      (o) =>
        (filter === 'all' ||
          (filter === 'pending' &&
            (['open', 'void_requested', 'unpaid_incident'].includes(o.status) ||
              o.lines.some((x) => x.delivered < x.quantity))) ||
          (filter === 'paid' && o.status === 'paid')) &&
        `${o.number} ${profiles.find((x) => x.id === o.sellerId)?.name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>Pedidos y entregas</h2>
          <p>Lo solicitado, lo entregado y lo cobrado, por separado.</p>
        </div>
        {actor.role === 'admin' && (
          <button className="button secondary" onClick={() => setPaper(true)}>
            <FilePlus2 size={17} />
            Ingresar desde papel
          </button>
        )}
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <Panel>
        <div className="table-toolbar">
          <div className="segmented">
            <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
              Pendientes
            </button>
            <button className={filter === 'paid' ? 'active' : ''} onClick={() => setFilter('paid')}>
              Cobrados
            </button>
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              Historial
            </button>
          </div>
          <input
            className="search"
            placeholder="Buscar pedido o responsable…"
            aria-label="Buscar pedido"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Productos</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <button className="text-button strong" onClick={() => setDetails(o)}>
                        #{o.number}
                      </button>
                      <small>{date(o.originalAt ?? o.createdAt)}</small>
                      <small>
                        {profiles.find((x) => x.id === o.sellerId)?.name}
                        {o.origin === 'paper' ? ' · Desde papel' : ''}
                      </small>
                    </td>
                    <td>
                      {o.lines.map((l) => (
                        <div key={l.id}>
                          {l.quantity} × {state.flavors.find((x) => x.id === l.flavorId)?.name} ·{' '}
                          {state.sizes.find((x) => x.id === l.sizeId)?.name}
                          <small>
                            {l.delivered}/{l.quantity} entregados
                          </small>
                        </div>
                      ))}
                      {o.tastings.length > 0 && <small>{o.tastings.length} degustaciones</small>}
                    </td>
                    <td>{money(o.total)}</td>
                    <td>
                      <Badge
                        tone={
                          o.status === 'paid'
                            ? 'green'
                            : ['void_requested', 'unpaid_incident'].includes(o.status)
                              ? 'orange'
                              : 'neutral'
                        }
                      >
                        {stateNames[o.status]}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        {['open', 'paid'].includes(o.status) &&
                          o.lines.some((x) => x.delivered < x.quantity) && (
                            <button
                              className="button small primary"
                              onClick={async () => {
                                try {
                                  await app.run('deliver', { orderId: o.id, expectedVersion: o.version });
                                  app.toast('Entrega registrada.');
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              <Check size={15} />
                              Entregar pendientes
                            </button>
                          )}
                        {o.status === 'paid' && actor.role !== 'apoyo' && (
                          <button
                            className="button small secondary"
                            onClick={() =>
                              setForm({
                                title: 'Solicitar anulación completa',
                                type: 'request_void',
                                extra: { orderId: o.id },
                                fields: [
                                  { name: 'notes', label: 'Motivo', type: 'textarea', required: true },
                                  {
                                    name: 'evidenceId',
                                    label: 'Foto de soporte',
                                    type: 'photo',
                                    required: true,
                                  },
                                ],
                              })
                            }
                          >
                            Solicitar anulación
                          </button>
                        )}
                        {o.status === 'voided' && !o.resolvedAt && canCash && (
                          <>
                            <button className="button small secondary" onClick={() => setReplace(o)}>
                              <ArrowRightLeft size={15} />
                              Corregir ticket
                            </button>
                            <button
                              className="button small secondary"
                              onClick={() =>
                                setForm({
                                  title: 'Registrar reembolso completo',
                                  type: 'refund_order',
                                  extra: { orderId: o.id },
                                  fields: [
                                    {
                                      name: 'evidenceId',
                                      label: 'Comprobante del reembolso',
                                      type: 'photo',
                                      required: true,
                                    },
                                  ],
                                })
                              }
                            >
                              Reembolsar
                            </button>
                          </>
                        )}
                        {o.status === 'open' && o.lines.some((x) => x.delivered) && canCash && (
                          <button
                            className="button small secondary"
                            onClick={() =>
                              setForm({
                                title: 'Registrar pedido sin pagar',
                                type: 'unpaid',
                                extra: { orderId: o.id },
                                fields: [
                                  { name: 'notes', label: 'Qué ocurrió', type: 'textarea', required: true },
                                ],
                              })
                            }
                          >
                            No se pagó
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
          <Empty
            title="Todo en su lugar"
            description="Los pedidos aparecerán aquí al comenzar la operación."
          />
        )}
      </Panel>
      {details && (
        <Modal title={`Pedido #${details.number}`} onClose={() => setDetails(null)}>
          <div className="detail-content">
            <p>
              {stateNames[details.status]} · {date(details.createdAt)}
            </p>
            {details.replacesId && (
              <div className="notice info">
                Este ticket sustituye una venta anulada y conserva su relación con pagos y consumos.
              </div>
            )}
            <dl>
              <dt>Total</dt>
              <dd>{money(details.total)}</dd>
              <dt>Origen</dt>
              <dd>{details.origin === 'paper' ? `Planilla · ${details.paperFolio}` : 'App'}</dd>
              <dt>Cobrado</dt>
              <dd>{date(details.paidAt)}</dd>
            </dl>
            {details.lines.map((l) => (
              <div className="list-row" key={l.id}>
                <div>
                  <strong>
                    {state.flavors.find((x) => x.id === l.flavorId)?.name} ·{' '}
                    {state.sizes.find((x) => x.id === l.sizeId)?.name}
                  </strong>
                  <small>
                    {l.quantity} solicitados · {l.delivered} entregados
                  </small>
                  {l.discount > 0 && <small>Descuento: {money(l.discount)}</small>}
                </div>
                <strong>{money(l.listPrice * l.quantity - l.discount)}</strong>
              </div>
            ))}
            {details.tastings.map((t) => (
              <div className="list-row" key={t.id}>
                <span>Degustación · {state.flavors.find((x) => x.id === t.flavorId)?.name}</span>
                <small>{date(t.at)}</small>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {form && (
        <Modal title={form.title} onClose={() => setForm(null)}>
          <FieldsForm
            fields={form.fields}
            onCancel={() => setForm(null)}
            onSubmit={async (v) => {
              await app.run(form.type, { ...form.extra, ...v });
              setForm(null);
              app.toast('Registro guardado.');
            }}
          />
        </Modal>
      )}
      {replace && <ReplaceDialog order={replace} onClose={() => setReplace(null)} />}
      {paper && <PaperDialog onClose={() => setPaper(false)} />}
    </div>
  );
}
function ReplaceDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const app = useApp(),
    [lines, setLines] = useState<DraftLine[]>(
      order.lines.map((l) => ({ flavorId: l.flavorId, sizeId: l.sizeId, quantity: l.quantity })),
    ),
    [same, setSame] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Crear ticket correcto" onClose={onClose}>
      <form
        className="fields-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await app.run('replace_order', { orderId: order.id, lines, sameDelivery: same });
            app.toast(
              'Ticket sustituto creado. Ábrelo en Mostrador para cobrar la diferencia o registrar el vuelto.',
            );
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="notice info">
          Se aplicará el pago anterior de {money(order.total)}. El nuevo ticket conserva la relación con esta
          anulación.
        </div>
        <LinesEditor value={lines} onChange={setLines} />
        <label className="check-inline">
          <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />
          Es el mismo producto físico ya entregado; corregir el registro sin duplicar el consumo.
        </label>
        {!same && (
          <p>Los productos nuevos descontarán inventario al entregarse. El consumo anterior se conserva.</p>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="button primary" disabled={busy}>
          Crear ticket sustituto
        </button>
      </form>
    </Modal>
  );
}
function PaperDialog({ onClose }: { onClose: () => void }) {
  const app = useApp(),
    { state } = app.data!,
    [lines, setLines] = useState<DraftLine[]>([
      {
        flavorId: '',
        sizeId: state.sizes.find((x) => x.active)?.id ?? '',
        quantity: 1,
        unitPrice: undefined,
      },
    ]);
  return (
    <Modal title="Ingresar pedido desde planilla" onClose={onClose}>
      <p className="modal-intro">
        Una fila por pedido. Conserva el folio y la hora original; adjunta la hoja. Este registro no debe
        repetirse en otro dispositivo.
      </p>
      <FieldsForm
        fields={[
          {
            name: 'shiftId',
            label: 'Turno al que pertenece',
            type: 'select',
            required: true,
            options: state.shifts.map((s) => ({
              value: s.id,
              label: `${date(s.openedAt ?? s.requestedAt)} · ${s.status}`,
            })),
          },
          { name: 'paperFolio', label: 'Folio único del pedido', required: true },
          {
            name: 'originalAt',
            label: 'Hora original (Colombia)',
            type: 'datetime-local',
            required: true,
            value: localDateTime(),
          },
          { name: 'evidenceId', label: 'Foto de la planilla', type: 'photo', required: true },
          { name: 'delivered', label: 'Productos entregados', type: 'checkbox', value: true },
          { name: 'notes', label: 'Novedades', type: 'textarea' },
        ]}
        onCancel={onClose}
        submit="Registrar pedido desde papel"
        onSubmit={async (v) => {
          await app.run('record_paper' as CommandType, { ...v, lines, originalAt: utc(v.originalAt) });
          app.toast('Pedido de planilla registrado.');
          onClose();
        }}
      >
        <LinesEditor value={lines} onChange={setLines} prices />
      </FieldsForm>
    </Modal>
  );
}
