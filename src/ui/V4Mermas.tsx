import { useState } from 'react';
import { articles } from '../domain/engine.ts';
import { businessDay, periodStart } from '../domain/business-date.ts';
import type { Request } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { Badge, Empty, FieldsForm, Modal, Panel, Stat, date, money, type Field } from './components.tsx';
import { EvidenceButton } from './EvidenceButton.tsx';
import { LiquidFortnightReport } from './LiquidFortnightReport.tsx';

export function V4Mermas() {
  const app = useApp(),
    { state, actor, profiles } = app.data!;
  const [type, setType] = useState('Todas'),
    [status, setStatus] = useState('all'),
    [period, setPeriod] = useState('month'),
    [article, setArticle] = useState('');
  const [selected, setSelected] = useState<Request>(),
    [kind, setKind] = useState('product');
  const [receipt, setReceipt] = useState<{ id: string; article: string }>();
  const [surplus, setSurplus] = useState('');
  const names = new Map(articles(state).map((a) => [a.id, a.name]));
  const availableSurplus = (countId: string, articleId: string, amount: number) =>
    amount -
    state.requests
      .filter((r) => r.merma?.article === articleId && !r.merma.superseded)
      .flatMap((r) => r.merma!.recoveries)
      .filter((r) => r.from === countId)
      .reduce((n, r) => n + r.quantity, 0);
  const hints = state.counts.flatMap((c) =>
    Object.entries(c.differences ?? {}).flatMap(([articleId, amount]) => {
      const remaining = availableSurplus(c.id, articleId, amount);
      const recent = state.requests
        .filter(
          (r) =>
            r.merma?.article === articleId &&
            !r.merma.superseded &&
            ['open', 'partial'].includes(r.merma.state) &&
            r.at <= c.at,
        )
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      return remaining > 0 && recent ? [{ countId: c.id, articleId, remaining, recent }] : [];
    }),
  );
  const cutoff = periodStart(businessDay(), period);
  const entries = state.requests.filter(
    (r) =>
      r.merma &&
      !r.merma.superseded &&
      businessDay(r.at) >= cutoff &&
      (type === 'Todas' || r.merma.type === type) &&
      (!article || r.merma.article === article) &&
      (status === 'all' ||
        (status === 'open' ? ['open', 'partial'].includes(r.merma.state) : r.merma.state === status)),
  );
  const total = entries.reduce((n, r) => n + r.merma!.quantity * r.merma!.unitCost, 0);
  const recovered = entries.reduce(
    (n, r) => n + r.merma!.recoveries.reduce((sum, x) => sum + x.amount, 0),
    0,
  );
  const open = entries.filter((r) => ['open', 'partial'].includes(r.merma!.state)).length;
  const m = selected?.merma;
  const fields: Field[] = [
    ...(kind === 'product' || kind === 'money'
      ? [
          {
            name: 'quantity',
            label: 'Cantidad que se recupera',
            type: 'number' as const,
            min: 0.001,
            step: '0.001',
            value: m ? m.quantity - m.recoveries.reduce((n, r) => n + r.quantity, 0) : 1,
            required: true,
          },
        ]
      : []),
    ...(kind === 'money'
      ? [
          { name: 'amount', label: 'Dinero recibido', type: 'money' as const, required: true },
          {
            name: 'destination',
            label: 'Dónde entró el dinero',
            type: 'select' as const,
            required: true,
            options: [
              ...(state.shifts.some((s) => s.status === 'open')
                ? [{ value: 'cash', label: 'Caja del turno abierto' }]
                : []),
              ...state.locations.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name })),
            ],
          },
        ]
      : []),
    ...(kind === 'product' || kind === 'money'
      ? [
          {
            name: 'from',
            label: kind === 'product' ? 'De dónde volvió' : 'Quién pagó',
            type: 'select' as const,
            required: true,
            options: (kind === 'product'
              ? ['Se encontró en el local', 'Lo repuso el transportador', 'Lo repuso el proveedor']
              : ['Cliente', 'Transportador', 'Proveedor', 'Otro']
            ).map((value) => ({ value, label: value })),
          },
        ]
      : []),
    ...(kind === 'product' && m
      ? [
          {
            name: 'surplusCountId',
            label: 'Vincular sobrante ya contado (opcional)',
            type: 'select' as const,
            value: surplus,
            options: state.counts
              .filter((c) => availableSurplus(c.id, m.article, c.differences?.[m.article] ?? 0) > 0)
              .map((c) => ({
                value: c.id,
                label: date(c.at) + ' · ' + availableSurplus(c.id, m.article, c.differences![m.article]),
              })),
          },
        ]
      : []),
    { name: 'notes', label: 'Nota', type: 'textarea', required: true },
  ];
  return (
    <div className="page-stack">
      <div className="stats-grid">
        <Stat label="Mermas del período" value={money(total)} />
        <Stat label="Recuperado" value={money(recovered)} />
        <Stat label="Pérdida neta" value={money(total - recovered)} />
        <Stat label="Abiertas" value={String(open)} />
      </div>
      {entries.some((r) => r.merma!.costMissing) && (
        <p className="notice warning">
          Hay mermas con costos históricos pendientes. Los importes incluyen solo los componentes con costo
          registrado.
        </p>
      )}
      {hints.map((hint) => (
        <div className="notice info" key={hint.countId + hint.articleId}>
          Sobrante de {hint.remaining} · {names.get(hint.articleId) ?? hint.articleId}. Hay una merma anterior
          abierta.
          <button
            className="button secondary"
            onClick={() => {
              setSelected(hint.recent);
              setKind('product');
              setSurplus(hint.countId);
            }}
          >
            Vincular a la merma
          </button>
        </div>
      ))}
      <div className="tabs">
        {['Todas', 'Cierre', 'Transporte', 'Daños', 'Dulces'].map((value) => (
          <button key={value} className={type === value ? 'active' : ''} onClick={() => setType(value)}>
            {value}
          </button>
        ))}
      </div>
      <div className="tabs">
        {[
          ['all', 'Todos los estados'],
          ['open', 'Abiertas'],
          ['reconciled', 'Conciliadas'],
          ['lost', 'Cerradas como pérdida'],
        ].map(([value, label]) => (
          <button key={value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="table-toolbar">
        <select aria-label="Período de mermas" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {[
            ['day', 'Día'],
            ['week', 'Semana'],
            ['fortnight', 'Quincena'],
            ['month', 'Mes'],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Artículo de merma" value={article} onChange={(e) => setArticle(e.target.value)}>
          <option value="">Todos los artículos</option>
          <option value="cash">Efectivo</option>
          {articles(state).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {entries.length ? (
        entries.map((r) => {
          const merma = r.merma!;
          return (
            <Panel key={r.id}>
              <Badge
                tone={
                  merma.state === 'open'
                    ? 'red'
                    : merma.state === 'partial'
                      ? 'orange'
                      : merma.state === 'reconciled'
                        ? 'green'
                        : 'neutral'
                }
              >
                {
                  {
                    open: 'Abierta',
                    partial: 'Conciliada en parte',
                    reconciled: 'Conciliada',
                    lost: 'Cerrada como pérdida',
                  }[merma.state]
                }
              </Badge>
              <h3>
                {merma.article === 'cash' ? 'Efectivo' : (names.get(merma.article) ?? merma.article)} ·{' '}
                {merma.quantity}
              </h3>
              <p>
                Costo {money(merma.unitCost * merma.quantity)} · Valor de venta{' '}
                {money(merma.saleValue * merma.quantity)} · {merma.type}
              </p>
              <p>
                {date(r.at)} · {profiles.find((p) => p.id === r.by)?.name} ·{' '}
                {merma.shiftId
                  ? 'Turno ' + merma.shiftId.slice(0, 8)
                  : 'Registro ' + merma.sourceId.slice(0, 8)}
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  setSelected(r);
                  setSurplus('');
                  setKind(merma.state === 'lost' ? 'reopen' : merma.article === 'cash' ? 'money' : 'product');
                }}
              >
                Conciliar
              </button>
              <details>
                <summary>Historia completa</summary>
                {merma.history.map((h, i) => (
                  <p key={i}>
                    {date(h.at)} · {profiles.find((p) => p.id === h.by)?.name ?? h.by} · {h.notes}
                  </p>
                ))}
                {merma.recoveries.map((h) => (
                  <p key={h.id}>
                    {date(h.at)} · {h.kind === 'money' ? 'Dinero' : 'Producto'} · {h.quantity} ·{' '}
                    {money(h.amount)} · {h.notes}
                  </p>
                ))}
              </details>
            </Panel>
          );
        })
      ) : (
        <Empty title="Sin mermas en este filtro" />
      )}
      {(type === 'Todas' || type === 'Transporte') && (
        <Panel title="Recepciones por revisar">
          {state.receipts
            .filter((r) => r.v4)
            .flatMap((r) =>
              Object.keys(r.items)
                .filter((article) => !r.reviewed?.[article])
                .map((article) => (
                  <div className="list-row" key={r.id + article}>
                    <div>
                      <strong>{names.get(article) ?? article}</strong>
                      <small>
                        {date(r.at)} · Dañados {r.damaged[article] ?? 0} · Faltantes{' '}
                        {r.missing?.[article] === 'lost'
                          ? Math.max(0, (r.expected?.[article] ?? 0) - r.items[article])
                          : 0}
                      </small>
                      <div className="button-row">
                        {r.photos?.[article]?.map((id) => (
                          <EvidenceButton key={id} id={id} />
                        ))}
                      </div>
                    </div>
                    <button
                      className="button secondary"
                      disabled={r.by === actor.id}
                      onClick={() => setReceipt({ id: r.id, article })}
                    >
                      {r.by === actor.id ? 'Requiere otro admin' : 'Aceptar o corregir'}
                    </button>
                  </div>
                )),
            )}
        </Panel>
      )}
      <Panel title="Lo que no cuadra">
        <LiquidFortnightReport state={state} />
        {state.requests
          .filter((r) => r.merma?.type === 'Dulces' && !r.merma.superseded)
          .map((r) => (
            <p key={r.id}>
              {names.get(r.merma!.article)} · {r.merma!.quantity} · {date(r.at)}
            </p>
          ))}
      </Panel>
      {selected && (
        <Modal title="Conciliar merma" onClose={() => setSelected(undefined)}>
          <label className="field">
            Acción
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {[
                ['product', 'Recuperar producto'],
                ['money', 'Recuperar dinero'],
                ['loss', 'Cerrar como pérdida'],
                ['reopen', 'Reabrir'],
                ...(!m?.emptyCup && m?.article.startsWith('cup:')
                  ? [['empty', 'Vaso vacío perdido o dañado']]
                  : []),
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p>
            {kind === 'product'
              ? 'Úsalo cuando lo que faltó volvió al local. Vincula el sobrante si ya se contó.'
              : kind === 'money'
                ? 'Úsalo cuando alguien pagó lo faltante. El ingreso quedará en la cuenta elegida.'
                : kind === 'loss'
                  ? 'Úsalo cuando ya no se va a recuperar. Puedes reabrirlo después.'
                  : kind === 'empty'
                    ? 'Solo se perdió el envase. Se devuelven el líquido y los dulces atribuidos al vaso servido.'
                    : 'La merma volverá a estar disponible para conciliaciones.'}
          </p>
          <FieldsForm
            key={kind}
            fields={fields}
            onSubmit={async (values) => {
              await app.run('v4', { action: 'reconcile', mermaId: selected.id, kind, ...values });
              setSelected(undefined);
            }}
          />
        </Modal>
      )}
      {receipt && (
        <Modal title="Revisar mercancía" onClose={() => setReceipt(undefined)}>
          <FieldsForm
            fields={[
              {
                name: 'good',
                label: 'Dañados que en realidad llegaron bien (0 acepta la merma)',
                type: 'number',
                value: 0,
                min: 0,
                max: state.receipts.find((r) => r.id === receipt.id)?.damaged[receipt.article] ?? 0,
                required: true,
              },
              { name: 'notes', label: 'Nota de revisión', type: 'textarea', required: true },
            ]}
            onSubmit={async (values) => {
              await app.run('v4', {
                action: 'review_receipt',
                receiptId: receipt.id,
                article: receipt.article,
                ...values,
              });
              setReceipt(undefined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
