import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface AuvpConfiguracao {
  habilitado: boolean;
  chaveConfigurada: boolean;
  chaveMascarada: string | null;
  ultimaSincronizacaoEm: string | null;
}

export interface AuvpSincronizacao {
  importadas: number;
  jaExistentes: number;
  paraRevisao: number;
  sincronizadoEm: string;
}

@Injectable({ providedIn: 'root' })
export class AuvpService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/financas/auvp';

  obter(): Observable<AuvpConfiguracao> {
    return this.http.get<AuvpConfiguracao>(this.baseUrl);
  }

  salvarChave(chave: string): Observable<AuvpConfiguracao> {
    return this.http.put<AuvpConfiguracao>(this.baseUrl, { chave });
  }

  removerChave(): Observable<AuvpConfiguracao> {
    return this.http.delete<AuvpConfiguracao>(this.baseUrl);
  }

  sincronizar(): Observable<AuvpSincronizacao> {
    return this.http.post<AuvpSincronizacao>(`${this.baseUrl}/sincronizar`, {});
  }
}
