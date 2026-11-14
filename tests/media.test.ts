import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PgBackend } from './support/backend.ts';
import { admin, cashier, support, cmd, ids, NOW } from './support/fixture.ts';
import { createGateway } from '../src/server/gateway.ts';
import { sha256 } from '../src/server/crypto.ts';
let backend: PgBackend, gateway: ReturnType<typeof createGateway>;
beforeAll(async () => {
  backend = await PgBackend.create();
  gateway = createGateway({ backend, allowedOrigins: [], now: () => new Date(NOW) });
}, 60000);
afterAll(async () => {
  await backend?.db.close();
});
async function request(route: string, body: unknown, actor = cashier) {
  const r = await gateway(
    new Request('http://localhost/dexter/' + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer ' + actor.id,
        'x-device-id': actor.deviceId,
        'x-device-token': 'test-device-token',
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: r.status, data: await r.json() };
}
it('confirma una fotografía privada y un reintento no puede reemplazar la evidencia definitiva', async () => {
  const bytes = await readFile('public/dexter.jpg'),
    id = crypto.randomUUID();
  await request('commands', {
    commands: [
      cmd('register_attachment', { id, name: 'soporte.jpg', mime: 'image/jpeg', size: bytes.length }),
    ],
  });
  const target = await request('attachments/upload', { id });
  expect(target.status).toBe(200);
  expect(target.data.path).toMatch(/^staging\//);
  backend.files.set(target.data.path, new Blob([bytes], { type: 'image/jpeg' }));
  const result = await request('attachments/complete', { id, path: target.data.path });
  expect(result.status).toBe(200);
  const photo = (await backend.load()).state.attachments.find((a) => a.id === id)!;
  expect(photo.status).toBe('uploaded');
  expect(photo.sha256).toBe(await sha256(new Uint8Array(bytes)));
  backend.files.set(
    target.data.path,
    new Blob([new Uint8Array([255, 216, 9, 9, 9])], { type: 'image/jpeg' }),
  );
  expect((await request('attachments/complete', { id, path: target.data.path })).status).toBe(200);
  expect((await request('attachments/upload', { id })).data.completed).toBe(true);
  expect(await sha256(new Uint8Array(await (await backend.download(photo.path!)).arrayBuffer()))).toBe(
    photo.sha256,
  );
  expect((await request('attachments/upload', { id }, support)).status).toBe(403);
});
it('rechaza contenido que no es imagen y rutas ajenas al usuario', async () => {
  const id = crypto.randomUUID();
  await request('commands', {
    commands: [cmd('register_attachment', { id, name: 'soporte.jpg', mime: 'image/jpeg', size: 20 })],
  });
  const target = await request('attachments/upload', { id });
  backend.files.set(target.data.path, new Blob(['no es una imagen'], { type: 'image/jpeg' }));
  expect((await request('attachments/complete', { id, path: target.data.path })).status).toBe(400);
  expect((await request('attachments/complete', { id, path: 'otro/archivo.jpg' })).status).toBe(400);
});
it('permite al apoyo leer una imagen publicada de sabor sin exponer evidencias ajenas', async () => {
  const s = (await backend.load()).state;
  const photo = s.attachments.find((a) => a.status === 'uploaded')!;
  expect((await request(`attachments/read?id=${photo.id}`, {}, support)).status).toBe(403);
  const result = await request(
    'commands',
    {
      commands: [
        cmd(
          'save_flavor',
          {
            id: ids.flavor,
            name: 'Maracuyá',
            alcohol: true,
            imageId: photo.id,
          },
          admin,
          { configVersion: s.settings[0].version },
        ),
      ],
    },
    admin,
  );
  expect(result.data.results[0].status).toBe('accepted');
  expect((await request(`attachments/read?id=${photo.id}`, {}, support)).status).toBe(200);
  const evidence = s.attachments.find((a) => a.id !== photo.id)!;
  expect((await request(`attachments/read?id=${evidence.id}`, {}, support)).status).toBe(403);
});
