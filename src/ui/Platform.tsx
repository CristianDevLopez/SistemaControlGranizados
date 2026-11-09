import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Receipt, CreditCard, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/store.tsx';
import { branchStatusLabels, type Branch, type PlatformView, type Invoice } from '../domain/platform.ts';
import {
  Badge,
  Empty,
  FieldsForm,
  Modal,
  Panel,
  Stat,
  money,
  localDateTime,
  type Field,
} from './components.tsx';

export function Platform() {
  const app = useApp();
  const [view, setView] = useState<PlatformView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [businessFilter, setBusinessFilter] = useState('');
  const [form, setForm] = useState<{
    title: string;
    route: string;
    fields: Field[];
    initial?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  } | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setView(await api<PlatformView>('platform/view'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!view) return <div role="status">{error || 'Cargando locales y mensualidades…'}</div>;
  const dev = view.developer;
  const today = localDateTime().slice(0, 10);
  const branches = view.branches.filter((b) => !businessFilter || b.businessId === businessFilter);
  const invoices = view.invoices.filter((i) => branches.some((b) => b.id === i.branchId));
  const active = branches.filter((b) => b.status === 'active');
  const balance = (invoice: Invoice) => (invoice.voided ? 0 : invoice.amount - invoice.paid);
  const localFields: Field[] = [
    { name: 'name', label: 'Nombre del local', required: true },
    { name: 'city', label: 'Ciudad o municipio' },
    { name: 'address', label: 'Dirección' },
  ];
  const configure = (branch: Branch) =>
    setForm({
      title: `Configurar ${branch.name}`,
      route: 'platform/branches/update',
      extra: { id: branch.id },
      initial: { ...branch, monthlyFee: branch.monthlyFee ?? '', billingStart: branch.billingStart ?? '' },
      fields: [
        ...localFields,
        {
          name: 'status',
          label: 'Estado del local',
          type: 'select',
          required: true,
          options: Object.entries(branchStatusLabels).map(([value, label]) => ({ value, label })),
        },
        {
          name: 'monthlyFee',
          label: 'Mensualidad por este local (COP)',
          type: 'number',
          min: 0,
          max: 1_000_000_000,
          required: true,
          hint: '0 permite una exención explícita. Los cambios se aplican a los próximos cobros.',
        },
        { name: 'billingStart', label: 'Inicio de cobro', type: 'date', required: true },
      ],
    });
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>{dev ? 'Propietarios, locales y mensualidades' : 'Mis locales y mensualidades'}</h2>
          <p>
            {dev
              ? 'Activa cada local y lleva el registro de sus cobros y pagos en pesos colombianos.'
              : 'Solicita locales adicionales y consulta el estado de sus mensualidades.'}
          </p>
        </div>
        <button className="button secondary" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={16} /> Actualizar
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="notice info">
        {dev
          ? 'Los cobros y los pagos se registran manualmente. Cada mensualidad corresponde a un mes calendario completo por local; no hay prorrateo automático.'
          : 'El desarrollador revisa tu solicitud, configura la tarifa y activa el nuevo local. Cada local tiene su propia mensualidad.'}
      </div>
      <div className="platform-tools">
        <label>
          Propietario / negocio
          <select value={businessFilter} onChange={(e) => setBusinessFilter(e.target.value)}>
            <option value="">Todos mis negocios</option>
            {view.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {dev && (
          <button
            className="button secondary"
            onClick={() =>
              setForm({
                title: 'Registrar propietario y primer local',
                route: 'platform/businesses',
                fields: [
                  { name: 'name', label: 'Nombre del negocio', required: true },
                  {
                    name: 'ownerId',
                    label: 'Usar una cuenta existente (opcional)',
                    type: 'select',
                    options: [
                      { value: '', label: 'Crear una cuenta nueva' },
                      ...view.owners.map((p) => ({ value: p.id, label: p.name })),
                    ],
                  },
                  { name: 'ownerName', label: 'Nombre del nuevo propietario' },
                  { name: 'email', label: 'Correo del nuevo propietario', type: 'email' },
                  {
                    name: 'password',
                    label: 'Contraseña inicial del nuevo propietario (14–200 caracteres)',
                    type: 'password',
                  },
                  {
                    name: 'localName',
                    label: 'Nombre del primer local',
                    required: true,
                    value: 'Local principal',
                  },
                  { name: 'city', label: 'Ciudad o municipio' },
                  { name: 'address', label: 'Dirección' },
                ],
              })
            }
          >
            <Plus size={16} /> Registrar propietario
          </button>
        )}
        {!!view.businesses.length && (
          <button
            className="button primary"
            onClick={() =>
              setForm({
                title: 'Solicitar nuevo local',
                route: 'platform/branches',
                fields: [
                  {
                    name: 'businessId',
                    label: 'Negocio propietario',
                    type: 'select',
                    required: true,
                    value: businessFilter || view.businesses[0].id,
                    options: view.businesses.map((b) => ({ value: b.id, label: b.name })),
                  },
                  ...localFields,
                ],
              })
            }
          >
            <Plus size={16} /> Solicitar local
          </button>
        )}
      </div>
      <div className="stats-grid">
        <Stat
          label="Locales activos"
          value={active.length}
          note={`${branches.filter((b) => b.status === 'requested').length} solicitudes pendientes`}
        />
        <Stat
          label="Mensualidad de locales activos"
          value={money(active.reduce((sum, b) => sum + (b.monthlyFee ?? 0), 0))}
          note={`${active.filter((b) => b.monthlyFee === null).length} locales con tarifa por configurar`}
        />
        <Stat
          label="Saldo pendiente registrado"
          value={money(invoices.reduce((sum, i) => sum + balance(i), 0))}
          note={`${invoices.filter((i) => balance(i) > 0 && i.dueDate < today).length} mensualidades vencidas`}
        />
      </div>
      <Panel title="Locales">
        <div className="branch-grid">
          {branches.map((b) => (
            <article className="branch-card" key={b.id}>
              <div className="branch-card-heading">
                <Building2 size={22} />
                <h3>{b.name}</h3>
                <Badge
                  tone={b.status === 'active' ? 'green' : b.status === 'requested' ? 'orange' : 'neutral'}
                >
                  {branchStatusLabels[b.status]}
                </Badge>
              </div>
              <p>{b.businessName}</p>
              <p>{[b.city, b.address].filter(Boolean).join(' · ') || 'Ubicación por completar'}</p>
              <strong>
                {b.monthlyFee === null ? 'Tarifa por configurar' : `${money(b.monthlyFee)} / mes`}
              </strong>
              {b.billingStart && <small>Inicio de cobro: {b.billingStart}</small>}
              <div className="platform-actions">
                <button
                  className="button secondary small"
                  disabled={busy || !app.online || app.data?.actor.branchId === b.id}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await app.switchBranch(b.id);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {app.data?.actor.branchId === b.id ? 'Local seleccionado' : 'Abrir local'}
                </button>
                {dev && (
                  <button className="button secondary small" onClick={() => configure(b)}>
                    Configurar y activar
                  </button>
                )}
                {dev && b.status === 'active' && b.monthlyFee !== null && b.billingStart && (
                  <button
                    className="button secondary small"
                    onClick={() =>
                      setForm({
                        title: `Registrar mensualidad · ${b.name}`,
                        route: 'platform/invoices',
                        extra: { branchId: b.id },
                        fields: [
                          {
                            name: 'period',
                            label: 'Mes a cobrar',
                            type: 'month',
                            required: true,
                            value: today.slice(0, 7),
                          },
                          {
                            name: 'dueDate',
                            label: 'Fecha límite de pago',
                            type: 'date',
                            required: true,
                            value: today,
                          },
                        ],
                      })
                    }
                  >
                    <Receipt size={15} /> Registrar mensualidad
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {!branches.length && <Empty title="No hay locales para este negocio" />}
      </Panel>
      <Panel title="Historial de mensualidades">
        {!invoices.length ? (
          <Empty title="Aún no hay mensualidades registradas" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Local</th>
                  <th>Periodo</th>
                  <th>Vencimiento</th>
                  <th>Valor</th>
                  <th>Pagado</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                  {dev && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{branches.find((b) => b.id === i.branchId)?.name}</td>
                    <td>{i.period.slice(0, 7)}</td>
                    <td>{i.dueDate}</td>
                    <td>{money(i.amount)}</td>
                    <td>{money(i.paid)}</td>
                    <td>{money(balance(i))}</td>
                    <td>
                      <Badge
                        tone={
                          i.voided ? 'neutral' : !balance(i) ? 'green' : i.dueDate < today ? 'red' : 'orange'
                        }
                      >
                        {i.voided
                          ? 'Anulada'
                          : !balance(i)
                            ? 'Pagada'
                            : i.dueDate < today
                              ? 'Vencida'
                              : i.paid
                                ? 'Pago parcial'
                                : 'Pendiente'}
                      </Badge>
                      {i.voided && <small>{i.voidReason}</small>}
                    </td>
                    {dev && (
                      <td>
                        <div className="platform-actions">
                          {balance(i) > 0 && (
                            <button
                              className="button secondary small"
                              onClick={() =>
                                setForm({
                                  title: 'Registrar pago recibido',
                                  route: 'platform/payments',
                                  extra: { id: crypto.randomUUID(), invoiceId: i.id },
                                  fields: [
                                    {
                                      name: 'amount',
                                      label: 'Valor recibido (COP)',
                                      type: 'number',
                                      required: true,
                                      min: 1,
                                      max: balance(i),
                                      value: balance(i),
                                    },
                                    {
                                      name: 'paidAt',
                                      label: 'Fecha del pago',
                                      type: 'date',
                                      required: true,
                                      value: today,
                                    },
                                    { name: 'reference', label: 'Referencia o comprobante', required: true },
                                  ],
                                })
                              }
                            >
                              <CreditCard size={15} /> Registrar pago
                            </button>
                          )}
                          {!i.voided && i.paid === 0 && (
                            <button
                              className="button secondary small"
                              onClick={() =>
                                setForm({
                                  title: 'Anular mensualidad sin pagos',
                                  route: 'platform/invoices/void',
                                  extra: { id: i.id },
                                  fields: [
                                    {
                                      name: 'reason',
                                      label: 'Motivo de anulación',
                                      type: 'textarea',
                                      required: true,
                                    },
                                  ],
                                })
                              }
                            >
                              Anular
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {!!view.payments.length && (
        <Panel title="Pagos recibidos">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Local / periodo</th>
                  <th>Fecha</th>
                  <th>Valor</th>
                  <th>Referencia</th>
                </tr>
              </thead>
              <tbody>
                {view.payments
                  .filter((p) => invoices.some((i) => i.id === p.invoiceId))
                  .map((p) => {
                    const i = invoices.find((i) => i.id === p.invoiceId)!;
                    return (
                      <tr key={p.id}>
                        <td>
                          {branches.find((b) => b.id === i.branchId)?.name} · {i.period.slice(0, 7)}
                        </td>
                        <td>{p.paidAt}</td>
                        <td>{money(p.amount)}</td>
                        <td>{p.reference}</td>
                      </tr>
                    );
                  })}
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
            onSubmit={async (values) => {
              const payload = { ...form.extra, ...values };
              if (form.route === 'platform/invoices') payload.period = `${values.period}-01`;
              await api(form.route, payload);
              setForm(null);
              await refresh();
              await app.load();
              app.toast('Registro guardado.');
            }}
          />
        </Modal>
      )}
    </div>
  );
}
