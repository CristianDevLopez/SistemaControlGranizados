import { useState } from 'react';
import { candies, candyRecipe, additionRecipe, expenseCategories } from '../domain/v4-catalog.ts';
import { candyAdditions } from '../domain/additions.ts';
import type { V4Settings as Config } from '../domain/v4-types.ts';
import { useApp } from '../lib/store.tsx';
import { FieldsForm, Modal, Panel, date, money, type Field } from './components.tsx';
export const telegramTypes = [
  ['cierre', 'Cierre enviado'],
  ['apertura_diferencias', 'Apertura con diferencias'],
  ['traslado', 'Traslado en camino'],
  ['traslado_diferencias', 'Traslado recibido con diferencia'],
  ['gasto_pendiente', 'Gasto pendiente'],
  ['daño', 'Daño'],
  ['anulacion', 'Anulación'],
  ['envio_creado', 'Envío creado'],
  ['recepcion_completa', 'Recepción completa'],
  ['recepcion_diferencias', 'Recepción con novedades'],
  ['recepcion_resuelta', 'Recepción revisada'],
  ['caja_tope', 'Caja sobre el tope'],
  ['poco_inventario', 'Poco inventario'],
  ['merma_conciliada', 'Conciliación de merma'],
  ['cierre_resuelto', 'Cierre resuelto'],
  ['resumen', 'Resumen diario'],
  ['prueba', 'Mensaje de prueba'],
];
export const defaultTelegram: NonNullable<Config['telegram']> = {
  groups: [{ id: 'admins', name: 'Dexter’s · Admins', chatId: '-5480458026' }],
  rules: Object.fromEntries(telegramTypes.map(([type]) => [type, { enabled: true, groupId: 'admins' }])),
  dailyTime: '22:00',
};
export function V4Settings({ mode = 'catalog' }: { mode?: 'catalog' | 'telegram' }) {
  const app = useApp(),
    { state } = app.data!,
    settings = state.settings[0];
  const [form, setForm] = useState<{
    title: string;
    fields: Field[];
    save: (v: Record<string, any>) => Promise<unknown>;
  }>();
  const [error, setError] = useState('');
  const config = settings.v4 ?? {},
    telegram = config.telegram ?? defaultTelegram;
  const save = async (payload: Record<string, unknown>) => {
    setError('');
    try {
      await app.run('v4', payload);
      app.toast('Cambio guardado.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const recipeForm = (sizeId?: string, additionId?: string) => {
    const recipe = sizeId ? candyRecipe(state, sizeId) : additionRecipe(state, additionId!);
    setForm({
      title:
        'Receta · ' +
        (state.sizes.find((s) => s.id === sizeId)?.name ??
          candyAdditions.find((a) => a.id === additionId)?.name),
      fields: candies(state).map((c) => ({
        name: c.id,
        label: c.name + ' (' + c.unit + ')',
        type: 'number',
        min: 0,
        step: '0.001',
        value: recipe[c.id] ?? 0,
        required: true,
      })),
      save: (v) => app.run('v4', { action: 'recipe', sizeId, additionId, recipe: v }),
    });
  };
  return (
    <div className="page-stack">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {mode === 'telegram' ? (
        <>
          <Panel
            title="Grupos de Telegram"
            action={
              <button
                className="button secondary"
                onClick={() =>
                  setForm({
                    title: 'Agregar grupo',
                    fields: [
                      { name: 'name', label: 'Nombre', required: true },
                      { name: 'chatId', label: 'Identificador del grupo (chat_id)', required: true },
                    ],
                    save: (values) =>
                      app.run('v4', {
                        action: 'configure',
                        telegram: {
                          ...telegram,
                          groups: [...telegram.groups, { id: crypto.randomUUID(), ...values }],
                        },
                      }),
                  })
                }
              >
                Agregar grupo
              </button>
            }
          >
            {telegram.groups.map((g) => (
              <div className="list-row" key={g.id}>
                <span>
                  {g.name} · {g.chatId}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    setForm({
                      title: 'Editar grupo',
                      fields: [
                        { name: 'name', label: 'Nombre', value: g.name, required: true },
                        { name: 'chatId', label: 'Identificador del grupo', value: g.chatId, required: true },
                      ],
                      save: (values) =>
                        app.run('v4', {
                          action: 'configure',
                          telegram: {
                            ...telegram,
                            groups: telegram.groups.map((old) =>
                              old.id === g.id ? { ...old, ...values } : old,
                            ),
                          },
                        }),
                    })
                  }
                >
                  Editar
                </button>
              </div>
            ))}
          </Panel>
          <Panel title="Tipos de aviso">
            {telegramTypes.map(([type, label]) => {
              const rule = telegram.rules[type] ?? { enabled: true, groupId: telegram.groups[0].id };
              return (
                <div className="list-row" key={type}>
                  <label className="check-inline">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) =>
                        void save({
                          action: 'configure',
                          telegram: {
                            ...telegram,
                            rules: { ...telegram.rules, [type]: { ...rule, enabled: e.target.checked } },
                          },
                        })
                      }
                    />
                    {label}
                  </label>
                  <select
                    aria-label={'Grupo para ' + label}
                    value={rule.groupId}
                    onChange={(e) =>
                      void save({
                        action: 'configure',
                        telegram: {
                          ...telegram,
                          rules: { ...telegram.rules, [type]: { ...rule, groupId: e.target.value } },
                        },
                      })
                    }
                  >
                    {telegram.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            <FieldsForm
              key={telegram.dailyTime}
              fields={[
                {
                  name: 'dailyTime',
                  label: 'Hora del resumen diario (Colombia)',
                  type: 'time',
                  required: true,
                  value: telegram.dailyTime,
                },
              ]}
              onSubmit={(v) =>
                app.run('v4', { action: 'configure', telegram: { ...telegram, dailyTime: v.dailyTime } })
              }
            />
            <button className="button primary" onClick={() => void save({ action: 'test_notice' })}>
              Enviar mensaje de prueba
            </button>
          </Panel>
        </>
      ) : (
        <>
          <Panel
            title="Dulces"
            action={
              <button
                className="button primary"
                onClick={() =>
                  setForm({
                    title: 'Agregar dulce',
                    fields: [
                      { name: 'name', label: 'Nombre', required: true },
                      {
                        name: 'unit',
                        label: 'Se maneja en',
                        type: 'select',
                        value: 'unidades',
                        options: [
                          { value: 'unidades', label: 'Unidades' },
                          { value: 'oz', label: 'Onzas' },
                          { value: 'g', label: 'Gramos' },
                        ],
                      },
                      {
                        name: 'perBag',
                        label: 'Cuánto trae una bolsa',
                        type: 'number',
                        min: 0.001,
                        step: '.001',
                        required: true,
                      },
                      {
                        name: 'cost',
                        label: 'Costo de la bolsa',
                        type: 'money',
                        min: 0,
                        value: 0,
                        required: true,
                      },
                    ],
                    save: (v) => app.run('v4', { action: 'candy', ...v }),
                  })
                }
              >
                Agregar dulce
              </button>
            }
          >
            {candies(state).map((c) => (
              <div className="list-row" key={c.id}>
                <span>
                  {c.name} · Bolsa de {c.perBag} {c.unit} · {money(c.cost)}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    setForm({
                      title: 'Editar ' + c.name,
                      fields: [
                        { name: 'name', label: 'Nombre', value: c.name, required: true },
                        {
                          name: 'unit',
                          label: 'Unidad',
                          type: 'select',
                          value: c.unit,
                          options: ['unidades', 'oz', 'g'].map((value) => ({ value, label: value })),
                        },
                        {
                          name: 'perBag',
                          label: 'Contenido por bolsa',
                          type: 'number',
                          min: 0.001,
                          step: '.001',
                          value: c.perBag,
                          required: true,
                        },
                        {
                          name: 'cost',
                          label: 'Costo por bolsa',
                          type: 'money',
                          min: 0,
                          value: c.cost,
                          required: true,
                        },
                      ],
                      save: (v) => app.run('v4', { action: 'candy', id: c.id, ...v }),
                    })
                  }
                >
                  Editar
                </button>
              </div>
            ))}
          </Panel>
          <Panel title="Recetas por tamaño">
            {state.sizes.map((s) => (
              <div className="list-row" key={s.id}>
                <span>{s.name}</span>
                <button className="text-button" onClick={() => recipeForm(s.id)}>
                  Editar receta
                </button>
              </div>
            ))}
          </Panel>
          <Panel title="Recetas de adiciones">
            {candyAdditions.map((a) => (
              <div className="list-row" key={a.id}>
                <span>{a.name}</span>
                <button className="text-button" onClick={() => recipeForm(undefined, a.id)}>
                  Editar consumo
                </button>
              </div>
            ))}
          </Panel>
          <Panel title="Parámetros de inventario y mermas">
            <FieldsForm
              fields={[
                {
                  name: 'candyTolerance',
                  label: 'Tolerancia de dulces (0,10 = 10 %)',
                  type: 'number',
                  min: 0,
                  max: 1,
                  step: '.01',
                  value: config.candyTolerance ?? 0.1,
                  required: true,
                },
                {
                  name: 'lowStockDays',
                  label: 'Avisar cuando alcance para menos de estos días',
                  type: 'number',
                  min: 1,
                  value: config.lowStockDays ?? 3,
                  required: true,
                },
                {
                  name: 'lossDays',
                  label: 'Cerrar mermas abiertas como pérdida después de estos días',
                  type: 'number',
                  min: 1,
                  value: config.lossDays ?? 30,
                  required: true,
                },
              ]}
              onSubmit={(v) => app.run('v4', { action: 'configure', ...v })}
            />
          </Panel>
          <Panel
            title="Grupos y categorías de gastos"
            action={
              <button
                className="button secondary"
                onClick={() =>
                  setForm({
                    title: 'Agregar categoría',
                    fields: [
                      { name: 'name', label: 'Categoría', required: true },
                      { name: 'group', label: 'Grupo', required: true },
                      {
                        name: 'nature',
                        label: 'Clasificación',
                        type: 'select',
                        value: 'Costo',
                        options: ['Costo', 'Gasto'].map((value) => ({ value, label: value })),
                      },
                      {
                        name: 'behavior',
                        label: 'Comportamiento',
                        type: 'select',
                        value: 'Variable',
                        options: ['Fijo', 'Variable'].map((value) => ({ value, label: value })),
                      },
                      { name: 'adminOnly', label: 'Solo administradores', type: 'checkbox' },
                    ],
                    save: (v) =>
                      app.run('v4', { action: 'categories', categories: [...expenseCategories(state), v] }),
                  })
                }
              >
                Agregar categoría
              </button>
            }
          >
            {expenseCategories(state).map((c, index) => (
              <div className="list-row" key={c.name}>
                <span>
                  {c.group} · {c.name} · {c.nature} · {c.behavior}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    setForm({
                      title: 'Editar categoría',
                      fields: [
                        { name: 'name', label: 'Categoría', value: c.name, required: true },
                        { name: 'group', label: 'Grupo', value: c.group, required: true },
                        {
                          name: 'nature',
                          label: 'Clasificación',
                          type: 'select',
                          value: c.nature,
                          options: ['Costo', 'Gasto'].map((value) => ({ value, label: value })),
                        },
                        {
                          name: 'behavior',
                          label: 'Comportamiento',
                          type: 'select',
                          value: c.behavior,
                          options: ['Fijo', 'Variable'].map((value) => ({ value, label: value })),
                        },
                        {
                          name: 'adminOnly',
                          label: 'Solo administradores',
                          type: 'checkbox',
                          value: c.adminOnly,
                        },
                      ],
                      save: (v) =>
                        app.run('v4', {
                          action: 'categories',
                          categories: expenseCategories(state).map((old, i) => (i === index ? v : old)),
                        }),
                    })
                  }
                >
                  Editar
                </button>
              </div>
            ))}
            {!config.expensesMigratedAt && (
              <details>
                <summary>Revisar y reclasificar gastos anteriores</summary>
                <p>
                  Revisa las equivalencias antes de confirmar. Insumos pasa a Mercancía e insumos, Transporte
                  a Logística, Aseo y Mantenimiento a Operación.
                </p>
                <FieldsForm
                  fields={state.expenses.map((e) => ({
                    name: e.id,
                    label: date(e.at) + ' · ' + e.category + ' · ' + money(e.amount),
                    type: 'select',
                    options: expenseCategories(state).map((c) => ({
                      value: c.name,
                      label: c.group + ' · ' + c.name,
                    })),
                  }))}
                  submit="Confirmar reclasificación"
                  onSubmit={(v) =>
                    app.run('v4', {
                      action: 'migrate_expenses',
                      overrides: Object.fromEntries(Object.entries(v).filter(([, value]) => !!value)),
                    })
                  }
                />
              </details>
            )}
          </Panel>
        </>
      )}
      {form && (
        <Modal title={form.title} onClose={() => setForm(undefined)}>
          <FieldsForm
            fields={form.fields}
            onSubmit={async (v) => {
              await form.save(v);
              setForm(undefined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
