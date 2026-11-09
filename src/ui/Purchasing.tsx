import { useState } from 'react';
import { Plus, Truck, ReceiptText, Camera, Check, Trash2 } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { photoBlob } from '../lib/db.ts';
import { articles } from '../domain/engine.ts';
import type { Shipment } from '../domain/types.ts';
import {
  Badge,
  Empty,
  FieldsForm,
  Modal,
  Panel,
  date,
  money,
  stateNames,
  type Field,
  MoneyInput,
} from './components.tsx';
export function Purchasing() {
  const app = useApp(),
    { state, actor, profiles } = app.data!,
    admin = actor.role === 'admin';
  const [expense, setExpense] = useState(false),
    [shipment, setShipment] = useState(false),
    [receive, setReceive] = useState<Shipment | null>(null),
    [error, setError] = useState('');
  const locationOptions = state.locations
    .filter((x) => x.active)
    .map((x) => ({ value: x.id, label: x.name }));
  const expenseFields: Field[] = [
    {
      name: 'category',
      label: 'Categoría',
      type: 'select',
      required: true,
      options: [
        ...new Set([
          ...state.settings[0].expenseCategories,
          'Arriendo',
          'Servicios',
          'Nómina',
          'Seguridad',
          'Publicidad',
        ]),
      ].map((x) => ({ value: x, label: x })),
    },
    { name: 'amount', label: 'Monto pagado', type: 'money', min: 1, required: true },
    {
      name: 'source',
      label: 'Pagado con',
      type: 'select',
      value: 'cash',
      required: true,
      options: [
        { value: 'cash', label: 'Efectivo de la caja' },
        ...(admin
          ? [
              { value: 'treasury', label: 'Caja principal o cuenta del negocio' },
              { value: 'personal', label: 'Bolsillo del administrador' },
            ]
          : []),
      ],
    },
    {
      name: 'locationId',
      label: 'Caja o cuenta que pagó (si corresponde)',
      type: 'select',
      options: locationOptions,
    },
    { name: 'supplier', label: 'Proveedor', required: true },
    { name: 'evidenceId', label: 'Soporte fotográfico', type: 'photo' },
    { name: 'notes', label: 'Nota (obligatoria si no hay foto)', type: 'textarea' },
  ];
  const approve = async (expenseId: string, value: boolean) => {
    try {
      await app.run('approve_expense', { expenseId, approve: value });
      app.toast(value ? 'Gasto aprobado.' : 'Gasto rechazado.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>Compras y gastos</h2>
          <p>El costo, el pago y la recepción quedan relacionados.</p>
        </div>
        <div className="button-row">
          {actor.role !== 'apoyo' && (
            <button className="button secondary" onClick={() => setExpense(true)}>
              <Plus size={17} />
              Registrar gasto
            </button>
          )}
          {admin && (
            <button className="button primary" onClick={() => setShipment(true)}>
              <Truck size={17} />
              Compra y envío
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <Panel title="Mercancía en camino y recibida">
        {state.shipments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Envío</th>
                  <th>Origen</th>
                  <th>Mercancía</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...state.shipments].reverse().map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.supplier}</strong>
                      <small>{date(s.at)}</small>
                      <small>{s.notes}</small>
                    </td>
                    <td>{s.from}</td>
                    <td>
                      {admin
                        ? s.items.map((item, i) => (
                            <small key={i}>
                              {item.quantity} × {articles(state).find((x) => x.id === item.article)?.name}
                            </small>
                          ))
                        : 'Se cuenta antes de ver lo enviado'}
                    </td>
                    <td>
                      <Badge tone={s.status === 'received' ? 'green' : 'orange'}>
                        {stateNames[s.status]}
                      </Badge>
                    </td>
                    <td>
                      {s.status !== 'received' && (
                        <button className="button small secondary" onClick={() => setReceive(s)}>
                          Recibir a ciegas
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Sin envíos registrados"
            description="El admin declara la compra y el empleado registra lo que realmente llega."
          />
        )}
      </Panel>
      <Panel title="Recepciones y cruces">
        {state.receipts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recepción</th>
                  <th>Recibido y dañado</th>
                  {admin && <th>Diferencias contra envío</th>}
                  <th>Soporte</th>
                </tr>
              </thead>
              <tbody>
                {[...state.receipts].reverse().map((r) => (
                  <tr key={r.id}>
                    <td>
                      {date(r.at)}
                      <small>{profiles.find((x) => x.id === r.by)?.name}</small>
                      <small>{r.notes}</small>
                    </td>
                    <td>
                      {Object.entries(r.items).map(([k, v]) => (
                        <small key={k}>
                          {articles(state).find((x) => x.id === k)?.name}: {v} recibidos · {r.damaged[k] ?? 0}{' '}
                          dañados
                        </small>
                      ))}
                    </td>
                    {admin && (
                      <td>
                        {Object.entries(r.differences ?? {})
                          .filter(([, v]) => v !== 0)
                          .map(([k, v]) => (
                            <small className="negative" key={k}>
                              {articles(state).find((x) => x.id === k)?.name}: {v > 0 ? '+' : ''}
                              {v}
                            </small>
                          ))}
                        {Object.values(r.differences ?? {}).every((v) => v === 0) && (
                          <Badge tone="green">Coincide</Badge>
                        )}
                      </td>
                    )}
                    <td>
                      <EvidenceButton id={r.evidenceId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Las recepciones aparecerán aquí" />
        )}
      </Panel>
      <Panel title="Gastos registrados">
        {state.expenses.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Gasto</th>
                  <th>Monto</th>
                  <th>Pagado con</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {[...state.expenses].reverse().map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>
                        {e.category} · {e.supplier}
                      </strong>
                      <small>
                        {date(e.at)} · {profiles.find((x) => x.id === e.by)?.name}
                      </small>
                      <small>{e.notes}</small>
                      {e.shipmentId && <small>Compra vinculada a envío</small>}
                    </td>
                    <td>{money(e.amount)}</td>
                    <td>
                      {e.source === 'cash'
                        ? 'Caja de turno'
                        : e.source === 'personal'
                          ? 'Bolsillo de admin'
                          : (state.locations.find((x) => x.id === e.locationId)?.name ?? 'Caja principal')}
                    </td>
                    <td>
                      <Badge
                        tone={e.status === 'approved' ? 'green' : e.status === 'rejected' ? 'red' : 'orange'}
                      >
                        {stateNames[e.status]}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        {e.evidenceId && <EvidenceButton id={e.evidenceId} />}{' '}
                        {admin && e.status === 'pending' && (
                          <>
                            <button className="button small primary" onClick={() => void approve(e.id, true)}>
                              Aprobar
                            </button>
                            <button
                              className="button small secondary"
                              onClick={() => void approve(e.id, false)}
                            >
                              Rechazar
                            </button>
                          </>
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
            title="Aún no hay gastos"
            description="Un gasto pendiente de caja sigue figurando como diferencia hasta su aprobación."
          />
        )}
      </Panel>
      {expense && (
        <Modal title="Registrar gasto pagado" onClose={() => setExpense(false)}>
          <FieldsForm
            fields={expenseFields}
            onCancel={() => setExpense(false)}
            onSubmit={async (v) => {
              await app.run('expense', v);
              setExpense(false);
              app.toast('Gasto registrado, pendiente de aprobación.');
            }}
          />
        </Modal>
      )}
      {shipment && <ShipmentDialog onClose={() => setShipment(false)} />}
      {receive && <ReceiveDialog shipment={receive} onClose={() => setReceive(null)} />}
    </div>
  );
}
export function EvidenceButton({ id }: { id: string }) {
  const app = useApp(),
    [busy, setBusy] = useState(false);
  return (
    <button
      className="text-button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { db } = await import('../lib/db.ts');
          const local = await db.photos.get(id);
          if (local) {
            const url = URL.createObjectURL(photoBlob(local));
            window.open(url, '_blank', 'noopener,noreferrer');
            setTimeout(() => URL.revokeObjectURL(url), 300000);
          } else {
            const { api } = await import('../lib/api.ts');
            const data = await api(`attachments/read?id=${encodeURIComponent(id)}`);
            window.open(data.url, '_blank', 'noopener,noreferrer');
          }
        } catch (e) {
          app.toast((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Camera size={15} />
      Ver foto
    </button>
  );
}
function ShipmentDialog({ onClose }: { onClose: () => void }) {
  const app = useApp(),
    list = articles(app.data!.state),
    [items, setItems] = useState([{ article: '', quantity: 1, unitCost: 0 }]);
  return (
    <Modal title="Registrar compra y envío" onClose={onClose}>
      <FieldsForm
        fields={[
          { name: 'supplier', label: 'Proveedor', required: true },
          {
            name: 'from',
            label: 'Origen de la compra',
            type: 'select',
            required: true,
            value: 'Medellín',
            options: [
              { value: 'Medellín', label: 'Medellín · crea envío' },
              { value: 'Tarazá', label: 'Tarazá · recepción local' },
            ],
          },
          {
            name: 'paidWith',
            label: 'Pagado con (opcional)',
            type: 'select',
            options: [
              { value: 'personal', label: 'Bolsillo de admin' },
              { value: 'treasury', label: 'Caja principal o cuenta' },
              { value: 'cash', label: 'Caja del turno' },
            ],
          },
          {
            name: 'locationId',
            label: 'Caja o cuenta que pagó',
            type: 'select',
            options: app
              .data!.state.locations.filter((x) => x.active)
              .map((x) => ({ value: x.id, label: x.name })),
          },
          { name: 'evidenceId', label: 'Soporte de compra', type: 'photo' },
          { name: 'notes', label: 'Notas', type: 'textarea' },
        ]}
        onCancel={onClose}
        onSubmit={async (v) => {
          await app.run('create_shipment', { ...v, items });
          onClose();
          app.toast('Compra y envío registrados. La recepción se cuenta por separado.');
        }}
      >
        <div className="lines-editor">
          {items.map((item, i) => (
            <div className="edit-line" key={i}>
              <label>
                Artículo
                <select
                  required
                  value={item.article}
                  onChange={(e) =>
                    setItems(items.map((x, j) => (j === i ? { ...x, article: e.target.value } : x)))
                  }
                >
                  <option value="">Seleccionar…</option>
                  {list
                    .filter((x) => !x.id.startsWith('liquid:') && !x.id.startsWith('cup:'))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Cantidad
                <input
                  type="number"
                  min="1"
                  required
                  value={item.quantity}
                  onChange={(e) =>
                    setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))
                  }
                />
              </label>
              <label>
                Costo unitario
                <MoneyInput
                  required
                  preview={false}
                  amount={item.unitCost || null}
                  onChange={(_, amount) =>
                    setItems(items.map((x, j) => (j === i ? { ...x, unitCost: amount ?? 0 } : x)))
                  }
                />
              </label>
              <button
                className="icon-button"
                type="button"
                aria-label="Eliminar artículo"
                disabled={items.length === 1}
                onClick={() => setItems(items.filter((_, j) => j !== i))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            onClick={() => setItems([...items, { article: '', quantity: 1, unitCost: 0 }])}
          >
            <Plus size={15} />
            Agregar artículo
          </button>
        </div>
      </FieldsForm>
    </Modal>
  );
}
function ReceiveDialog({ shipment, onClose }: { shipment: Shipment; onClose: () => void }) {
  const app = useApp(),
    list = articles(app.data!.state).filter((x) => !x.id.startsWith('liquid:') && !x.id.startsWith('cup:')),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title={`Recibir mercancía · ${shipment.supplier}`} onClose={onClose}>
      <p className="modal-intro">
        Registra lo que llegó antes de ver lo enviado. Deja en blanco los artículos que no llegaron en esta
        recepción. Los dañados se incluyen dentro del total recibido.
      </p>
      <form
        className="fields-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const form = new FormData(e.currentTarget);
          try {
            const file = form.get('photo') as File;
            if (!file?.size) throw new Error('Adjunta una foto del estado de la mercancía.');
            const evidenceId = await app.photo(file),
              items: Record<string, number> = {},
              damaged: Record<string, number> = {};
            for (const item of list) {
              const v = form.get(`item:${item.id}`);
              if (v !== '') {
                items[item.id] = Number(v);
                damaged[item.id] = Number(form.get(`damage:${item.id}`) ?? 0);
              }
            }
            await app.run('receive_shipment', {
              shipmentId: shipment.id,
              items,
              damaged,
              evidenceId,
              notes: form.get('notes'),
            });
            onClose();
            app.toast('Recepción registrada y cruzada contra el envío.');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Artículo</th>
                <th>Total recibido</th>
                <th>De esos, dañados</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>
                    <input
                      aria-label={`Recibido ${x.name}`}
                      name={`item:${x.id}`}
                      type="number"
                      min="0"
                      step="1"
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Dañado ${x.name}`}
                      name={`damage:${x.id}`}
                      type="number"
                      min="0"
                      step="1"
                      defaultValue="0"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="field">
          <span>Foto de mercancía y estado *</span>
          <input name="photo" type="file" accept="image/*" capture="environment" required />
        </label>
        <label className="field">
          <span>Observaciones</span>
          <textarea name="notes" maxLength={1500} />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Confirmar lo recibido'}
        </button>
      </form>
    </Modal>
  );
}
