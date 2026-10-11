// Post da Viih Mimos pelo MCP: mesma IA do painel "Post com IA" do editor
// (/api/imagens/post-ia). O resultado vira um projeto do Editor de Imagens que
// abre já montado — a pessoa confere, ajusta e exporta de lá.
import { randomUUID } from 'node:crypto';
import { authedFetch } from '../auth.js';
import { ModeloIa, ModeloSalvoDto, montarCatalogo } from './catalogo.js';
import { MODELOS_DO_EDITOR } from './modelos.js';

/** Mesmo perfil que vem preenchido no painel de legenda do editor. */
export const PERFIL_VIIH = [
  'Viih Mimos — papelaria personalizada feita à mão em Marabá-PA: topo de bolo, kit festa, caixinhas, convites e agendas.',
  'Voz: minúsculas, próxima e carinhosa; emojis 🎀 💕 com moderação.',
  'Instagram @viihmimos_ · WhatsApp (91) 99373-1794 (wa.me/5591993731794).',
  'Produção em até 5 dias úteis depois da arte aprovada.',
  'Hashtags da casa: #viihmimos #papelariapersonalizada #maraba #marabapa',
].join('\n');

/** Ids dos filtros do editor (social-model.ts) que a IA pode sugerir. */
export const FILTROS = [
  'original', 'vivido', 'suave', 'clean', 'nitido', 'claro', 'denso', 'quente', 'dourado', 'porsol', 'terroso',
  'pessego', 'caramelo', 'frio', 'azulado', 'neblina', 'menta', 'noturno', 'vintage', 'cinema', 'polaroid',
  'super8', 'desbotado', 'lomo', 'pb', 'pbsuave', 'pbforte', 'pbsepia', 'matte', 'moda', 'produto',
  'gastronomia', 'pastel', 'dramatico',
];

export interface PlanoPost {
  modeloId: string;
  textos: { indice: number; texto: string }[];
  ordemFotos: number[];
  filtro: string | null;
  explicacao: string;
}

async function asJson<T>(res: Response, acao: string): Promise<T> {
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`${acao} falhou (HTTP ${res.status}): ${corpo.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function listarModelos(): Promise<ModeloIa[]> {
  const salvos = await asJson<ModeloSalvoDto[]>(await authedFetch('/api/imagens/modelos'), 'Listar modelos salvos');
  return montarCatalogo(MODELOS_DO_EDITOR, salvos);
}

export async function planejarPost(pedido: {
  fotos: string[]; modelos: ModeloIa[]; tipo: string; tom: string; contexto: string; marca: string;
}): Promise<PlanoPost> {
  const r = await asJson<{ post: PlanoPost | null; usouIa: boolean; motivo: string | null }>(
    await authedFetch('/api/imagens/post-ia', {
      method: 'POST',
      body: JSON.stringify({ ...pedido, filtros: FILTROS }),
    }),
    'Montar post com IA',
  );
  if (!r.usouIa || !r.post) throw new Error(r.motivo ?? 'A IA não montou o post.');
  return r.post;
}

export async function sugerirLegendas(pedido: {
  imagem: string | null; textos: string[]; formato: string; tom: string; contexto: string; marca: string;
}): Promise<string[]> {
  const r = await asJson<{ legendas: { texto: string; hashtags: string[] }[]; usouIa: boolean; motivo: string | null }>(
    await authedFetch('/api/imagens/legenda', { method: 'POST', body: JSON.stringify(pedido) }),
    'Gerar legenda',
  );
  if (!r.usouIa) throw new Error(r.motivo ?? 'A IA não escreveu legendas.');
  return r.legendas.map((l) => (l.hashtags.length ? `${l.texto}\n\n${l.hashtags.join(' ')}` : l.texto));
}

/** Textos do modelo depois da troca da IA — o que a legenda precisa ler. */
export function textosFinais(modelo: ModeloIa, plano: PlanoPost): string[] {
  const novo = new Map(plano.textos.map((t) => [t.indice, t.texto]));
  return modelo.textos.map((t, i) => novo.get(i) ?? t);
}

/** Todas as fotos entram, na ordem da IA; as que ela não viu vão no fim. */
export function ordemCompleta(ordem: number[], total: number): number[] {
  const out = ordem.filter((i, k) => i >= 0 && i < total && ordem.indexOf(i) === k);
  for (let i = 0; i < total; i++) if (!out.includes(i)) out.push(i);
  return out;
}

export function formatoDaLegenda(m: ModeloIa): string {
  return m.grupo === 'Story' ? 'story' : m.grupo === 'Carrossel' ? 'carrossel' : 'feed';
}

/** Salva o rascunho como projeto do editor e devolve o id. */
export async function salvarRascunho(nome: string, rascunho: {
  fotos: { nome: string; src: string }[]; post: PlanoPost; legendas: string[];
}): Promise<string> {
  const id = randomUUID();
  const agora = new Date().toISOString();
  const data = JSON.stringify({ version: 3, rascunhoIa: rascunho });
  if (data.length > 9 * 1024 * 1024) throw new Error('Fotos demais (ou grandes demais) para um projeto. Tente com menos fotos.');
  await asJson(
    await authedFetch(`/api/imagens/projetos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ id, name: nome, data, createdAt: agora, updatedAt: agora, deletedAt: null }),
    }),
    'Salvar o rascunho no editor',
  );
  return id;
}
