// Teste da ponte em JavaScript dos craft apps (estudio/crafts/ponte-hub.js) num Chromium de verdade:
// um "app" de mentira com canvas, que lê o que é solto nele e salva por <a download>, dentro de uma
// página que faz o papel do hub. A ponte entra no index.html como o build.sh a põe.
//
//   npm i --no-save playwright@1.63.0 && npx playwright install chromium && node estudio/crafts/teste/ponte.test.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const aqui = dirname(fileURLToPath(import.meta.url));
const tag = '<script src="ponte-hub.js" data-app="fakecraft" data-versao="1.0"></script>';
const paginas = {
  '/hub.html': readFileSync(join(aqui, 'hub.html'), 'utf8'),
  // Mesma troca do build.sh (perl -0pi -e 's{<head([^>]*)>}{<head$1>\n  <script…>}i').
  '/crafts/fakecraft/index.html': readFileSync(join(aqui, 'app.html'), 'utf8').replace(/<head([^>]*)>/i, `<head$1>\n  ${tag}`),
  '/crafts/fakecraft/ponte-hub.js': readFileSync(join(aqui, '..', 'ponte-hub.js'), 'utf8'),
};
const servidor = createServer((req, res) => {
  const corpo = paginas[new URL(req.url, 'http://x').pathname];
  if (!corpo) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': req.url.includes('.js') ? 'text/javascript' : 'text/html' }).end(corpo);
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;

const navegador = await chromium.launch();
let falhou = false;
const conferir = (ok, msg) => { console.log(`${ok ? 'ok ' : 'ERRO'} ${msg}`); if (!ok) falhou = true; };
try {
  const p = await navegador.newPage();
  p.on('pageerror', (e) => conferir(false, 'erro na página: ' + e.message));
  await p.goto(`${base}/hub.html`);
  await p.waitForFunction(() => window.msgs.some((m) => m.type === 'fakecraft:save'), null, { timeout: 15000 });
  await p.waitForFunction(() => window.msgs.some((m) => m.type === 'fakecraft:dirty'), null, { timeout: 8000 }).catch(() => {});
  const msgs = await p.evaluate(() => window.msgs);
  const app = await p.frames().find((f) => f.url().includes('fakecraft')).evaluate(() => window.recebido);
  conferir(msgs[0]?.type === 'fakecraft:ready' && msgs[0]?.ponte === 'js', 'avisa que está pronto (ponte js)');
  conferir(app?.nome === 'nota.txt' && app?.txt === 'ola mundo', 'o arquivo do hub chega ao app como um soltar no canvas');
  conferir(app?.x === 400, 'modo inserir solta no meio do canvas');
  const salvo = msgs.find((m) => m.type === 'fakecraft:save');
  conferir(salvo?.name === 'salvo-nota.txt' && salvo?.texto === 'OLA MUNDO', 'o download vira salvar no hub, mesmo com a URL revogada logo depois');
  conferir(msgs.some((m) => m.type === 'fakecraft:dirty' && m.dirty === true), 'repassa o "não salvo" do beforeunload');

  // Fora de um iframe (ou sem ?host=parent) a ponte não age: o download segue normal.
  const solto = await navegador.newPage();
  await solto.goto(`${base}/crafts/fakecraft/index.html`);
  const intacto = await solto.evaluate(() => HTMLAnchorElement.prototype.click.toString().includes('[native code]'));
  conferir(intacto, 'sem ?host=parent nada é trocado');
} finally {
  await navegador.close();
  servidor.close();
}
process.exit(falhou ? 1 : 0);
