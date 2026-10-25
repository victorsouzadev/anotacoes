// Ferramentas da Viih Mimos: montar post (story, feed, carrossel) a partir de
// fotos e contexto, e alimentar o site (catálogo, fotos, depoimentos, textos).
// O post sai como rascunho no Editor de Imagens: a pessoa confere e exporta lá.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../config.js';
import { capacidade } from './catalogo.js';
import { lerFoto, paraOSite, reduzir } from './fotos.js';
import {
  PERFIL_VIIH, formatoDaLegenda, listarModelos, ordemCompleta, planejarPost, salvarRascunho, sugerirLegendas, textosFinais,
} from './postApi.js';
import { SiteApi, siteConfig, slug } from './siteApi.js';

type Resultado = { content: { type: 'text'; text: string }[]; isError?: true };

function texto(v: unknown): Resultado {
  return { content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] };
}

function seguro<A extends unknown[]>(fn: (...a: A) => Promise<Resultado>) {
  return async (...a: A): Promise<Resultado> => {
    try {
      return await fn(...a);
    } catch (e) {
      return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  };
}

/** A IA olha no máximo 6 fotos; o carrossel de entregas aceita até 9. */
const MAX_FOTOS_IA = 6;
const MAX_FOTOS = 9;

const TOM = z.enum(['carinhoso', 'divertido', 'vendedor', 'informativo']).optional()
  .describe('Tom dos textos. Padrão: carinhoso.');
const FOTOS = z.array(z.string().min(1)).min(1).max(MAX_FOTOS)
  .describe('Caminhos das fotos no computador (ex.: ~/Fotos/alice/1.jpg) ou links https. Anexos da conversa não servem: peça o caminho.');

let site: SiteApi | null = null;
function painel(): SiteApi {
  if (site) return site;
  const cfg = siteConfig();
  if (!cfg) throw new Error('O site não está configurado neste MCP. Defina VIIH_PAINEL_URL, VIIH_PAINEL_LOGIN e VIIH_PAINEL_SENHA no cliente MCP.');
  return (site = new SiteApi(cfg));
}

export function registrarFerramentasViih(server: McpServer): void {
  const marca = process.env.VIIH_PERFIL_MARCA?.trim() || PERFIL_VIIH;

  server.tool(
    'viih_listar_modelos',
    'Lista os modelos de post da Viih Mimos (story, feed, carrossel) com quantas fotos cada um recebe e os textos que ele tem. Inclui os modelos salvos na galeria do editor.',
    {},
    seguro(async () => texto((await listarModelos()).map((m) => ({
      id: m.id, tipo: m.grupo, nome: m.nome, quando: m.ajuda, fotos: capacidade(m), textos: m.textos,
    })))),
  );

  server.tool(
    'viih_gerar_post',
    'Monta um post da Viih Mimos a partir de fotos: a IA escolhe o modelo (ou usa o tipo/modelo pedido), reescreve os textos da arte para o que aparece nas fotos, ordena as fotos e escreve 3 legendas. '
      + 'O post é salvo como rascunho no Editor de Imagens e a resposta traz o link para abrir, conferir e exportar. Para story + feed do mesmo assunto, chame uma vez por tipo.',
    {
      fotos: FOTOS,
      contexto: z.string().max(1500).optional().describe('Do que é o post: produto, tema, cliente, ocasião. Ex.: "kit festa jardim encantado da Alice, 5 anos".'),
      tipo: z.enum(['auto', 'Story', 'Feed', 'Carrossel']).optional().describe('Tipo de post. Padrão: auto (a IA escolhe).'),
      modelo: z.string().optional().describe('Id de um modelo específico (de viih_listar_modelos). Opcional.'),
      tom: TOM,
      legenda: z.boolean().optional().describe('Escrever as legendas também. Padrão: true.'),
      nome: z.string().max(200).optional().describe('Nome do projeto no editor. Padrão: tipo + contexto.'),
    },
    seguro(async ({ fotos, contexto, tipo, modelo, tom, legenda, nome }) => {
      const lidas = await Promise.all(fotos.map(lerFoto));
      // Pra IA, pequenas; pro editor, grandes o bastante pra exportar 1080 px.
      const [paraIa, paraEditor] = await Promise.all([
        Promise.all(lidas.slice(0, MAX_FOTOS_IA).map((f) => reduzir(f, 768, 80))),
        Promise.all(lidas.map((f) => reduzir(f, 1440, 82))),
      ]);

      const todos = (await listarModelos()).filter((m) => m.fotos > 0);
      const candidatos = modelo ? todos.filter((m) => m.id === modelo) : todos;
      if (!candidatos.length) throw new Error(modelo ? `O modelo "${modelo}" não existe ou não recebe fotos. Veja viih_listar_modelos.` : 'Nenhum modelo recebe fotos.');

      const ctx = contexto?.trim() ?? '';
      const t = tom ?? 'carinhoso';
      const plano = await planejarPost({ fotos: paraIa, modelos: candidatos, tipo: modelo ? 'auto' : (tipo ?? 'auto'), tom: t, contexto: ctx, marca });
      const escolhido = candidatos.find((m) => m.id === plano.modeloId)!;
      const ordem = ordemCompleta(plano.ordemFotos, lidas.length);
      const textos = textosFinais(escolhido, plano);

      let legendas: string[] = [];
      let avisoLegenda = '';
      if (legenda !== false) {
        try {
          legendas = await sugerirLegendas({
            imagem: paraIa[ordem[0]] ?? paraIa[0], textos, formato: formatoDaLegenda(escolhido), tom: t, contexto: ctx, marca,
          });
        } catch (e) {
          avisoLegenda = e instanceof Error ? e.message : String(e);
        }
      }

      const id = await salvarRascunho(nome?.trim() || `${escolhido.grupo} · ${ctx || escolhido.nome}`.slice(0, 200), {
        fotos: lidas.map((f, i) => ({ nome: f.nome, src: paraEditor[i] })),
        post: { ...plano, ordemFotos: ordem },
        legendas,
      });
      const cabem = escolhido.cresce ? 9 : escolhido.fotos;
      return texto({
        link: `${config.webUrl}/imagens?projeto=${id}`,
        modelo: { id: escolhido.id, tipo: escolhido.grupo, nome: escolhido.nome },
        porque: plano.explicacao,
        textosDaArte: textos,
        filtro: plano.filtro,
        ordemDasFotos: ordem.map((i) => lidas[i].nome),
        fotosQueNaoCabem: lidas.length > cabem ? ordem.slice(cabem).map((i) => lidas[i].nome) : [],
        legendas,
        ...(avisoLegenda ? { avisoLegenda } : {}),
        proximoPasso: 'Abra o link: o editor monta o post com as fotos. Ajuste o que quiser, exporte na aba Exportar e salve o projeto. As legendas aparecem lá também.',
      });
    }),
  );

  server.tool(
    'viih_gerar_legenda',
    'Escreve 3 opções de legenda de Instagram (com hashtags) na voz da Viih Mimos, a partir de uma foto e/ou do contexto.',
    {
      contexto: z.string().min(1).max(1500).describe('Do que é o post.'),
      foto: z.string().optional().describe('Caminho ou link de uma foto do post (opcional, ajuda a IA).'),
      formato: z.enum(['story', 'feed', 'carrossel']).optional().describe('Padrão: feed.'),
      tom: TOM,
    },
    seguro(async ({ contexto, foto, formato, tom }) => {
      const imagem = foto ? await reduzir(await lerFoto(foto), 1080, 82) : null;
      return texto(await sugerirLegendas({ imagem, textos: [], formato: formato ?? 'feed', tom: tom ?? 'carinhoso', contexto, marca }));
    }),
  );

  // ---------------------------------------------------------------- site ---

  server.tool(
    'viih_site_estado',
    'Resumo do site da Viih Mimos: quantos produtos e depoimentos, quando foi publicado e o endereço.',
    {},
    seguro(async () => texto(await painel().estado())),
  );

  server.tool(
    'viih_site_listar_produtos',
    'Lista os produtos do catálogo do site (id, nome, descrição, itens, foto, se está visível e em destaque).',
    {},
    seguro(async () => texto(await painel().produtos())),
  );

  server.tool(
    'viih_site_enviar_fotos',
    'Envia fotos para a galeria do site (o painel reduz e grava). Devolve o caminho de cada uma para usar em produtos. Não publica.',
    { fotos: FOTOS },
    seguro(async ({ fotos }) => {
      const api = painel();
      const out = [];
      for (const ref of fotos) out.push(await api.enviarFoto(await paraOSite(await lerFoto(ref))));
      return texto(out.map((i) => ({ id: i.id, nome: i.nome, caminho: i.caminho })));
    }),
  );

  const camposProduto = {
    nome: z.string().min(1).max(120).describe('Nome do produto, ex.: "Topo de bolo".'),
    etiqueta: z.string().max(60).optional().describe('Selo curto no cartão, ex.: "mais pedido".'),
    texto: z.string().max(1200).optional().describe('Descrição do cartão, na voz da marca.'),
    itens: z.array(z.string().max(160)).max(12).optional().describe('Bullets do cartão.'),
    mensagemZap: z.string().max(500).optional().describe('Mensagem pronta do botão de orçamento no WhatsApp.'),
    foto: z.string().optional().describe('Caminho/link de uma foto nova (é enviada) ou um caminho que já está no site (/uploads/...).'),
    visivel: z.boolean().optional(),
    destaque: z.boolean().optional().describe('Aparece também na página inicial.'),
  };

  async function caminhoDaFoto(api: SiteApi, foto: string | undefined): Promise<string | undefined> {
    if (!foto) return undefined;
    if (foto.startsWith('/uploads/') || foto.startsWith('../brand/')) return foto;
    return (await api.enviarFoto(await paraOSite(await lerFoto(foto)))).caminho;
  }

  server.tool(
    'viih_site_criar_produto',
    'Cria um produto no catálogo do site. Não publica: depois de revisar, use viih_site_publicar.',
    camposProduto,
    seguro(async (a) => {
      const api = painel();
      const imagem = (await caminhoDaFoto(api, a.foto)) ?? '';
      const p = await api.criarProduto({
        slug: slug(a.nome), nome: a.nome, etiqueta: a.etiqueta ?? '', texto: a.texto ?? '', itens: (a.itens ?? []).join('\n'),
        mensagemZap: a.mensagemZap ?? `Oi, Viih! Quero um orçamento de ${a.nome.toLowerCase()} 💕`,
        imagem, visivel: a.visivel ?? true, destaque: a.destaque ?? false,
      });
      return texto({ criado: true, produto: p, lembrete: 'Ainda não está no ar. Use viih_site_publicar quando estiver tudo certo.' });
    }),
  );

  server.tool(
    'viih_site_editar_produto',
    'Edita um produto do catálogo (pelo id ou pelo nome). Só os campos passados mudam. Não publica.',
    { produto: z.string().min(1).describe('Id ou nome do produto.'), ...camposProduto, nome: camposProduto.nome.optional() },
    seguro(async (a) => {
      const api = painel();
      const lista = await api.produtos();
      const alvo = lista.find((p) => String(p.id) === a.produto)
        ?? lista.find((p) => p.nome.toLowerCase() === a.produto.toLowerCase())
        ?? (() => {
          const parecidos = lista.filter((p) => p.nome.toLowerCase().includes(a.produto.toLowerCase()));
          return parecidos.length === 1 ? parecidos[0] : undefined;
        })();
      if (!alvo) throw new Error(`Não achei um produto único para "${a.produto}". Produtos: ${lista.map((p) => `${p.id} ${p.nome}`).join(', ')}`);
      const imagem = await caminhoDaFoto(api, a.foto);
      const p = await api.editarProduto({
        ...alvo,
        ...(a.nome !== undefined ? { nome: a.nome } : {}),
        ...(a.etiqueta !== undefined ? { etiqueta: a.etiqueta } : {}),
        ...(a.texto !== undefined ? { texto: a.texto } : {}),
        ...(a.itens !== undefined ? { itens: a.itens.join('\n') } : {}),
        ...(a.mensagemZap !== undefined ? { mensagemZap: a.mensagemZap } : {}),
        ...(imagem !== undefined ? { imagem } : {}),
        ...(a.visivel !== undefined ? { visivel: a.visivel } : {}),
        ...(a.destaque !== undefined ? { destaque: a.destaque } : {}),
      });
      return texto({ editado: true, produto: p, lembrete: 'Ainda não está no ar. Use viih_site_publicar.' });
    }),
  );

  server.tool(
    'viih_site_adicionar_depoimento',
    'Adiciona um depoimento de cliente ao site. Use só texto que a cliente realmente escreveu. Não publica.',
    {
      texto: z.string().min(1).max(800),
      autor: z.string().min(1).max(80).describe('Ex.: "Ana".'),
      contexto: z.string().max(120).optional().describe('Ex.: "mãe da Alice · kit festa".'),
    },
    seguro(async ({ texto: t, autor, contexto }) =>
      texto(await painel().criarDepoimento({ texto: t, autor, contexto: contexto ?? '', visivel: true }))),
  );

  server.tool(
    'viih_site_listar_textos',
    'Lista os textos editáveis das páginas do site (chave e valor), ex.: inicio.titulo.',
    {},
    seguro(async () => texto(await painel().textos())),
  );

  server.tool(
    'viih_site_editar_textos',
    'Troca textos das páginas do site pela chave (veja viih_site_listar_textos). Não publica.',
    { valores: z.record(z.string(), z.string().max(2000)).describe('Mapa chave → texto novo.') },
    seguro(async ({ valores }) => texto(await painel().editarTextos(valores))),
  );

  server.tool(
    'viih_site_publicar',
    'Regera o site com o conteúdo atual do painel e coloca no ar. Só chame depois de a pessoa confirmar na conversa.',
    { confirmado: z.literal(true).describe('A pessoa confirmou que quer publicar agora.') },
    seguro(async () => texto(await painel().publicar())),
  );
}
