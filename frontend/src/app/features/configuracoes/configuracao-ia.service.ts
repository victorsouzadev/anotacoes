import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ConfiguracaoIa,
  ProvedorIa,
  SalvarConfiguracaoIaRequest,
  TesteConexao,
} from './configuracao-ia.model';

@Injectable({ providedIn: 'root' })
export class ConfiguracaoIaService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/configuracoes/ia';

  obter(): Observable<ConfiguracaoIa> {
    return this.http.get<ConfiguracaoIa>(this.baseUrl);
  }

  salvar(request: SalvarConfiguracaoIaRequest): Observable<ConfiguracaoIa> {
    return this.http.put<ConfiguracaoIa>(this.baseUrl, request);
  }

  removerChave(): Observable<ConfiguracaoIa> {
    return this.http.delete<ConfiguracaoIa>(`${this.baseUrl}/chave`);
  }

  /** Faz uma extração real com a configuração informada, antes de salvar. */
  testar(provedor: ProvedorIa, modelo: string | null, chaveApi: string | null): Observable<TesteConexao> {
    return this.http.post<TesteConexao>(`${this.baseUrl}/testar`, { provedor, modelo, chaveApi });
  }
}
