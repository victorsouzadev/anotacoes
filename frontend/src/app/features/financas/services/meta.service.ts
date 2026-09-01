import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CriarAporteRequest,
  InvestimentoDisponivel,
  Meta,
  SalvarMetaRequest,
} from '../models/meta.model';

@Injectable({ providedIn: 'root' })
export class MetaService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/financas/metas';

  listar(incluirArquivadas = false): Observable<Meta[]> {
    return this.http.get<Meta[]>(this.baseUrl, {
      params: new HttpParams().set('incluirArquivadas', incluirArquivadas),
    });
  }

  investimentosDisponiveis(): Observable<InvestimentoDisponivel[]> {
    return this.http.get<InvestimentoDisponivel[]>(`${this.baseUrl}/investimentos-disponiveis`);
  }

  criar(request: SalvarMetaRequest): Observable<Meta> {
    return this.http.post<Meta>(this.baseUrl, request);
  }

  atualizar(id: string, request: SalvarMetaRequest): Observable<Meta> {
    return this.http.put<Meta>(`${this.baseUrl}/${id}`, request);
  }

  arquivar(id: string, desarquivar = false): Observable<Meta> {
    return this.http.post<Meta>(`${this.baseUrl}/${id}/arquivar`, null, {
      params: new HttpParams().set('desarquivar', desarquivar),
    });
  }

  remover(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  adicionarAporte(id: string, request: CriarAporteRequest): Observable<Meta> {
    return this.http.post<Meta>(`${this.baseUrl}/${id}/aportes`, request);
  }

  removerAporte(id: string, aporteId: string): Observable<Meta> {
    return this.http.delete<Meta>(`${this.baseUrl}/${id}/aportes/${aporteId}`);
  }
}
