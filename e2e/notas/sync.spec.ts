import { Browser, BrowserContext, Page, expect, test, devices, request } from '@playwright/test';

// Spec 035 (T015): o que a sincronização das Notas precisa continuar fazendo quando sair do núcleo. Duas telas da
// mesma conta (computador e celular), cada uma com o seu IndexedDB.

const senha = 'senha-do-e2e-123';

async function novaConta(): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const api = await request.newContext({ baseURL: 'http://127.0.0.1:5199' });
  const r = await api.post('/api/auth/register', { data: { email, password: senha } });
  expect(r.ok(), await r.text()).toBeTruthy();
  await api.dispose();
  return email;
}

async function tela(browser: Browser, email: string, celular = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(celular ? { ...devices['Pixel 7'] } : {});
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('/login');
  await page.getByPlaceholder('voce@email.com').fill(email);
  await page.locator('input[type=password]').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto('/notes');
  return { ctx, page };
}

const cartao = (page: Page, titulo: string) => page.locator('.card, .list-row').filter({ hasText: titulo });

/** Recarrega até a nota aparecer (a sincronização roda na abertura e a cada 30 s). */
async function esperarNota(page: Page, titulo: string) {
  await expect(async () => {
    await page.goto('/notes');
    await expect(cartao(page, titulo)).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 45_000 });
}

async function criarNota(page: Page, titulo: string) {
  await page.getByRole('button', { name: 'Nova nota' }).click();
  await page.waitForURL(/\/notes\/.+/);
  const campo = page.getByPlaceholder('Título da nota');
  await campo.fill(titulo);
  await campo.press('Tab');
  await page.waitForTimeout(500);
  await page.goto('/notes');
  await expect(cartao(page, titulo)).toBeVisible();
}

async function porTag(page: Page, titulo: string, tag: string) {
  const input = cartao(page, titulo).locator('app-tag-input input');
  await input.fill(tag);
  await input.press('Enter');
  await expect(cartao(page, titulo)).toContainText(tag);
}

test('o celular vê a nota e as tags criadas no computador', async ({ browser }) => {
  const email = await novaConta();
  const pc = await tela(browser, email);
  await criarNota(pc.page, 'Lista do mercado');
  await porTag(pc.page, 'Lista do mercado', 'casa');

  const cel = await tela(browser, email, true);
  await esperarNota(cel.page, 'Lista do mercado');
  await expect(cartao(cel.page, 'Lista do mercado')).toContainText('casa');
});

test('edição offline sobe quando a conexão volta', async ({ browser }) => {
  const email = await novaConta();
  const pc = await tela(browser, email);
  await criarNota(pc.page, 'Rascunho');
  const cel = await tela(browser, email, true);
  await esperarNota(cel.page, 'Rascunho');

  await pc.ctx.setOffline(true);
  await cartao(pc.page, 'Rascunho').getByTitle('Renomear').click();
  await pc.page.locator('.card-title-input, input[appFocusOnInit]').first().fill('Feito sem internet');
  await pc.page.keyboard.press('Enter');
  await porTag(pc.page, 'Feito sem internet', 'offline');
  await pc.ctx.setOffline(false);

  await esperarNota(cel.page, 'Feito sem internet');
  await expect(cartao(cel.page, 'Feito sem internet')).toContainText('offline');
});

test('lixeira e restauração passam de uma tela para a outra', async ({ browser }) => {
  const email = await novaConta();
  const pc = await tela(browser, email);
  await criarNota(pc.page, 'Para a lixeira');
  const cel = await tela(browser, email, true);
  await esperarNota(cel.page, 'Para a lixeira');

  await cartao(cel.page, 'Para a lixeira').getByTitle('Excluir').click();
  await expect(cel.page.getByText('Nota movida para a lixeira')).toBeVisible();

  await expect(async () => {
    await pc.page.goto('/notes');
    await pc.page.getByRole('button', { name: /Lixeira/ }).click();
    await expect(pc.page.locator('main, .content').getByText('Para a lixeira')).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 45_000 });
  await pc.page.getByTitle('Restaurar').first().click();

  await esperarNota(cel.page, 'Para a lixeira');
});
