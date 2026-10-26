// Painel da casa: todos os dados numa página para o app (WebView), o PC e a TV.
//  - No app: GET /painel/app com o token do membro → sessão (cookie) e a página.
//  - PC/TV: o app gera um link /p/<slug> e um código de 6 dígitos; quem abre o link digita o código uma vez
//    e o aparelho fica conectado (cookie de 90 dias). Gerar outro link ou "desconectar" revoga tudo.
// A página busca /painel/dados (JSON) a cada minuto.
import crypto from 'node:crypto';

const DIAS_SESSAO = 90;
const MAX_TENTATIVAS = 5, BLOQUEIO_MIN = 15;
const COOKIE = 'casa_painel';

export function criarPainel({ db, estado, listarAtribuicoes, registra, exige, Erro, hoje, iso, addDias, SIMBOLO, BASE_URL, FOTOS, TIPOS_FOTO }) {
  const agora = () => new Date().toISOString();
  const membroDaCasa = casaId => db.prepare('SELECT * FROM membros WHERE casa_id=? ORDER BY admin DESC, id LIMIT 1').get(casaId);
  const limpaVencidas = () => db.prepare('DELETE FROM painel_sessoes WHERE criado < ?').run(new Date(Date.now() - DIAS_SESSAO * 864e5).toISOString());
  limpaVencidas(); setInterval(limpaVencidas, 6 * 3600e3).unref();
  // Pareamento de TV (como "entrar com código" da Netflix/YouTube): a TV abre /tv, ganha um código curto
  // e um segredo (cookie); alguém da casa digita o código no app e a TV vira um aparelho conectado.
  db.exec(`CREATE TABLE IF NOT EXISTS tv_pareamentos(codigo TEXT PRIMARY KEY, segredo TEXT UNIQUE, casa_id INTEGER, criado TEXT, expira TEXT)`);
  const MIN_PAREAMENTO = 10;
  const ALFA_TV = 'ACDEFGHJKMNPQRTUVWXY34679'; // sem letras/números que se confundem na TV (0/O, 1/I/L, 5/S, 8/B, 2/Z)
  const limpaPareamentos = () => db.prepare('DELETE FROM tv_pareamentos WHERE expira < ?').run(agora());

  function info(casaId) {
    const p = db.prepare('SELECT * FROM paineis WHERE casa_id=?').get(casaId);
    const aparelhos = db.prepare("SELECT COUNT(*) n FROM painel_sessoes WHERE casa_id=? AND origem='codigo'").get(casaId).n;
    // TVs conectadas + as já confirmadas no app que ainda não buscaram a sessão (a TV consulta a cada 3 s).
    const tvs = db.prepare("SELECT COUNT(*) n FROM painel_sessoes WHERE casa_id=? AND origem='tv'").get(casaId).n
      + db.prepare('SELECT COUNT(*) n FROM tv_pareamentos WHERE casa_id=? AND expira >= ?').get(casaId, agora()).n;
    return { url: p ? `${BASE_URL}/p/${p.slug}` : null, codigo: p ? p.pin : null, aparelhos, tvs, enderecoTv: `${BASE_URL}/tv` };
  }

  function gerar(m) {
    // Slug: 10 caracteres sem ambiguidade (sem 0/o/1/l); código: 6 dígitos.
    const alfabeto = 'abcdefghijkmnpqrstuvwxyz23456789';
    const slug = Array.from(crypto.randomBytes(10), b => alfabeto[b % alfabeto.length]).join('');
    const pin = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    db.prepare('DELETE FROM paineis WHERE casa_id=?').run(m.casa_id);
    db.prepare("DELETE FROM painel_sessoes WHERE casa_id=? AND origem='codigo'").run(m.casa_id);
    db.prepare('INSERT INTO paineis(casa_id,slug,pin,criado) VALUES(?,?,?,?)').run(m.casa_id, slug, pin, agora());
    registra({ evento: 'painel_link_criado', casaId: m.casa_id, membroId: m.id });
  }
  /** App: alguém da casa digita o código que a TV mostra. */
  function conectarTv(m, codigo) {
    limpaPareamentos();
    const c = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const p = c.length === 6 ? db.prepare('SELECT * FROM tv_pareamentos WHERE codigo=?').get(c) : null;
    exige(p && !p.casa_id, 404, 'Código da TV não encontrado ou vencido. Recarregue a página na TV.');
    db.prepare('UPDATE tv_pareamentos SET casa_id=? WHERE codigo=?').run(m.casa_id, c);
    registra({ evento: 'tv_conectada', casaId: m.casa_id, membroId: m.id });
  }

  function desligar(m) {
    db.prepare('DELETE FROM paineis WHERE casa_id=?').run(m.casa_id);
    desconectar(m);
  }
  function desconectar(m) {
    db.prepare("DELETE FROM painel_sessoes WHERE casa_id=? AND origem IN ('codigo','tv')").run(m.casa_id);
    registra({ evento: 'painel_desconectado', casaId: m.casa_id, membroId: m.id });
  }

  // ---------- dados ----------
  function dados(casaId) {
    const e = estado(membroDaCasa(casaId));
    const nome = id => e.membros.find(x => x.id === id)?.nome ?? '—';
    const semanas = db.prepare('SELECT DISTINCT semana FROM atribuicoes WHERE casa_id=? ORDER BY semana DESC LIMIT 8').all(casaId).map(r => r.semana).reverse();
    const historico = semanas.map(sem => {
      const at = sem === e.semana ? e.atribuicoes : listarAtribuicoes(casaId, sem);
      return { semana: sem, pessoas: Object.fromEntries(e.membros.map(m => {
        const minhas = at.filter(a => a.membro_id === m.id);
        return [m.id, { feitos: minhas.filter(a => a.feito_em).reduce((s, a) => s + a.pontos, 0), previstos: minhas.reduce((s, a) => s + a.pontos, 0) }];
      })) };
    });
    const atrib = Object.fromEntries(e.atribuicoes.map(a => [a.id, a]));
    const recentes = db.prepare(`SELECT c.* FROM comentarios c JOIN atribuicoes a ON a.id=c.atribuicao_id WHERE c.casa_id=? ORDER BY c.id DESC LIMIT 20`).all(casaId)
      .map(c => {
        const a = atrib[c.atribuicao_id] ?? db.prepare('SELECT a.*, t.nome tarefa FROM atribuicoes a JOIN tarefas t ON t.id=a.tarefa_id WHERE a.id=?').get(c.atribuicao_id);
        return { tipo: c.tipo, texto: c.texto, em: c.em, autor: nome(c.membro_id), tarefa: a?.tarefa, dia: a?.dia, dono: nome(a?.membro_id) };
      });
    const regrasDoDia = d => (e.diasCondicoes.find(x => x.dia === d)?.condicoes ?? []).map(id => e.condicoes.find(c => c.id === id)?.nome).filter(Boolean);
    return {
      casa: e.casa.nome, semana: e.semana, hoje: e.hoje, atualizado: agora(),
      pessoas: e.membros.map(m => ({ id: m.id, nome: m.nome })),
      placar: e.placar,
      tarefasHoje: e.atribuicoes.filter(a => a.dia === e.hoje).map(a => ({ tarefa: a.tarefa, horario: a.horario, pontos: a.pontos, pessoa: a.membro_id,
        estado: a.feito_em ? 'feita' : a.nao_feita != null ? 'nao_feita' : a.iniciada_em ? 'andamento' : 'pendente', iniciada: a.iniciada_em, comentarios: a.comentarios, foto: a.foto ? a.id : null })),
      dias: e.diasCondicoes.map(({ dia }) => ({ dia, regras: regrasDoDia(dia), pessoas: Object.fromEntries(e.membros.map(m => {
        const minhas = e.atribuicoes.filter(a => a.dia === dia && a.membro_id === m.id);
        return [m.id, { feitos: minhas.filter(a => a.feito_em).reduce((s, a) => s + a.pontos, 0), previstos: minhas.reduce((s, a) => s + a.pontos, 0),
          naoFeitas: minhas.filter(a => a.nao_feita != null && !a.feito_em).length }];
      })) })),
      naoFeitas: e.atribuicoes.filter(a => a.nao_feita != null && !a.feito_em).map(a => ({ tarefa: a.tarefa, dia: a.dia, pessoa: nome(a.membro_id),
        motivo: a.nao_feita, por: nome(a.nao_feita_por) })),
      comentarios: recentes,
      historico,
      tarefas: e.tarefas.map(t => ({ nome: t.nome, pontos: t.pontos, vezes: t.vezes, horario: t.horario, fixo: t.fixo_id ? nome(t.fixo_id) : null,
        regra: e.condicoes.find(c => c.id === t.condicao_id)?.nome ?? null })),
    };
  }

  // ---------- http ----------
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, v.join('=')]));
  const sessao = req => {
    const t = cookies(req)[COOKIE];
    if (!t || !/^[0-9a-f]{48}$/.test(t)) return null;
    const s = db.prepare('SELECT * FROM painel_sessoes WHERE token=?').get(t);
    if (s) db.prepare('UPDATE painel_sessoes SET visto=? WHERE token=?').run(agora(), t);
    return s;
  };
  const novaSessao = (res, casaId, origem) => {
    const t = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO painel_sessoes(token,casa_id,origem,criado,visto) VALUES(?,?,?,?,?)').run(t, casaId, origem, agora(), agora());
    const seguro = BASE_URL.startsWith('https') ? '; Secure' : '';
    res.setHeader('set-cookie', `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}${seguro}`);
    return t;
  };
  const html = (res, status, corpo) => {
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'",
    });
    res.end(corpo);
  };
  const lerForm = async req => {
    let corpo = ''; for await (const c of req) { corpo += c; if (corpo.length > 2000) break; }
    return Object.fromEntries(new URLSearchParams(corpo));
  };

  async function http(req, res, url) {
    const caminho = url.pathname;
    if (caminho === '/tv' && req.method === 'GET') {
      const s = sessao(req);
      if (s) { html(res, 200, paginaPainel(url.searchParams.get('tema'), false, true)); return { chave: 'GET /tv' }; }
      limpaPareamentos();
      // Reaproveita o pareamento desta TV se ainda vale (recarregar a página não troca o código).
      const seg = cookies(req).casa_tv;
      let p = seg && /^[0-9a-f]{48}$/.test(seg) ? db.prepare('SELECT * FROM tv_pareamentos WHERE segredo=?').get(seg) : null;
      if (!p) {
        if (db.prepare('SELECT COUNT(*) n FROM tv_pareamentos').get().n > 5000) { html(res, 503, pagina('Casa', formularioErro('Tente de novo em alguns minutos.'))); return { chave: 'GET /tv' }; }
        const segredo = crypto.randomBytes(24).toString('hex');
        let codigo; do { codigo = Array.from(crypto.randomBytes(6), b => ALFA_TV[b % ALFA_TV.length]).join(''); } while (db.prepare('SELECT 1 FROM tv_pareamentos WHERE codigo=?').get(codigo));
        db.prepare('INSERT INTO tv_pareamentos VALUES(?,?,NULL,?,?)').run(codigo, segredo, agora(), new Date(Date.now() + MIN_PAREAMENTO * 60e3).toISOString());
        res.setHeader('set-cookie', `casa_tv=${segredo}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MIN_PAREAMENTO * 60}${BASE_URL.startsWith('https') ? '; Secure' : ''}`);
        p = { codigo };
      }
      html(res, 200, paginaTv(p.codigo));
      return { chave: 'GET /tv' };
    }
    if (caminho === '/tv/estado' && req.method === 'GET') {
      const seg = cookies(req).casa_tv;
      const p = seg && /^[0-9a-f]{48}$/.test(seg) ? db.prepare('SELECT * FROM tv_pareamentos WHERE segredo=?').get(seg) : null;
      let r = { pronto: false };
      if (!p || p.expira < agora()) r = { expirado: true };
      else if (p.casa_id) {
        novaSessao(res, p.casa_id, 'tv');
        db.prepare('DELETE FROM tv_pareamentos WHERE codigo=?').run(p.codigo);
        registra({ evento: 'painel_aparelho_conectado', casaId: p.casa_id, detalhes: { tv: true, agente: String(req.headers['user-agent'] || '').slice(0, 120) } });
        r = { pronto: true };
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(r));
      return { chave: 'GET /tv/estado' };
    }
    // App: token do membro no cabeçalho (o WebView manda na primeira carga) → sessão do app.
    if (caminho === '/painel/app' && req.method === 'GET') {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const m = token ? db.prepare('SELECT * FROM membros WHERE token=?').get(token) : null;
      if (!m) { html(res, 401, pagina('Casa', formularioErro('Abra o painel pelo app Casa.'))); return { chave: 'GET /painel/app' }; }
      const s = sessao(req);
      if (!s || s.casa_id !== m.casa_id) novaSessao(res, m.casa_id, 'app');
      html(res, 200, paginaPainel(url.searchParams.get('tema'), true));
      return { chave: 'GET /painel/app', membro: m };
    }
    if (caminho === '/painel/dados' && req.method === 'GET') {
      const s = sessao(req);
      res.writeHead(s ? 200 : 401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(s ? dados(s.casa_id) : { erro: 'Sessão do painel expirada' }));
      return { chave: 'GET /painel/dados' };
    }
    const foto = caminho.match(/^\/painel\/foto\/(\d+)$/);
    if (foto && req.method === 'GET') {
      const s = sessao(req);
      const a = s ? db.prepare('SELECT foto FROM atribuicoes WHERE id=? AND casa_id=?').get(Number(foto[1]), s.casa_id) : null;
      if (!a || !a.foto) { res.writeHead(s ? 404 : 401); res.end(); return { chave: 'GET /painel/foto/:id' }; }
      res.writeHead(200, { 'content-type': TIPOS_FOTO[a.foto.split('.').pop()] || 'application/octet-stream', 'cache-control': 'private, max-age=86400' });
      (await import('node:fs')).createReadStream((await import('node:path')).join(FOTOS, a.foto)).on('error', () => res.end()).pipe(res);
      return { chave: 'GET /painel/foto/:id' };
    }
    // Impressão da semana: app (token no cabeçalho) ou PC (sessão do painel).
    if (caminho === '/painel/imprimir' && req.method === 'GET') {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const m = token ? db.prepare('SELECT * FROM membros WHERE token=?').get(token) : null;
      const s = m ? null : sessao(req);
      if (!m && !s) { html(res, 401, pagina('Casa', formularioErro('Abra pelo app Casa ou pelo painel.'))); return { chave: 'GET /painel/imprimir' }; }
      html(res, 200, paginaImpressao(m ? m.casa_id : s.casa_id, url.searchParams, !m));
      return { chave: 'GET /painel/imprimir', membro: m };
    }
    if (caminho === '/painel/sair' && req.method === 'POST') {
      const t = cookies(req)[COOKIE];
      if (t) db.prepare('DELETE FROM painel_sessoes WHERE token=?').run(t);
      res.writeHead(303, { location: '/', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` }); res.end();
      return { chave: 'POST /painel/sair' };
    }
    const alvo = caminho.match(/^\/p\/([a-z2-9]{10})$/);
    if (!alvo) { html(res, 404, pagina('Casa', formularioErro('Painel não encontrado.'))); return { chave: `${req.method} /painel/?` }; }
    const chave = `${req.method} /p/:link`;
    const p = db.prepare('SELECT * FROM paineis WHERE slug=?').get(alvo[1]);
    if (!p) { html(res, 404, pagina('Casa', formularioErro('Este link de painel não vale mais. Gere outro no app.'))); return { chave }; }
    const s = sessao(req);
    if (req.method === 'GET') {
      if (s && s.casa_id === p.casa_id) html(res, 200, paginaPainel(url.searchParams.get('tema'), false));
      else html(res, 200, paginaCodigo());
      return { chave };
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return { chave }; }
    if (p.bloqueado_ate && p.bloqueado_ate > agora()) {
      html(res, 429, paginaCodigo(`Muitas tentativas. Tente de novo em alguns minutos.`)); return { chave };
    }
    const { codigo = '' } = await lerForm(req);
    const certo = codigo.replace(/\D/g, '').length === 6 && crypto.timingSafeEqual(Buffer.from(codigo.replace(/\D/g, '')), Buffer.from(p.pin));
    if (!certo) {
      const n = p.tentativas + 1;
      db.prepare('UPDATE paineis SET tentativas=?, bloqueado_ate=? WHERE id=?')
        .run(n >= MAX_TENTATIVAS ? 0 : n, n >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MIN * 60e3).toISOString() : null, p.id);
      registra({ nivel: 'aviso', evento: 'painel_codigo_errado', casaId: p.casa_id });
      html(res, 401, paginaCodigo('Código errado.')); return { chave };
    }
    db.prepare('UPDATE paineis SET tentativas=0, bloqueado_ate=NULL WHERE id=?').run(p.id);
    novaSessao(res, p.casa_id, 'codigo');
    registra({ evento: 'painel_aparelho_conectado', casaId: p.casa_id, detalhes: { agente: String(req.headers['user-agent'] || '').slice(0, 120) } });
    res.writeHead(303, { location: caminho }); res.end();
    return { chave };
  }

  // ---------- páginas ----------
  const CSS_BASE = `
:root{--papel:#F4F5F2;--folha:#FFFFFF;--grafite:#1E2523;--grafite-suave:#5E6865;--linha:#DFE3DF;--nanquim:#2E5E5A;--nanquim-escuro:#224744;
  --nanquim-tinta:#E2ECEA;--sobre-nanquim:#FFFFFF;--positivo:#2F7D4F;--negativo:#B3403A;--atencao:#9A5D0C;
  --marca:#2E5E5A;--marca-traco:#F4F5F2;--marca-ponto:#D6AE62;--marca-pauta:#F4F5F2;color-scheme:light}
:root[data-tema=escuro]{--papel:#121514;--folha:#1A1E1D;--grafite:#E6EAE7;--grafite-suave:#9AA4A0;--linha:#2A302E;--nanquim:#7FB5AE;--nanquim-escuro:#A3CDC7;
  --nanquim-tinta:#1F3331;--sobre-nanquim:#121514;--positivo:#6FCF97;--negativo:#F08A84;--atencao:#F0B860;
  --marca:#7FB5AE;--marca-traco:#121514;--marca-ponto:#121514;--marca-pauta:#121514;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-tema=claro]){--papel:#121514;--folha:#1A1E1D;--grafite:#E6EAE7;--grafite-suave:#9AA4A0;--linha:#2A302E;
  --nanquim:#7FB5AE;--nanquim-escuro:#A3CDC7;--nanquim-tinta:#1F3331;--sobre-nanquim:#121514;--positivo:#6FCF97;--negativo:#F08A84;--atencao:#F0B860;
  --marca:#7FB5AE;--marca-traco:#121514;--marca-ponto:#121514;--marca-pauta:#121514;color-scheme:dark}}
html{font-size:16px}@media (min-width:1600px){html{font-size:20px}}@media (min-width:2400px){html{font-size:28px}}
*{box-sizing:border-box}
body{margin:0;background:var(--papel);color:var(--grafite);font:400 .9375rem/1.4375rem Figtree,system-ui,sans-serif}
h1{font:500 2.25rem/2.5rem Newsreader,Georgia,serif;margin:0}
h2{font:600 1.0625rem/1.5rem Figtree,system-ui,sans-serif;margin:0 0 .75rem}
.leg{font:500 .75rem/1rem Figtree,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--grafite-suave)}
.rot{font:500 .8125rem/1.125rem Figtree,system-ui,sans-serif;color:var(--grafite-suave)}
.val{font:500 .9375rem/1.375rem "IBM Plex Mono",ui-monospace,monospace}
.cartao{background:var(--folha);border:1px solid var(--linha);border-radius:10px;padding:1rem}
.marca svg{width:2.5rem;height:2.5rem;display:block}
button,.botao{font:600 .9375rem/1.4375rem Figtree,system-ui,sans-serif;border-radius:10px;border:1px solid var(--linha);background:var(--folha);color:var(--grafite);padding:.5rem 1rem;cursor:pointer}
button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--nanquim);outline-offset:2px}`;
  const FONTES = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@500&family=Newsreader:opsz,wght@6..72,500&display=swap" rel="stylesheet">`;
  const pagina = (titulo, corpo, tema = null, extraHead = '', classe = '') => `<!doctype html><html lang="pt-BR"${tema ? ` data-tema="${tema}"` : ''}${classe ? ` class="${classe}"` : ''}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titulo}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">${FONTES}<style>${CSS_BASE}${extraHead}</style></head><body>${corpo}</body></html>`;
  const formularioErro = msg => `<main style="max-width:420px;margin:15vh auto;padding:0 16px;text-align:center" class="marca">${SIMBOLO()}<h1 style="margin-top:16px">Casa</h1><p class="rot">${msg}</p></main>`;

  const paginaCodigo = (erro = '') => pagina('Painel da casa', `
<main style="max-width:420px;margin:12vh auto;padding:0 16px">
  <div class="cartao" style="padding:2rem 1.5rem;text-align:center;border-radius:16px">
    <div class="marca" style="display:flex;justify-content:center;margin-bottom:1rem">${SIMBOLO()}</div>
    <h1>Painel da casa</h1>
    <p class="rot" style="margin:.5rem 0 1.5rem">Digite o código de 6 dígitos que aparece no app Casa (aba Casa → Painel).</p>
    <form method="post" autocomplete="off">
      <input name="codigo" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" autofocus required aria-label="Código"
        style="width:100%;text-align:center;font:500 2.25rem/2.5rem 'IBM Plex Mono',monospace;letter-spacing:.3em;padding:.75rem;border-radius:10px;border:1px solid var(--linha);background:var(--papel);color:var(--grafite)">
      ${erro ? `<p role="alert" style="color:var(--negativo);margin:.75rem 0 0">${erro}</p>` : ''}
      <button style="margin-top:1.5rem;width:100%;background:var(--nanquim);border-color:var(--nanquim);color:var(--sobre-nanquim)">Entrar</button>
    </form>
  </div>
</main>`);

  // ---------- impressão da semana ----------
  // formato: quadro (tarefas × dias, folha deitada) | dia (lista por dia) | pessoa (uma página por pessoa)
  // pessoa: id (só dela) ou vazio (todos) · feitas: 1 = já marcadas, 0 = em branco
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NOMES_DIA = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
  const CURTOS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const ddmm = d => d.slice(8, 10) + '/' + d.slice(5, 7);
  // Iniciais únicas: "V" e "Vi" para Victor e Vitória.
  function iniciais(pessoas) {
    const r = {};
    for (const p of pessoas) {
      let n = 1;
      while (pessoas.some(o => o.id !== p.id && o.nome.slice(0, n).toLowerCase() === p.nome.slice(0, n).toLowerCase()) && n < p.nome.length) n++;
      r[p.id] = p.nome.slice(0, n);
    }
    return r;
  }
  function paginaImpressao(casaId, q, comBarra) {
    const e = estado(membroDaCasa(casaId));
    const formato = ['quadro', 'dia', 'pessoa'].includes(q.get('formato')) ? q.get('formato') : 'quadro';
    const pessoaId = Number(q.get('pessoa')) || null;
    const marcarFeitas = q.get('feitas') !== '0';
    const pessoas = e.membros.filter(m => !pessoaId || m.id === pessoaId);
    const nome = id => (e.membros.find(m => m.id === id) || {}).nome || '—';
    const ini = iniciais(e.membros);
    const at = e.atribuicoes.filter(a => !pessoaId || a.membro_id === pessoaId);
    const dias = e.diasCondicoes.map(x => x.dia);
    const regras = d => (e.diasCondicoes.find(x => x.dia === d)?.condicoes ?? []).map(id => e.condicoes.find(c => c.id === id)?.nome).filter(Boolean);
    const caixa = a => `<span class="caixa${marcarFeitas && a.feito_em ? ' marcada' : ''}" aria-hidden="true">${marcarFeitas && a.feito_em ? '✓' : ''}</span>`;
    const naoFeita = a => a.nao_feita != null && !a.feito_em;
    const titulo = `${esc(e.casa.nome)}${pessoaId ? ' · ' + esc(nome(pessoaId)) : ''}`;
    const sub = `Semana de ${ddmm(dias[0])} a ${ddmm(dias[6])}`;
    const cab = t => `<header class="cab"><div><h1>${t}</h1><div class="leg">${sub} · marque ao concluir</div></div><div class="marca">${SIMBOLO()}</div></header>`;
    const rodape = `<footer class="rot">Casa · ${esc(e.casa.nome)} · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</footer>`;
    let corpo = '';
    if (formato === 'quadro') {
      const tarefas = [...new Map(at.map(a => [a.tarefa_id, a])).values()]
        .sort((a, b) => (a.horario || '99').localeCompare(b.horario || '99') || a.tarefa.localeCompare(b.tarefa));
      corpo = cab(titulo) + `<table class="quadro"><thead><tr><th class="t">Tarefa</th>${dias.map((d, i) =>
        `<th>${CURTOS[i]} ${ddmm(d)}${regras(d).length ? `<div class="regra">${regras(d).map(esc).join(', ')}</div>` : ''}</th>`).join('')}</tr></thead><tbody>` +
        tarefas.map(t => `<tr><td class="t">${esc(t.tarefa)}<span class="rot"> · ${t.pontos} pt${t.horario ? ' · ' + t.horario : ''}</span></td>` + dias.map(d => {
          const l = at.filter(a => a.tarefa_id === t.tarefa_id && a.dia === d);
          return `<td>${l.map(a => `<span class="cel${naoFeita(a) ? ' nao' : ''}">${caixa(a)}${pessoaId ? '' : `<span class="ini">${esc(ini[a.membro_id] || '?')}</span>`}</span>`).join('')}</td>`;
        }).join('') + '</tr>').join('') + '</tbody></table>' +
        (pessoaId ? '' : `<p class="rot legenda">${e.membros.map(m => `<b>${esc(ini[m.id])}</b> = ${esc(m.nome)}`).join(' · ')}</p>`);
    } else {
      const blocoDia = (lista, d, i, comPessoa) => !lista.length ? '' : `<section class="dia"><h2>${NOMES_DIA[i]} ${ddmm(d)}${regras(d).length ? ` <span class="regra">${regras(d).map(esc).join(', ')}</span>` : ''}</h2>` +
        lista.map(a => `<div class="linha${naoFeita(a) ? ' nao' : ''}">${caixa(a)}<span class="hora val">${a.horario || ''}</span><span class="nome">${esc(a.tarefa)}${naoFeita(a) ? ' <span class="rot">(não feita)</span>' : ''}</span>` +
          `${comPessoa ? `<span class="quem">${esc(nome(a.membro_id))}</span>` : ''}<span class="pts">${a.pontos} pt</span></div>`).join('') + '</section>';
      if (formato === 'dia') corpo = cab(titulo) + `<div class="colunas">${dias.map((d, i) => blocoDia(at.filter(a => a.dia === d), d, i, !pessoaId)).join('')}</div>`;
      else corpo = pessoas.map(p => {
        const minhas = at.filter(a => a.membro_id === p.id);
        const total = minhas.reduce((s, a) => s + a.pontos, 0);
        return `<div class="folha">${cab(esc(p.nome))}<div class="colunas">${dias.map((d, i) => blocoDia(minhas.filter(a => a.dia === d), d, i, false)).join('')}</div>` +
          `<p class="total">Feitos: ______ de <b>${total}</b> pontos</p>${rodape}</div>`;
      }).join('');
    }
    if (formato !== 'pessoa') corpo += rodape;
    // Quadro: quanto mais tarefas, linhas mais justas, para caber numa folha deitada (A4 tem ~186 mm úteis).
    const nTarefas = new Set(at.map(a => a.tarefa_id)).size;
    // ~132 mm para as linhas (o resto: cabeçalho, títulos dos dias, legenda e rodapé). Altura medida do texto
    // de uma linha: 6,7 mm normal e 5,1 mm no modo justo (letra menor), usado quando a folga cairia abaixo de 1 mm.
    const ESPACO = 132, n = Math.max(1, nTarefas);
    const justo = (ESPACO / n - 6.7) / 2 < 1;
    const folgaQuadro = Math.max(0.4, Math.min(2.6, (ESPACO / n - (justo ? 5.1 : 6.7)) / 2)).toFixed(1);
    const opcoes = (nomeCampo, valores, atual) => valores.map(([v, r]) => `<a href="?${new URLSearchParams({ formato, pessoa: pessoaId || '', feitas: marcarFeitas ? '1' : '0', [nomeCampo]: v })}"${String(atual) === String(v) ? ' aria-current="true"' : ''}>${r}</a>`).join('');
    const barra = !comBarra ? '' : `<nav class="barra">
  <span class="grupo">${opcoes('formato', [['quadro', 'Quadro da semana'], ['dia', 'Lista por dia'], ['pessoa', 'Por pessoa']], formato)}</span>
  <span class="grupo">${opcoes('pessoa', [['', 'Todos'], ...e.membros.map(m => [m.id, esc(m.nome)])], pessoaId || '')}</span>
  <span class="grupo">${opcoes('feitas', [['1', 'Marcar feitas'], ['0', 'Tudo em branco']], marcarFeitas ? '1' : '0')}</span>
  <button onclick="window.print()">Imprimir</button></nav>`;
    return pagina(`Tarefas da semana · ${esc(e.casa.nome)}`, barra + `<main class="impresso ${formato}">${corpo}</main>`, 'claro', `
@page{size:A4 ${formato === 'quadro' ? 'landscape' : 'portrait'};margin:12mm}
body{background:#fff}
.impresso{max-width:${formato === 'quadro' ? '277mm' : '186mm'};margin:0 auto;padding:16px;font-size:10.5pt;line-height:1.4}
.cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--linha);padding-bottom:3mm;margin-bottom:4mm}
.cab h1{font-size:20pt;line-height:24pt}.cab .marca svg{width:10mm;height:10mm}
.caixa{display:inline-block;width:4.2mm;height:4.2mm;border:1.3px solid var(--grafite);border-radius:1mm;vertical-align:middle;text-align:center;
  line-height:4mm;font-size:9pt;font-weight:600;flex:none;box-sizing:border-box}
.regra{font:500 7.5pt/1.2 Figtree,sans-serif;color:var(--grafite-suave);text-transform:none;letter-spacing:0}
table.quadro{width:100%;border-collapse:collapse;table-layout:fixed}
.quadro th{font:600 8.5pt/1.2 Figtree,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--grafite-suave);text-align:center;padding:1.5mm 1mm;border-bottom:1.3px solid var(--grafite)}
.quadro th.t,.quadro td.t{text-align:left;width:30%}
.quadro td{border-bottom:1px solid var(--linha);padding:1.8mm 1mm;text-align:center;vertical-align:middle;white-space:normal;font-size:10pt}
.quadro td+td,.quadro th+th{border-left:1px solid var(--linha)}
.cel{display:inline-flex;align-items:center;gap:1mm;margin:0 1mm}.ini{font:600 8.5pt Figtree,sans-serif}
.cel.nao .caixa{border-style:dashed}.cel.nao .ini{text-decoration:line-through}
.legenda{margin-top:3mm}
/* Quadro de geladeira: linhas e caixas maiores, para marcar à caneta. */
.quadro td{padding:${folgaQuadro}mm 1mm;font-size:11pt}.quadro .caixa{width:5mm;height:5mm;line-height:4.8mm;font-size:11pt}.quadro .ini{font-size:9.5pt}
.quadro thead{display:table-header-group}.quadro tr{break-inside:avoid}${justo ? '.quadro td{font-size:9.5pt;line-height:1.2}.quadro .caixa{width:4mm;height:4mm;line-height:3.8mm;font-size:9pt}.quadro .ini{font-size:8pt}' : ''}
.colunas{column-count:${formato === 'quadro' ? 1 : 2};column-gap:8mm}
.dia{break-inside:avoid;margin-bottom:4mm}
.dia h2{font:600 10.5pt/1.3 Figtree,sans-serif;margin:0 0 1.5mm;border-bottom:1px solid var(--linha);padding-bottom:1mm}
.linha{display:flex;align-items:center;gap:2mm;padding:1.1mm 0}
.linha .hora{min-width:10mm;font-size:9pt;color:var(--grafite-suave)}.linha .hora:empty{min-width:0;display:none}
.linha .nome{flex:1}.linha .quem{color:var(--grafite-suave);font-size:9pt}.linha .pts{color:var(--grafite-suave);font-size:9pt;min-width:9mm;text-align:right}
.linha.nao .nome{text-decoration:line-through;color:var(--grafite-suave)}
.total{margin-top:4mm;font-size:11pt}
.folha+.folha{break-before:page}
footer{margin-top:4mm;font-size:8pt}
.barra{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--linha);background:var(--papel);position:sticky;top:0}
.barra .grupo{display:inline-flex;gap:4px;flex-wrap:wrap}
.barra a{color:var(--grafite);text-decoration:none;border:1px solid var(--linha);border-radius:6px;padding:4px 10px;font-size:13px;background:var(--folha)}
.barra a[aria-current]{background:var(--nanquim-tinta);border-color:var(--nanquim-tinta)}
.barra button{margin-left:auto;background:var(--nanquim);border-color:var(--nanquim);color:var(--sobre-nanquim)}
@media print{.barra{display:none}.impresso{padding:0;max-width:none}body{background:#fff}}`);
  }

  const paginaTv = codigo => pagina('Casa na TV', `
<main class="tvcod">
  <div class="marca">${SIMBOLO()}</div>
  <h1>Painel da casa na TV</h1>
  <p class="rot">No celular, abra o app Casa → aba Casa → Painel da casa → <b>Conectar TV</b> e digite:</p>
  <div class="codigo val" aria-label="Código ${codigo.split('').join(' ')}">${codigo.slice(0, 3)} ${codigo.slice(3)}</div>
  <p class="rot" id="st">Aguardando o celular… o código vale por ${MIN_PAREAMENTO} minutos.</p>
</main>
<script>
var t = setInterval(function () {
  var x = new XMLHttpRequest(); x.open('GET', '/tv/estado'); x.withCredentials = true;
  x.onload = function () { try { var r = JSON.parse(x.responseText);
    if (r.pronto) { clearInterval(t); location.replace('/tv'); }
    else if (r.expirado) { clearInterval(t); document.getElementById('st').textContent = 'O código venceu. Gerando outro…'; setTimeout(function () { location.reload(); }, 1500); }
  } catch (e) {} };
  x.send();
}, 3000);
</script>`, null, `
html{font-size:1.4vw}
.tvcod{max-width:60rem;margin:8vh auto;padding:0 2rem;text-align:center}
.tvcod .marca svg{width:5rem;height:5rem;margin:0 auto 1.5rem}
.tvcod .rot{font-size:1.1rem;line-height:1.6rem}
.codigo{font-size:6rem;line-height:7rem;letter-spacing:.15em;margin:2rem 0;padding:1.5rem 2rem;background:var(--folha);border:1px solid var(--linha);border-radius:16px;display:inline-block}`);

  const paginaPainel = (tema, noApp, tv = false) => pagina('Painel da casa', `
<header class="topo${tv ? ' tv' : ''}">
  <div class="marca">${SIMBOLO()}</div>
  <div style="flex:1;min-width:0"><h1 id="casa">Casa</h1><div class="leg" id="sub">carregando…</div></div>
  <div class="temas" role="group" aria-label="Tema">${noApp ? '' : `
    <button data-t="sistema">Sistema</button><button data-t="claro">Claro</button><button data-t="escuro">Escuro</button>
    ${tv ? '' : '<a class="botao" href="/painel/imprimir" style="text-decoration:none">Imprimir semana</a>'}
    <form method="post" action="/painel/sair" style="display:inline"><button title="Desconectar este aparelho">Sair</button></form>`}</div>
</header>
<main id="painel"${tv ? ' class="tv"' : ''}>
  <section class="cartao largo" id="placar"><h2>Placar da semana</h2><div class="grade-pessoas"></div></section>
  <div class="dupla largo">
    <section class="cartao" id="hoje"><h2>Hoje</h2><div></div></section>
    <section class="cartao" id="avisos"><h2>Não feitas e comentários</h2><div></div></section>
  </div>
  <section class="cartao largo" id="semana"><h2>Semana por dia</h2><div class="rolar"></div></section>
  <section class="cartao largo" id="historico"><h2>Pontos feitos por semana</h2><p class="rot" style="margin:-.5rem 0 .75rem">Barra cheia: feito · faixa clara: previsto</p><div class="multiplos"></div>
    <details><summary class="rot">Ver em tabela</summary><div class="rolar" id="hist-tabela"></div></details></section>
  ${tv ? '' : '<section class="cartao largo" id="tarefas"><h2>Tarefas cadastradas</h2><div class="rolar"></div></section>'}
</main>
<div id="dica" role="tooltip" hidden></div>
<script>
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SEM = ['seg','ter','qua','qui','sex','sáb','dom'];
const dois = n => (n < 10 ? '0' : '') + n;
const dia = d => { const x = new Date(d + 'T12:00:00Z'); return SEM[(x.getUTCDay() + 6) % 7] + ' ' + dois(x.getUTCDate()) + '/' + dois(x.getUTCMonth() + 1); };
const hora = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
// Tema: ?tema= (vindo do app) > escolha salva > sistema.
const temaUrl = ${JSON.stringify(tema && ['claro', 'escuro'].includes(tema) ? tema : null)};
let tema = temaUrl; try { tema = tema || localStorage.getItem('tema'); } catch (e) {}
const aplica = t => { if (t === 'claro' || t === 'escuro') document.documentElement.dataset.tema = t; else delete document.documentElement.dataset.tema;
  document.querySelectorAll('[data-t]').forEach(b => b.setAttribute('aria-pressed', String((t || 'sistema') === b.dataset.t))); };
aplica(tema);
document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tema = b.dataset.t; try { localStorage.setItem('tema', tema); } catch (e) {} aplica(tema); });

function barra(feito, previsto) {
  const p = previsto ? Math.min(100, feito / previsto * 100) : 0;
  return '<div class="barra" role="img" aria-label="' + feito + ' de ' + previsto + ' pontos"><i style="width:' + p + '%"></i></div>';
}
function render(d) {
  const nome = id => (d.pessoas.find(p => p.id === id) || {}).nome || '—';
  $('#casa').textContent = d.casa;
  $('#sub').textContent = 'semana de ' + dia(d.semana) + ' · atualizado ' + hora(d.atualizado);
  $('#placar .grade-pessoas').innerHTML = d.placar.map(p =>
    '<div><div class="linha"><b>' + esc(p.nome) + '</b><span class="val">' + p.feitos + '/' + p.previstos + ' pt</span></div>' + barra(p.feitos, p.previstos) +
    '<div class="rot">saldo ' + (p.saldo > 0 ? '+' : '') + p.saldo + (p.naoFeitas ? ' · <span class="neg">' + p.naoFeitas + ' não feita' + (p.naoFeitas > 1 ? 's' : '') + '</span>' : '') + '</div></div>').join('');
  const ESTADO = { feita: 'feita', nao_feita: 'não feita', pendente: '', andamento: 'em andamento' };
  $('#hoje div').innerHTML = d.pessoas.map(p => {
    const l = d.tarefasHoje.filter(t => t.pessoa === p.id);
    return '<div class="leg" style="margin-top:.5rem">' + esc(p.nome) + '</div>' + (l.length ? l.map(t =>
      '<div class="item ' + t.estado + '"><span class="val hora">' + (t.horario || '') + '</span><span class="nome">' + esc(t.tarefa) + '</span>' +
      (t.foto ? '<a href="/painel/foto/' + t.foto + '" target="_blank" rel="noopener"><img class="mini" src="/painel/foto/' + t.foto + '" alt="Foto de ' + esc(t.tarefa) + '" loading="lazy"></a>' : '') + '<span class="rot">' +
      [t.estado === 'andamento' ? 'em andamento desde ' + hora(t.iniciada) : ESTADO[t.estado], t.comentarios ? t.comentarios + ' coment.' : '', t.pontos + ' pt'].filter(Boolean).join(' · ') + '</span></div>').join('') : '<div class="rot">nada hoje</div>');
  }).join('');
  const avisos = [
    ...d.naoFeitas.map(n => '<div class="item"><span class="neg rot" style="min-width:5.5rem">não feita</span><span class="nome">' + esc(n.tarefa) + ' <span class="rot">· ' + esc(n.pessoa) + ' · ' + dia(n.dia) + '</span>' +
      (n.motivo ? '<br><span class="rot">“' + esc(n.motivo) + '” (' + esc(n.por) + ')</span>' : '<br><span class="rot">sinalizado por ' + esc(n.por) + '</span>') + '</span></div>'),
    ...d.comentarios.filter(c => c.tipo === 'comentario').slice(0, 8).map(c => '<div class="item"><span class="rot" style="min-width:5.5rem">' + esc(c.autor) + '</span><span class="nome">' + esc(c.texto) +
      '<br><span class="rot">em ' + esc(c.tarefa || '—') + (c.dono ? ' (' + esc(c.dono) + ')' : '') + (c.dia ? ' · ' + dia(c.dia) : '') + '</span></span></div>'),
  ];
  $('#avisos div').innerHTML = avisos.length ? avisos.join('') : '<div class="rot">Nada por aqui.</div>';
  $('#semana .rolar').innerHTML = '<table><thead><tr><th>Dia</th><th>Regras</th>' + d.pessoas.map(p => '<th class="num">' + esc(p.nome) + '</th>').join('') + '</tr></thead><tbody>' +
    d.dias.map(x => '<tr' + (x.dia === d.hoje ? ' class="hoje"' : '') + '><td>' + dia(x.dia) + (x.dia === d.hoje ? ' <span class="leg">hoje</span>' : '') + '</td><td class="rot">' + (x.regras.map(esc).join(', ') || '—') + '</td>' +
      d.pessoas.map(p => { const v = x.pessoas[p.id]; return '<td class="num val">' + v.feitos + '/' + v.previstos + (v.naoFeitas ? ' <span class="neg rot">' + v.naoFeitas + ' não</span>' : '') + '</td>'; }).join('') + '</tr>').join('') + '</tbody></table>';
  // Histórico: um pequeno gráfico por pessoa (mesma escala), barra = semana.
  const max = Math.max.apply(null, [1].concat(d.historico.reduce((acc, h) => acc.concat(d.pessoas.map(p => (h.pessoas[p.id] || {}).previstos || 0)), [])));
  const caixa = $('#historico .multiplos');
  const colunas = Math.max(1, getComputedStyle(caixa).gridTemplateColumns.split(' ').length);
  const W = Math.max(200, Math.floor((caixa.clientWidth - (colunas - 1) * 32) / colunas)), H = 140, base = H - 20;
  const larg = Math.min(32, (W - 8) / Math.max(1, d.historico.length) - 8);
  $('#historico .multiplos').innerHTML = d.pessoas.map(p => {
    const barras = d.historico.map((h, i) => {
      const v = h.pessoas[p.id] || { feitos: 0, previstos: 0 }, x = 4 + i * ((W - 8) / d.historico.length);
      const hp = (v.previstos / max) * (base - 6), hf = (v.feitos / max) * (base - 6);
      const r = Math.min(4, larg / 2);
      const col = (alt, cls) => alt <= 0 ? '' : '<path class="' + cls + '" d="M' + x + ' ' + base + 'v' + (-(alt - r)) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + (-r) + 'h' + (larg - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'v' + (alt - r) + 'z"/>';
      return '<g class="alvo" data-dica="' + esc(p.nome + ' · semana de ' + dia(h.semana) + ': ' + v.feitos + ' de ' + v.previstos + ' pt') + '">' +
        '<rect x="' + (x - 3) + '" y="0" width="' + (larg + 6) + '" height="' + base + '" fill="transparent"/>' + col(hp, 'prev') + col(hf, 'feito') +
        '<text x="' + (x + larg / 2) + '" y="' + (H - 4) + '" text-anchor="middle" class="eixo">' + dia(h.semana).slice(4) + '</text></g>';
    }).join('');
    return '<figure><figcaption><b>' + esc(p.nome) + '</b></figcaption><svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Pontos por semana de ' + esc(p.nome) + '">' +
      '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" class="base"/>' + barras + '</svg></figure>';
  }).join('');
  $('#hist-tabela').innerHTML = '<table><thead><tr><th>Semana</th>' + d.pessoas.map(p => '<th class="num">' + esc(p.nome) + '</th>').join('') + '</tr></thead><tbody>' +
    d.historico.map(h => '<tr><td>' + dia(h.semana) + '</td>' + d.pessoas.map(p => { const v = h.pessoas[p.id] || {}; return '<td class="num val">' + (v.feitos || 0) + '/' + (v.previstos || 0) + '</td>'; }).join('') + '</tr>').join('') + '</tbody></table>';
  if ($('#tarefas')) $('#tarefas .rolar').innerHTML = '<table><thead><tr><th>Tarefa</th><th class="num">Pontos</th><th>Frequência</th><th>Horário</th><th>Responsável</th><th>Regra</th></tr></thead><tbody>' +
    d.tarefas.map(t => '<tr><td>' + esc(t.nome) + '</td><td class="num val">' + t.pontos + '</td><td>' + (t.vezes === 7 ? 'todo dia' : t.vezes + 'x/sem') + '</td><td class="val">' + (t.horario || '—') +
      '</td><td>' + esc(t.fixo || 'dividida') + '</td><td>' + esc(t.regra || '—') + '</td></tr>').join('') + '</tbody></table>';
}
// Dica ao passar o mouse/dedo nas barras do histórico.
const dica = $('#dica');
document.addEventListener('pointermove', ev => {
  const g = ev.target.closest && ev.target.closest('.alvo');
  if (!g) { dica.hidden = true; return; }
  dica.textContent = g.dataset.dica; dica.hidden = false;
  dica.style.left = Math.min(innerWidth - dica.offsetWidth - 8, ev.clientX + 12) + 'px'; dica.style.top = (ev.clientY + 12) + 'px';
});
async function atualiza() {
  try {
    const r = await fetch('/painel/dados', { credentials: 'same-origin' });
    if (r.status === 401) { location.reload(); return; }
    render(await r.json());
  } catch (e) { $('#sub').textContent = 'sem conexão — tentando de novo'; }
}
let ultimo = null;
const _render = render; render = d => { ultimo = d; _render(d); };
addEventListener('resize', () => { if (ultimo) _render(ultimo); });
atualiza(); setInterval(atualiza, 60000);
// TV: pede para a tela não apagar (onde o navegador permitir) e recarrega a página uma vez por dia.
if (${tv}) {
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {}); } catch (e) {}
  setTimeout(function () { location.reload(); }, 24 * 3600e3);
}
</script>`, tema && ['claro', 'escuro'].includes(tema) ? tema : null, `
.topo{display:flex;gap:1rem;align-items:center;padding:1.5rem 1.5rem .5rem;max-width:1800px;margin:0 auto;flex-wrap:wrap}
.temas{display:flex;gap:.5rem;flex-wrap:wrap}.temas button{padding:.25rem .75rem}.temas button[aria-pressed=true]{background:var(--nanquim-tinta);border-color:var(--nanquim-tinta)}
#painel{display:grid;grid-template-columns:repeat(auto-fit,minmax(22rem,1fr));grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));grid-gap:1rem;gap:1rem;padding:1rem 1.5rem 2rem;max-width:1800px;margin:0 auto}
.largo{grid-column:1/-1}
.item>*+*,.linha>*+*,.topo>*+*{margin-left:.75rem}@supports (gap:1rem){.item>*+*,.linha>*+*,.topo>*+*{margin-left:0}}
/* TV: cabe numa tela 16:9, letras proporcionais à largura, sem a lista de tarefas cadastradas. */
.topo.tv,#painel.tv{max-width:none}
#painel.tv{padding-top:.5rem}
html.tv{font-size:1.3vw}
#painel.tv{grid-template-columns:2fr 2fr 3fr;align-items:start}
#painel.tv #placar{grid-column:1/4;grid-row:1}
#painel.tv .dupla{grid-column:1/3;grid-row:2;grid-template-columns:1fr 1fr}
#painel.tv #semana{grid-column:3/4;grid-row:2}
#painel.tv #historico{display:none}
#painel.tv #semana td,#painel.tv #semana th{padding:.25rem .5rem .25rem 0}
.dupla{display:grid;grid-template-columns:repeat(auto-fit,minmax(22rem,1fr));grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));grid-gap:1rem;gap:1rem}
.grade-pessoas{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));grid-gap:1rem 2rem;gap:1rem 2rem}
.linha{display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
.barra{height:.375rem;border-radius:4px;background:var(--linha);margin:.5rem 0 .25rem;overflow:hidden}.barra i{display:block;height:100%;background:var(--grafite);border-radius:4px}
.item{display:flex;gap:.75rem;align-items:baseline;padding:.25rem 0;border-bottom:1px solid var(--linha)}.item:last-child{border-bottom:0}
.item .hora{min-width:3.25rem;color:var(--grafite-suave)}.item .hora:empty{display:none}.item .nome{flex:1;min-width:0}
.item.feita .nome{text-decoration:line-through;color:var(--grafite-suave)}
.item.andamento .nome{font-weight:600}
.mini{width:2.5rem;height:2.5rem;object-fit:cover;border-radius:6px;border:1px solid var(--linha);display:block}
.neg{color:var(--negativo)}
.rolar{overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.375rem .75rem .375rem 0;border-bottom:1px solid var(--linha);white-space:nowrap}
th{font:500 .75rem/1rem Figtree,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--grafite-suave)}
.num{text-align:right}tr.hoje td{background:var(--nanquim-tinta)}
.multiplos{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));grid-gap:1rem 2rem;gap:1rem 2rem}
figure{margin:0}figcaption{margin-bottom:.25rem}svg .prev{fill:var(--linha)}svg .feito{fill:var(--grafite)}svg .base{stroke:var(--linha);stroke-width:1}
svg .eixo{font:500 .75rem "IBM Plex Mono",monospace;fill:var(--grafite-suave)}svg{display:block;max-width:100%}
#dica{position:fixed;z-index:9;pointer-events:none;background:var(--folha);color:var(--grafite);border:1px solid var(--linha);border-radius:6px;padding:.25rem .5rem;
  font:500 .8125rem/1.125rem Figtree,system-ui,sans-serif;box-shadow:0 12px 32px rgba(30,37,35,.14)}
summary{cursor:pointer;margin-top:.75rem}
:root[data-tema=escuro] #dica{box-shadow:0 12px 32px rgba(0,0,0,.5)}
@media (prefers-color-scheme:dark){:root:not([data-tema=claro]) #dica{box-shadow:0 12px 32px rgba(0,0,0,.5)}}`, tv ? 'tv' : '');

  return { info, gerar, desligar, desconectar, conectarTv, http, dados };
}
