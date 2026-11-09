import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 40000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs tests/support/server.ts',
      url: 'http://127.0.0.1:5180/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command:
        'npm run build:e2e && node node_modules/vite/bin/vite.js preview --outDir .local/e2e-dist --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      // Valores ficticios: las pruebas simulan Supabase Auth con page.route. Al venir del proceso,
      // tienen prioridad sobre un .env.local y evitan que la compilación e2e apunte al proyecto real.
      env: {
        VITE_TEST_GATEWAY: 'http://127.0.0.1:5180/dexter',
        VITE_SUPABASE_URL: 'http://127.0.0.1:5180',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-clave-publicable-ficticia',
      },
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
});
