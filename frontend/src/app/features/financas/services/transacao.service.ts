import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AtualizarTransacaoRequest,
  CriarTransacaoRequest,
  ListarTransacoesFiltro,
  Transacao,
} from '../models/transacao.model';

@Injectable({ providedIn: 'root' })
export class TransacaoService {
  private readonly baseUrl = '/api/financas/transacoes';

  constructor(private readonly http: HttpClient) {}

  criar(request: CriarTransacaoRequest): Observable<Transacao> {
    return this.http.post<Transacao>(this.baseUrl, request);
  }

  listar(filtro: ListarTransacoesFiltro = {}): Observable<Transacao[]> {
    let params = new HttpParams();
    if (filtro.dataInicio) params = params.set('dataInicio', filtro.dataInicio);
    if (filtro.dataFim) params = params.set('dataFim', filtro.dataFim);
    if (filtro.categoria) params = params.set('categoria', filtro.categoria);
    if (filtro.tipo) params = params.set('tipo', filtro.tipo);
    return this.http.get<Transacao[]>(this.baseUrl, { params });
  }

  atualizar(id: string, request: AtualizarTransacaoRequest): Observable<Transacao> {
    return this.http.patch<Transacao>(`${this.baseUrl}/${id}`, request);
  }

  remover(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
