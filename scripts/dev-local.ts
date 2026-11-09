// Sandbox 100 % local: backend de prueba (PGlite en memoria) + Vite apuntando a él.
// No usa Supabase ni credenciales y nunca toca la base real. Los datos se pierden al detenerlo.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const node = process.execPath;
// El servidor de pruebas solo acepta CORS desde este origen.
const appPort = 5174;
const backendUrl = 'http://127.0.0.1:5180';
const children: ChildProcess[] = [];

function start(name: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(node, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`\n[dev:local] ${name} terminó (código ${code}). Deteniendo el sandbox.`);
      stop(code ?? 1);
    }
  });
  children.push(child);
}

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

start('Backend de prueba', ['node_modules/tsx/dist/cli.mjs', 'tests/support/server.ts']);

// Esperar a que el backend responda antes de levantar Vite.
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${backendUrl}/health`)).ok) break;
  } catch {}
  if (i === 60) {
    console.error('[dev:local] El backend de prueba no respondió en 30 s.');
    stop(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}

start(
  'Vite',
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'],
  {
    VITE_TEST_GATEWAY: `${backendUrl}/dexter`,
    // Anula un .env.local con el proyecto real: en el sandbox no debe existir cliente de Supabase.
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_PUBLISHABLE_KEY: '',
  },
);

console.log(`
[dev:local] Sandbox listo en http://127.0.0.1:${appPort}
  Administrador:     admin@test.invalid  (cualquier contraseña)
  Superadministrador: owner@test.invalid (cualquier contraseña)
  Ctrl + C para detener. Los datos viven en memoria y se pierden al cerrar.
`);
