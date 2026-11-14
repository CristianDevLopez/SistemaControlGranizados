import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Plus, Ticket, Gift, Download, Share2, CalendarClock, Power, Copy } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import type { Coupon, Promotion, PromoEffect, State } from '../domain/types.ts';
import { colombiaMonth } from '../domain/engine.ts';
import { downloadFile } from '../lib/export.ts';
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
const effect = (p: Promotion) =>
  p.effect === 'fixed'
    ? `Precio fijo: ${money(p.fixedPrice ?? 0)}`
    : p.effect === 'upgrade'
      ? `Upgrade de ${p.steps} tamaño${p.steps === 1 ? '' : 's'}`
      : p.effect === 'nxm'
        ? `Lleva ${p.take} y paga ${p.pay}`
        : 'Producto gratis con cupón';

export function Promotions() {
  const app = useApp(),
    { state, actor } = app.data!,
    [edit, setEdit] = useState<Promotion | null | undefined>(undefined),
    [issue, setIssue] = useState(false),
    [courtesy, setCourtesy] = useState(false),
    [showId, setShowId] = useState<string | null>(null),
    [excess, setExcess] = useState(false);
  const show = state.coupons.find((coupon) => coupon.id === showId);
  const promotions = state.promotions.filter((promotion) => !promotion.courtesyOnly);
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>Beneficios que se pueden controlar</h2>
          <p>Promociones por horario y cupones de un solo uso.</p>
        </div>
        <div className="button-row">
          <button className="button primary" disabled={!app.online} onClick={() => setCourtesy(true)}>
            <Gift size={17} />
            Generar cortesía
          </button>
          <button className="button secondary" onClick={() => setIssue(true)}>
            <Ticket size={17} />
            Emitir cupón
          </button>
          <button className="button secondary" onClick={() => setEdit(null)}>
            <Plus size={17} />
            Crear promoción
          </button>
        </div>
      </div>
      <div className="promo-grid">
        {promotions.map((p) => (
          <Panel key={p.id} className="promo-card">
            <div className="promo-card-head">
              <span className="promo-icon">
                {p.delivery === 'coupon' ? <Ticket size={23} /> : <CalendarClock size={23} />}
              </span>
              <Badge tone={p.active ? 'green' : 'neutral'}>{p.active ? 'Activa' : 'Apagada'}</Badge>
            </div>
            <h3>{p.name}</h3>
            <strong className="promo-effect">{effect(p)}</strong>
            <p>
              {p.delivery === 'coupon'
                ? 'Se aplica con código verificado online'
                : `${p.startTime}–${p.endTime} · Hora de Colombia`}
            </p>
            <small>
              {date(p.startsAt)} — {date(p.endsAt)}
            </small>
            <small>
              {p.redemptions} beneficios aplicados{p.maxRedemptions !== null ? ` de ${p.maxRedemptions}` : ''}
            </small>
            <div className="button-row">
              <button className="button small secondary" onClick={() => setEdit(p)}>
                Editar
              </button>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await app.run('save_promotion', { ...p, active: !p.active });
                    app.toast(p.active ? 'Promoción apagada.' : 'Promoción activada.');
                  } catch (e) {
                    app.toast((e as Error).message);
                  }
                }}
              >
                <Power size={15} />
                {p.active ? 'Apagar' : 'Activar'}
              </button>
            </div>
          </Panel>
        ))}
        {!promotions.length && (
          <Panel>
            <Empty
              title="Crea una promoción general"
              description="Combina producto, efecto, vigencia y forma de entrega. Cada publicación queda en el histórico."
              action={
                <button className="button primary" onClick={() => setEdit(null)}>
                  Crear promoción
                </button>
              }
            />
          </Panel>
        )}
      </div>
      <Panel
        title="Cortesías y cupones emitidos"
        action={
          <button className="text-button" onClick={() => setExcess(true)}>
            Solicitar cortesía adicional
          </button>
        }
      >
        {state.coupons.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Beneficio</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...state.coupons].reverse().map((c) => (
                  <tr key={c.id}>
                    <td>
                      <code>{c.code}</code>
                      {c.courtesy && <small>Cortesía</small>}
                    </td>
                    <td>
                      {state.promotions.find((x) => x.id === c.promotionId)?.name}
                      <small>
                        {courtesyDescription(
                          state.promotions.find((x) => x.id === c.promotionId),
                          state,
                        )}
                      </small>
                    </td>
                    <td>{date(c.expiresAt)}</td>
                    <td>
                      <Badge
                        tone={
                          c.status === 'redeemed'
                            ? 'neutral'
                            : c.expiresAt < new Date().toISOString()
                              ? 'orange'
                              : 'green'
                        }
                      >
                        {c.status === 'issued' && c.expiresAt < new Date().toISOString()
                          ? 'Vencido'
                          : stateNames[c.status]}
                      </Badge>
                    </td>
                    <td>
                      <button className="button small secondary" onClick={() => setShowId(c.id)}>
                        Ver QR y compartir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Sin cupones emitidos"
            description="Los códigos no contienen datos personales. Solo se consumen al confirmar el canje online."
          />
        )}
      </Panel>
      {edit !== undefined && <PromotionDialog promotion={edit} onClose={() => setEdit(undefined)} />}
      {courtesy && (
        <CourtesyDialog
          onClose={() => setCourtesy(false)}
          onIssued={(id) => {
            setCourtesy(false);
            setShowId(id);
          }}
        />
      )}
      {issue && (
        <Modal title="Emitir cupón" onClose={() => setIssue(false)}>
          <FieldsForm
            fields={[
              {
                name: 'promotionId',
                label: 'Promoción',
                type: 'select',
                required: true,
                options: state.promotions
                  .filter((x) => x.active && x.delivery === 'coupon' && !x.courtesyOnly)
                  .map((x) => ({ value: x.id, label: x.name })),
              },
              {
                name: 'expiresAt',
                label: 'Vence (hora de Colombia)',
                type: 'datetime-local',
                required: true,
                value: localDateTime(new Date(Date.now() + 15 * 86400000)),
              },
              {
                name: 'courtesy',
                label: 'Contar dentro de mi cuota de cortesías',
                type: 'checkbox',
                value: true,
              },
              {
                name: 'excessRequestId',
                label: 'Autorización de cortesía adicional (si se agotó la cuota)',
                type: 'select',
                options: state.requests
                  .filter((x) => x.type === 'courtesy_excess' && x.by === actor.id && x.status === 'approved')
                  .map((x) => ({ value: x.id, label: `Autorizada · ${date(x.reviewedAt)}` })),
              },
            ]}
            onSubmit={async (v) => {
              const result = await app.run('issue_coupon', {
                ...v,
                expiresAt: utc(v.expiresAt),
                excessRequestId: v.excessRequestId || undefined,
              });
              setIssue(false);
              setShowId(result.referenceId ?? null);
              app.toast('Cupón generado. Puedes abrir su QR en la lista.');
            }}
          />
        </Modal>
      )}
      {excess && (
        <Modal title="Solicitar cortesía adicional" onClose={() => setExcess(false)}>
          <FieldsForm
            fields={[{ name: 'notes', label: 'Motivo', type: 'textarea', required: true }]}
            onSubmit={async (v) => {
              await app.run('request_courtesy_excess', v);
              setExcess(false);
              app.toast('Otro admin debe revisar la solicitud.');
            }}
          />
        </Modal>
      )}
      {show && <CouponDialog coupon={show} onClose={() => setShowId(null)} />}
    </div>
  );
}
function courtesyDescription(promotion: Promotion | undefined, state: State): string | null {
  if (!promotion?.courtesyOnly) return null;
  const size = state.sizes.find((size) => size.id === promotion.sizeIds[0])?.name ?? 'tamaño definido';
  const flavors = promotion.flavorIds.length
    ? promotion.flavorIds
        .map((id) => state.flavors.find((flavor) => flavor.id === id)?.name ?? 'Sabor')
        .join(', ')
    : 'Todos los sabores';
  return `1 vaso de ${size} sin cobro · ${promotion.alcohol === 'yes' ? 'Con licor' : promotion.alcohol === 'no' ? 'Sin licor' : 'Con o sin licor'} · ${flavors} · ${promotion.allowMixed === false ? 'Un solo sabor' : 'Admite combinados'}`;
}

function CourtesyDialog({ onClose, onIssued }: { onClose: () => void; onIssued: (id: string) => void }) {
  const app = useApp(),
    { state, actor } = app.data!;
  const month = colombiaMonth(new Date().toISOString());
  const issued = state.coupons.filter(
    (coupon) => coupon.issuedBy === actor.id && coupon.courtesy && colombiaMonth(coupon.issuedAt) === month,
  ).length;
  return (
    <Modal title="Generar cortesía" onClose={onClose}>
      <p className="modal-intro">
        Cada código cubre un vaso y se canjea una sola vez. Caja registra el vaso sin cobro; los insumos se
        descuentan al entregarlo. Cuota disponible este mes:{' '}
        {Math.max(0, state.settings[0].courtesyQuota - issued)}.
      </p>
      <FieldsForm
        submit="Generar código de cortesía"
        onCancel={onClose}
        fields={[
          { name: 'name', label: 'Nombre de la cortesía', required: true, value: 'Cortesía' },
          {
            name: 'sizeId',
            label: 'Tamaño del vaso',
            type: 'select',
            required: true,
            options: state.sizes
              .filter((size) => size.active && size.ounces > 0)
              .map((size) => ({ value: size.id, label: size.name })),
          },
          {
            name: 'alcohol',
            label: 'Tipo de cortesía',
            type: 'select',
            required: true,
            value: 'all',
            options: [
              { value: 'all', label: 'Con o sin licor' },
              { value: 'yes', label: 'Con licor' },
              { value: 'no', label: 'Sin licor' },
            ],
          },
          {
            name: 'flavorIds',
            label: 'Sabores permitidos (sin seleccionar: todos)',
            type: 'multiselect',
            options: state.flavors
              .filter((flavor) => flavor.active)
              .map((flavor) => ({ value: flavor.id, label: flavor.name })),
          },
          {
            name: 'stackable',
            label: 'Acumulable con otras cortesías en productos distintos',
            type: 'checkbox',
            value: true,
          },
          {
            name: 'allowMixed',
            label: 'Permitir combinados de los sabores elegibles',
            type: 'checkbox',
            value: true,
          },
          {
            name: 'expiresAt',
            label: 'Vence (hora de Colombia)',
            type: 'datetime-local',
            required: true,
            value: localDateTime(new Date(Date.now() + 15 * 86400000)),
          },
          {
            name: 'excessRequestId',
            label: 'Autorización adicional (si se agotó la cuota)',
            type: 'select',
            options: state.requests
              .filter(
                (request) =>
                  request.type === 'courtesy_excess' &&
                  request.by === actor.id &&
                  request.status === 'approved',
              )
              .map((request) => ({ value: request.id, label: `Autorizada · ${date(request.reviewedAt)}` })),
          },
        ]}
        onSubmit={async ({ expiresAt, excessRequestId, ...courtesySpec }) => {
          const result = await app.run('issue_coupon', {
            courtesy: true,
            courtesySpec,
            expiresAt: utc(expiresAt),
            excessRequestId: excessRequestId || undefined,
          });
          if (!result.referenceId)
            throw new Error(
              'La emisión está pendiente de confirmación. Revisa la lista de códigos antes de repetirla.',
            );
          onIssued(result.referenceId);
          app.toast('Cortesía generada. Comparte el código para canjearlo en caja.');
        }}
      />
    </Modal>
  );
}
function PromotionDialog({ promotion, onClose }: { promotion: Promotion | null; onClose: () => void }) {
  const app = useApp(),
    { state } = app.data!,
    [effect, setEffect] = useState<PromoEffect>(promotion?.effect ?? 'fixed'),
    [delivery, setDelivery] = useState(promotion?.delivery ?? 'schedule');
  const fields: Field[] = [
    { name: 'name', label: 'Nombre de la promoción', required: true },
    {
      name: 'startsAt',
      label: 'Desde (Colombia)',
      type: 'datetime-local',
      required: true,
      value: localDateTime(),
    },
    {
      name: 'endsAt',
      label: 'Hasta (Colombia)',
      type: 'datetime-local',
      required: true,
      value: localDateTime(new Date(Date.now() + 30 * 86400000)),
    },
    { name: 'startTime', label: 'Hora de inicio diaria', type: 'time', required: true, value: '00:00' },
    { name: 'endTime', label: 'Hora de fin diaria', type: 'time', required: true, value: '23:59' },
    {
      name: 'days',
      label: 'Días (sin seleccionar: todos)',
      type: 'multiselect',
      options: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map(
        (label, value) => ({ value: String(value), label }),
      ),
    },
    {
      name: 'alcohol',
      label: 'Tipo de sabor',
      type: 'select',
      value: 'all',
      options: [
        { value: 'all', label: 'Con y sin licor' },
        { value: 'yes', label: 'Con licor' },
        { value: 'no', label: 'Sin licor' },
      ],
    },
    {
      name: 'maxRedemptions',
      label: 'Límite global de beneficios (opcional)',
      type: 'number',
      min: 1,
      hint: 'Si tiene límite global, su aplicación requiere conexión.',
    },
    ...(effect === 'fixed'
      ? [{ name: 'fixedPrice', label: 'Precio promocional', type: 'money' as const, required: true, min: 1 }]
      : effect === 'upgrade'
        ? [
            {
              name: 'steps',
              label: 'Cantidad de tamaños',
              type: 'select' as const,
              required: true,
              value: '1',
              options: [
                { value: '1', label: 'Un tamaño' },
                { value: '2', label: 'Dos tamaños' },
              ],
            },
          ]
        : effect === 'nxm'
          ? [
              {
                name: 'take',
                label: 'Lleva N',
                type: 'number' as const,
                required: true,
                min: 2,
                max: 20,
                value: 3,
              },
              {
                name: 'pay',
                label: 'Paga M',
                type: 'number' as const,
                required: true,
                min: 1,
                max: 19,
                value: 2,
              },
            ]
          : []),
    {
      name: 'sizeIds',
      label:
        effect === 'free'
          ? 'Tamaños del producto de cortesía (obligatorio)'
          : 'Tamaños elegibles (sin seleccionar: todos)',
      type: 'multiselect',
      options: state.sizes.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name })),
    },
    {
      name: 'flavorIds',
      label:
        effect === 'free'
          ? 'Sabores del producto de cortesía (obligatorio)'
          : 'Sabores elegibles (sin seleccionar: todos)',
      type: 'multiselect',
      options: state.flavors
        .filter((x) => x.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .map((x) => ({ value: x.id, label: `${x.name} · ${x.alcohol ? 'Con licor' : 'Sin licor'}` })),
    },
    ...(delivery === 'coupon'
      ? [
          {
            name: 'stackable',
            label: 'Acumulable con otras cortesías y promociones en el mismo pedido (en productos distintos)',
            type: 'checkbox' as const,
            value: true,
          },
        ]
      : []),
    { name: 'active', label: 'Publicar activa', type: 'checkbox', value: true },
  ];
  const initial = promotion
    ? {
        ...promotion,
        startsAt: localDateTime(new Date(promotion.startsAt)),
        endsAt: localDateTime(new Date(promotion.endsAt)),
        days: promotion.days.map(String),
        steps: String(promotion.steps ?? 1),
        stackable: promotion.stackable !== false,
      }
    : {};
  return (
    <Modal title={promotion ? 'Editar promoción' : 'Crear promoción'} onClose={onClose}>
      <div className="promotion-builder">
        <label className="field">
          <span>Qué cambia</span>
          <select
            value={effect}
            onChange={(e) => {
              setEffect(e.target.value as PromoEffect);
              if (e.target.value === 'free') setDelivery('coupon');
            }}
          >
            <option value="fixed">Precio fijo</option>
            <option value="upgrade">Subir uno o dos tamaños</option>
            <option value="nxm">Lleva N y paga M</option>
            <option value="free">Producto gratis con cupón</option>
          </select>
        </label>
        <label className="field">
          <span>Cómo se entrega</span>
          <select
            value={delivery}
            disabled={effect === 'free'}
            onChange={(e) => setDelivery(e.target.value as 'schedule' | 'coupon')}
          >
            <option value="schedule">Automática por horario</option>
            <option value="coupon">Con cupón de un solo uso</option>
          </select>
        </label>
      </div>
      <FieldsForm
        key={`${effect}-${delivery}`}
        fields={fields}
        initial={initial}
        onCancel={onClose}
        submit="Publicar promoción"
        onSubmit={async (v) => {
          await app.run('save_promotion', {
            ...promotion,
            ...v,
            id: promotion?.id,
            effect,
            delivery,
            steps: Number(v.steps),
            days: (v.days ?? []).map(Number),
            startsAt: utc(v.startsAt),
            endsAt: utc(v.endsAt),
            maxRedemptions: v.maxRedemptions ?? null,
          });
          onClose();
          app.toast('Promoción publicada y guardada en el histórico.');
        }}
      />
    </Modal>
  );
}
function CouponDialog({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
  const app = useApp(),
    [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(coupon.code, { width: 350, margin: 3, errorCorrectionLevel: 'M' }).then(setQr);
  }, [coupon.code]);
  const state = app.data!.state;
  const promotion = coupon.benefit ?? state.promotions.find((x) => x.id === coupon.promotionId);
  const name = promotion?.name;
  const description = courtesyDescription(promotion, state);
  const conditions = promotion
    ? `${effect(promotion)} · Tamaños: ${promotion.sizeIds.map((id) => state.sizes.find((s) => s.id === id)?.name).join(', ') || 'todos'} · Sabores: ${promotion.flavorIds.map((id) => state.flavors.find((f) => f.id === id)?.name).join(', ') || 'todos'} · ${promotion.stackable === false ? 'No acumulable' : 'Acumulable en productos distintos'} · ${promotion.alcohol === 'all' ? 'Con o sin licor' : promotion.alcohol === 'yes' ? 'Con licor' : 'Sin licor'} · Horario ${promotion.startTime}–${promotion.endTime} Colombia · Días: ${promotion.days.length ? promotion.days.map((d) => ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d]).join(', ') : 'todos'}`
    : '';
  const shareText = `Dexter’s Granizados · ${name}\n${description ? `${description}\n` : ''}${conditions}\nCupón: ${coupon.code}\nVence: ${date(coupon.expiresAt)}. Un solo uso. No canjeable por dinero ni devolución de efectivo.`;
  return (
    <Modal title={promotion?.courtesyOnly ? 'Cortesía Dexter’s' : 'Cupón Dexter’s'} onClose={onClose}>
      <div className="coupon-preview">
        <Gift size={28} />
        <h3>{name}</h3>
        {description && <p>{description}</p>}
        {qr && <img src={qr} alt={`QR del cupón ${coupon.code}`} />}
        <strong>{coupon.code}</strong>
        <p>{conditions}</p>
        <p>
          No canjeable por dinero ni devolución de efectivo. Cada código cubre únicamente el beneficio
          definido.
        </p>
        <p>Válido hasta {date(coupon.expiresAt)}. Un solo uso, sujeto al beneficio indicado.</p>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(coupon.code);
                app.toast('Código copiado.');
              } catch {
                app.toast('Selecciona el código para copiarlo desde tu navegador.');
              }
            }}
          >
            <Copy size={16} />
            Copiar código
          </button>
          <button
            className="button primary"
            onClick={async () => {
              const text = shareText;
              try {
                if (navigator.share) await navigator.share({ title: 'Cupón Dexter’s', text });
                else {
                  await navigator.clipboard.writeText(text);
                  app.toast('Texto del cupón copiado.');
                }
              } catch {}
            }}
          >
            <Share2 size={16} />
            Compartir código
          </button>
          <button
            className="button secondary"
            disabled={!qr}
            onClick={async () => {
              const blob = await (await fetch(qr)).blob();
              const file = new File([blob], `cupon-${coupon.code}.png`, { type: 'image/png' });
              try {
                if (navigator.canShare?.({ files: [file] }))
                  await navigator.share({ title: 'Cupón Dexter’s', text: shareText, files: [file] });
                else {
                  downloadFile(blob, file.name, 'image/png');
                  app.toast('QR descargado para compartir junto al código y sus condiciones.');
                }
              } catch (e) {
                if ((e as Error).name !== 'AbortError')
                  app.toast('No se pudo compartir. Puedes descargar el QR.');
              }
            }}
          >
            <Share2 size={16} />
            Compartir QR
          </button>
          <button
            className="button secondary"
            onClick={async () => {
              const blob = await (await fetch(qr)).blob();
              downloadFile(blob, `cupon-${coupon.code}.png`, 'image/png');
            }}
          >
            <Download size={16} />
            Descargar QR
          </button>
        </div>
      </div>
    </Modal>
  );
}
