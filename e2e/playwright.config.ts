import { defineConfig, devices } from '@playwright/test';

// Spec 035 (T015): e2e da sincronização das Notas (offline-first, achados da 021). Sobe a API (5199) e o
// ng serve (4300, com o proxy de /api) e abre duas telas da mesma conta: computador e celular.
const raiz = __dirname + '/..';
export default defineConfig({
  testDir: './notas',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4300', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'dotnet run --project backend/Notas.Api --no-launch-profile',
      cwd: raiz,
      url: 'http://127.0.0.1:5199/api/health',
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ASPNETCORE_URLS: 'http://127.0.0.1:5199',
        ASPNETCORE_ENVIRONMENT: 'Development',
        JWT_SECRET: 'segredo-do-e2e-com-tamanho-suficiente-para-hs256',
        ConnectionStrings__Db: `Data Source=${process.env.E2E_BANCO ?? raiz + '/e2e/.banco/notas.db'}`,
      },
    },
    {
      command: 'npx ng serve --host 127.0.0.1 --port 4300',
      cwd: raiz + '/frontend',
      url: 'http://127.0.0.1:4300',
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
