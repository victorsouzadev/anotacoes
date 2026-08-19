import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CategoriaResumo, ResumoResponse, TendenciaPeriodo } from '../models/dashboard.model';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly baseUrl = '/api/financas/dashboard';

  constructor(private readonly http: HttpClient) {}

  resumo(ano?: number, mes?: number): Observable<ResumoResponse> {
    let params = new HttpParams();
    if (ano) params = params.set('ano', ano);
    if (mes) params = params.set('mes', mes);
    return this.http.get<ResumoResponse>(`${this.baseUrl}/resumo`, { params });
  }

  categorias(ano?: number, mes?: number): Observable<CategoriaResumo[]> {
    let params = new HttpParams();
    if (ano) params = params.set('ano', ano);
    if (mes) params = params.set('mes', mes);
    return this.http.get<CategoriaResumo[]>(`${this.baseUrl}/categorias`, { params });
  }

  tendencias(agrupamento: 'mensal' | 'semanal' = 'mensal', periodos = 6): Observable<TendenciaPeriodo[]> {
    const params = new HttpParams().set('agrupamento', agrupamento).set('periodos', periodos);
    return this.http.get<TendenciaPeriodo[]>(`${this.baseUrl}/tendencias`, { params });
  }
}
