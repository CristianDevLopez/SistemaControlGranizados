// Isolated loopback fixture server. This file is never included in a production build.
import { createServer } from 'node:http';
import { PgBackend } from './backend.ts';
import { createGateway } from '../../src/server/gateway.ts';
import { admin, cashier, support, owner, ids, NOW } from './fixture.ts';
let backend = await PgBackend.create();
let pauseCommands = false;
const gateway = () =>
  createGateway({ backend, allowedOrigins: ['http://127.0.0.1:5174'], now: () => new Date() });
createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1:5180').pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const cors = {
      'Access-Control-Allow-Origin': 'http://127.0.0.1:5174',
      'Access-Control-Allow-Headers':
        'content-type, authorization, apikey, x-device-id, x-device-token, x-preview-role, x-branch-id',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (path === '/health') {
      res.writeHead(200, cors);
      res.end('ok');
      return;
    }
    if (path.startsWith('/test-files/') && req.method === 'GET') {
      const file = backend.files.get(decodeURIComponent(path.slice('/test-files/'.length)));
      if (!file) {
        res.writeHead(404, cors);
        res.end();
        return;
      }
      res.writeHead(200, { ...cors, 'Content-Type': file.type });
      res.end(Buffer.from(await file.arrayBuffer()));
      return;
    }
    if (path === '/reset' && req.method === 'POST') {
      pauseCommands = false;
      await backend.db.close();
      backend = await PgBackend.create();
      const options = body.length ? JSON.parse(body.toString()) : {};
      if (options.emptyCash === true) await backend.db.exec('delete from public.shifts');
      res.writeHead(200, cors);
      res.end('ok');
      return;
    }
    if (path === '/test/commands' && req.method === 'POST') {
      pauseCommands = JSON.parse(body.toString()).paused === true;
      res.writeHead(200, cors);
      res.end('ok');
      return;
    }
    if (path === '/dexter/commands' && pauseCommands) {
      res.writeHead(503, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Error temporal de prueba', code: 'TEMPORARY' }));
      return;
    }
    if (path === '/dexter/test-login') {
      const input = JSON.parse(body.toString()),
        actor =
          input.email === 'owner@test.invalid'
            ? owner
            : input.email === 'support@test.invalid'
              ? support
              : input.email === 'admin@test.invalid'
                ? admin
                : cashier;
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          token: actor.id,
          device: actor.superAdmin ? null : { id: actor.deviceId, token: 'test-device-token' },
        }),
      );
      return;
    }
    if (path.startsWith('/test-upload/') && req.method === 'PUT') {
      const id = path.split('/').at(-1),
        a = (await backend.load()).state.attachments.find((a) => a.id === id);
      if (!a) throw new Error('Foto no registrada');
      backend.files.set(
        new URL(req.url!, 'http://127.0.0.1:5180').searchParams.get('path')!,
        new Blob([body], { type: 'image/jpeg' }),
      );
      res.writeHead(200, cors);
      res.end('ok');
      return;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
    const response = await gateway()(
      new Request(`http://127.0.0.1:5180${req.url}`, {
        method: req.method,
        headers,
        ...(body.length ? { body } : {}),
        duplex: 'half',
      } as RequestInit),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5174' });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}).listen(5180, '127.0.0.1', () => console.log('Dexter test backend http://127.0.0.1:5180'));
