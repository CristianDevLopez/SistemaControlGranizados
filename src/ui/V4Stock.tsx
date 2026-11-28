import { useState } from 'react';
import { articles, stockBalances } from '../domain/engine.ts';
import { candies } from '../domain/v4-catalog.ts';
import { inventoryForecast } from '../domain/candy-forecast.ts';
import { useApp } from '../lib/store.tsx';
import { FieldsForm, Modal, Panel } from './components.tsx';
export function V4Stock({ onCorrect }: { onCorrect: () => void }) {
  const app = useApp(),
    { state } = app.data!;
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('all'),
    [count, setCount] = useState<string>(),
    [units, setUnits] = useState(false);
  const balances = stockBalances(state),
    candyIds = new Set(candies(state).map((c) => c.id));
  const matches = (id: string) =>
    category === 'all' ||
    (category === 'cups' && (id.startsWith('cup:') || id.startsWith('package:'))) ||
    (category === 'liquid' && id.startsWith('liquid:')) ||
    (category === 'bags' && id.startsWith('sealed_bag:')) ||
    (category === 'coolers' && ['nevera', 'coronita'].includes(id)) ||
    (category === 'supplies' && id.startsWith('supply:') && !candyIds.has(id)) ||
    (category === 'candies' && candyIds.has(id));
  const normalized = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  const rows = articles(state).filter(
    (a) =>
      matches(a.id) &&
      a.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes(normalized),
  );
  const forecasts = inventoryForecast(state, new Date().toISOString());
  const candy = candies(state).find((c) => c.id === count);
  return (
    <Panel
      title="Saldos de inventario"
      action={
        <button className="button secondary" onClick={onCorrect}>
          Proponer corrección de inventario
        </button>
      }
    >
      <input
        className="search"
        aria-label="Buscar en todo el inventario"
        placeholder="Buscar en todo el inventario…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="tabs">
        {[
          ['all', 'Todos'],
          ['cups', 'Vasos'],
          ['liquid', 'Líquido'],
          ['bags', 'Bolsas selladas'],
          ['coolers', 'Neveras y coronitas'],
          ['supplies', 'Insumos'],
          ['candies', 'Dulces'],
        ].map(([id, label]) => (
          <button key={id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Artículo</th>
              <th>Saldo</th>
              <th>Unidad</th>
              <th>Duración estimada</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const forecast = forecasts.find((f) => f.id === a.id);
              return (
                <tr key={a.id}>
                  <th>{a.name}</th>
                  <td>{Number((balances[a.id] ?? 0).toFixed(3))}</td>
                  <td>{a.unit}</td>
                  <td>{forecast?.until ?? 'Sin historial suficiente'}</td>
                  <td>
                    {candyIds.has(a.id) && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setCount(a.id);
                          setUnits(false);
                        }}
                      >
                        Contar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {candy && (
        <Modal title={'Contar ' + candy.name} onClose={() => setCount(undefined)}>
          {candy.unit === 'unidades' && (
            <label className="check-inline">
              <input type="checkbox" checked={units} onChange={(e) => setUnits(e.target.checked)} /> Contar la
              bolsa abierta por unidades
            </label>
          )}
          <FieldsForm
            key={String(units)}
            fields={[
              { name: 'bags', label: 'Bolsas cerradas', type: 'number', min: 0, value: 0, required: true },
              units
                ? {
                    name: 'units',
                    label: 'Unidades de la bolsa abierta',
                    type: 'number',
                    min: 0,
                    max: candy.perBag,
                    value: 0,
                    required: true,
                  }
                : {
                    name: 'fraction',
                    label: 'Bolsa abierta',
                    type: 'select',
                    value: '0',
                    options: [
                      { value: '0', label: 'Sin bolsa abierta' },
                      { value: '1', label: 'Llena' },
                      { value: '.75', label: '¾' },
                      { value: '.5', label: '½' },
                      { value: '.25', label: '¼' },
                      { value: '.05', label: 'Casi vacía (5 %)' },
                    ],
                  },
              { name: 'notes', label: 'Nota', type: 'textarea' },
            ]}
            onSubmit={async (values) => {
              await app.run('v4', {
                action: 'candy_count',
                article: candy.id,
                ...values,
                ...(!units ? { fraction: Number(values.fraction) } : {}),
              });
              setCount(undefined);
            }}
          />
        </Modal>
      )}
    </Panel>
  );
}
