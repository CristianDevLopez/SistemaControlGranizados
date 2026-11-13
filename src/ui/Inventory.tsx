import { useState } from 'react';
import { PackageOpen, Plus, Droplets, AlertTriangle } from 'lucide-react';
import { articles, stockBalances } from '../domain/engine.ts';
import { liquidReconciliation } from '../domain/liquid.ts';
import { useApp } from '../lib/store.tsx';
import { Badge, Empty, FieldsForm, Modal, Panel, date, type Field } from './components.tsx';
import type { CommandType } from '../domain/types.ts';
import { canWork } from '../domain/access.ts';
export function Inventory() {
  const app = useApp(),
    { state, actor } = app.data!,
    admin = actor.role === 'admin',
    balances = stockBalances(state),
    list = articles(state);
  const [query, setQuery] = useState(''),
    [group, setGroup] = useState('all'),
    [form, setForm] = useState<{
      title: string;
      type: CommandType;
      fields: Field[];
      extra?: Record<string, unknown>;
    } | null>(null),
    [initial, setInitial] = useState(false);
  const filtered = list.filter(
    (x) => (group === 'all' || x.id.startsWith(group)) && x.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>Insumos en movimiento</h2>
          <p>Cada entrada, entrega y merma conserva su origen.</p>
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={!canWork(actor, state, 'inventory')}
            onClick={() =>
              setForm({
                title: 'Abrir paquete de vasos',
                type: 'open_package',
                fields: [
                  {
                    name: 'sizeId',
                    label: 'Tamaño',
                    type: 'select',
                    required: true,
                    options: state.sizes
                      .filter((x) => x.cups > 0)
                      .map((x) => ({ value: x.id, label: x.name })),
                  },
                  {
                    name: 'units',
                    label: 'Unidades del paquete',
                    type: 'number',
                    value: state.settings[0].cupPackageUnits,
                    min: 1,
                    required: true,
                  },
                  {
                    name: 'confirmEmpty',
                    label: 'Confirmo que el paquete anterior está vacío',
                    type: 'checkbox',
                  },
                ],
              })
            }
          >
            <PackageOpen size={17} />
            Abrir paquete
          </button>
          <button
            className="button primary"
            disabled={!canWork(actor, state, 'inventory')}
            onClick={() =>
              setForm({
                title: 'Abrir bolsa de líquido',
                type: 'open_bag',
                fields: [
                  {
                    name: 'flavorId',
                    label: 'Sabor',
                    type: 'select',
                    required: true,
                    options: state.flavors.map((x) => ({ value: x.id, label: x.name })),
                  },
                  {
                    name: 'ounces',
                    label: 'Onzas de la bolsa',
                    type: 'number',
                    value: state.settings[0].bagOunces,
                    step: '0.000001',
                    min: 0.01,
                    required: true,
                  },
                ],
              })
            }
          >
            <Droplets size={17} />
            Abrir bolsa
          </button>
        </div>
      </div>
      <div className="notice info">
        {admin
          ? 'El líquido es un saldo teórico. Los desperdicios y daños se registran; la tolerancia solo determina cuándo alertar.'
          : 'Los conteos de inventario se presentan a ciegas. El administrador revisa los saldos y las diferencias.'}
      </div>
      <Panel
        title="Inventario"
        action={
          <div className="button-row">
            {admin && (
              <button className="button small primary" onClick={() => setInitial(true)}>
                Registrar inventario inicial
              </button>
            )}
            <button
              className="button small secondary"
              disabled={!canWork(actor, state, 'inventory')}
              onClick={() =>
                setForm({
                  title: 'Reportar daño o desperdicio',
                  type: 'report_damage',
                  fields: [
                    {
                      name: 'article',
                      label: 'Artículo',
                      type: 'select',
                      required: true,
                      options: list.map((x) => ({ value: x.id, label: `${x.name} (${x.unit})` })),
                    },
                    {
                      name: 'quantity',
                      label: 'Cantidad',
                      type: 'number',
                      step: '0.001',
                      min: 0.001,
                      required: true,
                    },
                    { name: 'notes', label: 'Motivo', type: 'textarea', required: true },
                    { name: 'evidenceId', label: 'Fotografía', type: 'photo', required: true },
                    {
                      name: 'checklist',
                      label: 'Bolsa: verifiqué empaque, contenido y estado',
                      type: 'checkbox',
                    },
                    { name: 'diagnosis', label: 'Diagnóstico de bolsa (si aplica)', type: 'textarea' },
                  ],
                })
              }
            >
              <AlertTriangle size={15} />
              Reportar daño
            </button>
          </div>
        }
      >
        <div className="table-toolbar">
          <input
            className="search"
            aria-label="Buscar insumo"
            placeholder="Buscar un insumo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Tipo de inventario" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">Todos los insumos</option>
            <option value="sealed_bag:">Bolsas selladas</option>
            <option value="liquid:">Líquido</option>
            <option value="cup:">Vasos sueltos</option>
            <option value="package:">Paquetes</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Artículo</th>
                <th>Unidad</th>
                {admin && (
                  <>
                    <th>Saldo teórico</th>
                    <th>Control</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.id}>
                  <td>
                    <strong>{x.name}</strong>
                  </td>
                  <td>{x.unit}</td>
                  {admin && (
                    <>
                      <td className={(balances[x.id] ?? 0) < 0 ? 'negative' : ''}>
                        {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(
                          balances[x.id] ?? 0,
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            (balances[x.id] ?? 0) < 0
                              ? 'red'
                              : x.id.startsWith('liquid:')
                                ? 'blue'
                                : 'neutral'
                          }
                        >
                          {(balances[x.id] ?? 0) < 0
                            ? 'Revisar faltante'
                            : x.id.startsWith('liquid:')
                              ? 'Aproximado'
                              : 'Conteo exacto'}
                        </Badge>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="two-columns">
        <Panel title="Bolsas abiertas">
          {state.bags.filter((x) => !x.exhaustedAt).length ? (
            state.bags
              .filter((x) => !x.exhaustedAt)
              .map((b) => (
                <div className="list-row" key={b.id}>
                  <div>
                    <strong>{state.flavors.find((x) => x.id === b.flavorId)?.name}</strong>
                    <small>
                      {b.ounces.toFixed(2)} oz · {date(b.openedAt)}
                    </small>
                  </div>
                  <button
                    className="button small secondary"
                    disabled={!canWork(actor, state, 'inventory')}
                    onClick={async () => {
                      try {
                        await app.run('exhaust_bag', { bagId: b.id });
                        app.toast('Bolsa marcada como agotada.');
                      } catch (e) {
                        app.toast((e as Error).message);
                      }
                    }}
                  >
                    Marcar agotada
                  </button>
                </div>
              ))
          ) : (
            <Empty title="Sin bolsas abiertas registradas" />
          )}
        </Panel>
        <Panel title="Paquetes abiertos">
          {state.packages.filter((x) => !x.closedAt).length ? (
            state.packages
              .filter((x) => !x.closedAt)
              .map((p) => (
                <div className="list-row" key={p.id}>
                  <div>
                    <strong>{state.sizes.find((x) => x.id === p.sizeId)?.name}</strong>
                    <small>
                      {p.units} unidades · {date(p.openedAt)}
                    </small>
                  </div>
                  <Badge>Abierto</Badge>
                </div>
              ))
          ) : (
            <Empty title="Sin paquetes abiertos registrados" />
          )}
        </Panel>
      </div>
      {admin && (
        <Panel title="Líquido y pérdida aceptable">
          <div className="liquid-summary">
            <p>
              {state.settings[0].baseline
                ? 'Medición de línea base activa.'
                : 'Seguimiento de consumo activo.'}{' '}
              {state.settings[0].liquidTolerance === null
                ? 'La tolerancia aún no está configurada.'
                : `Tolerancia: ${(state.settings[0].liquidTolerance * 100).toFixed(1)} %.`}{' '}
              El residual se estima cuando todas las bolsas abiertas del sabor están agotadas. No genera
              descuentos ni ajustes automáticos.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sabor</th>
                    <th>Abierto</th>
                    <th>Servido</th>
                    <th>Degustaciones</th>
                    <th>Merma aprobada</th>
                    <th>Residual sin explicar</th>
                    <th>Control</th>
                  </tr>
                </thead>
                <tbody>
                  {liquidReconciliation(state).map((r) => (
                    <tr key={r.flavorId}>
                      <td>
                        {r.name}
                        <small>
                          {r.openBags} bolsas abiertas · {r.closedBags} agotadas
                        </small>
                      </td>
                      <td>{r.opened.toFixed(2)} oz</td>
                      <td>{r.served.toFixed(2)} oz</td>
                      <td>{r.tastings} oz</td>
                      <td>{r.approvedWaste.toFixed(2)} oz</td>
                      <td>
                        {r.unexplained === null
                          ? 'Pendiente de agotar bolsas'
                          : `${r.unexplained.toFixed(2)} oz`}
                      </td>
                      <td>
                        <Badge tone={r.alert ? 'orange' : r.ratio === null ? 'neutral' : 'green'}>
                          {r.alert
                            ? 'Supera tolerancia'
                            : r.ratio === null
                              ? 'En medición'
                              : `${(r.ratio * 100).toFixed(1)} % de pérdida estimada`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}
      {form && (
        <Modal title={form.title} onClose={() => setForm(null)}>
          <FieldsForm
            fields={form.fields}
            onCancel={() => setForm(null)}
            onSubmit={async (values) => {
              await app.run(form.type, { ...form.extra, ...values });
              app.toast('Movimiento registrado.');
              setForm(null);
            }}
          />
        </Modal>
      )}
      {initial && <InitialInventory onClose={() => setInitial(false)} />}
    </div>
  );
}
function InitialInventory({ onClose }: { onClose: () => void }) {
  const app = useApp(),
    list = articles(app.data!.state),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Inventario físico inicial" onClose={onClose}>
      <p className="modal-intro">
        Registra las cantidades que deseas agregar al inventario. Cada registro suma las cantidades ingresadas
        al saldo existente; los artículos en cero conservan su saldo.
      </p>
      <form
        className="fields-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const form = new FormData(e.currentTarget);
          try {
            await app.run('initialize_stock', {
              items: Object.fromEntries(list.map((x) => [x.id, Number(form.get(x.id) ?? 0)])),
            });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="count-list">
          {list.map((x) => (
            <label key={x.id}>
              <span>
                {x.name}
                <small>{x.unit}</small>
              </span>
              <input
                name={x.id}
                aria-label={x.name}
                type="number"
                step={x.unit === 'oz' ? '0.001' : '1'}
                min="0"
                defaultValue="0"
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
        <button className="button primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Confirmar inventario inicial'}
        </button>
      </form>
    </Modal>
  );
}
