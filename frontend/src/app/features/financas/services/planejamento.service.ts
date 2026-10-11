import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Divida,
  Envelope,
  Fechamento,
  FluxoCaixa,
  MetodoDivisao,
  MetodoResposta,
  Preferencias,
  Provisao,
  Provisoes,
  SalvarDivida,
  SalvarPreferencias,
  SalvarProvisao,
  SaudeFinanceira,
  SimulacaoDividas,
} from '../models/planejamento.model';

@Injectable({ providedIn: 'root' })
export class PlanejamentoService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/financas/planejamento';

  private mes(ano: number, mes: number): HttpParams {
    return new HttpParams().set('ano', ano).set('mes', mes);
  }

  preferencias(): Observable<Preferencias> {
    return this.http.get<Preferencias>(`${this.base}/preferencias`);
  }

  salvarPreferencias(p: SalvarPreferencias): Observable<Preferencias> {
    return this.http.put<Preferencias>(`${this.base}/preferencias`, p);
  }

  saude(ano: number, mes: number): Observable<SaudeFinanceira> {
    return this.http.get<SaudeFinanceira>(`${this.base}/saude`, { params: this.mes(ano, mes) });
  }

  metodo(ano: number, mes: number, metodo?: MetodoDivisao): Observable<MetodoResposta> {
    let params = this.mes(ano, mes);
    if (metodo) params = params.set('metodo', metodo);
    return this.http.get<MetodoResposta>(`${this.base}/metodo`, { params });
  }

  envelopes(ano: number, mes: number): Observable<Envelope[]> {
    return this.http.get<Envelope[]>(`${this.base}/envelopes`, { params: this.mes(ano, mes) });
  }

  fluxo(dias: number): Observable<FluxoCaixa> {
    return this.http.get<FluxoCaixa>(`${this.base}/fluxo`, { params: { dias } });
  }

  dividas(): Observable<Divida[]> {
    return this.http.get<Divida[]>(`${this.base}/dividas`);
  }

  criarDivida(d: SalvarDivida): Observable<Divida> {
    return this.http.post<Divida>(`${this.base}/dividas`, d);
  }

  atualizarDivida(id: string, d: SalvarDivida): Observable<Divida> {
    return this.http.put<Divida>(`${this.base}/dividas/${id}`, d);
  }

  removerDivida(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/dividas/${id}`);
  }

  simularDividas(extra: number): Observable<SimulacaoDividas | null> {
    return this.http.get<SimulacaoDividas | null>(`${this.base}/dividas/simulacao`, { params: { extra } });
  }

  provisoes(): Observable<Provisoes> {
    return this.http.get<Provisoes>(`${this.base}/provisoes`);
  }

  criarProvisao(p: SalvarProvisao): Observable<Provisao> {
    return this.http.post<Provisao>(`${this.base}/provisoes`, p);
  }

  atualizarProvisao(id: string, p: SalvarProvisao): Observable<Provisao> {
    return this.http.put<Provisao>(`${this.base}/provisoes/${id}`, p);
  }

  removerProvisao(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/provisoes/${id}`);
  }

  fechamento(ano: number, mes: number): Observable<Fechamento> {
    return this.http.get<Fechamento>(`${this.base}/fechamento/${ano}/${mes}`);
  }

  salvarFechamento(
    ano: number,
    mes: number,
    f: { metaPoupanca: number | null; reflexao: string; compromisso: string },
  ): Observable<Fechamento> {
    return this.http.put<Fechamento>(`${this.base}/fechamento/${ano}/${mes}`, f);
  }
}
