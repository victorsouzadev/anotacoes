import { HttpClient, HttpEvent, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

export type StatusVersao = 'Enviado' | 'Iniciando' | 'NoAr' | 'Falhou' | 'Substituido';

export interface Versao {
  id: string;
  versao: number;
  tipo: 'Estatico' | 'DotNet';
  status: StatusVersao;
  temWeb: boolean;
  runtimeVersao: string | null;
  entrada: string | null;
  tamanhoBytes: number;
  temBackupBanco: boolean;
  criadoEm: string;
  terminadoEm: string | null;
  log: string;
}

export interface SiteResumo {
  id: string;
  slug: string;
  nome: string;
  url: string;
  parado: boolean;
  criadoEm: string;
  atual: Versao | null;
  ultimo: Versao | null;
}

export interface SiteDetalhe {
  id: string;
  slug: string;
  nome: string;
  url: string;
  parado: boolean;
  criadoEm: string;
  currentDeploymentId: string | null;
  versoes: Versao[];
}

export interface Variavel {
  chave: string;
  valor: string;
}

/** Cliente de /api/sites — ferramenta "Publicar". */
@Injectable({ providedIn: 'root' })
export class PublicarService {
  private readonly http = inject(HttpClient);

  /** urlModelo: "http://{slug}.<domínio>:<porta>" — para mostrar o endereço antes de criar. */
  async permissao(): Promise<{ podePublicar: boolean; urlModelo: string }> {
    try {
      return await firstValueFrom(this.http.get<{ podePublicar: boolean; urlModelo: string }>('/api/sites/permissao'));
    } catch {
      return { podePublicar: false, urlModelo: '' };
    }
  }

  listar(): Promise<SiteResumo[]> {
    return firstValueFrom(this.http.get<SiteResumo[]>('/api/sites'));
  }

  detalhe(id: string): Promise<SiteDetalhe> {
    return firstValueFrom(this.http.get<SiteDetalhe>(`/api/sites/${id}`));
  }

  criar(nome: string, slug: string): Promise<SiteDetalhe> {
    return firstValueFrom(this.http.post<SiteDetalhe>('/api/sites', { nome, slug }));
  }

  /** Envia o ZIP cru (sem multipart), com eventos de progresso do upload. */
  enviar(id: string, zip: Blob): Observable<HttpEvent<Versao>> {
    return this.http.post<Versao>(`/api/sites/${id}/deployments`, zip, {
      headers: new HttpHeaders({ 'Content-Type': 'application/zip' }),
      reportProgress: true,
      observe: 'events',
    });
  }

  ativar(id: string, versaoId: string, restaurarBanco: boolean): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/sites/${id}/deployments/${versaoId}/ativar`, { restaurarBanco }));
  }

  logs(id: string, linhas = 300): Promise<string> {
    return firstValueFrom(this.http.get(`/api/sites/${id}/logs`, { params: { linhas }, responseType: 'text' }));
  }

  variaveis(id: string): Promise<Variavel[]> {
    return firstValueFrom(this.http.get<Variavel[]>(`/api/sites/${id}/variaveis`));
  }

  salvarVariaveis(id: string, vars: Variavel[]): Promise<void> {
    return firstValueFrom(this.http.put<void>(`/api/sites/${id}/variaveis`, vars));
  }

  reiniciar(id: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/sites/${id}/reiniciar`, null));
  }

  parar(id: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/sites/${id}/parar`, null));
  }

  excluir(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/sites/${id}`));
  }
}
