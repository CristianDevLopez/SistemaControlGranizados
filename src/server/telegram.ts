import { inventoryForecast } from '../domain/candy-forecast.ts';
import type { Backend } from './backend.ts';
import { businessDay } from '../domain/business-date.ts';
import type { Notification, State } from '../domain/types.ts';

function clean(error: unknown, token?: string) {
  let message = error instanceof Error ? error.message : 'No se pudo entregar el aviso.';
  if (token) message = message.replaceAll(token, '[TOKEN]');
  return message.replace(/https?:\/\/api\.telegram\.org\/bot[^\s]+/gi, '[Telegram]').slice(0, 300);
}
function destination(
  state: State | undefined,
  n: Notification,
  env: Record<string, string | undefined>,
  prefix: string,
  legacy: boolean,
) {
  const config = state?.settings[0].v4?.telegram;
  if (state?.settings[0].v4Enabled && config) {
    const rule = config.rules[n.type ?? n.channel];
    if (rule?.enabled === false) return undefined;
    return config.groups.find((g) => g.id === (rule?.groupId ?? config.groups[0]?.id))?.chatId;
  }
  return (
    env[prefix + '_' + n.channel.toUpperCase() + '_CHAT_ID'] ??
    (legacy ? env['TELEGRAM_' + n.channel.toUpperCase() + '_CHAT_ID'] : undefined)
  );
}
function link(appUrl: string, n: Notification) {
  const page =
    n.type === 'gasto_pendiente'
      ? 'control'
      : n.type?.startsWith('recepcion')
        ? 'control'
        : n.type === 'prueba'
          ? 'settings'
          : 'review';
  return appUrl + '/#' + page + (n.referenceId ? '?registro=' + encodeURIComponent(n.referenceId) : '');
}
async function slot(store: Backend, chatId: string) {
  const reserved = await store.security('telegram_slot', { chatId });
  if (reserved?.allowed === false) return false;
  if (reserved?.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, reserved.delayMs));
  return true;
}
async function call(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) {
    const error = new Error('Telegram: ' + String(data.description ?? response.status)) as Error & {
      retryAfter?: number;
    };
    error.retryAfter = Number(data.parameters?.retry_after) || undefined;
    throw error;
  }
  return data.result;
}
export async function dispatchNotifications(
  store: Backend,
  env: Record<string, string | undefined>,
  appUrl: string,
  legacy = true,
) {
  const state = (await store.load()).state;
  const prefix = store.branchId
    ? 'TELEGRAM_BRANCH_' + store.branchId.replaceAll('-', '').toUpperCase()
    : 'TELEGRAM';
  const token = env[prefix + '_BOT_TOKEN'] ?? (legacy ? env.TELEGRAM_BOT_TOKEN : undefined);
  for (const n of (await store.security('notifications_claim')) as Notification[]) {
    const chat = destination(state, n, env, prefix, legacy);
    if (state.settings[0].v4Enabled && !chat) {
      await store.security('notification_defer', { id: n.id });
      continue;
    }
    try {
      if (!token || !chat) throw new Error('Telegram pendiente de configuración.');
      if (state.settings[0].v4Enabled && !(await slot(store, chat))) {
        await store.security('notification_defer', { id: n.id });
        continue;
      }
      const result = await call(token, 'sendMessage', {
        chat_id: chat,
        text: n.text + '\nRevisar: ' + link(appUrl, n),
      });
      await store.security('notification_finish', {
        id: n.id,
        ok: true,
        messageId: result.message_id,
        chatId: chat,
      });
    } catch (error) {
      await store.security('notification_finish', {
        id: n.id,
        ok: false,
        error: clean(error, token),
        retryAfter: (error as { retryAfter?: number }).retryAfter,
      });
    }
  }
  if (!state.settings[0].v4Enabled || !token) return;
  for (const n of (await store.security('telegram_resolutions')) as (Notification & { replyId?: number })[]) {
    try {
      if (!n.chatId || !n.messageId || !n.resolved) continue;
      if (!(await slot(store, n.chatId))) {
        await store.security('telegram_resolution_finish', {
          id: n.id,
          ok: false,
          error: 'Esperando turno del grupo.',
        });
        continue;
      }
      const stamp = new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(n.resolved.at));
      const text = (n.resolved.outcome ?? '✅ Resuelto') + ' · ' + n.resolved.by + ' · ' + stamp;
      try {
        await call(token, 'editMessageText', {
          chat_id: n.chatId,
          message_id: n.messageId,
          text: n.text + '\nRevisar: ' + link(appUrl, n) + '\n' + text,
        });
      } catch (e) {
        if (!(e as Error).message.includes('message is not modified')) throw e;
      }
      let replyId = n.replyId;
      if (!replyId) {
        if (!(await slot(store, n.chatId))) throw new Error('Esperando turno para confirmar la resolución.');
        const reply = await call(token, 'sendMessage', {
          chat_id: n.chatId,
          text,
          reply_parameters: { message_id: n.messageId },
          disable_notification: true,
        });
        replyId = reply.message_id;
      }
      await store.security('telegram_resolution_finish', {
        id: n.id,
        ok: true,
        replyId,
        eventId: n.resolved.eventId,
      });
    } catch (error) {
      await store.security('telegram_resolution_finish', { id: n.id, ok: false, error: clean(error, token) });
    }
  }
}
export async function telegramTick(
  backend: Backend,
  env: Record<string, string | undefined>,
  appUrl: string,
) {
  const branches = (await backend.security('telegram_branches')) as { id: string; legacy: boolean }[];
  for (const branch of branches) {
    const store = backend.forBranch(branch.id),
      { state } = await store.load(),
      at = new Date().toISOString(),
      day = businessDay(at);
    const localTime = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(at));
    const notices: Record<string, unknown>[] = [];
    if (localTime >= (state.settings[0].v4?.telegram?.dailyTime ?? '22:00')) {
      const orders = state.orders.filter(
        (o) => o.status === 'paid' && businessDay(o.paidAt ?? o.createdAt) === day,
      );
      const ids = new Set(orders.map((o) => o.id));
      const payments = state.payments.filter((p) => ids.has(p.orderId));
      const byAccount = new Map<string, number>();
      for (const p of payments) {
        const name =
          (p.method ?? 'cash') === 'cash'
            ? 'Efectivo'
            : (state.locations.find((l) => l.id === p.accountId)?.name ?? 'Transferencia');
        byAccount.set(name, (byAccount.get(name) ?? 0) + p.amount);
      }
      const expenses = state.expenses
        .filter((e) => e.status === 'approved' && businessDay(e.at) === day)
        .reduce((n, e) => n + e.amount, 0);
      const differences = state.shifts
        .filter((s) => s.closedAt && businessDay(s.closedAt) === day)
        .reduce(
          (n, s) =>
            n +
            (state.counts.find((c) => c.id === (s.closingReview?.countId ?? s.closingCountId))?.difference ??
              0),
          0,
        );
      const pending =
        state.requests.filter((r) => r.status === 'pending').length +
        state.expenses.filter((e) => e.status === 'pending').length;
      notices.push({
        id: crypto.randomUUID(),
        key: 'resumen:' + day,
        type: 'resumen',
        at,
        text:
          'Resumen ' +
          day +
          ' · Ventas $' +
          orders.reduce((n, o) => n + o.total, 0) +
          ' · ' +
          [...byAccount].map(([name, value]) => name + ' $' + value).join(' · ') +
          ' · Gastos $' +
          expenses +
          ' · Diferencias $' +
          differences +
          ' · Pendientes ' +
          pending,
      });
    }
    for (const item of inventoryForecast(state, at))
      if (item.days !== null && item.days < (state.settings[0].v4?.lowStockDays ?? 3))
        notices.push({
          id: crypto.randomUUID(),
          key: 'stock:' + item.id + ':' + day,
          type: 'poco_inventario',
          at,
          text: item.name + ': quedan ' + item.remaining + '; alcanzan hasta ' + item.until + '.',
        });
    await store.security('telegram_prepare', { notices });
    for (const photo of (await store.security('telegram_expired_photos')) as { id: string; path: string }[]) {
      await store.deletePhoto(photo.path);
      await store.security('telegram_photo_deleted', { id: photo.id });
    }
    await dispatchNotifications(store, env, appUrl, branch.legacy);
  }
}
