import { candies } from '../domain/v4-catalog.ts';
import { useState } from 'react';
import { articles } from '../domain/engine.ts';
import { closingProposal } from '../domain/v4-closing.ts';
import type { Command, Count } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { FieldsForm, Modal, date, localDateTime, money, utc, type Field } from './components.tsx';
import { parseMoney } from '../lib/money.ts';

export function V4Closing({ count }: { count: Count }) {
  const app = useApp(),
    { state, actor, profiles } = app.data!,
    shift = state.shifts.find((s) => s.id === count.shiftId)!;
  const employee = state.counts.find((c) => c.id === shift.closingCountId) ?? count;
  const [corrections, setCorrections] = useState<Record<string, unknown>[]>([]),
    [items, setItems] = useState<Record<string, string>>({}),
    [cash, setCash] = useState(''),
    [notes, setNotes] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ kind: string; title: string; fields: Field[] }>();
  const [previewId] = useState(() => crypto.randomUUID());
  const latest = shift.v4Reviews?.at(-1);
  const names = new Map(articles(state).map((a) => [a.id, a.name]));
  const payload = {
    action: 'closing_proposal',
    shiftId: shift.id,
    corrections,
    notes: notes || 'Vista previa',
    items: Object.fromEntries(
      Object.entries(items)
        .filter(([, v]) => v !== '')
        .map(([id, v]) => [id, Number(v)]),
    ),
    ...(cash !== '' ? { cash: parseMoney(cash) } : {}),
  };
  let proposed = latest?.status !== 'rejected' ? latest?.count : undefined;
  let previewError = '';
  if (!proposed && actor.id !== shift.cashierId) {
    try {
      const copy = structuredClone(state);
      const command: Command = {
        id: previewId,
        branchId: actor.branchId,
        type: 'v4',
        actorId: actor.id,
        deviceId: actor.deviceId,
        at: new Date().toISOString(),
        sequence: 1,
        configVersion: state.settings[0].version,
        payload,
      };
      closingProposal({ state: copy, command, actor: { ...actor, online: true }, at: command.at });
      proposed = copy.shifts.find((s) => s.id === shift.id)?.v4Reviews?.at(-1)?.count;
    } catch (e) {
      previewError = (e as Error).message;
    }
  }
  const display = proposed ?? employee;
  const fieldNote: Field = { name: 'notes', label: 'Motivo', type: 'textarea', required: true };
  const action = (kind: string, title: string, fields: Field[]) =>
    setForm({ kind, title, fields: [...fields, fieldNote] });
  const orderOptions = state.orders
    .filter((o) => o.shiftId === shift.id && o.status === 'paid')
    .map((o) => ({ value: o.id, label: '#' + o.number + ' · ' + money(o.total) }));
  const paymentFields: Field[] = [
    {
      name: 'method',
      label: 'Medio de pago',
      type: 'select',
      value: 'cash',
      options: [
        { value: 'cash', label: 'Efectivo' },
        { value: 'transfer', label: 'Transferencia' },
      ],
    },
    {
      name: 'accountId',
      label: 'Cuenta de la transferencia',
      type: 'select',
      options: state.locations
        .filter((l) => l.active && l.type === 'bank')
        .map((l) => ({ value: l.id, label: l.name })),
    },
    { name: 'verified', label: 'Verifiqué el ingreso en la cuenta', type: 'checkbox' },
  ];
  const pending = latest?.status === 'pending',
    editable = (!latest || latest.status === 'rejected') && actor.id !== shift.cashierId;
  const submit = async (adjust: boolean) => {
    setBusy(true);
    setError('');
    try {
      await app.run('v4', {
        ...payload,
        notes,
        adjust,
        expectedPreview: { cash: display.expectedCash, items: display.expectedItems },
      });
      setCorrections([]);
      setItems({});
      setCash('');
      app.toast('Cierre confirmado.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fields-form">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {shift.cashierId === actor.id && (
        <p className="notice warning">Otro administrador debe confirmar tu cierre.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Artículo</th>
              <th>Contaste</th>
              <th>Debería haber</th>
              <th>Conteo del admin</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Efectivo</th>
              <td>{money(employee.cash ?? 0)}</td>
              <td>{money(display.expectedCash ?? 0)}</td>
              <td>
                {editable ? (
                  <input
                    aria-label="Conteo del admin · Efectivo"
                    value={cash}
                    placeholder={String(employee.cash ?? 0)}
                    onChange={(e) => setCash(e.target.value)}
                  />
                ) : (
                  money(display.cash ?? 0)
                )}
              </td>
              <td>{money(display.difference ?? 0)}</td>
            </tr>
            {Object.entries(employee.items).map(([id, n]) => (
              <tr key={id}>
                <th>{names.get(id) ?? id}</th>
                <td>{n}</td>
                <td>{display.expectedItems?.[id] ?? 0}</td>
                <td>
                  {editable ? (
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      aria-label={'Conteo del admin · ' + (names.get(id) ?? id)}
                      value={items[id] ?? ''}
                      placeholder={String(n)}
                      onChange={(e) => setItems((current) => ({ ...current, [id]: e.target.value }))}
                    />
                  ) : (
                    display.items[id]
                  )}
                </td>
                <td>{display.differences?.[id] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <>
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                action('opening_add', 'Agregar apertura olvidada', [
                  {
                    name: 'article',
                    label: 'Artículo cerrado',
                    type: 'select',
                    required: true,
                    options: articles(state)
                      .filter(
                        (a) =>
                          a.id.startsWith('package:') ||
                          a.id.startsWith('sealed_bag:') ||
                          (a.id.startsWith('supply:') && !candies(state).some((c) => c.id === a.id)),
                      )
                      .map((a) => ({ value: a.id, label: a.name })),
                  },
                  {
                    name: 'at',
                    label: 'Hora dentro del turno',
                    type: 'datetime-local',
                    required: true,
                    value: localDateTime(new Date(shift.closedAt ?? employee.at)),
                  },
                ])
              }
            >
              Agregar apertura
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                action('opening_remove', 'Quitar apertura', [
                  {
                    name: 'openingId',
                    label: 'Apertura',
                    type: 'select',
                    required: true,
                    options: [
                      ...state.packages.map((p) => ({
                        ...p,
                        label: 'Paquete ' + state.sizes.find((s) => s.id === p.sizeId)?.name,
                      })),
                      ...state.bags.map((b) => ({
                        ...b,
                        label: 'Bolsa ' + state.flavors.find((f) => f.id === b.flavorId)?.name,
                      })),
                    ]
                      .filter((o) => o.shiftId === shift.id && !o.voidedAt)
                      .map((o) => ({ value: o.id, label: o.label + ' · ' + date(o.openedAt) })),
                  },
                ])
              }
            >
              Quitar apertura
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                action('opening_move', 'Mover apertura de turno', [
                  {
                    name: 'openingId',
                    label: 'Apertura',
                    type: 'select',
                    required: true,
                    options: [...state.packages, ...state.bags]
                      .filter((o) => o.shiftId === shift.id && !o.voidedAt)
                      .map((o) => ({ value: o.id, label: date(o.openedAt) + ' · ' + o.id.slice(0, 8) })),
                  },
                  {
                    name: 'targetShiftId',
                    label: 'Turno de destino',
                    type: 'select',
                    required: true,
                    options: state.shifts
                      .filter((s) => s.id !== shift.id)
                      .map((s) => ({ value: s.id, label: date(s.openedAt ?? s.requestedAt) })),
                  },
                  { name: 'at', label: 'Hora en destino', type: 'datetime-local', required: true },
                ])
              }
            >
              Mover apertura
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                action('sale_add', 'Agregar venta sin registrar', [
                  {
                    name: 'sizeId',
                    label: 'Tamaño',
                    type: 'select',
                    required: true,
                    options: state.sizes.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })),
                  },
                  { name: 'alcohol', label: 'Con licor', type: 'checkbox' },
                  {
                    name: 'flavorId',
                    label: 'Sabor',
                    type: 'select',
                    required: true,
                    value: 'bomba',
                    options: [
                      { value: 'bomba', label: 'Bomba' },
                      ...state.flavors.filter((f) => f.active).map((f) => ({ value: f.id, label: f.name })),
                    ],
                  },
                  ...paymentFields,
                ])
              }
            >
              Agregar venta
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                action('sale_void', 'Anular venta de más', [
                  { name: 'orderId', label: 'Venta', type: 'select', required: true, options: orderOptions },
                ])
              }
            >
              Anular venta
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                action('payment', 'Cambiar medio de pago', [
                  { name: 'orderId', label: 'Venta', type: 'select', required: true, options: orderOptions },
                  ...paymentFields,
                ])
              }
            >
              Cambiar medio de pago
            </button>
          </div>
          {Object.entries(employee.differences ?? {})
            .filter(
              ([id, n]) =>
                id.startsWith('cup:') &&
                n === state.settings[0].cupPackageUnits &&
                (employee.differences?.[id.replace('cup:', 'package:')] ?? 0) === -1,
            )
            .map(([id]) => (
              <p className="notice info" key={id}>
                Sobran {state.settings[0].cupPackageUnits} vasos y falta 1 paquete. ¿Apertura sin registrar?{' '}
                <button
                  className="text-button"
                  onClick={() =>
                    setCorrections((c) => [
                      ...c,
                      {
                        kind: 'opening_add',
                        article: id.replace('cup:', 'package:'),
                        at: shift.closedAt ?? employee.at,
                        notes: 'Apertura olvidada detectada en el cierre',
                      },
                    ])
                  }
                >
                  Agregar apertura
                </button>
              </p>
            ))}
          {(employee.difference ?? 0) > 0 &&
            state.sizes
              .filter(
                (s) => employee.differences?.['cup:' + s.id] === -1 && s.alcoholPrice === employee.difference,
              )
              .map((s) => (
                <p className="notice info" key={s.id}>
                  Sobran {money(employee.difference!)} y falta 1 vaso de {s.name}.{' '}
                  <button
                    className="text-button"
                    onClick={() =>
                      setCorrections((c) => [
                        ...c,
                        {
                          kind: 'sale_add',
                          sizeId: s.id,
                          alcohol: true,
                          flavorId: 'bomba',
                          method: 'cash',
                          notes: 'Venta sin registrar detectada en el cierre',
                        },
                      ])
                    }
                  >
                    Agregar venta Bomba
                  </button>
                </p>
              ))}
          {corrections.map((c, i) => (
            <div className="list-row" key={i}>
              <span>
                {String(c.kind)} · {String(c.notes)}
              </span>
              <button
                className="text-button"
                onClick={() => setCorrections((list) => list.filter((_, n) => n !== i))}
              >
                Quitar
              </button>
            </div>
          ))}
          <label className="field">
            Nota del admin
            <textarea maxLength={1500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {previewError && <p className="form-error">{previewError}</p>}
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || !notes.trim() || !!previewError}
              onClick={() => void submit(true)}
            >
              Confirmar y ajustar inventario
            </button>
            <button
              className="button secondary"
              disabled={busy || !notes.trim() || !!previewError}
              onClick={() => void submit(false)}
            >
              Confirmar sin ajustar inventario
            </button>
          </div>
          <p>Sin ajustar inventario, la próxima apertura será un arqueo completo.</p>
        </>
      )}
      {pending && (
        <div className="notice warning">
          Propuesta v{latest.version} de {profiles.find((p) => p.id === latest.by)?.name}. Pendiente de otro
          administrador.
          {latest.by !== actor.id && shift.cashierId !== actor.id && (
            <FieldsForm
              fields={[fieldNote]}
              submit="Aprobar propuesta"
              onSubmit={async (values) => {
                await app.run('v4', {
                  action: 'closing_resolve',
                  shiftId: shift.id,
                  approve: true,
                  ...values,
                });
              }}
            >
              <button
                type="button"
                className="button secondary"
                onClick={() => action('reject', 'Rechazar propuesta', [])}
              >
                Rechazar con motivo
              </button>
            </FieldsForm>
          )}
        </div>
      )}
      {shift.v4Reviews?.map((v) => (
        <details key={v.id}>
          <summary>
            Versión {v.version} · {v.status} · {date(v.at)}
          </summary>
          <p>
            {v.notes} · {profiles.find((p) => p.id === v.by)?.name}
          </p>
          <p>
            {v.reviewNotes} · {v.reviewedAt && date(v.reviewedAt)}
          </p>
          <p>
            Merma de efectivo antes {money(Math.min(0, employee.difference ?? 0))} · después{' '}
            {money(Math.min(0, v.count.difference ?? 0))}
          </p>
          {v.corrections.map((c, i) => (
            <p key={i}>
              {String(c.kind)} · {String(c.notes)}
            </p>
          ))}
          <pre>
            {JSON.stringify(
              { antes: employee.expectedItems, despues: v.expected.items, diferencia: v.count.differences },
              null,
              2,
            )}
          </pre>
        </details>
      ))}
      {form && (
        <Modal title={form.title} onClose={() => setForm(undefined)}>
          <FieldsForm
            fields={form.fields}
            onSubmit={async (values) => {
              if (form.kind === 'reject')
                await app.run('v4', {
                  action: 'closing_resolve',
                  shiftId: shift.id,
                  approve: false,
                  ...values,
                });
              else
                setCorrections((list) => [
                  ...list,
                  { ...values, kind: form.kind, ...(values.at ? { at: utc(values.at) } : {}) },
                ]);
              setForm(undefined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
