// Site da Viih Mimos: fala com a API do painel (repositório ViihMimos,
// admin/api). O login devolve um cookie httpOnly `vm_sessao`; aqui ele é
// guardado só na memória do processo e mandado de volta em cada chamada.
import type { Foto } from './fotos.js';

export interface SiteConfig {
  url: string;
  login: string;
  senha: string;
}

export function siteConfig(env: NodeJS.ProcessEnv = process.env): SiteConfig | null {
  const url = env.VIIH_PAINEL_URL?.replace(/\/+$/, '');
  if (!url || !env.VIIH_PAINEL_LOGIN || !env.VIIH_PAINEL_SENHA) return null;
  return { url, login: env.VIIH_PAINEL_LOGIN, senha: env.VIIH_PAINEL_SENHA };
}

export interface Produto {
  id: number;
  slug: string;
  nome: string;
  etiqueta: string;
  texto: string;
  /** Um item por linha. */
  itens: string;
  mensagemZap: string;
  imagem: string;
  ordem: number;
  visivel: boolean;
  destaque: boolean;
}

export interface Depoimento {
  id: number;
  texto: string;
  autor: string;
  contexto: string;
  ordem: number;
  visivel: boolean;
}

export interface ImagemSite {
  id: number;
  caminho: string;
  nome: string;
  origem: string;
}

export interface TextoSite {
  chave: string;
  valor: string;
  [k: string]: unknown;
}

/** "Topo de Bolo Unicórnio" → "topo-de-bolo-unicornio" (âncora do catálogo). */
export function slug(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** O painel só aceita JPG, PNG e WebP e confere o tipo declarado. */
export function tipoDaFoto(nome: string): string {
  const ext = nome.toLowerCase().split('.').pop();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

/** Pega o valor do cookie da sessão no Set-Cookie da resposta do login. */
export function cookieDaSessao(setCookie: string | null): string | null {
  const m = /(?:^|[,\s])vm_sessao=([^;,\s]+)/.exec(setCookie ?? '');
  return m ? m[1] : null;
}

export class SiteApi {
  private cookie: string | null = null;

  constructor(private readonly cfg: SiteConfig) {}

  private async entrar(): Promise<void> {
    const res = await fetch(`${this.cfg.url}/api/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: this.cfg.login, senha: this.cfg.senha }),
    });
    if (res.status === 429) throw new Error('O painel bloqueou por tentativas demais. Espere uns minutos.');
    if (!res.ok) throw new Error(`Login no painel do site falhou (HTTP ${res.status}). Confira VIIH_PAINEL_LOGIN e VIIH_PAINEL_SENHA.`);
    const c = cookieDaSessao(res.headers.get('set-cookie'));
    if (!c) throw new Error('O painel não devolveu o cookie de sessão.');
    this.cookie = c;
  }

  private async chamar(path: string, init: RequestInit = {}, json = true): Promise<Response> {
    if (!this.cookie) await this.entrar();
    const fazer = () => fetch(`${this.cfg.url}/api${path}`, {
      ...init,
      headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}), Cookie: `vm_sessao=${this.cookie}` },
    });
    let res = await fazer();
    if (res.status === 401) {
      await this.entrar();
      res = await fazer();
    }
    return res;
  }

  private async json<T>(path: string, init: RequestInit = {}, acao = path): Promise<T> {
    const res = await this.chamar(path, init);
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new Error(`${acao} falhou (HTTP ${res.status}): ${corpo.slice(0, 300)}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  produtos() { return this.json<Produto[]>('/produtos'); }
  depoimentos() { return this.json<Depoimento[]>('/depoimentos'); }
  imagens() { return this.json<ImagemSite[]>('/imagens'); }
  textos() { return this.json<TextoSite[]>('/textos'); }
  estado() { return this.json<unknown>('/estado'); }

  criarProduto(p: Omit<Produto, 'id' | 'ordem'>) {
    return this.json<Produto>('/produtos', { method: 'POST', body: JSON.stringify({ ...p, id: 0, ordem: 0 }) }, 'Criar produto');
  }

  editarProduto(p: Produto) {
    return this.json<Produto>(`/produtos/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }, 'Editar produto');
  }

  criarDepoimento(d: Omit<Depoimento, 'id' | 'ordem'>) {
    return this.json<Depoimento>('/depoimentos', { method: 'POST', body: JSON.stringify({ ...d, id: 0, ordem: 0 }) }, 'Criar depoimento');
  }

  editarTextos(valores: Record<string, string>) {
    return this.json<{ atualizados: number }>('/textos', { method: 'PUT', body: JSON.stringify(valores) }, 'Editar textos');
  }

  /** O painel valida, reduz e grava a foto; devolve o caminho público. */
  async enviarFoto(foto: Foto): Promise<ImagemSite> {
    const form = new FormData();
    form.append('arquivo', new Blob([new Uint8Array(foto.bytes)], { type: tipoDaFoto(foto.nome) }), foto.nome);
    const res = await this.chamar('/imagens', { method: 'POST', body: form }, false);
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new Error(`Enviar ${foto.nome} falhou (HTTP ${res.status}): ${corpo.slice(0, 300)}`);
    }
    return (await res.json()) as ImagemSite;
  }

  publicar() {
    return this.json<{ publicado: boolean; paginas: unknown; em: string }>('/publicar', { method: 'POST' }, 'Publicar o site');
  }
}
