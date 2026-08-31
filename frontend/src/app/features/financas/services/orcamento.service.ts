import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Acompanhamento,
  CategoriaOrcavel,
  ModeloOrcamento,
  Orcamento,
  SalvarOrcamentoRequest,
} from '../models/orcamento.model';

@Injectable({ providedIn: 'root' })
export class OrcamentoService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/financas/orcamentos';

  /** Mês sem orçamento devolve 204, que chega aqui como `null`. */
  atual(ano: number, mes: number): Observable<Orcamento | null> {
    return this.http.get<Orcamento | null>(`${this.baseUrl}/atual`, {
      params: new HttpParams().set('ano', ano).set('mes', mes),
    });
  }

  historico(): Observable<Orcamento[]> {
    return this.http.get<Orcamento[]>(this.baseUrl);
  }

  acompanhamento(ano: number, mes: number): Observable<Acompanhamento> {
    return this.http.get<Acompanhamento>(`${this.baseUrl}/acompanhamento`, {
      params: new HttpParams().set('ano', ano).set('mes', mes),
    });
  }

  modelos(valorTotal: number): Observable<ModeloOrcamento[]> {
    return this.http.get<ModeloOrcamento[]>(`${this.baseUrl}/modelos`, {
      params: new HttpParams().set('valorTotal', valorTotal),
    });
  }

  categorias(): Observable<CategoriaOrcavel[]> {
    return this.http.get<CategoriaOrcavel[]>(`${this.baseUrl}/categorias`);
  }

  salvar(request: SalvarOrcamentoRequest): Observable<Orcamento> {
    return this.http.put<Orcamento>(this.baseUrl, request);
  }

  copiar(anoOrigem: number, mesOrigem: number, anoDestino: number, mesDestino: number, valorTotal: number | null): Observable<Orcamento> {
    return this.http.post<Orcamento>(`${this.baseUrl}/copiar`, {
      anoOrigem, mesOrigem, anoDestino, mesDestino, valorTotal,
    });
  }

  remover(ano: number, mes: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${ano}/${mes}`);
  }
}
