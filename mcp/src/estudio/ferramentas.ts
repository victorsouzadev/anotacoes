// Ferramentas do Estúdio no MCP local: as mesmas gerações, biblioteca e documentos do MCP remoto
// (/api/mcp/estudio), mais o que só dá para fazer no computador do usuário — mandar arquivos de
// uma pasta para a biblioteca e baixar os resultados para uma pasta.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { aguardar, baixar, dolar, enviarCaminhos, estudio, precisaConfirmar, textoDoJob } from './api.js';

type Resultado = { content: { type: 'text'; text: string }[]; isError?: true };
const texto = (v: string): Resultado => ({ content: [{ type: 'text', text: v }] });

function seguro<A extends unknown[]>(fn: (...a: A) => Promise<Resultado>) {
  return async (...a: A): Promise<Resultado> => {
    try {
      return await fn(...a);
    } catch (e) {
      return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  };
}

const CRAFTS = ['photocraft', 'vectorcraft', 'lightcraft', 'filmcraft', 'effectcraft', 'soundcraft', 'designcraft', 'figcraft', 'deckcraft', 'wordcraft', 'gridcraft', 'pdfcraft', 'cadcraft'] as const;
const ROTAS: Record<string, string> = {
  storyboard: '/estudio/ferramentas/storyboard', moodboard: '/estudio/ferramentas/moodboard', cena: '/estudio/ferramentas/palco', timeline: '/estudio/ferramentas/montagem',
};

const PARAMETROS = z.record(z.unknown()).optional()
  .describe('Parâmetros genéricos: prompt, negativo, proporcao, resolucao, duracao, quantidade, audio, qualidade, voz, anguloH, anguloV, zoom… (ver estudio_modelos).');
const ENTRADAS = z.record(z.array(z.string())).optional()
  .describe('Ids da biblioteca por entrada: imagens, imagem, imagemFinal, mascara, video, videos, audios, arquivo3d… Para arquivos do computador, use estudio_enviar_arquivos antes.');
const AGUARDAR = z.number().int().min(0).max(600).optional().describe('Segundos para esperar o resultado (até 600). Padrão 0.');
const BAIXAR_PARA = z.string().optional().describe('Pasta do computador onde gravar os resultados quando ficarem prontos (ex.: ~/Downloads/estudio).');

export function registrarFerramentasEstudio(server: McpServer): void {
  server.tool(
    'estudio_modelos',
    'Modelos de IA do Estúdio (fal.ai e World Labs): operações, entradas de arquivo, parâmetros e valores aceitos. Use antes de estudio_gerar.',
    {
      tipo: z.enum(['imagem', 'video', 'audio', 'modelo3d', 'mundo']).optional().describe('Tipo de saída.'),
      operacao: z.string().optional().describe('Só os modelos que fazem esta operação (texto, editar, inpaint, imagem, quadros, referencias, estender, musica…).'),
    },
    seguro(async ({ tipo, operacao }) => {
      const lista = (await estudio.catalogo()).filter((m) => (!tipo || m.tipo === tipo) && (!operacao || operacao in m.ops));
      if (!lista.length) return texto('Nenhum modelo com esse filtro.');
      return texto(lista.map((m) => {
        const ops = Object.entries(m.ops).filter(([o]) => !operacao || o === operacao).map(([o, s]) => {
          const opcoes = Object.entries(s.opcoes).map(([k, v]) => `${k} ∈ {${v.join(', ')}}`).join(' · ');
          return `  - ${o}: entradas [${s.entradas.join(', ')}] · parâmetros [${s.parametros.join(', ')}]${opcoes ? ' · ' + opcoes : ''}${s.maxImagens ? ` · até ${s.maxImagens} imagens` : ''}`;
        });
        return `- ${m.id} — ${m.nome} (${m.tipo}${m.descricao ? ': ' + m.descricao : ''})\n${ops.join('\n')}`;
      }).join('\n'));
    }),
  );

  server.tool(
    'estudio_gerar',
    'Gera imagem, vídeo, áudio, modelo 3D ou mundo com IA (custa na conta do fal.ai do usuário). Acima do limite de confirmação do usuário, a primeira chamada só mostra o custo: repita com confirmar=true depois que ele aprovar. O resultado vai para a biblioteca e, com baixar_para, também para uma pasta do computador.',
    {
      modelo: z.string().describe('Id do modelo (estudio_modelos).'),
      operacao: z.string().describe('Operação do modelo.'),
      parametros: PARAMETROS,
      entradas: ENTRADAS,
      confirmar: z.boolean().optional().describe('true depois que o usuário aprovar o custo.'),
      aguardar_segundos: AGUARDAR,
      baixar_para: BAIXAR_PARA,
    },
    seguro(async ({ modelo, operacao, parametros, entradas, confirmar, aguardar_segundos, baixar_para }) => {
      const pedido = { modelo, operacao, parametros: parametros ?? {}, entradas: entradas ?? {}, app: 'mcp' };
      const [est, cfg] = await Promise.all([estudio.estimar(pedido), estudio.config()]);
      if (precisaConfirmar(est.custoCentavos, cfg.confirmarAcimaCentavos, !!confirmar))
        return texto(`Custa ~${dolar(est.custoCentavos)} (acima do limite de confirmação de ${dolar(cfg.confirmarAcimaCentavos)}). Pergunte ao usuário e chame de novo com confirmar=true.`);
      return await concluir((await estudio.gerar(pedido)).id, aguardar_segundos, baixar_para);
    }),
  );

  server.tool(
    'estudio_status',
    'Andamento de uma geração ou montagem. Com aguardar_segundos espera terminar; com baixar_para grava os resultados no computador.',
    { id: z.string(), aguardar_segundos: AGUARDAR, baixar_para: BAIXAR_PARA },
    seguro(async ({ id, aguardar_segundos, baixar_para }) => concluir(id, aguardar_segundos, baixar_para)),
  );

  server.tool(
    'estudio_cancelar',
    'Cancela uma geração na fila ou rodando.',
    { id: z.string() },
    seguro(async ({ id }) => texto(textoDoJob(await estudio.cancelar(id)))),
  );

  server.tool(
    'estudio_trocar_fundo_video',
    'Troca o fundo de um vídeo da biblioteca por uma imagem (tira o fundo no fal.ai e junta com ffmpeg, mantendo o áudio).',
    { video: z.string().describe('Id do vídeo.'), fundo: z.string().describe('Id da imagem do fundo.'), confirmar: z.boolean().optional(), aguardar_segundos: AGUARDAR, baixar_para: BAIXAR_PARA },
    seguro(async ({ video, fundo, confirmar, aguardar_segundos, baixar_para }) => {
      const pedido = { modelo: 'bria-video-fundo', operacao: 'remover-fundo', entradas: { video: [video], fundo: [fundo] }, app: 'mcp', pipeline: 'trocar-fundo' };
      const [est, cfg] = await Promise.all([estudio.estimar(pedido), estudio.config()]);
      if (precisaConfirmar(est.custoCentavos, cfg.confirmarAcimaCentavos, !!confirmar))
        return texto(`Custa ~${dolar(est.custoCentavos)}. Confirme com o usuário e chame de novo com confirmar=true.`);
      return await concluir((await estudio.gerar(pedido)).id, aguardar_segundos, baixar_para);
    }),
  );

  server.tool(
    'estudio_enviar_arquivos',
    'Manda arquivos do computador (ou links https) para a biblioteca do Estúdio e devolve os ids, para usar nas gerações e nos craft apps. Aceita imagens, vídeos, áudios, modelos 3D e documentos (.xlsx, .docx, .pptx, .pdf, .dxf, .psd…).',
    {
      caminhos: z.array(z.string().min(1)).min(1).max(50).describe('Caminhos no computador (ex.: ~/Fotos/cena.png) ou links https.'),
      pasta: z.string().optional().describe('Pasta na biblioteca (opcional).'),
    },
    seguro(async ({ caminhos, pasta }) => {
      const m = await enviarCaminhos(caminhos, pasta);
      return texto(m.map((x) => `- ${x.nome} · ${x.tipo} · id ${x.id}`).join('\n'));
    }),
  );

  server.tool(
    'estudio_baixar',
    'Baixa arquivos da biblioteca do Estúdio para uma pasta do computador.',
    { ids: z.array(z.string()).min(1).max(50), pasta: z.string().describe('Pasta de destino (ex.: ~/Downloads/estudio).') },
    seguro(async ({ ids, pasta }) => {
      const midias = await Promise.all(ids.map((id) => estudio.midia(id)));
      return texto((await baixar(midias, pasta)).map((c) => `Gravado: ${c}`).join('\n'));
    }),
  );

  server.tool(
    'estudio_midias',
    'Arquivos da biblioteca do Estúdio, mais recentes primeiro.',
    {
      tipo: z.string().optional().describe('imagem, video, audio, modelo3d, mundo ou documento (vários separados por vírgula).'),
      busca: z.string().optional().describe('Busca no nome e no prompt.'),
      pasta: z.string().optional(),
      limite: z.number().int().min(1).max(200).optional(),
    },
    seguro(async ({ tipo, busca, pasta, limite }) => {
      const l = await estudio.midias({ tipo, q: busca, pasta, limite: limite ?? 30 });
      return texto(l.length ? l.map((m) => `- ${m.nome} · ${m.tipo} · id ${m.id}${m.pasta ? ' · ' + m.pasta : ''}`).join('\n') : 'Nada na biblioteca com esse filtro.');
    }),
  );

  server.tool(
    'estudio_apagar_midia',
    'Apaga um arquivo da biblioteca. Só com confirmar=true, depois de o usuário pedir.',
    { id: z.string(), confirmar: z.boolean().optional() },
    seguro(async ({ id, confirmar }) => {
      const m = await estudio.midia(id);
      if (!confirmar) return texto(`Vai apagar "${m.nome}" de vez. Confirme com o usuário e chame de novo com confirmar=true.`);
      await estudio.apagar(id);
      return texto(`"${m.nome}" apagado.`);
    }),
  );

  server.tool(
    'estudio_montar_video',
    'Monta um MP4 com ffmpeg no servidor (sem custo de IA): clipes/imagens em sequência e trilhas de áudio. clipes: [{midia, inicio?, fim?, volume?, fadeIn?, fadeOut?}], audios: [{midia, posicao?, volume?, fadeIn?, fadeOut?}] (segundos).',
    {
      clipes: z.array(z.object({ midia: z.string() }).passthrough()).min(1),
      audios: z.array(z.object({ midia: z.string() }).passthrough()).optional(),
      largura: z.number().int().optional(), altura: z.number().int().optional(), nome: z.string().optional(),
      aguardar_segundos: AGUARDAR, baixar_para: BAIXAR_PARA,
    },
    seguro(async ({ clipes, audios, largura, altura, nome, aguardar_segundos, baixar_para }) => {
      const ids = [...new Set([...clipes, ...(audios ?? [])].map((c) => c.midia))];
      const job = await estudio.local('montar', { clipes, audios: audios ?? [], largura: largura ?? 1920, altura: altura ?? 1080, fps: 30, nome: nome ?? 'Montagem' }, { clipes: ids });
      return await concluir(job.id, aguardar_segundos ?? 60, baixar_para);
    }),
  );

  server.tool(
    'estudio_extrair_quadros',
    'Tira quadros PNG de um vídeo da biblioteca (instantes escolhidos ou a cada N segundos), com ffmpeg no servidor.',
    { video: z.string(), tempos: z.array(z.number().min(0)).optional(), intervalo: z.number().positive().optional(), aguardar_segundos: AGUARDAR, baixar_para: BAIXAR_PARA },
    seguro(async ({ video, tempos, intervalo, aguardar_segundos, baixar_para }) => {
      const job = await estudio.local('quadros', { tempos, intervalo: intervalo ?? 1 }, { video: [video] });
      return await concluir(job.id, aguardar_segundos ?? 60, baixar_para);
    }),
  );

  server.tool(
    'estudio_documentos',
    'Documentos das ferramentas: storyboard, moodboard, cena (palco 3D) ou timeline (montagem), com o link para abrir.',
    { tipo: z.enum(['storyboard', 'moodboard', 'cena', 'timeline']) },
    seguro(async ({ tipo }) => {
      const l = await estudio.documentos(tipo);
      return texto(l.length ? l.map((d) => `- ${d.nome} (id ${d.id}) · ${config.webUrl}${ROTAS[tipo]}?quadro=${d.id}`).join('\n') : 'Nenhum documento desse tipo.');
    }),
  );

  server.tool(
    'estudio_documento',
    'Conteúdo JSON de um documento, para ler ou editar e salvar com estudio_salvar_documento.',
    { id: z.string() },
    seguro(async ({ id }) => {
      const d = await estudio.documento(id);
      return texto(`${d.tipo} "${d.nome}":\n${d.data}`);
    }),
  );

  server.tool(
    'estudio_salvar_documento',
    'Cria ou substitui um documento de ferramenta. Formatos: storyboard {estilo, proporcao, planos:[{id,titulo,descricao,camera,duracao,imagem,video,notas}]}; moodboard {itens:[{id,tipo,midia?,texto?,x,y,w}]}; cena {objetos:[{id,tipo:boneco|modelo|forma|imagem,nome,posicao,rotacao,escala,cor?,forma?,midia?,pose?}],fundo,camera,luz,chao,proporcao}; timeline {largura,altura,fps,clipes,audios}.',
    {
      tipo: z.enum(['storyboard', 'moodboard', 'cena', 'timeline']),
      nome: z.string(),
      conteudo: z.record(z.unknown()),
      id: z.string().optional().describe('Id para substituir (vazio = novo).'),
    },
    seguro(async ({ tipo, nome, conteudo, id }) => {
      const d = await estudio.salvarDocumento(id || randomUUID(), tipo, nome, conteudo);
      return texto(`Salvo. Abrir: ${config.webUrl}${ROTAS[tipo]}?quadro=${d.id}`);
    }),
  );

  server.tool(
    'estudio_abrir_no_app',
    'Link para abrir um arquivo da biblioteca num craft app do ArtCraft dentro do hub; o que o usuário salvar lá volta para a biblioteca.',
    { midia: z.string(), app: z.enum(CRAFTS) },
    seguro(async ({ midia, app }) => texto(`${config.webUrl}/estudio/apps/${app}?abrir=${encodeURIComponent(midia)}`)),
  );
}

async function concluir(id: string, segundos?: number, baixarPara?: string): Promise<Resultado> {
  const j = await aguardar(id, segundos ?? 0);
  const baixados = baixarPara && j.status === 'concluido' && j.resultado.length ? await baixar(j.resultado, baixarPara) : [];
  const pendente = j.status === 'fila' || j.status === 'rodando';
  return texto(textoDoJob(j, baixados) + (pendente ? '\n(ainda não terminou: chame estudio_status com este id mais tarde)' : ''));
}
