import { fixture } from './support/fixture.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { dispatchNotifications } from '../src/server/gateway.ts';
import type { Backend } from '../src/server/backend.ts';

afterEach(() => vi.unstubAllGlobals());

it('elimina el token y la dirección de Telegram antes de guardar un error', async () => {
  const token = 'token-ficticio-solo-para-pruebas';
  const security = vi.fn(async (action: string) =>
    action === 'notifications_claim' ? [{ id: 'aviso', channel: 'mermas', text: 'Cierre enviado' }] : {},
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error(`Fallo al consultar https://api.telegram.org/bot${token}/sendMessage, token ${token}`);
    }),
  );
  await dispatchNotifications(
    { security, load: async () => ({ state: fixture() }) } as unknown as Backend,
    {
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_MERMAS_CHAT_ID: '-123',
    },
    'https://dexter.test',
  );
  const saved = security.mock.calls.find(([action]) => action === 'notification_finish');
  expect(saved).toBeDefined();
  const serialized = JSON.stringify(saved);
  expect(serialized).not.toContain(token);
  expect(serialized).not.toContain('api.telegram.org');
  expect(serialized).toContain('[TOKEN]');
});
