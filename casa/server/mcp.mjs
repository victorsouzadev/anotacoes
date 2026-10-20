// MCP da Casa (Streamable HTTP, sem sessão): POST /mcp com JSON-RPC, resposta em JSON.
// Age em nome de um membro (MCP_MEMBRO_ID) e reaproveita as mesmas rotas do app,
// então as regras (distribuição, permissões) são as mesmas.
import crypto from 'node:crypto';

const VERSOES = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCOES = `Servidor da Casa: divisão de tarefas domésticas da casa do usuário.
Comece por casa_resumo. As tarefas da semana têm um id de atribuição (use em concluir_tarefa e
passar_tarefa); as tarefas cadastradas têm outro id (use em editar_tarefa e remover_tarefa).
Pessoas podem ser indicadas pelo nome. Para guardar algo no Segundo Cérebro (ex.: o resumo da
semana no diário), use resumo_semana e depois as ferramentas do servidor Segundo Cérebro.
Regras da casa: uma tarefa pode depender de uma regra (ex.: "Água", dia sim, dia não) e só cai nos
dias em que ela vale; cada pessoa tem disponibilidade por dia da semana (livre, pouco, nada), e a
divisão põe menos tarefa nos dias com pouca disponibilidade, compensando nos outros.
Peça confirmação ao usuário antes de remover tarefas ou regras ou redistribuir a semana.`;

const txt = { type: 'string' }, int = { type: 'integer' }, bool = { type: 'boolean' };
const obj = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const pessoa = { type: 'string', description: 'Nome da pessoa (como aparece na casa).' };
const hora = { type: 'string', description: 'Horário de preferência HH:MM (ex.: "20:00"); "" tira o horário.' };
const duracao = { type: 'integer', minimum: 5, maximum: 480, description: 'Duração em minutos (agenda).' };
const regra = { type: 'string', description: 'Nome da regra (ex.: "Água"); "" = sem regra, vale todo dia.' };
const SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const NIVEL = { livre: 1, pouco: 0.4, nada: 0 };
const nivelDe = f => f >= 0.99 ? 'livre' : f <= 0 ? 'nada' : 'pouco';

export function criarMcp({ db, rotas, registra, lerLogs }) {
  const membroDe = id => db.prepare('SELECT * FROM membros WHERE id=?').get(id);
  const eu = () => {
    const m = membroDe(Number(process.env.MCP_MEMBRO_ID));
    if (!m) throw new ErroFerramenta('MCP_MEMBRO_ID não aponta para um membro existente');
    return m;
  };
  const estado = m => rotas['GET /api/estado'](m);
  const acharPessoa = (m, nome) => {
    const todos = db.prepare('SELECT * FROM membros WHERE casa_id=?').all(m.casa_id);
    const n = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    const p = todos.find(x => n(x.nome) === n(nome)) || todos.find(x => n(x.nome).startsWith(n(nome)));
    if (!p) throw new ErroFerramenta(`Pessoa "${nome}" não encontrada. Na casa: ${todos.map(x => x.nome).join(', ')}`);
    return p;
  };
  const acharRegra = (m, nome) => {
    const todas = db.prepare('SELECT * FROM condicoes WHERE casa_id=?').all(m.casa_id);
    const n = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    const r = todas.find(x => n(x.nome) === n(nome));
    if (!r) throw new ErroFerramenta(`Regra "${nome}" não encontrada. Regras: ${todas.map(x => x.nome).join(', ') || 'nenhuma'}`);
    return r;
  };
  const descreveRegra = c => c.tipo === 'alternado'
    ? `${c.nome}: dia sim, dia não (vale em ${c.referencia} e a cada 2 dias)`
    : `${c.nome}: ${c.dias.map(d => SEMANA[d]).join(', ') || 'nenhum dia'}`;
  const regrasDoDia = (e, d) => (e.diasCondicoes.find(x => x.dia === d)?.condicoes ?? []).map(id => e.condicoes.find(c => c.id === id)?.nome);
  const nomeDe = (e, id) => e.membros.find(x => x.id === id)?.nome ?? 'ninguém';
  const dia = d => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const linhaAtrib = (e, a) => `[${a.id}] ${dia(a.dia)}${a.horario ? ` ${a.horario}` : ''}${regrasDoDia(e, a.dia).length ? ` (${regrasDoDia(e, a.dia).join(', ')})` : ''} · ${a.tarefa} (${a.pontos} pt) · ${nomeDe(e, a.membro_id)}${a.feito_em ? ' · ✅ feita' : ''}`;
  // "Lavar a louça ×3, Tirar o lixo"
  const agrupa = l => Object.entries(l.reduce((c, a) => ({ ...c, [a.tarefa]: (c[a.tarefa] ?? 0) + 1 }), {}))
    .map(([t, n]) => n > 1 ? `${t} ×${n}` : t).join(', ');
  const placar = e => e.placar.map(p => `${p.nome}: ${p.feitos}/${p.previstos} pt (saldo ${p.saldo > 0 ? '+' : ''}${p.saldo})`).join('\n');

  const ferramentas = {
    casa_resumo: {
      descricao: 'Resumo da casa: pessoas, modo de divisão, código de convite, placar da semana e as tarefas de hoje e atrasadas.',
      esquema: obj(), leitura: true,
      exec: (m) => {
        const e = estado(m);
        const hoje = e.atribuicoes.filter(a => a.dia === e.hoje);
        const atrasadas = e.atribuicoes.filter(a => a.dia < e.hoje && !a.feito_em);
        return [
          `Casa "${e.casa.nome}" · código ${e.casa.codigo} · modo ${e.casa.modo === 'pontos' ? 'equilibrar pontos' : 'rodízio'}`,
          `Você é ${e.eu.nome}. Semana de ${e.semana}, hoje ${e.hoje}.`,
          `Pessoas: ${e.membros.map(x => `${x.nome} (peso ${x.peso}${x.ausente_ate ? `, ausente até ${x.ausente_ate}` : ''})`).join(', ')}`,
          `Disponibilidade: ${e.membros.map(x => `${x.nome} — ${x.disponibilidade.map((f, i) => f < 1 ? `${SEMANA[i]} ${nivelDe(f)}` : null).filter(Boolean).join(', ') || 'livre todos os dias'}`).join('; ')}`,
          `Regras: ${e.condicoes.map(descreveRegra).join('; ') || 'nenhuma'}`,
          `Hoje valem: ${regrasDoDia(e, e.hoje).join(', ') || 'nenhuma regra'}`,
          `\nPlacar:\n${placar(e)}`,
          `\nHoje:\n${hoje.map(a => linhaAtrib(e, a)).join('\n') || 'nada'}`,
          `\nAtrasadas:\n${atrasadas.map(a => linhaAtrib(e, a)).join('\n') || 'nenhuma'}`,
        ].join('\n');
      },
    },
    listar_semana: {
      descricao: 'Lista as tarefas da semana (com id de atribuição), com filtros opcionais.',
      esquema: obj({ pessoa, dia: { type: 'string', description: 'AAAA-MM-DD' }, so_pendentes: bool }), leitura: true,
      exec: (m, a) => {
        const e = estado(m);
        const pid = a.pessoa ? acharPessoa(m, a.pessoa).id : null;
        const l = e.atribuicoes.filter(x => (!pid || x.membro_id === pid) && (!a.dia || x.dia === a.dia) && (!a.so_pendentes || !x.feito_em));
        return l.map(x => linhaAtrib(e, x)).join('\n') || 'Nenhuma tarefa com esses filtros.';
      },
    },
    listar_tarefas: {
      descricao: 'Lista as tarefas cadastradas (id, pontos, frequência, responsável fixo).',
      esquema: obj(), leitura: true,
      exec: (m) => {
        const e = estado(m);
        return e.tarefas.map(t => `[${t.id}] ${t.nome} · ${t.pontos} pt · ${t.vezes === 7 ? 'todo dia' : `${t.vezes}x/semana`}` +
          `${t.horario ? ` · às ${t.horario} (${t.duracao} min)` : ''}` +
          `${t.fixo_id ? ` · sempre ${nomeDe(e, t.fixo_id)}` : ''}${t.condicao_id ? ` · só quando: ${e.condicoes.find(c => c.id === t.condicao_id)?.nome}` : ''}`).join('\n');
      },
    },
    concluir_tarefa: {
      descricao: 'Marca uma tarefa da semana como feita (ou desfaz, com desfazer=true).',
      esquema: obj({ atribuicao_id: int, desfazer: bool }, ['atribuicao_id']),
      exec: (m, a) => {
        const e = rotas[`POST /api/atribuicoes/:id/${a.desfazer ? 'desfazer' : 'concluir'}`](m, {}, a.atribuicao_id);
        return `${a.desfazer ? 'Desfeita' : 'Feita'}: ${linhaAtrib(e, e.atribuicoes.find(x => x.id === a.atribuicao_id))}`;
      },
    },
    passar_tarefa: {
      descricao: 'Passa uma tarefa da semana para outra pessoa (ou para você, sem "pessoa").',
      esquema: obj({ atribuicao_id: int, pessoa }, ['atribuicao_id']),
      exec: (m, a) => {
        const alvo = a.pessoa ? acharPessoa(m, a.pessoa) : m;
        const e = rotas['POST /api/atribuicoes/:id/assumir'](alvo, {}, a.atribuicao_id);
        return `Agora é de ${alvo.nome}: ${linhaAtrib(e, e.atribuicoes.find(x => x.id === a.atribuicao_id))}`;
      },
    },
    criar_tarefa: {
      descricao: 'Cadastra uma tarefa e redistribui a semana.',
      esquema: obj({
        nome: txt, pontos: { type: 'integer', minimum: 1, maximum: 10, description: 'Esforço' },
        vezes_por_semana: { type: 'integer', minimum: 1, maximum: 7 }, responsavel_fixo: pessoa, regra, horario: hora, duracao_min: duracao,
      }, ['nome']),
      exec: (m, a) => {
        const fixo = a.responsavel_fixo ? acharPessoa(m, a.responsavel_fixo).id : null;
        const cond = a.regra ? acharRegra(m, a.regra).id : null;
        rotas['POST /api/tarefas'](m, { nome: a.nome, pontos: a.pontos ?? 2, vezes: a.vezes_por_semana ?? 1, fixoId: fixo, condicaoId: cond,
          horario: a.horario, duracao: a.duracao_min });
        return `Tarefa "${a.nome}" criada e semana redistribuída.`;
      },
    },
    editar_tarefa: {
      descricao: 'Altera uma tarefa cadastrada. responsavel_fixo vazio ("") volta a dividir entre todos.',
      esquema: obj({ tarefa_id: int, nome: txt, pontos: { type: 'integer', minimum: 1, maximum: 10 },
        vezes_por_semana: { type: 'integer', minimum: 1, maximum: 7 }, responsavel_fixo: pessoa, regra, horario: hora, duracao_min: duracao }, ['tarefa_id']),
      exec: (m, a) => {
        const t = db.prepare('SELECT * FROM tarefas WHERE id=? AND casa_id=? AND ativa=1').get(a.tarefa_id, m.casa_id);
        if (!t) throw new ErroFerramenta('Tarefa não encontrada');
        const fixo = a.responsavel_fixo === undefined ? t.fixo_id : a.responsavel_fixo ? acharPessoa(m, a.responsavel_fixo).id : null;
        const cond = a.regra === undefined ? undefined : a.regra ? acharRegra(m, a.regra).id : null;
        rotas['PUT /api/tarefas/:id'](m, { nome: a.nome, pontos: a.pontos, vezes: a.vezes_por_semana, fixoId: fixo, condicaoId: cond,
          horario: a.horario, duracao: a.duracao_min }, a.tarefa_id);
        return `Tarefa ${a.tarefa_id} atualizada e semana redistribuída.`;
      },
    },
    remover_tarefa: {
      descricao: 'Remove uma tarefa cadastrada (as já feitas na semana continuam no placar).',
      esquema: obj({ tarefa_id: int }, ['tarefa_id']), destrutiva: true,
      exec: (m, a) => { rotas['DELETE /api/tarefas/:id'](m, {}, a.tarefa_id); return `Tarefa ${a.tarefa_id} removida.`; },
    },
    definir_ausencia: {
      descricao: 'Marca alguém como ausente pelos próximos N dias (não recebe tarefas). dias=0 limpa.',
      esquema: obj({ pessoa, dias: { type: 'integer', minimum: 0, maximum: 60 } }, ['pessoa', 'dias']),
      exec: (m, a) => {
        const p = acharPessoa(m, a.pessoa);
        const ate = a.dias > 0 ? new Date(Date.now() + a.dias * 864e5).toISOString().slice(0, 10) : '';
        rotas['PUT /api/membros/:id'](m, { ausenteAte: ate }, p.id);
        return ate ? `${p.nome} ausente até ${ate}; semana redistribuída.` : `${p.nome} disponível de novo.`;
      },
    },
    definir_disponibilidade: {
      descricao: 'Define quanto alguém consegue fazer em cada dia da semana: livre, pouco (recebe só tarefas leves e poucas) ou nada. Dias não informados ficam como estão.',
      esquema: obj({ pessoa, dias: { type: 'object', description: 'Ex.: {"qua":"pouco","qui":"pouco","sex":"pouco"}',
        propertyNames: { enum: SEMANA }, additionalProperties: { type: 'string', enum: Object.keys(NIVEL) } } }, ['pessoa', 'dias']),
      exec: (m, a) => {
        const p = acharPessoa(m, a.pessoa);
        const e = estado(m);
        const disp = [...e.membros.find(x => x.id === p.id).disponibilidade];
        for (const [dia, nivel] of Object.entries(a.dias ?? {})) {
          const i = SEMANA.indexOf(dia.toLowerCase().replace('sab', 'sáb'));
          if (i < 0 || !(nivel in NIVEL)) throw new ErroFerramenta(`Use dias ${SEMANA.join('/')} e níveis livre/pouco/nada`);
          disp[i] = NIVEL[nivel];
        }
        rotas['PUT /api/membros/:id'](m, { disponibilidade: disp }, p.id);
        return `${p.nome}: ${disp.map((f, i) => `${SEMANA[i]} ${nivelDe(f)}`).join(', ')}; semana redistribuída.`;
      },
    },
    criar_regra: {
      descricao: 'Cria uma regra da casa. tipo "alternado" = dia sim, dia não (informe se vale hoje); tipo "semana" = só em certos dias.',
      esquema: obj({ nome: txt, tipo: { type: 'string', enum: ['alternado', 'semana'] }, vale_hoje: bool,
        dias: { type: 'array', items: { type: 'string', enum: SEMANA } } }, ['nome', 'tipo']),
      exec: (m, a) => {
        const e = estado(m);
        const ref = a.vale_hoje === false ? new Date(new Date(e.hoje + 'T00:00:00Z').getTime() + 864e5).toISOString().slice(0, 10) : e.hoje;
        rotas['POST /api/condicoes'](m, { nome: a.nome, tipo: a.tipo, referencia: ref, dias: (a.dias ?? []).map(d => SEMANA.indexOf(d)) });
        return `Regra "${a.nome}" criada. Ligue tarefas a ela com editar_tarefa (campo regra).`;
      },
    },
    remover_regra: {
      descricao: 'Remove uma regra; as tarefas ligadas a ela passam a valer todo dia.',
      esquema: obj({ nome: txt }, ['nome']), destrutiva: true,
      exec: (m, a) => { const r = acharRegra(m, a.nome); rotas['DELETE /api/condicoes/:id'](m, {}, r.id); return `Regra "${r.nome}" removida.`; },
    },
    definir_peso: {
      descricao: 'Muda o peso de alguém na divisão (1 = normal, 0.5 = metade da carga, até 3).',
      esquema: obj({ pessoa, peso: { type: 'number', minimum: 0.1, maximum: 3 } }, ['pessoa', 'peso']),
      exec: (m, a) => {
        const p = acharPessoa(m, a.pessoa);
        rotas['PUT /api/membros/:id'](m, { peso: a.peso }, p.id);
        return `Peso de ${p.nome}: ${a.peso}; semana redistribuída.`;
      },
    },
    definir_modo: {
      descricao: 'Escolhe o modo de divisão: "pontos" (equilibrado) ou "rodizio".',
      esquema: obj({ modo: { type: 'string', enum: ['pontos', 'rodizio'] } }, ['modo']),
      exec: (m, a) => { rotas['PUT /api/casa'](m, { modo: a.modo }); return `Modo: ${a.modo}. Use redistribuir_semana para aplicar já.`; },
    },
    redistribuir_semana: {
      descricao: 'Refaz a divisão das tarefas ainda não feitas desta semana.',
      esquema: obj(), destrutiva: true,
      exec: (m) => { const e = rotas['POST /api/distribuir'](m); return `Semana redistribuída.\n\n${placar(e)}`; },
    },
    resumo_semana: {
      descricao: 'Resumo da semana em Markdown (placar, o que cada um fez, pendências), pronto para salvar no Segundo Cérebro.',
      esquema: obj(), leitura: true,
      exec: (m) => {
        const e = estado(m);
        const porPessoa = e.membros.map(p => {
          const feitas = e.atribuicoes.filter(a => a.membro_id === p.id && a.feito_em);
          const pend = e.atribuicoes.filter(a => a.membro_id === p.id && !a.feito_em && a.dia <= e.hoje);
          const pl = e.placar.find(x => x.membroId === p.id);
          return `### ${p.nome} — ${pl.feitos}/${pl.previstos} pt\n` +
            `- Feitas: ${agrupa(feitas) || '—'}\n` +
            `- Pendentes até hoje: ${agrupa(pend) || '—'}`;
        });
        return `## Casa "${e.casa.nome}" — semana de ${e.semana}\n\n${porPessoa.join('\n\n')}\n`;
      },
    },
    ver_logs: {
      descricao: 'Lê os logs do servidor e do app (erros, eventos), do mais recente para o mais antigo.',
      esquema: obj({ nivel: { type: 'string', enum: ['info', 'aviso', 'erro'] }, origem: { type: 'string', enum: ['app', 'servidor'] },
        limite: { type: 'integer', minimum: 1, maximum: 200 } }), leitura: true,
      exec: (m, a) => {
        const q = new URLSearchParams({ limite: String(a.limite ?? 30) });
        if (a.nivel) q.set('nivel', a.nivel);
        if (a.origem) q.set('origem', a.origem);
        const l = lerLogs(new URL('http://x/?' + q));
        return l.map(x => `${x.em} [${x.nivel}] ${x.origem}/${x.evento}${x.versao ? ` v${x.versao}` : ''}: ${x.mensagem ?? ''}`).join('\n') || 'Nenhum log.';
      },
    },
  };

  const listaFerramentas = Object.entries(ferramentas).map(([name, f]) => ({
    name, description: f.descricao, inputSchema: f.esquema,
    annotations: { readOnlyHint: !!f.leitura, destructiveHint: !!f.destrutiva, openWorldHint: false },
  }));

  function responder(msg) {
    const { id, method, params = {} } = msg;
    if (id === undefined) return null; // notificação (ex.: notifications/initialized)
    const ok = result => ({ jsonrpc: '2.0', id, result });
    const erro = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    switch (method) {
      case 'initialize': return ok({
        protocolVersion: VERSOES.includes(params.protocolVersion) ? params.protocolVersion : VERSOES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'casa', title: 'Casa — tarefas de casa', version: '1.0.0' },
        instructions: INSTRUCOES,
      });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: listaFerramentas });
      case 'tools/call': {
        const f = ferramentas[params.name];
        if (!f) return erro(-32602, `Ferramenta desconhecida: ${params.name}`);
        const m = eu();
        try {
          const texto = f.exec(m, params.arguments ?? {});
          if (!f.leitura) registra({ evento: 'mcp_acao', mensagem: params.name, casaId: m.casa_id, membroId: m.id });
          return ok({ content: [{ type: 'text', text: texto }] });
        } catch (e) {
          // Erros de regra (404, 403, validação) voltam para o modelo poder corrigir a chamada.
          if (!(e instanceof ErroFerramenta) && !e.status) throw e;
          return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
        }
      }
      default: return erro(-32601, `Método não suportado: ${method}`);
    }
  }

  // Token: Authorization: Bearer <MCP_TOKEN> ou ?key=<MCP_TOKEN> (para o conector do Claude web/app).
  function autorizado(req, url) {
    const esperado = process.env.MCP_TOKEN || '';
    const recebido = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('key') || '';
    return esperado.length >= 32 && recebido.length === esperado.length &&
      crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
  }

  return async function mcp(req, res, url) {
    const json = (status, corpo) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(corpo == null ? '' : JSON.stringify(corpo)); };
    if (!(process.env.MCP_TOKEN || '').length) return json(503, { erro: 'MCP desligado: defina MCP_TOKEN' });
    if (!autorizado(req, url)) {
      registra({ nivel: 'aviso', evento: 'mcp_token_recusado' });
      return json(401, { erro: 'Token do MCP inválido' });
    }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
    let corpo = ''; for await (const c of req) { corpo += c; if (corpo.length > 1e6) return json(413, { erro: 'Corpo grande demais' }); }
    let msg;
    try { msg = JSON.parse(corpo); } catch { return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); }
    const respostas = (Array.isArray(msg) ? msg : [msg]).map(responder).filter(Boolean);
    if (!respostas.length) return json(202, null);
    return json(200, Array.isArray(msg) ? respostas : respostas[0]);
  };
}

class ErroFerramenta extends Error {}
