import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CategoriaResumo,
  Compromissos,
  Recorrente,
  ResumoResponse,
  TagResumo,
  TendenciaPeriodo,
} from '../models/dashboard.model';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/financas/dashboard';

  resumo(ano: number, mes: number): Observable<ResumoResponse> {
    return this.http.get<ResumoResponse>(`${this.baseUrl}/resumo`, {
      params: new HttpParams().set('ano', ano).set('mes', mes),
    });
  }

  categorias(ano: number, mes: number, tipo: 'receita' | 'despesa' = 'despesa'): Observable<CategoriaResumo[]> {
    return this.http.get<CategoriaResumo[]>(`${this.baseUrl}/categorias`, {
      params: new HttpParams().set('ano', ano).set('mes', mes).set('tipo', tipo),
    });
  }

  recorrentes(): Observable<Recorrente[]> {
    return this.http.get<Recorrente[]>(`${this.baseUrl}/recorrentes`);
  }

  compromissos(): Observable<Compromissos> {
    return this.http.get<Compromissos>(`${this.baseUrl}/compromissos`);
  }

  tags(ano: number, mes: number): Observable<TagResumo[]> {
    return this.http.get<TagResumo[]>(`${this.baseUrl}/tags`, {
      params: new HttpParams().set('ano', ano).set('mes', mes),
    });
  }

  tendencias(agrupamento: 'mensal' | 'semanal' = 'mensal', periodos = 6): Observable<TendenciaPeriodo[]> {
    return this.http.get<TendenciaPeriodo[]>(`${this.baseUrl}/tendencias`, {
      params: new HttpParams().set('agrupamento', agrupamento).set('periodos', periodos),
    });
  }
}
