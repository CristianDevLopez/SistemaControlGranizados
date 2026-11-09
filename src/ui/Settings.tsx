import { useState } from 'react';
import {
  Plus,
  SlidersHorizontal,
  Users,
  Smartphone,
  Landmark,
  Target,
  Clock3,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { getMeta, setMeta, type OfflineAuthorizer } from '../lib/db.ts';
import type { CommandType } from '../domain/types.ts';
import {
  Badge,
  Empty,
  FieldsForm,
  Modal,
  Panel,
  date,
  localDateTime,
  money,
  utc,
  type Field,
} from './components.tsx';
export function Settings() {
  const app = useApp(),
    { state, actor, profiles, devices } = app.data!,
    settings = state.settings[0];
  const [tab, setTab] = useState('catalog'),
    [form, setForm] = useState<{
      title: string;
      fields: Field[];
      initial?: Record<string, unknown>;
      save: (values: Record<string, any>) => Promise<unknown>;
    } | null>(null),
    [code, setCode] = useState<string | null>(null),
    [error, setError] = useState('');
  const businessForm = (
    title: string,
    type: CommandType,
    fields: Field[],
    initial?: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    setForm({
      title,
      fields,
      initial,
      save: async (v) => {
        await app.run(type, { ...extra, ...v });
      },
    });
  /** Campos de una caja o cuenta. Al editar, el saldo inicial ya no cambia. */
  const locationFields = (edit: boolean): Field[] => [
    { name: 'name', label: 'Nombre del destino', required: true },
    {
      name: 'type',
      label: 'Tipo',
      type: 'select',
      required: true,
      value: 'bank',
      options: [
        { value: 'bank', label: 'Cuenta bancaria de un admin' },
        { value: 'treasury', label: 'Caja principal en custodia' },
      ],
    },
    {
      name: 'custodianId',
      label: 'Administrador que recibe y custodia',
      type: 'select',
      required: true,
      options: profiles
        .filter((x) => x.active && x.role === 'admin')
        .map((x) => ({ value: x.id, label: x.name })),
    },
    { name: 'bank', label: 'Banco (si es cuenta)' },
    { name: 'account', label: 'Cuenta o referencia para consignar' },
    ...(edit
      ? []
      : [
          {
            name: 'openingBalance',
            label: 'Saldo inicial del negocio bajo esta custodia',
            type: 'money',
            value: 0,
            min: 0,
            required: true,
          } satisfies Field,
        ]),
    {
      name: 'receivesSales',
      label: 'Recibe transferencias de clientes (Nequi, Daviplata, Bre-B)',
      type: 'checkbox',
      hint: 'Aparece como opción al cobrar. Solo aplica a cuentas bancarias.',
    },
    { name: 'active', label: 'Destino activo', type: 'checkbox', value: true },
  ];
  const invoke = async (path: string, body: unknown) => {
    try {
      await api(path, body);
      await app.load();
      app.toast('Cambio guardado.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const tabs = [
    ['catalog', 'Catálogo'],
    ['parameters', 'Parámetros'],
    ['team', 'Equipo y accesos'],
    ['accounts', 'Cuentas y custodia'],
    ['goals', 'Metas'],
    ['history', 'Histórico'],
  ];
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>El negocio, a tu medida</h2>
          <p>
            El catálogo y los parámetros se guardan directamente con tu usuario, sin aprobación de otro admin.
            Cada cambio conserva su histórico.
          </p>
        </div>
      </div>
      <div className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {tab === 'catalog' && (
        <>
          <Panel
            title="Sabores reales"
            action={
              <button
                className="button primary small"
                onClick={() =>
                  businessForm('Agregar sabor', 'save_flavor', [
                    { name: 'name', label: 'Nombre del sabor', required: true },
                    { name: 'alcohol', label: 'Contiene licor', type: 'checkbox' },
                    { name: 'active', label: 'Disponible para vender', type: 'checkbox', value: true },
                  ])
                }
              >
                <Plus size={16} />
                Agregar sabor
              </button>
            }
          >
            {state.flavors.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sabor</th>
                      <th>Tipo</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.flavors.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <strong>{f.name}</strong>
                        </td>
                        <td>{f.alcohol ? 'Con licor' : 'Sin licor'}</td>
                        <td>
                          <Badge tone={f.active ? 'green' : 'neutral'}>
                            {f.active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() =>
                              businessForm(
                                'Editar sabor',
                                'save_flavor',
                                [
                                  { name: 'name', label: 'Nombre', required: true },
                                  { name: 'alcohol', label: 'Contiene licor', type: 'checkbox' },
                                  { name: 'active', label: 'Activo', type: 'checkbox' },
                                ],
                                { ...f },
                                { id: f.id },
                              )
                            }
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Agrega los sabores de Dexter’s"
                description="Cada sabor define si contiene licor. No se han creado productos ficticios."
              />
            )}
          </Panel>
          <Panel title="Tamaños, precios y composición">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tamaño</th>
                    <th>Con licor</th>
                    <th>Sin licor</th>
                    <th>Consumo</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.sizes.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{s.alcoholPrice === null ? 'Por definir' : money(s.alcoholPrice)}</td>
                      <td>{s.plainPrice === null ? 'Por definir' : money(s.plainPrice)}</td>
                      <td>
                        {s.ounces} oz · {s.cups} vaso(s) · {s.beers} coronita(s)
                      </td>
                      <td>
                        <Badge tone={s.active ? 'green' : 'orange'}>
                          {s.active ? 'Activo' : 'Pendiente / inactivo'}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            businessForm(
                              `Configurar ${s.name}`,
                              'save_size',
                              [
                                { name: 'alcoholPrice', label: 'Precio con licor', type: 'money', min: 1 },
                                { name: 'plainPrice', label: 'Precio sin licor', type: 'money', min: 1 },
                                {
                                  name: 'ounces',
                                  label: 'Onzas efectivas de granizado',
                                  type: 'number',
                                  step: '0.001',
                                  min: 0,
                                  required: true,
                                },
                                {
                                  name: 'cups',
                                  label: 'Vasos por unidad',
                                  type: 'number',
                                  min: 0,
                                  required: true,
                                },
                                {
                                  name: 'beers',
                                  label: 'Coronitas por unidad',
                                  type: 'number',
                                  min: 0,
                                  required: true,
                                },
                                { name: 'active', label: 'Disponible para vender', type: 'checkbox' },
                              ],
                              { ...s },
                              { id: s.id },
                            )
                          }
                        >
                          Configurar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      {tab === 'parameters' && (
        <Panel title="Parámetros de operación">
          <FieldsForm
            key={settings.version}
            fields={[
              { name: 'businessName', label: 'Nombre del negocio', required: true },
              {
                name: 'cashLimit',
                label: 'Tope de efectivo por caja',
                type: 'money',
                min: 0,
                required: true,
              },
              {
                name: 'expenseLimit',
                label: 'Tope de un gasto pagado desde caja',
                type: 'money',
                min: 0,
                required: true,
              },
              {
                name: 'expenseCategories',
                label: 'Categorías permitidas desde caja (separadas por coma)',
                type: 'textarea',
                required: true,
              },
              {
                name: 'courtesyQuota',
                label: 'Cortesías por admin al mes',
                type: 'number',
                min: 0,
                required: true,
              },
              { name: 'cupPackageUnits', label: 'Vasos por paquete', type: 'number', min: 1, required: true },
              {
                name: 'bagOunces',
                label: 'Onzas de referencia por bolsa',
                type: 'number',
                min: 0.001,
                step: '0.000001',
                required: true,
              },
              {
                name: 'liquidTolerance',
                label: 'Tolerancia de líquido (%)',
                type: 'number',
                min: 0,
                max: 100,
                step: '0.1',
                hint: 'Deja en blanco mientras se mide la línea base. No se descuenta automáticamente.',
              },
              {
                name: 'syncWarningMinutes',
                label: 'Aviso tras minutos sin sincronizar',
                type: 'number',
                min: 1,
                max: 1440,
                required: true,
              },
              {
                name: 'skipOpeningCount',
                label: 'Permitir omitir conteo de apertura y marcarlo pendiente',
                type: 'checkbox',
              },
              { name: 'baseline', label: 'Período de medición de línea base', type: 'checkbox' },
              {
                name: 'openingChecklist',
                label: 'Checklist de apertura',
                type: 'textarea',
                hint: 'Una tarea por línea, según el procedimiento del negocio.',
              },
              {
                name: 'closingChecklist',
                label: 'Checklist de cierre',
                type: 'textarea',
                hint: 'Una tarea por línea. Se conserva la versión presentada en cada conteo.',
              },
            ]}
            initial={{
              ...settings,
              expenseCategories: settings.expenseCategories.join(', '),
              openingChecklist: (settings.openingChecklist ?? []).join('\n'),
              closingChecklist: (settings.closingChecklist ?? []).join('\n'),
              liquidTolerance: settings.liquidTolerance === null ? '' : settings.liquidTolerance * 100,
            }}
            submit="Publicar configuración"
            onSubmit={async (v) => {
              await app.run('configure', {
                ...v,
                openingChecklist: v.openingChecklist
                  .split('\n')
                  .map((s: string) => s.trim())
                  .filter(Boolean),
                closingChecklist: v.closingChecklist
                  .split('\n')
                  .map((s: string) => s.trim())
                  .filter(Boolean),
                expenseCategories: v.expenseCategories
                  .split(',')
                  .map((x: string) => x.trim())
                  .filter(Boolean),
                liquidTolerance: v.liquidTolerance === null ? null : v.liquidTolerance / 100,
              });
              app.toast('Configuración publicada. Los cierres anteriores conservan sus valores originales.');
            }}
          />
        </Panel>
      )}
      {tab === 'team' && (
        <>
          <Panel
            title="Usuarios"
            action={
              <button
                className="button primary small"
                onClick={() =>
                  setForm({
                    title: 'Crear usuario',
                    fields: [
                      { name: 'name', label: 'Nombre', required: true },
                      { name: 'username', label: 'Usuario (minúsculas, sin espacios)', required: true },
                      {
                        name: 'role',
                        label: 'Rol',
                        type: 'select',
                        required: true,
                        value: 'apoyo',
                        options: [
                          { value: 'apoyo', label: 'Apoyo: pedidos y entregas' },
                          { value: 'encargado', label: 'Encargado de caja' },
                          { value: 'admin', label: 'Administrador' },
                        ],
                      },
                      { name: 'pin', label: 'PIN de seis dígitos (empleados)', type: 'password' },
                      { name: 'email', label: 'Correo (solo admin)', type: 'email' },
                      {
                        name: 'password',
                        label: 'Contraseña de al menos 14 caracteres (solo admin)',
                        type: 'password',
                      },
                    ],
                    save: async (v) => {
                      await api('users', v);
                      await app.load();
                    },
                  })
                }
              >
                <Plus size={16} />
                Crear usuario
              </button>
            }
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <small>{p.username ?? 'Administrador inicial'}</small>
                      </td>
                      <td>
                        {p.role === 'encargado'
                          ? 'Encargado'
                          : p.role === 'apoyo'
                            ? 'Apoyo'
                            : 'Administrador'}
                      </td>
                      <td>
                        <Badge tone={p.active ? 'green' : 'neutral'}>
                          {p.active ? 'Activo' : 'Desactivado'}
                        </Badge>
                      </td>
                      <td>
                        <div className="table-actions">
                          {p.role !== 'admin' && p.active && (
                            <button
                              className="button small secondary"
                              onClick={() =>
                                setForm({
                                  title: `Registrar equipo de ${p.name}`,
                                  fields: [
                                    {
                                      name: 'primary',
                                      label: 'Será el equipo principal de caja (sin turno abierto)',
                                      type: 'checkbox',
                                    },
                                  ],
                                  save: async (v) => {
                                    const result = await api('devices/invite', { userId: p.id, ...v });
                                    setCode(result.code);
                                  },
                                })
                              }
                            >
                              Registrar dispositivo
                            </button>
                          )}
                          <button
                            className="text-button"
                            disabled={p.id === actor.id}
                            onClick={() => void invoke('users/update', { userId: p.id, active: !p.active })}
                          >
                            {p.active ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Dispositivos registrados">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Equipo</th>
                    <th>Usuario</th>
                    <th>Acceso</th>
                    <th>Última actividad</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Smartphone size={16} /> {d.name}
                      </td>
                      <td>{profiles.find((x) => x.id === d.userId)?.name}</td>
                      <td>
                        <Badge tone={d.primary ? 'green' : d.active ? 'blue' : 'neutral'}>
                          {d.primary ? 'Caja principal' : d.active ? 'Equipo conectado' : 'Desactivado'}
                        </Badge>
                      </td>
                      <td>{date(d.lastSeen)}</td>
                      <td>
                        <div className="table-actions">
                          {d.active && !d.primary && (
                            <button
                              className="text-button"
                              onClick={() => void invoke('devices/update', { deviceId: d.id, primary: true })}
                            >
                              Hacer principal
                            </button>
                          )}
                          <button
                            className="text-button"
                            disabled={d.id === actor.deviceId}
                            onClick={() =>
                              void invoke('devices/update', { deviceId: d.id, active: !d.active })
                            }
                          >
                            {d.active ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {actor.primary && (
            <Panel title="Apertura de contingencia">
              <p className="panel-copy">
                Habilita un permiso de un solo uso para autorizar presencialmente una apertura cuando fallen
                wifi y datos. Vence a los siete días.
              </p>
              <button
                className="button secondary"
                onClick={() =>
                  setForm({
                    title: 'Habilitar mi autorización offline en esta caja',
                    fields: [
                      {
                        name: 'pin',
                        label: 'PIN de contingencia de seis dígitos',
                        type: 'password',
                        required: true,
                      },
                    ],
                    save: async (v) => {
                      const permit = await api('offline-authorizer', v),
                        all = (await getMeta<OfflineAuthorizer[]>('offline-permits')) ?? [];
                      await setMeta('offline-permits', [
                        ...all.filter((x) => x.adminId !== actor.id || x.branchId !== actor.branchId),
                        permit,
                      ]);
                    },
                  })
                }
              >
                <ShieldCheck size={17} />
                Habilitar autorización presencial
              </button>
            </Panel>
          )}
        </>
      )}
      {tab === 'accounts' && (
        <Panel
          title="Destinos de dinero registrados"
          action={
            <button
              className="button primary small"
              onClick={() => businessForm('Registrar caja o cuenta', 'save_location', locationFields(false))}
            >
              <Plus size={16} />
              Registrar destino
            </button>
          }
        >
          <div className="notice info">
            Las cuentas de admins registran únicamente dinero del negocio bajo su custodia. Una consignación
            no es un retiro de utilidad.
          </div>
          {state.locations.map((l) => (
            <div className="list-row" key={l.id}>
              <div>
                <strong>{l.name}</strong>
                <small>
                  {l.type === 'bank' ? `${l.bank} · ${l.account}` : 'Caja principal'} ·{' '}
                  {profiles.find((x) => x.id === l.custodianId)?.name}
                  {l.receivesSales ? ' · Recibe transferencias de clientes' : ''}
                </small>
              </div>
              <Badge tone={l.active ? 'green' : 'neutral'}>{l.active ? 'Activo' : 'Inactivo'}</Badge>
              <button
                className="text-button"
                aria-label={`Editar ${l.name}`}
                onClick={() =>
                  businessForm(
                    'Editar caja o cuenta',
                    'save_location',
                    locationFields(true),
                    { ...l },
                    { id: l.id },
                  )
                }
              >
                Editar
              </button>
            </div>
          ))}
          {!state.locations.length && <Empty title="Registra quién recibirá los remanentes" />}
        </Panel>
      )}
      {tab === 'goals' && (
        <Panel
          title="Metas de ventas"
          action={
            <button
              className="button primary small"
              onClick={() =>
                setForm({
                  title: 'Crear meta',
                  fields: [
                    {
                      name: 'period',
                      label: 'Período',
                      type: 'select',
                      required: true,
                      value: 'week',
                      options: [
                        { value: 'week', label: 'Semanal' },
                        { value: 'month', label: 'Mensual' },
                      ],
                    },
                    {
                      name: 'startsAt',
                      label: 'Desde',
                      type: 'datetime-local',
                      required: true,
                      value: localDateTime(),
                    },
                    {
                      name: 'endsAt',
                      label: 'Hasta',
                      type: 'datetime-local',
                      required: true,
                      value: localDateTime(new Date(Date.now() + 7 * 86400000)),
                    },
                    { name: 'cups', label: 'Meta en vasos', type: 'number', min: 0, required: true },
                    { name: 'amount', label: 'Meta en pesos', type: 'money', min: 0, required: true },
                  ],
                  save: async (v) => {
                    await app.run('save_goal', { ...v, startsAt: utc(v.startsAt), endsAt: utc(v.endsAt) });
                  },
                })
              }
            >
              <Plus size={16} />
              Crear meta
            </button>
          }
        >
          {state.goals.map((g) => {
            const orders = state.orders.filter(
                (o) => o.status === 'paid' && o.paidAt! >= g.startsAt && o.paidAt! < g.endsAt,
              ),
              amount = orders.reduce((n, o) => n + o.total, 0),
              cups = orders.flatMap((o) => o.lines).reduce((n, l) => n + l.quantity, 0);
            return (
              <div className="goal-card" key={g.id}>
                <h3>{g.period === 'week' ? 'Meta semanal' : 'Meta mensual'}</h3>
                <small>
                  {date(g.startsAt)} — {date(g.endsAt)}
                </small>
                <p>
                  {money(amount)} de {money(g.amount)} · {cups} de {g.cups} vasos
                </p>
                <progress value={amount} max={g.amount || 1} />
              </div>
            );
          })}
          {!state.goals.length && <Empty title="Configura la primera meta" />}
        </Panel>
      )}
      {tab === 'history' && (
        <Panel title="Histórico de configuración">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Versión</th>
                  <th>Fecha</th>
                  <th>Responsable</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {[...state.parameters].reverse().map((p) => (
                  <tr key={p.id}>
                    <td>v{p.version}</td>
                    <td>{date(p.at)}</td>
                    <td>{profiles.find((x) => x.id === p.by)?.name ?? 'Configuración inicial'}</td>
                    <td>
                      {state.audit.find((a) => a.at === p.at)?.action ?? 'Cambio de catálogo o parámetros'}
                      <details>
                        <summary>Consultar valores</summary>
                        <pre>{JSON.stringify(p.after, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {form && (
        <Modal title={form.title} onClose={() => setForm(null)}>
          <FieldsForm
            fields={form.fields}
            initial={form.initial}
            onCancel={() => setForm(null)}
            onSubmit={async (v) => {
              await form.save(v);
              setForm(null);
              app.toast('Cambio guardado.');
            }}
          />
        </Modal>
      )}
      {code && (
        <Modal title="Código de registro de dispositivo" onClose={() => setCode(null)}>
          <div className="detail-content">
            <p>
              El empleado debe escribir este código junto con su usuario y PIN en «Registrar un dispositivo
              nuevo». Vence en 15 minutos y se utiliza una vez.
            </p>
            <code className="large-code">{code}</code>
            <button
              className="button primary"
              onClick={async () => {
                await navigator.clipboard.writeText(code);
                app.toast('Código copiado.');
              }}
            >
              Copiar código
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
