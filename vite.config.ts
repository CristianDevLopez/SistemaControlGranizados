import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Solo para `npm run dev:local`: el backend de prueba vive en memoria y cada arranque crea locales con
// identificadores nuevos. Si el navegador conserva la sesión del sandbox anterior, pide registrar el
// equipo o rechaza el local. En la primera página de cada arranque se ordena borrar lo guardado.
function sandboxCleanStart(): Plugin {
  const id = process.env.DEXTER_SANDBOX_ID;
  return {
    name: 'dexter-sandbox-clean-start',
    apply: 'serve',
    configureServer(server) {
      if (!id) return;
      const cookie = `dexter-sandbox=${id}`;
      server.middlewares.use((req, res, next) => {
        const page =
          req.headers['sec-fetch-dest'] === 'document' ||
          (req.method === 'GET' && (req.headers.accept ?? '').includes('text/html'));
        if (page && !(req.headers.cookie ?? '').split(/;\s*/).includes(cookie)) {
          res.setHeader('Clear-Site-Data', '"storage"');
          res.setHeader('Set-Cookie', `${cookie}; Path=/; SameSite=Strict`);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    sandboxCleanStart(),
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['dexter.jpg', 'icon.svg'],
      manifest: {
        id: '/',
        name: 'Dexter’s · Mostrador',
        short_name: 'Dexter’s',
        description: 'Caja, pedidos e inventario de Dexter’s Granizados',
        theme_color: '#173b40',
        background_color: '#f5f7f5',
        display: 'standalone',
        start_url: '/',
        lang: 'es-CO',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,jpg,png,woff2}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
  build: { sourcemap: false, target: 'es2022' },
});
