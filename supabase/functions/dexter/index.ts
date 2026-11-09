import { createClient } from '@supabase/supabase-js';
import { SupabaseBackend } from '../../../src/server/backend.ts';
import { createGateway, dispatchNotifications } from '../../../src/server/gateway.ts';
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
const env = Deno.env.toObject();
const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const backend = new SupabaseBackend(
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, authOptions),
  () => createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, authOptions),
);
const appUrl = env.APP_URL ?? 'https://dexter-granizados.vercel.app';
const origins = (env.ALLOWED_ORIGINS ?? `${appUrl},http://localhost:5173,http://127.0.0.1:5173`)
  .split(',')
  .map((x) => x.trim());
const gateway = createGateway({ backend, allowedOrigins: origins, appUrl });
Deno.serve(async (req) => {
  const response = await gateway(req);
  if (
    req.method === 'POST' &&
    response.ok &&
    /\/commands$|\/notifications\/retry$/.test(new URL(req.url).pathname)
  )
    EdgeRuntime.waitUntil(
      dispatchNotifications(
        response.headers.get('X-Branch-Id')
          ? backend.forBranch(response.headers.get('X-Branch-Id')!)
          : backend,
        env,
        appUrl,
        response.headers.get('X-Legacy-Branch') === 'true',
      ),
    );
  return response;
});
