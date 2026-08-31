import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AtualizarTransacaoRequest,
  CriarTransacaoRequest,
  ListarTransacoesFiltro,
  Transacao,
} from '../models/transacao.model';

@Injectable({ providedIn: 'root' })
export class TransacaoService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/financas/transacoes';

  criar(request: CriarTransacaoRequest): Observable<Transacao> {
    return this.http.post<Transacao>(this.baseUrl, request);
  }

  listar(filtro: ListarTransacoesFiltro = {}): Observable<Transacao[]> {
    let params = new HttpParams();
    for (const [chave, valor] of Object.entries(filtro)) {
      if (valor !== undefined && valor !== null && valor !== '') {
        params = params.set(chave, valor as string | number);
      }
    }
    return this.http.get<Transacao[]>(this.baseUrl, { params });
  }

  atualizar(id: string, request: AtualizarTransacaoRequest): Observable<Transacao> {
    return this.http.patch<Transacao>(`${this.baseUrl}/${id}`, request);
  }

  remover(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
