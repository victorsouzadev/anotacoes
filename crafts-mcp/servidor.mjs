// MCP remoto dos craft apps: transforma o MCP por stdio de cada CLI do ArtCraft
// (<app>-cli mcp, sem janela) em MCP por HTTP (transporte "streamable HTTP", sem SSE).
//
// Fica num container próprio, que só enxerga as CLIs (/crafts-cli, só leitura) e a pasta de
// trabalho das sessões (/trabalho, a mesma data/estudio/_mcp que a API vê). Quem fala com a
// internet é a API (/api/mcp/crafts/<app>): ela confere o token, acrescenta as ferramentas do
// hub (trazer arquivo da biblioteca, guardar resultado) e repassa o resto para cá.
//
// Cada sessão MCP (cabeçalho Mcp-Session-Id, criado no initialize) tem um processo da CLI e uma
// pasta própria; a CLI só lê e grava nessa pasta quando aceita --automation-*-root.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const PORTA = Number(process.env.PORTA ?? 8080);
const CLIS = process.env.CRAFTS_CLI_DIR ?? '/crafts-cli';
const TRABALHO = process.env.CRAFTS_TRABALHO ?? '/trabalho';
const OCIOSA_MS = Number(process.env.CRAFTS_OCIOSA_MIN ?? 15) * 60_000;
const MAX_SESSOES = Number(process.env.CRAFTS_MAX_SESSOES ?? 4);
const PRAZO_MS = Number(process.env.CRAFTS_PRAZO_S ?? 120) * 1000;
/** Para testes: roda este comando no lugar da CLI (recebe o app como argumento). */
const COMANDO_TESTE = process.env.CRAFTS_COMANDO_TESTE;

/** Como cada CLI abre o MCP sem janela, e se aceita prender leitura e escrita numa pasta. */
export const APPS = {
  photocraft: { args: ['mcp'], raizes: true },
  vectorcraft: { args: ['mcp', '--headless'], raizes: true },
  filmcraft: { args: ['mcp'], raizes: false },
  lightcraft: { args: ['mcp'], raizes: false },
  pdfcraft: { args: ['mcp'], raizes: true },
  effectcraft: { args: ['mcp'], raizes: false },
  designcraft: { args: ['mcp'], raizes: true },
  figcraft: { args: ['mcp'], raizes: true },
  wordcraft: { args: ['mcp'], raizes: true },
  soundcraft: { args: ['mcp'], raizes: true },
  deckcraft: { args: ['mcp'], raizes: true },
  cadcraft: { args: ['mcp'], raizes: false },
  gridcraft: { args: ['mcp'], raizes: false },
};

const sessoes = new Map();

export function argumentosDa(app, pasta) {
  const c = APPS[app];
  const args = [...c.args];
  if (c.raizes) args.push('--automation-read-root', pasta, '--automation-write-root', pasta);
  return args;
}

function abrirSessao(app) {
  // Sem memória para mais uma CLI: fecha a sessão parada há mais tempo.
  if (sessoes.size >= MAX_SESSOES) {
    const velha = [...sessoes.values()].sort((a, b) => a.usadaEm - b.usadaEm)[0];
    fecharSessao(velha.id);
  }
  const id = randomUUID();
  const pasta = join(TRABALHO, id);
  mkdirSync(pasta, { recursive: true });
  const [exe, args] = COMANDO_TESTE
    ? [process.execPath, [COMANDO_TESTE, app, ...argumentosDa(app, pasta)]]
    : [join(CLIS, `${app}-cli`), argumentosDa(app, pasta)];
  const proc = spawn(exe, args, { cwd: pasta, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: pasta } });
  const sessao = { id, app, pasta, proc, pendentes: new Map(), usadaEm: Date.now(), erro: '' };
  createInterface({ input: proc.stdout }).on('line', (linha) => {
    let msg;
    try { msg = JSON.parse(linha); } catch { return; }
    const lista = Array.isArray(msg) ? msg : [msg];
    for (const m of lista) {
      if (m && m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
        sessao.pendentes.get(String(m.id))?.(m);
        sessao.pendentes.delete(String(m.id));
      }
    }
  });
  proc.stderr.on('data', (d) => { sessao.erro = (sessao.erro + d.toString()).slice(-2000); });
  proc.on('exit', (codigo) => {
    for (const [, resolver] of sessao.pendentes) resolver({ jsonrpc: '2.0', id: null, error: { code: -32000, message: `${app}-cli saiu (${codigo}): ${sessao.erro.trim().slice(-400)}` } });
    sessao.pendentes.clear();
    sessoes.delete(id);
  });
  proc.on('error', (e) => { sessao.erro = String(e); });
  sessoes.set(id, sessao);
  return sessao;
}

function fecharSessao(id) {
  const s = sessoes.get(id);
  if (!s) return;
  sessoes.delete(id);
  try { s.proc.kill(); } catch { /* já saiu */ }
  try { rmSync(s.pasta, { recursive: true, force: true }); } catch { /* arquivo preso */ }
}

/** Manda uma mensagem à CLI; requisições esperam a resposta com o mesmo id. */
function enviar(sessao, msg) {
  sessao.usadaEm = Date.now();
  if (msg.id === undefined || msg.id === null) {
    sessao.proc.stdin.write(JSON.stringify(msg) + '\n');
    return Promise.resolve(null);
  }
  return new Promise((resolver) => {
    const chave = String(msg.id);
    const prazo = setTimeout(() => {
      sessao.pendentes.delete(chave);
      resolver({ jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: `${sessao.app} não respondeu em ${PRAZO_MS / 1000} s` } });
    }, PRAZO_MS);
    sessao.pendentes.set(chave, (r) => { clearTimeout(prazo); resolver({ ...r, id: msg.id }); });
    sessao.proc.stdin.write(JSON.stringify(msg) + '\n');
  });
}

function responder(res, status, corpo, cabecalhos = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cabecalhos });
  res.end(corpo === undefined ? undefined : JSON.stringify(corpo));
}

async function lerCorpo(req) {
  const partes = [];
  let total = 0;
  for await (const p of req) {
    total += p.length;
    if (total > 20 * 1024 * 1024) throw new Error('mensagem grande demais');
    partes.push(p);
  }
  return Buffer.concat(partes).toString('utf8');
}

export const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/saude') return responder(res, 200, { ok: true, sessoes: sessoes.size });
  const app = url.pathname.replace(/^\/+|\/+$/g, '');
  if (!APPS[app]) return responder(res, 404, { erro: 'app desconhecido' });
  const idSessao = req.headers['mcp-session-id'];

  if (req.method === 'DELETE') {
    if (typeof idSessao === 'string') fecharSessao(idSessao);
    return responder(res, 204);
  }
  if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' }, { Allow: 'POST, DELETE' });

  let corpo;
  try { corpo = JSON.parse(await lerCorpo(req)); } catch (e) { return responder(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: String(e.message ?? e) } }); }
  const mensagens = Array.isArray(corpo) ? corpo : [corpo];

  let sessao = typeof idSessao === 'string' ? sessoes.get(idSessao) : undefined;
  if (!sessao) {
    if (!mensagens.some((m) => m?.method === 'initialize')) {
      return responder(res, idSessao ? 404 : 400, { jsonrpc: '2.0', id: null, error: { code: -32000, message: idSessao ? 'sessão encerrada; comece com initialize' : 'falta o cabeçalho Mcp-Session-Id' } });
    }
    sessao = abrirSessao(app);
  }
  if (sessao.app !== app) return responder(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'a sessão é de outro app' } });

  const respostas = (await Promise.all(mensagens.map((m) => enviar(sessao, m)))).filter((r) => r !== null);
  const cabecalhos = { 'Mcp-Session-Id': sessao.id };
  if (respostas.length === 0) return responder(res, 202, undefined, cabecalhos);
  return responder(res, 200, Array.isArray(corpo) ? respostas : respostas[0], cabecalhos);
});

// Sessão parada há muito tempo libera a memória (e a pasta de trabalho).
setInterval(() => {
  const limite = Date.now() - OCIOSA_MS;
  for (const s of [...sessoes.values()]) if (s.usadaEm < limite) fecharSessao(s.id);
}, 60_000).unref();

/** Fecha todas as sessões (as CLIs) e o servidor. */
export function encerrar() {
  for (const id of [...sessoes.keys()]) fecharSessao(id);
  servidor.closeAllConnections();
  servidor.close();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  servidor.listen(PORTA, () => console.log(`crafts-mcp na porta ${PORTA} (CLIs em ${CLIS})`));
  for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => { encerrar(); process.exit(0); });
}
