// node --test crafts-mcp/teste
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
process.env.CRAFTS_TRABALHO = mkdtempSync(join(tmpdir(), 'crafts-mcp-'));
process.env.CRAFTS_COMANDO_TESTE = join(aqui, 'cli-falsa.mjs');
process.env.CRAFTS_MAX_SESSOES = '2';
const { servidor, encerrar } = await import('../servidor.mjs');
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => encerrar());

const rpc = (app, corpo, sessao) => fetch(`${base}/${app}`, {
  method: 'POST', body: JSON.stringify(corpo),
  headers: { 'Content-Type': 'application/json', ...(sessao ? { 'Mcp-Session-Id': sessao } : {}) },
});

test('initialize abre a sessão e as chamadas seguintes vão para a mesma CLI', async () => {
  const ini = await rpc('gridcraft', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(ini.status, 200);
  const sessao = ini.headers.get('mcp-session-id');
  assert.match(sessao, /^[0-9a-f-]{36}$/);
  assert.equal((await ini.json()).result.serverInfo.name, 'gridcraft-cli');

  assert.equal((await rpc('gridcraft', { jsonrpc: '2.0', method: 'notifications/initialized' }, sessao)).status, 202);
  const lista = await (await rpc('gridcraft', { jsonrpc: '2.0', id: 'b', method: 'tools/list' }, sessao)).json();
  assert.equal(lista.id, 'b');
  assert.equal(lista.result.tools[0].name, 'eco');

  const eco = JSON.parse((await (await rpc('gridcraft', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'eco' } }, sessao)).json()).result.content[0].text);
  assert.equal(eco.cwd, join(process.env.CRAFTS_TRABALHO, sessao));
  assert.deepEqual(eco.args, ['mcp']);
});

test('apps que aceitam prendem leitura e escrita na pasta da sessão', async () => {
  const ini = await rpc('designcraft', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const sessao = ini.headers.get('mcp-session-id');
  const eco = JSON.parse((await (await rpc('designcraft', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'eco' } }, sessao)).json()).result.content[0].text);
  const pasta = join(process.env.CRAFTS_TRABALHO, sessao);
  assert.deepEqual(eco.args, ['mcp', '--automation-read-root', pasta, '--automation-write-root', pasta]);
  assert.equal((await fetch(`${base}/designcraft`, { method: 'DELETE', headers: { 'Mcp-Session-Id': sessao } })).status, 204);
  assert.equal(existsSync(pasta), false);
});

test('sem sessão, sem initialize, e app desconhecido são recusados', async () => {
  assert.equal((await rpc('gridcraft', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 400);
  assert.equal((await rpc('gridcraft', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, '00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await rpc('outro', { jsonrpc: '2.0', id: 1, method: 'initialize' })).status, 404);
});
