import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AtualizarTransacaoRequest,
  CriarTransacaoRequest,
  ListarTransacoesFiltro,
  Transacao,
} from '../models/transacao.model';
import { Capacidades, ImportacaoResponse } from '../models/importacao.model';

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

  /** O que este servidor consegue fazer — sem chave de LLM não há leitura de arquivo. */
  capacidades(): Observable<Capacidades> {
    return this.http.get<Capacidades>('/api/financas/capacidades');
  }

  /** Importa lançamentos de foto de cupom, PDF de extrato ou planilha de fatura. */
  importar(arquivos: File[], texto: string): Observable<ImportacaoResponse> {
    const form = new FormData();
    for (const arquivo of arquivos) {
      form.append('arquivos', arquivo, arquivo.name);
    }
    if (texto.trim()) form.append('texto', texto.trim());

    return this.http.post<ImportacaoResponse>(`${this.baseUrl}/importar`, form);
  }

  atualizar(id: string, request: AtualizarTransacaoRequest): Observable<Transacao> {
    return this.http.patch<Transacao>(`${this.baseUrl}/${id}`, request);
  }

  remover(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
