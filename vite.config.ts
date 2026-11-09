import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
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
