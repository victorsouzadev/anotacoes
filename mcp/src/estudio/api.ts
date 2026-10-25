// Cliente da API do Estúdio (/api/estudio) para o MCP local: o mesmo que a tela usa, com o
// login do hub (HUB_EMAIL/HUB_PASSWORD). O que só o MCP local faz — ler e gravar arquivos do
// computador — fica aqui também.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { authedFetch } from '../auth.js';
import { config } from '../config.js';

export interface Midia {
  id: string;
  tipo: string;
  nome: string;
  url: string;
  tamanho: number;
  duracaoSeg: number | null;
  largura: number | null;
  altura: number | null;
  prompt: string | null;
  pasta: string | null;
  criadoEm: string;
}

export interface Job {
  id: string;
  modeloId: string;
  modeloNome: string | null;
  operacao: string;
  provedor: string;
  status: 'fila' | 'rodando' | 'concluido' | 'falhou' | 'cancelado';
  mensagem: string | null;
  erro: string | null;
  custoEstimadoCentavos: number;
  linkExterno: string | null;
  resultado: Midia[];
}

export interface OperacaoCatalogo {
  entradas: string[];
  parametros: string[];
  obrigatorios: string[];
  opcoes: Record<string, unknown[]>;
  padroes: Record<string, unknown>;
  maxImagens: number | null;
}

export interface ModeloCatalogo {
  id: string;
  nome: string;
  familia: string;
  tipo: string;
  provedor: string;
  descricao: string | null;
  ops: Record<string, OperacaoCatalogo>;
}

export interface Config {
  falConfigurada: boolean;
  confirmarAcimaCentavos: number;
  limiteMensalCentavos: number | null;
  gastoMesCentavos: number;
}

async function json<T>(res: Response, acao: string): Promise<T> {
  if (!res.ok) {
    let detalhe = '';
    try { detalhe = ((await res.json()) as { erro?: string }).erro ?? ''; } catch { /* sem corpo */ }
    throw new Error(`${acao}: ${detalhe || `HTTP ${res.status}`}`);
  }
  return (await res.json()) as T;
}

export const estudio = {
  catalogo: async () => json<ModeloCatalogo[]>(await authedFetch('/api/estudio/catalogo'), 'Catálogo'),
  config: async () => json<Config>(await authedFetch('/api/estudio/config'), 'Configuração'),
  estimar: async (p: Pedido) => json<{ custoCentavos: number; passaDoLimite: boolean }>(
    await authedFetch('/api/estudio/estimar', { method: 'POST', body: JSON.stringify(p) }), 'Estimativa'),
  gerar: async (p: Pedido) => json<Job>(await authedFetch('/api/estudio/geracoes', { method: 'POST', body: JSON.stringify(p) }), 'Geração'),
  local: async (operacao: string, parametros: unknown, entradas: Record<string, string[]>) =>
    json<Job>(await authedFetch('/api/estudio/local', { method: 'POST', body: JSON.stringify({ operacao, parametros, entradas, app: 'mcp' }) }), operacao),
  geracao: async (id: string) => json<Job>(await authedFetch(`/api/estudio/geracoes/${encodeURIComponent(id)}`), 'Geração'),
  cancelar: async (id: string) => json<Job>(await authedFetch(`/api/estudio/geracoes/${encodeURIComponent(id)}/cancelar`, { method: 'POST', body: '{}' }), 'Cancelar'),
  midias: async (q: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
    return json<Midia[]>(await authedFetch(`/api/estudio/midias?${s}`), 'Biblioteca');
  },
  midia: async (id: string) => json<Midia>(await authedFetch(`/api/estudio/midias/${encodeURIComponent(id)}`), 'Arquivo'),
  apagar: async (id: string) => {
    const r = await authedFetch(`/api/estudio/midias/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`Apagar: HTTP ${r.status}`);
  },
  importarUrl: async (url: string, nome?: string, pasta?: string) =>
    json<Midia[]>(await authedFetch('/api/estudio/midias', { method: 'POST', body: JSON.stringify({ url, nome, pasta, origem: 'mcp' }) }), 'Importar'),
  enviar: async (arquivos: { nome: string; bytes: Uint8Array }[], pasta?: string) => {
    const form = new FormData();
    for (const a of arquivos) form.append('arquivos', new Blob([new Uint8Array(a.bytes)]), a.nome);
    if (pasta) form.append('pasta', pasta);
    form.append('origem', 'mcp');
    return json<Midia[]>(await authedFetch('/api/estudio/midias', { method: 'POST', body: form }), 'Enviar');
  },
  documentos: async (tipo: string) => json<{ id: string; nome: string; updatedAt: string }[]>(
    await authedFetch(`/api/estudio/quadros?tipo=${encodeURIComponent(tipo)}`), 'Documentos'),
  documento: async (id: string) => json<{ id: string; tipo: string; nome: string; data: string }>(await authedFetch(`/api/estudio/quadros/${encodeURIComponent(id)}`), 'Documento'),
  salvarDocumento: async (id: string, tipo: string, nome: string, conteudo: unknown) =>
    json<{ id: string }>(await authedFetch(`/api/estudio/quadros/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify({ tipo, nome, data: JSON.stringify(conteudo), thumb: null }),
    }), 'Salvar documento'),
};

export interface Pedido {
  modelo: string;
  operacao: string;
  parametros?: Record<string, unknown>;
  entradas?: Record<string, string[]>;
  app?: string;
  pipeline?: string;
}

/** Endereço absoluto de um link da API (os links assinados vêm relativos). */
export function absoluto(url: string): string {
  return url.startsWith('http') ? url : `${config.apiUrl}${url}`;
}

/** "~/Fotos/x.png" e caminhos relativos → caminho absoluto. */
export function caminhoLocal(c: string): string {
  const t = c.trim();
  return resolve(t === '~' ? homedir() : t.startsWith('~/') ? join(homedir(), t.slice(2)) : t);
}

/** Lê arquivos locais (ou baixa links https) e manda para a biblioteca. */
export async function enviarCaminhos(caminhos: string[], pasta?: string): Promise<Midia[]> {
  const locais: { nome: string; bytes: Uint8Array }[] = [];
  const enviados: Midia[] = [];
  for (const c of caminhos) {
    if (/^https:\/\//i.test(c)) enviados.push(...(await estudio.importarUrl(c, undefined, pasta)));
    else locais.push({ nome: basename(c), bytes: await readFile(caminhoLocal(c)) });
  }
  if (locais.length) enviados.push(...(await estudio.enviar(locais, pasta)));
  return enviados;
}

/** Baixa arquivos da biblioteca para uma pasta do computador. Devolve os caminhos gravados. */
export async function baixar(midias: Midia[], pasta: string): Promise<string[]> {
  const destino = caminhoLocal(pasta);
  await mkdir(destino, { recursive: true });
  const gravados: string[] = [];
  for (const m of midias) {
    const r = await fetch(absoluto(m.url));
    if (!r.ok) throw new Error(`Baixar ${m.nome}: HTTP ${r.status}`);
    const nome = nomeLivre(m.nome, gravados);
    const caminho = join(destino, nome);
    await writeFile(caminho, new Uint8Array(await r.arrayBuffer()));
    gravados.push(caminho);
  }
  return gravados;
}

/** Nome sem caracteres proibidos no Windows, sem repetir os já gravados nesta leva. */
export function nomeLivre(nome: string, jaUsados: string[]): string {
  const limpo = nome.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'arquivo';
  const ext = extname(limpo);
  const base = limpo.slice(0, limpo.length - ext.length);
  let candidato = limpo;
  for (let i = 2; jaUsados.some((u) => basename(u) === candidato); i++) candidato = `${base} (${i})${ext}`;
  return candidato;
}

export function dolar(centavos: number): string {
  return `US$ ${(centavos / 100).toFixed(2)}`;
}

/** Texto de uma geração para o modelo de linguagem ler. */
export function textoDoJob(j: Job, baixados: string[] = []): string {
  const linhas = [`Geração ${j.id} · ${j.modeloNome ?? j.modeloId} · ${j.operacao} · ${j.status}${j.provedor !== 'local' ? ` · ~${dolar(j.custoEstimadoCentavos)}` : ''}`];
  if ((j.status === 'fila' || j.status === 'rodando') && j.mensagem) linhas.push(`Andamento: ${j.mensagem}`);
  if (j.erro) linhas.push(`Erro: ${j.erro}`);
  for (const m of j.resultado) linhas.push(`- ${m.nome} (${m.tipo}, id ${m.id}): ${absoluto(m.url)}`);
  for (const b of baixados) linhas.push(`Baixado em: ${b}`);
  if (j.linkExterno) linhas.push(`No site do provedor: ${j.linkExterno}`);
  return linhas.join('\n');
}

/** Espera a geração terminar (consulta a cada 2,5 s) até o prazo. */
export async function aguardar(id: string, segundos: number): Promise<Job> {
  const limite = Date.now() + Math.max(0, Math.min(segundos, 600)) * 1000;
  for (;;) {
    const j = await estudio.geracao(id);
    if (j.status === 'concluido' || j.status === 'falhou' || j.status === 'cancelado' || Date.now() >= limite) return j;
    await new Promise((r) => setTimeout(r, 2500));
  }
}

/** Gerações acima do limite do usuário só saem com confirmação explícita. */
export function precisaConfirmar(custoCentavos: number, limiteCentavos: number, confirmado: boolean): boolean {
  return !confirmado && custoCentavos > limiteCentavos;
}
