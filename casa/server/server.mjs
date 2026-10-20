// Casa — servidor do app de divisão de tarefas domésticas.
// Node 22 puro (node:http + node:sqlite), sem dependências.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const db = new DatabaseSync(process.env.DB_PATH || './casa.db');
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS casas(id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT UNIQUE, modo TEXT DEFAULT 'pontos', criado TEXT);
CREATE TABLE IF NOT EXISTS membros(id INTEGER PRIMARY KEY, casa_id INTEGER REFERENCES casas(id) ON DELETE CASCADE,
  nome TEXT, token TEXT UNIQUE, peso REAL DEFAULT 1, ausente_ate TEXT, admin INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tarefas(id INTEGER PRIMARY KEY, casa_id INTEGER REFERENCES casas(id) ON DELETE CASCADE,
  nome TEXT, pontos INTEGER DEFAULT 1, vezes INTEGER DEFAULT 1, fixo_id INTEGER, ativa INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS preferencias(membro_id INTEGER REFERENCES membros(id) ON DELETE CASCADE,
  tarefa_id INTEGER REFERENCES tarefas(id) ON DELETE CASCADE, nivel INTEGER, PRIMARY KEY(membro_id, tarefa_id));
CREATE TABLE IF NOT EXISTS atribuicoes(id INTEGER PRIMARY KEY, casa_id INTEGER, tarefa_id INTEGER REFERENCES tarefas(id) ON DELETE CASCADE,
  membro_id INTEGER REFERENCES membros(id) ON DELETE SET NULL, semana TEXT, dia TEXT, pontos INTEGER, feito_em TEXT);
CREATE TABLE IF NOT EXISTS saldos(membro_id INTEGER REFERENCES membros(id) ON DELETE CASCADE, semana TEXT, saldo REAL,
  PRIMARY KEY(membro_id, semana));
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY, em TEXT, nivel TEXT, origem TEXT, evento TEXT, mensagem TEXT,
  casa_id INTEGER, membro_id INTEGER, versao TEXT, detalhes TEXT);
CREATE INDEX IF NOT EXISTS logs_em ON logs(em);
`);

// ---------- logs ----------
// Toda requisição vira uma linha JSON no stdout (docker logs casa-api, com rotação no compose).
// Eventos e erros, do servidor e os enviados pelo app, também vão para a tabela "logs",
// consultável em GET /admin/logs. Nunca registra tokens nem corpos de requisição.
const DIAS_LOGS = Number(process.env.LOG_DIAS || 30);
const corta = (v, n) => v == null ? null : String(v).slice(0, n);
function registra({ nivel = 'info', origem = 'servidor', evento, mensagem, casaId, membroId, versao, detalhes }) {
  const em = new Date().toISOString();
  console.log(JSON.stringify({ em, nivel, origem, evento, mensagem, casaId, membroId, versao, detalhes }));
  db.prepare('INSERT INTO logs(em,nivel,origem,evento,mensagem,casa_id,membro_id,versao,detalhes) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(em, nivel, origem, corta(evento, 80), corta(mensagem, 2000), casaId ?? null, membroId ?? null, corta(versao, 40),
      detalhes == null ? null : corta(typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes), 8000));
}
const limpaLogs = () => db.prepare('DELETE FROM logs WHERE em < ?').run(new Date(Date.now() - DIAS_LOGS * 864e5).toISOString());
limpaLogs(); setInterval(limpaLogs, 6 * 3600e3).unref();

const BIBLIOTECA = [
  ['Lavar a louça', 2, 7], ['Tirar o lixo', 1, 3], ['Limpar o banheiro', 5, 1], ['Varrer / aspirar a casa', 3, 2],
  ['Passar pano no chão', 3, 1], ['Lavar roupa', 3, 2], ['Estender / recolher roupa', 1, 2], ['Fazer compras', 3, 1],
  ['Cozinhar o jantar', 3, 5], ['Limpar a cozinha', 3, 2], ['Trocar roupa de cama', 2, 1], ['Regar plantas', 1, 2],
];

// ---------- datas ----------
const iso = d => d.toISOString().slice(0, 10);
function segunda(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}
const addDias = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
// Espalha n ocorrências pelos 7 dias da semana (ex.: 2 → seg e qui).
const diasDe = n => Array.from({ length: Math.min(7, Math.max(1, n)) }, (_, i) => Math.floor(i * 7 / Math.min(7, n)));

// ---------- distribuição ----------
function saldoAcumulado(membroId) {
  return db.prepare('SELECT COALESCE(SUM(saldo),0) s FROM saldos WHERE membro_id=?').get(membroId).s;
}

// Fecha a semana anterior: quem fez menos que a meta fica devendo pontos (saldo negativo).
function fecharSemana(casaId, semana) {
  const membros = db.prepare('SELECT * FROM membros WHERE casa_id=?').all(casaId);
  const linhas = db.prepare('SELECT membro_id, pontos, feito_em FROM atribuicoes WHERE casa_id=? AND semana=?').all(casaId, semana);
  if (!linhas.length) return;
  const total = linhas.reduce((s, l) => s + l.pontos, 0);
  const somaPesos = membros.reduce((s, m) => s + m.peso, 0) || 1;
  for (const m of membros) {
    const feitos = linhas.filter(l => l.membro_id === m.id && l.feito_em).reduce((s, l) => s + l.pontos, 0);
    const alvo = total * m.peso / somaPesos;
    db.prepare('INSERT OR REPLACE INTO saldos VALUES(?,?,?)').run(m.id, semana, feitos - alvo);
  }
}

function distribuir(casaId, inicio = segunda()) {
  const semana = iso(inicio);
  const casa = db.prepare('SELECT * FROM casas WHERE id=?').get(casaId);
  const anterior = iso(addDias(inicio, -7));
  if (!db.prepare('SELECT 1 FROM saldos s JOIN membros m ON m.id=s.membro_id WHERE m.casa_id=? AND s.semana=?').get(casaId, anterior))
    fecharSemana(casaId, anterior);

  const membros = db.prepare('SELECT * FROM membros WHERE casa_id=? ORDER BY id').all(casaId);
  const tarefas = db.prepare('SELECT * FROM tarefas WHERE casa_id=? AND ativa=1').all(casaId);
  // Mantém o que já foi feito; refaz o resto.
  db.prepare('DELETE FROM atribuicoes WHERE casa_id=? AND semana=? AND feito_em IS NULL').run(casaId, semana);
  const feitas = db.prepare('SELECT * FROM atribuicoes WHERE casa_id=? AND semana=?').all(casaId, semana);

  const ocorrencias = [];
  for (const t of tarefas) diasDe(t.vezes).forEach((d, i) => {
    const dia = iso(addDias(inicio, d));
    const jaFeitas = feitas.filter(f => f.tarefa_id === t.id).length;
    if (i >= jaFeitas) ocorrencias.push({ t, dia });
  });

  const carga = Object.fromEntries(membros.map(m => [m.id, feitas.filter(f => f.membro_id === m.id).reduce((s, f) => s + f.pontos, 0)]));
  const total = ocorrencias.reduce((s, o) => s + o.t.pontos, 0) + feitas.reduce((s, f) => s + f.pontos, 0);
  const somaPesos = membros.reduce((s, m) => s + m.peso, 0) || 1;
  // Meta de cada um: proporcional ao peso, ajustada pelo saldo das semanas passadas.
  const alvo = Object.fromEntries(membros.map(m => [m.id, Math.max(0.5, total * m.peso / somaPesos - saldoAcumulado(m.id))]));
  const prefs = db.prepare('SELECT p.* FROM preferencias p JOIN membros m ON m.id=p.membro_id WHERE m.casa_id=?').all(casaId);
  const pref = (m, t) => prefs.find(p => p.membro_id === m && p.tarefa_id === t)?.nivel ?? 0;
  const semanaPassada = db.prepare('SELECT tarefa_id, membro_id FROM atribuicoes WHERE casa_id=? AND semana=?').all(casaId, anterior);
  const fezAntes = (m, t) => semanaPassada.some(a => a.membro_id === m && a.tarefa_id === t);
  const contagemRodizio = {};

  ocorrencias.sort((a, b) => b.t.pontos - a.t.pontos || a.dia.localeCompare(b.dia));
  const ins = db.prepare('INSERT INTO atribuicoes(casa_id,tarefa_id,membro_id,semana,dia,pontos) VALUES(?,?,?,?,?,?)');
  for (const { t, dia } of ocorrencias) {
    const disponiveis = membros.filter(m => !m.ausente_ate || m.ausente_ate < dia);
    let escolhido = null;
    if (t.fixo_id && membros.some(m => m.id === t.fixo_id)) escolhido = t.fixo_id;
    else if (!disponiveis.length) escolhido = null;
    else if (casa.modo === 'rodizio') {
      // Rodízio: semana N, tarefa vai para o membro (índice da tarefa + N + ocorrência) mod n.
      const n = Math.floor(inicio.getTime() / 6048e5);
      const k = contagemRodizio[t.id] = (contagemRodizio[t.id] ?? -1) + 1;
      escolhido = disponiveis[(t.id + n + k) % disponiveis.length].id;
    } else {
      const custo = m => carga[m.id] / alvo[m.id] - pref(m.id, t.id) * 0.25 + (fezAntes(m.id, t.id) ? 0.1 : 0);
      escolhido = disponiveis.reduce((a, b) => custo(b) < custo(a) ? b : a).id;
    }
    if (escolhido) carga[escolhido] += t.pontos;
    ins.run(casaId, t.id, escolhido, semana, dia, t.pontos);
  }
}

// ---------- estado ----------
function estado(m) {
  const casa = db.prepare('SELECT id,nome,codigo,modo FROM casas WHERE id=?').get(m.casa_id);
  const semana = iso(segunda());
  if (!db.prepare('SELECT 1 FROM atribuicoes WHERE casa_id=? AND semana=?').get(casa.id, semana)) distribuir(casa.id);
  const membros = db.prepare('SELECT id,nome,peso,ausente_ate,admin FROM membros WHERE casa_id=? ORDER BY id').all(casa.id);
  const tarefas = db.prepare('SELECT id,nome,pontos,vezes,fixo_id FROM tarefas WHERE casa_id=? AND ativa=1 ORDER BY nome').all(casa.id);
  const atribuicoes = db.prepare(`SELECT a.id,a.tarefa_id,t.nome tarefa,a.membro_id,a.dia,a.pontos,a.feito_em
    FROM atribuicoes a JOIN tarefas t ON t.id=a.tarefa_id WHERE a.casa_id=? AND a.semana=? ORDER BY a.dia, t.nome`).all(casa.id, semana);
  const placar = membros.map(x => {
    const minhas = atribuicoes.filter(a => a.membro_id === x.id);
    return { membroId: x.id, nome: x.nome, feitos: minhas.filter(a => a.feito_em).reduce((s, a) => s + a.pontos, 0),
      previstos: minhas.reduce((s, a) => s + a.pontos, 0), saldo: Math.round(saldoAcumulado(x.id) * 10) / 10 };
  });
  const preferencias = db.prepare('SELECT tarefa_id, nivel FROM preferencias WHERE membro_id=?').all(m.id);
  return { eu: { id: m.id, nome: m.nome, admin: !!m.admin }, casa, semana, hoje: iso(new Date()), membros, tarefas, atribuicoes, placar, preferencias };
}

// ---------- http ----------
const codigo = () => crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
const token = () => crypto.randomBytes(24).toString('hex');
class Erro extends Error { constructor(s, m) { super(m); this.status = s; } }
const exige = (c, s, m) => { if (!c) throw new Erro(s, m); };

const rotas = {
  'GET /health': () => ({ ok: true }),
  'POST /api/casas': (_, b) => {
    exige(b.nome && b.membroNome, 400, 'Informe o nome da casa e o seu nome');
    const c = db.prepare('INSERT INTO casas(nome,codigo,criado) VALUES(?,?,?)').run(b.nome.trim(), codigo(), new Date().toISOString());
    const tk = token();
    db.prepare('INSERT INTO membros(casa_id,nome,token,admin) VALUES(?,?,?,1)').run(c.lastInsertRowid, b.membroNome.trim(), tk);
    if (b.biblioteca !== false) for (const [n, p, v] of BIBLIOTECA)
      db.prepare('INSERT INTO tarefas(casa_id,nome,pontos,vezes) VALUES(?,?,?,?)').run(c.lastInsertRowid, n, p, v);
    registra({ evento: 'casa_criada', mensagem: b.nome.trim(), casaId: Number(c.lastInsertRowid) });
    return { token: tk };
  },
  'POST /api/entrar': (_, b) => {
    const c = db.prepare('SELECT * FROM casas WHERE codigo=?').get(String(b.codigo || '').trim().toUpperCase());
    exige(c, 404, 'Código de casa não encontrado');
    exige(b.nome?.trim(), 400, 'Informe o seu nome');
    const tk = token();
    const novo = db.prepare('INSERT INTO membros(casa_id,nome,token) VALUES(?,?,?)').run(c.id, b.nome.trim(), tk);
    registra({ evento: 'membro_entrou', mensagem: b.nome.trim(), casaId: c.id, membroId: Number(novo.lastInsertRowid) });
    distribuir(c.id);
    return { token: tk };
  },
  'GET /api/estado': m => estado(m),
  'PUT /api/casa': (m, b) => {
    if (b.nome) db.prepare('UPDATE casas SET nome=? WHERE id=?').run(b.nome, m.casa_id);
    if (['pontos', 'rodizio'].includes(b.modo)) db.prepare('UPDATE casas SET modo=? WHERE id=?').run(b.modo, m.casa_id);
    return estado(m);
  },
  'POST /api/distribuir': m => { distribuir(m.casa_id); return estado(m); },
  'POST /api/tarefas': (m, b) => {
    exige(b.nome?.trim(), 400, 'Informe o nome da tarefa');
    db.prepare('INSERT INTO tarefas(casa_id,nome,pontos,vezes,fixo_id) VALUES(?,?,?,?,?)')
      .run(m.casa_id, b.nome.trim(), clamp(b.pontos, 1, 10), clamp(b.vezes, 1, 7), b.fixoId || null);
    distribuir(m.casa_id); return estado(m);
  },
  'PUT /api/tarefas/:id': (m, b, id) => {
    const t = db.prepare('SELECT * FROM tarefas WHERE id=? AND casa_id=?').get(id, m.casa_id); exige(t, 404, 'Tarefa não encontrada');
    db.prepare('UPDATE tarefas SET nome=?,pontos=?,vezes=?,fixo_id=? WHERE id=?')
      .run(b.nome?.trim() || t.nome, clamp(b.pontos ?? t.pontos, 1, 10), clamp(b.vezes ?? t.vezes, 1, 7), b.fixoId || null, id);
    distribuir(m.casa_id); return estado(m);
  },
  'DELETE /api/tarefas/:id': (m, _, id) => {
    db.prepare('UPDATE tarefas SET ativa=0 WHERE id=? AND casa_id=?').run(id, m.casa_id);
    db.prepare('DELETE FROM atribuicoes WHERE tarefa_id=? AND feito_em IS NULL').run(id);
    return estado(m);
  },
  'PUT /api/membros/:id': (m, b, id) => {
    const x = db.prepare('SELECT * FROM membros WHERE id=? AND casa_id=?').get(id, m.casa_id); exige(x, 404, 'Membro não encontrado');
    db.prepare('UPDATE membros SET nome=?,peso=?,ausente_ate=? WHERE id=?')
      .run(b.nome?.trim() || x.nome, Math.min(3, Math.max(0.1, Number(b.peso ?? x.peso))), b.ausenteAte === undefined ? x.ausente_ate : (b.ausenteAte || null), id);
    distribuir(m.casa_id); return estado(m);
  },
  'DELETE /api/membros/:id': (m, _, id) => {
    exige(m.admin || m.id === id, 403, 'Só o administrador remove outras pessoas');
    db.prepare('DELETE FROM membros WHERE id=? AND casa_id=?').run(id, m.casa_id);
    registra({ evento: 'membro_removido', casaId: m.casa_id, membroId: m.id, detalhes: { removido: id } });
    distribuir(m.casa_id); return m.id === id ? { saiu: true } : estado(m);
  },
  'PUT /api/preferencias': (m, b) => {
    for (const [tid, nivel] of Object.entries(b || {}))
      db.prepare('INSERT OR REPLACE INTO preferencias VALUES(?,?,?)').run(m.id, Number(tid), Math.max(-1, Math.min(1, Number(nivel))));
    return estado(m);
  },
  'POST /api/atribuicoes/:id/concluir': (m, _, id) => marca(m, id, "UPDATE atribuicoes SET feito_em=?, membro_id=COALESCE(membro_id, ?) WHERE id=?", new Date().toISOString(), m.id),
  'POST /api/atribuicoes/:id/desfazer': (m, _, id) => marca(m, id, 'UPDATE atribuicoes SET feito_em=NULL WHERE id=?'),
  'POST /api/atribuicoes/:id/assumir': (m, _, id) => marca(m, id, 'UPDATE atribuicoes SET membro_id=? WHERE id=?', m.id),
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, Math.round(Number(v) || a)));
function marca(m, id, sql, ...args) {
  exige(db.prepare('SELECT 1 FROM atribuicoes WHERE id=? AND casa_id=?').get(id, m.casa_id), 404, 'Tarefa não encontrada');
  db.prepare(sql).run(...args, id); return estado(m);
}

// ---------- download do APK ----------
// GET / mostra a página de download; GET /casa.apk entrega o arquivo.
// PUT /admin/apk (header X-Upload-Token = UPLOAD_TOKEN) troca o APK publicado.
const APK = path.join(process.env.APK_DIR || './apk', 'casa.apk');
fs.mkdirSync(path.dirname(APK), { recursive: true });

function paginaDownload(res) {
  const info = fs.existsSync(APK) ? fs.statSync(APK) : null;
  const detalhe = info
    ? `${(info.size / 1048576).toFixed(1)} MB · atualizado em ${info.mtime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    : 'Ainda não há versão publicada.';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Casa</title><style>
:root{--bg:#f6f8f7;--fg:#1c2b24;--sub:#5b6b63;--verde:#2e7d5b;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111815;--fg:#e6efe9;--sub:#9fb2a8;--card:#1a2420}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
main{background:var(--card);padding:32px 24px;border-radius:16px;max-width:360px;margin:16px;text-align:center;box-shadow:0 2px 12px #0001}
h1{color:var(--verde);margin:0 0 4px}p{color:var(--sub);margin:8px 0}
a.b{display:inline-block;margin:16px 0 8px;padding:14px 28px;background:var(--verde);color:#fff;border-radius:999px;text-decoration:none;font-weight:600}
small{color:var(--sub)}</style>
<main><h1>Casa</h1><p>Divida as tarefas de casa de forma justa.</p>
${info ? '<a class="b" href="/casa.apk">Baixar para Android</a>' : ''}<p><small>${detalhe}</small></p>
<p><small>Ao instalar, permita “instalar apps desconhecidos” para o navegador.</small></p></main></html>`);
}

function baixarApk(res) {
  if (!fs.existsSync(APK)) { res.writeHead(404); return res.end('APK ainda não publicado'); }
  res.writeHead(200, {
    'content-type': 'application/vnd.android.package-archive',
    'content-disposition': 'attachment; filename="casa.apk"',
    'content-length': fs.statSync(APK).size,
  });
  fs.createReadStream(APK).pipe(res);
}

// Token de administração (UPLOAD_TOKEN no .env): publicar APK e ler logs.
function exigeAdmin(req) {
  const esperado = process.env.UPLOAD_TOKEN || '';
  const recebido = String(req.headers['x-upload-token'] || '');
  exige(esperado && recebido.length === esperado.length &&
    crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado)), 401, 'Token de administração inválido');
}

async function publicarApk(req) {
  exigeAdmin(req);
  const tmp = APK + '.tmp';
  await pipeline(req, fs.createWriteStream(tmp));
  // Um APK é um zip: confere a assinatura "PK" antes de publicar.
  const cab = Buffer.alloc(2); const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, cab, 0, 2, 0); fs.closeSync(fd);
  if (cab.toString() !== 'PK') { fs.rmSync(tmp); throw new Erro(400, 'Arquivo não é um APK'); }
  fs.renameSync(tmp, APK);
  registra({ evento: 'apk_publicado', detalhes: { bytes: fs.statSync(APK).size } });
  return { ok: true, bytes: fs.statSync(APK).size };
}

// GET /admin/logs?nivel=erro&origem=app&casa=5&desde=2026-10-20&limite=200
function lerLogs(url) {
  const q = url.searchParams, onde = [], args = [];
  for (const [p, col] of [['nivel', 'nivel'], ['origem', 'origem'], ['casa', 'casa_id'], ['evento', 'evento']])
    if (q.get(p)) { onde.push(`${col}=?`); args.push(q.get(p)); }
  if (q.get('desde')) { onde.push('em>=?'); args.push(q.get('desde')); }
  const limite = Math.min(1000, Number(q.get('limite')) || 200);
  return db.prepare(`SELECT * FROM logs ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limite}`).all(...args)
    .map(l => ({ ...l, detalhes: l.detalhes && l.detalhes.startsWith('{') ? JSON.parse(l.detalhes) : l.detalhes }));
}

// POST /api/logs: o app envia erros e travamentos (com ou sem login, para pegar falhas antes de entrar).
// Limite por IP para ninguém encher a tabela.
const envios = new Map();
function recebeLogs(req, membro, b) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0];
  const agora = Date.now(), j = envios.get(ip)?.filter(t => agora - t < 60e3) ?? [];
  const itens = (Array.isArray(b.logs) ? b.logs : [b]).slice(0, 20);
  exige(j.length + itens.length <= 60, 429, 'Logs demais, tente mais tarde');
  envios.set(ip, [...j, ...itens.map(() => agora)]);
  for (const l of itens) registra({
    nivel: ['info', 'aviso', 'erro'].includes(l.nivel) ? l.nivel : 'erro', origem: 'app',
    evento: l.evento || 'erro_app', mensagem: l.mensagem, casaId: membro?.casa_id, membroId: membro?.id,
    versao: req.headers['x-app-versao'], detalhes: { aparelho: l.aparelho, android: l.android, quando: l.quando, pilha: corta(l.pilha, 6000) },
  });
  return { ok: true, recebidos: itens.length };
}

const PUBLICAS = new Set(['GET /health', 'POST /api/casas', 'POST /api/entrar']);

http.createServer(async (req, res) => {
  const inicio = performance.now();
  let chave = `${req.method} ?`, membro = null;
  res.on('finish', () => {
    // Uma linha por requisição no stdout; só a rota (sem ids nem query) e quem chamou.
    if (chave === 'GET /health') return;
    console.log(JSON.stringify({ em: new Date().toISOString(), req: chave, status: res.statusCode,
      ms: Math.round(performance.now() - inicio), casaId: membro?.casa_id, membroId: membro?.id, versao: req.headers['x-app-versao'] }));
  });
  const envia = (s, o) => { res.writeHead(s, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  try {
    const url = new URL(req.url, 'http://x');
    chave = `${req.method} ${url.pathname}`;
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/download')) return paginaDownload(res);
    if (req.method === 'GET' && url.pathname === '/casa.apk') return baixarApk(res);
    if (req.method === 'PUT' && url.pathname === '/admin/apk') return envia(200, await publicarApk(req));
    if (req.method === 'GET' && url.pathname === '/admin/logs') { exigeAdmin(req); return envia(200, lerLogs(url)); }
    const partes = url.pathname.split('/');
    const idx = partes.findIndex(p => /^\d+$/.test(p));
    const id = idx > 0 ? Number(partes[idx]) : null;
    chave = `${req.method} ${idx > 0 ? (partes[idx] = ':id', partes.join('/')) : url.pathname}`;
    const rota = rotas[chave] || (chave === 'POST /api/logs' ? 'logs' : null); exige(rota, 404, 'Rota não encontrada');
    let corpo = ''; for await (const c of req) { corpo += c; exige(corpo.length < 1e5, 413, 'Corpo grande demais'); }
    const b = corpo ? JSON.parse(corpo) : {};
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (token) membro = db.prepare('SELECT * FROM membros WHERE token=?').get(token) ?? null;
    if (rota === 'logs') return envia(200, recebeLogs(req, membro, b));
    if (!PUBLICAS.has(chave)) exige(membro, 401, 'Sessão inválida — entre de novo na casa');
    envia(200, rota(PUBLICAS.has(chave) ? null : membro, b, id));
  } catch (e) {
    const status = e.status || (e instanceof SyntaxError ? 400 : 500);
    if (status >= 500) registra({ nivel: 'erro', evento: 'erro_servidor', mensagem: `${chave}: ${e.message}`,
      casaId: membro?.casa_id, membroId: membro?.id, versao: req.headers['x-app-versao'], detalhes: corta(e.stack, 6000) });
    if (!res.headersSent) envia(status, { erro: e.status ? e.message : status === 400 ? 'Corpo da requisição inválido' : 'Erro interno' });
  }
}).listen(Number(process.env.PORT || 8080), () => console.log('casa ouvindo'));
