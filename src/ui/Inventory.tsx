import { V4Stock } from './V4Stock.tsx';
import { candies } from '../domain/v4-catalog.ts';
import { orderedFlavors } from '../domain/flavors.ts';
import { supplies } from '../domain/supplies.ts';
import { supplyDuration } from '../domain/inventory.ts';
import { AddPackages } from './AddPackages.tsx';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Droplets, PackageOpen } from 'lucide-react';
import { canWork } from '../domain/access.ts';
import { articles, stockBalances } from '../domain/engine.ts';
import { operatingShift } from '../domain/employee-view.ts';
import { DEFAULT_LIQUID_BAG_WINDOW } from '../domain/initial.ts';
import { inventoryOpenings, liquidBagInventory } from '../domain/inventory.ts';
import type { CommandType, Snapshot } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { Empty, FieldsForm, Modal, Panel, date, type Field } from './components.tsx';
import { LiquidFortnightReport } from './LiquidFortnightReport.tsx';

const amount = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6, signDisplay: 'exceptZero' });

function InventoryTable({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details className="panel inventory-disclosure">
      <summary>
        <strong>{title}</strong>
        <small>{description}</small>
      </summary>
      {children}
    </details>
  );
}

function AdminInventory({ snapshot, onCorrect }: { snapshot: Snapshot; onCorrect: () => void }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const { state, profiles } = snapshot;
  const settings = state.settings[0];
  const liquid = liquidBagInventory(state);
  const balances = stockBalances(state);
  for (const row of liquid) balances[`liquid:${row.flavorId}`] = row.remaining;
  const openings = inventoryOpenings(state);
  const names = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const window = settings.liquidBagWindow ?? DEFAULT_LIQUID_BAG_WINDOW;
  const stock = articles(state).filter(
    (item) => item.id.startsWith(group) && item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      {!settings.v4Enabled && (
        <InventoryTable
          title="Saldos de inventario"
          description="Consulta las existencias teóricas por artículo."
        >
          <div className="table-toolbar">
            <input
              className="search"
              aria-label="Buscar insumo"
              placeholder="Buscar un insumo…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="Tipo de inventario"
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="">Todos los insumos</option>
              <option value="sealed_bag:">Bolsas selladas</option>
              <option value="liquid:">Líquido</option>
              <option value="cup:">Vasos sueltos</option>
              <option value="package:">Paquetes</option>
              <option value="coronita">Coronitas</option>
            </select>
            <button className="button small secondary" onClick={onCorrect}>
              Proponer corrección de inventario
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th>Saldo teórico</th>
                  <th>Unidad</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td className={(balances[row.id] ?? 0) < 0 ? 'negative' : ''}>
                      {amount.format(balances[row.id] ?? 0)}
                    </td>
                    <td>{row.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </InventoryTable>
      )}
      <InventoryTable title="Duración de insumos" description="Promedio entre aperturas registradas.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Insumo</th>
                <th>Unidades cerradas</th>
                <th>Días por unidad</th>
                <th>Vasos por unidad abierta</th>
                <th>Días restantes</th>
              </tr>
            </thead>
            <tbody>
              {supplyDuration(state).map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.name}</th>
                  <td>{item.initialized ? amount.format(item.remaining) : 'Sin saldo inicial'}</td>
                  <td>{item.days == null ? '—' : amount.format(item.days)}</td>
                  <td>{item.cups == null ? '—' : amount.format(item.cups)}</td>
                  <td>{item.days == null ? '—' : amount.format(item.days * Math.max(0, item.remaining))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </InventoryTable>
      <InventoryTable
        title="Líquido por sabor"
        description={`Consulta el saldo en uso y la diferencia de hasta ${window} bolsas terminadas por sabor.`}
      >
        <p className="inventory-table-note">
          {settings.liquidTolerance === null
            ? 'Configura la tolerancia para señalar diferencias positivas.'
            : `Tolerancia configurada ${amount.format(settings.liquidTolerance * 100)} %.`}{' '}
          Registra cada bolsa al abrirla. La siguiente apertura del mismo sabor da por terminada la bolsa
          anterior. Las degustaciones cuentan como merma esperada. El cálculo excluye el remanente fijo de la
          máquina.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sabor</th>
                <th>Saldo de bolsa en uso</th>
                <th>Bolsas terminadas</th>
                <th>Onzas servidas</th>
                <th>Merma esperada por degustaciones</th>
                <th>Diferencia acumulada</th>
              </tr>
            </thead>
            <tbody>
              {liquid.map((row) => (
                <tr key={row.flavorId}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{amount.format(row.remaining)} oz</td>
                  <td>
                    {row.completed.length}
                    {row.completed.map((bag) => (
                      <small className="inventory-bag-difference" key={bag.id}>
                        {date(bag.openedAt)} · {amount.format(bag.ounces)} oz · Diferencia{' '}
                        {signed.format(bag.difference)} oz
                      </small>
                    ))}
                  </td>
                  <td>{amount.format(row.completed.reduce((sum, bag) => sum + bag.served, 0))} oz</td>
                  <td>{amount.format(row.completed.reduce((sum, bag) => sum + bag.tastings, 0))} oz</td>
                  <td>{signed.format(row.difference)} oz</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </InventoryTable>
      <InventoryTable
        title="Historial de aperturas"
        description="Consulta qué se abrió, quién lo registró y a qué turno pertenece."
      >
        {openings.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Registró</th>
                  <th>Turno</th>
                  <th>Fecha y hora de apertura</th>
                </tr>
              </thead>
              <tbody>
                {openings.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>
                        {item.kind} · {item.article}
                      </strong>
                    </td>
                    <td>{names.get(item.by) ?? item.by}</td>
                    <td>
                      {item.shift
                        ? `${date(item.shift.openedAt)} · ${names.get(item.shift.cashierId) ?? 'Caja'}`
                        : 'Sin turno vinculado'}
                    </td>
                    <td>{date(item.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sin aperturas registradas" />
        )}
      </InventoryTable>
      <InventoryTable
        title="Merma de líquido por quincena"
        description="Consulta los saldos y diferencias del histórico por quincena."
      >
        <LiquidFortnightReport state={state} />
      </InventoryTable>
    </>
  );
}

export function Inventory() {
  const app = useApp();
  const snapshot = app.data!;
  const { state, actor } = snapshot;
  const admin = actor.role === 'admin';
  const active = operatingShift(state);
  const canRecord = !!active && canWork(actor, state, 'inventory', active.id);
  const openings = !admin && active ? inventoryOpenings(state, active) : [];
  const [form, setForm] = useState<{ title: string; type: CommandType; fields: Field[] } | null>(null);
  const articleOptions = articles(state)
    .filter((item) => !item.id.startsWith('supply:'))
    .map((item) => ({
      value: item.id,
      label: `${item.name} (${item.unit})`,
    }));
  const [addingPackages, setAddingPackages] = useState(false);
  const [query, setQuery] = useState('');
  const availableSupplies = supplies(state).filter(
    (item) =>
      item.initialized && !(state.settings[0].v4Enabled && candies(state).some((c) => c.id === item.id)),
  );
  const openSupply = () =>
    setForm({
      title: 'Abrir insumo',
      type: 'open_supply',
      fields: [
        {
          name: 'article',
          label: 'Unidad cerrada abierta',
          type: 'select',
          required: true,
          options: availableSupplies.map((item) => ({
            value: item.id,
            label: `${item.name} · ${item.unit}`,
          })),
        },
      ],
    });
  const openBag = () =>
    setForm({
      title: 'Abrir bolsa de líquido',
      type: 'open_bag',
      fields: [
        {
          name: 'flavorId',
          label: 'Sabor',
          type: 'select',
          required: true,
          options: orderedFlavors(state.flavors).map((flavor) => ({ value: flavor.id, label: flavor.name })),
        },
      ],
    });
  const reportDamage = () =>
    setForm({
      title: 'Reportar daño',
      type: 'report_damage',
      fields: [
        { name: 'article', label: 'Artículo', type: 'select', required: true, options: articleOptions },
        { name: 'quantity', label: 'Cantidad', type: 'number', step: '0.001', min: 0.001, required: true },
        { name: 'notes', label: 'Motivo', type: 'textarea', required: true },
        { name: 'evidenceId', label: 'Fotografía', type: 'photo', required: true },
        {
          name: 'checklist',
          label: 'Bolsa sellada: verifiqué empaque, contenido y estado',
          type: 'checkbox',
        },
        { name: 'diagnosis', label: 'Diagnóstico de bolsa sellada (si aplica)', type: 'textarea' },
      ],
    });
  const proposeCorrection = () =>
    setForm({
      title: 'Proponer corrección de inventario',
      type: 'correct_inventory',
      fields: [
        { name: 'article', label: 'Artículo', type: 'select', required: true, options: articleOptions },
        {
          name: 'finalQuantity',
          label: 'Cantidad final en inventario',
          type: 'number',
          step: '0.000001',
          min: 0,
          max: 1_000_000,
          required: true,
          hint: 'Escribe el total que debe quedar. Por ejemplo, 15 deja el inventario en 15. Puedes escribir 0.',
        },
        { name: 'notes', label: 'Motivo', type: 'textarea', required: true },
      ],
    });
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <h2>Inventario</h2>
        {addingPackages && <AddPackages onClose={() => setAddingPackages(false)} />}
        <div className="button-row">
          <button className="button secondary" disabled={!canRecord} onClick={() => setAddingPackages(true)}>
            <PackageOpen size={17} /> Agregar paquetes
          </button>
          <button
            className="button secondary"
            disabled={!canRecord || !availableSupplies.length}
            onClick={openSupply}
          >
            Abrir insumo
          </button>
          <button className="button primary" disabled={!canRecord} onClick={openBag}>
            <Droplets size={17} /> Abrir bolsa de líquido
          </button>
          <button className="button secondary" disabled={admin ? false : !canRecord} onClick={reportDamage}>
            <AlertTriangle size={17} /> Reportar daño
          </button>
        </div>
      </div>
      {admin ? (
        <>
          {state.settings[0].v4Enabled && <V4Stock onCorrect={proposeCorrection} />}
          <AdminInventory snapshot={snapshot} onCorrect={proposeCorrection} />
        </>
      ) : (
        <Panel title="Aperturas del turno">
          {openings.length ? (
            openings.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>
                    {item.kind} · {item.article}
                  </strong>
                  <small>{date(item.openedAt)}</small>
                </div>
              </div>
            ))
          ) : (
            <Empty title="Sin aperturas en el turno" />
          )}
        </Panel>
      )}
      {form && (
        <Modal
          title={form.title}
          onClose={() => {
            setForm(null);
            setQuery('');
          }}
        >
          {form.type === 'open_bag' && (
            <p className="modal-intro">
              Al abrir una bolsa, se da por terminada la anterior del mismo sabor.
            </p>
          )}
          {state.settings[0].v4Enabled && ['open_bag', 'open_supply'].includes(form.type) && (
            <input
              className="search"
              aria-label="Buscar artículo para abrir"
              placeholder="Buscar…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <FieldsForm
            fields={form.fields.map((f) => ({
              ...f,
              options: f.options?.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())),
            }))}
            submit={form.type === 'correct_inventory' ? 'Proponer corrección' : 'Registrar'}
            onCancel={() => {
              setForm(null);
              setQuery('');
            }}
            onSubmit={async (values) => {
              await app.run(form.type, values);
              if (form.type !== 'correct_inventory') app.toast('Movimiento registrado.');
              setForm(null);
              setQuery('');
            }}
          />
        </Modal>
      )}
    </div>
  );
}
