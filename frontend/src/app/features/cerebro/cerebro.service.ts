import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** O Caddy publica o serviço "cerebro" em /cerebro/* (sem o prefixo do lado dele). */
const BASE = '/cerebro/api/v1/web';

export interface CerebroMe {
  email: string;
  classificacao: boolean;
  pastas: string[];
}

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

  buscar(q: string): Promise<ResultadoBusca[]> {
    return firstValueFrom(this.http.get<ResultadoBusca[]>(`${BASE}/search`, { params: { q } }));
  }
}
