import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** O Caddy publica o serviço "cerebro" em /cerebro/* (sem o prefixo do lado dele). */
const BASE = '/cerebro/api/v1/web';

export interface CerebroMe {
  email: string;
  classificacao: boolean;
  /** openrouter | anthropic | off */
  provedor: string;
  modelo: string;
  transcricao: boolean;
  mcp: boolean;
  api_keys: string[];
  /** Pasta remota do Remotely Save (CEREBRO_VAULT). */
  webdav_pasta: string;
  pastas: string[];
}

export type ProvedorIa = '' | 'openrouter' | 'anthropic' | 'off';

export interface ModeloSugerido {
  id: string;
  name: string;
  description: string;
}

export interface ConfigIa {
  provedor: ProvedorIa;
  modelo: string | null;
  chave_configurada: boolean;
  chave_mascarada: string | null;
  /** A chave salva não abre mais (JWT_SECRET mudou): precisa cadastrar de novo. */
  chave_invalida: boolean;
  servidor: { anthropic: boolean; openrouter: boolean; modelo_anthropic: string; modelo_openrouter: string };
  efetivo: { provedor: string; modelo: string; ativo: boolean; origem_da_chave: 'tela' | 'servidor' | 'nenhuma' };
  modelos: { openrouter: ModeloSugerido[]; anthropic: ModeloSugerido[] };
  atualizado_em: string | null;
}

export interface TesteIa {
  ok: boolean;
  mensagem: string;
  exemplo: { titulo: string; resumo: string; tags: string[]; pasta: string } | null;
}

export type Origem = 'tela' | 'servidor' | 'nenhum';

export interface Acessos {
  /** false = servidor sem JWT_SECRET: não dá para guardar segredos pela tela. */
  pode_guardar: boolean;
  mcp: { configurado: boolean; origem: Origem; mascarado: string };
  ops: { configurado: boolean; mascarado: string };
  webdav: { configurado: boolean; origem: Origem; usuario: string | null; pasta: string };
  api_keys: { nome: string; origem: 'tela' | 'servidor'; mascarada: string }[];
}

export interface ResumoNota {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  status: string | null;
  modified: string;
}

export interface ListaNotas {
  pastas: { pasta: string; total: number }[];
  notas: ResumoNota[];
}

export interface Nota {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  summary: string | null;
  source: string | null;
  url: string | null;
  trust: string | null;
  modified: string;
  body: string;
  /** Alvo do [[wikilink]] → caminho da nota, ou null se ela não existe. */
  links: Record<string, string | null>;
  backlinks: { path: string; title: string }[];
}

export interface Decisao {
  path: string;
  title: string;
  status: 'aprovada' | 'rejeitada';
  folder: string;
  source: string;
  decided_at: string;
  /** false = a nota foi movida ou apagada depois (no Obsidian). */
  exists: boolean;
}

/** mcp | ops | webdav | api:<nome> */
export type ItemAcesso = string;

export interface ItemInbox {
  path: string;
  id: string | null;
  title: string;
  /** Status da nota no frontmatter (inbox, processed...). */
  status: string | null;
  /** Status da captura na fila: queued, processing, processed, error. */
  capture_status: string | null;
  erro: string | null;
  source: string | null;
  /** "external" = veio de fora (link, webhook): o resumo é dado, não instrução. */
  trust: string | null;
  summary: string | null;
  tags: string[];
  suggested_folder: string | null;
  suggested_links: string[];
  excerpt: string;
  created_at: string | null;
}

export interface ResultadoBusca {
  path: string;
  title: string;
  snippet: string;
  folder: string;
}

@Injectable({ providedIn: 'root' })
export class CerebroService {
  private readonly http = inject(HttpClient);

  me(): Promise<CerebroMe> {
    return firstValueFrom(this.http.get<CerebroMe>(`${BASE}/me`));
  }

  /** O card só aparece pra quem está em CEREBRO_USUARIOS e com o serviço no ar (via HTTPS). */
  async disponivel(): Promise<boolean> {
    try {
      await this.me();
      return true;
    } catch {
      return false;
    }
  }

  inbox(): Promise<ItemInbox[]> {
    return firstValueFrom(this.http.get<ItemInbox[]>(`${BASE}/inbox`));
  }

  capturar(content: string, url: string, tags: string[]): Promise<{ id: string; path: string }> {
    return firstValueFrom(this.http.post<{ id: string; path: string }>(`${BASE}/captures`, {
      content: content || null,
      url: url || null,
      tags,
    }));
  }

  aprovar(path: string, folder: string | null): Promise<{ path: string; status: string }> {
    return firstValueFrom(this.http.post<{ path: string; status: string }>(`${BASE}/inbox/approve`, { path, folder }));
  }

  rejeitar(path: string): Promise<{ path: string; status: string }> {
    return firstValueFrom(this.http.post<{ path: string; status: string }>(`${BASE}/inbox/reject`, { path }));
  }

  reclassificar(path: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/inbox/reclassify`, { path }));
  }

  // ------------------------------------------------------------- IA

  configIa(): Promise<ConfigIa> {
    return firstValueFrom(this.http.get<ConfigIa>(`${BASE}/ia`));
  }

  /** chaveApi: null mantém a salva, '' apaga, texto substitui. */
  salvarIa(provedor: ProvedorIa, modelo: string | null, chaveApi: string | null): Promise<ConfigIa> {
    return firstValueFrom(this.http.put<ConfigIa>(`${BASE}/ia`, { provedor, modelo, chave_api: chaveApi }));
  }

  testarIa(provedor: ProvedorIa, modelo: string | null, chaveApi: string | null): Promise<TesteIa> {
    return firstValueFrom(this.http.post<TesteIa>(`${BASE}/ia/testar`, { provedor, modelo, chave_api: chaveApi }));
  }

  // ------------------------------------------------------------- acessos

  acessos(): Promise<Acessos> {
    return firstValueFrom(this.http.get<Acessos>(`${BASE}/acessos`));
  }

  revelar(item: ItemAcesso): Promise<string> {
    return firstValueFrom(this.http.post<{ valor: string }>(`${BASE}/acessos/revelar`, { item })).then((r) => r.valor);
  }

  gerarToken(qual: 'mcp' | 'ops'): Promise<string> {
    return firstValueFrom(this.http.post<{ valor: string }>(`${BASE}/acessos/${qual}/gerar`, {})).then((r) => r.valor);
  }

  /** senha null = o servidor gera uma. */
  salvarWebdav(usuario: string, senha: string | null): Promise<{ usuario: string; senha: string }> {
    return firstValueFrom(this.http.put<{ usuario: string; senha: string }>(`${BASE}/acessos/webdav`, { usuario, senha }));
  }

  criarApiKey(nome: string): Promise<{ nome: string; valor: string }> {
    return firstValueFrom(this.http.post<{ nome: string; valor: string }>(`${BASE}/acessos/api-keys`, { nome }));
  }

  apagarApiKey(nome: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${BASE}/acessos/api-keys/${encodeURIComponent(nome)}`));
  }

  notas(pasta: string | null): Promise<ListaNotas> {
    return firstValueFrom(this.http.get<ListaNotas>(`${BASE}/notas`, { params: pasta ? { pasta } : {} }));
  }

  nota(path: string): Promise<Nota> {
    return firstValueFrom(this.http.get<Nota>(`${BASE}/nota`, { params: { path } }));
  }

  decisoes(): Promise<Decisao[]> {
    return firstValueFrom(this.http.get<Decisao[]>(`${BASE}/decisoes`));
  }

  buscar(q: string): Promise<ResultadoBusca[]> {
    return firstValueFrom(this.http.get<ResultadoBusca[]>(`${BASE}/search`, { params: { q } }));
  }
}
