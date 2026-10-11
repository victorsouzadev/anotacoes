import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface AuvpConfiguracao {
  habilitado: boolean;
  chaveConfigurada: boolean;
  chaveMascarada: string | null;
  ultimaSincronizacaoEm: string | null;
}

export interface AuvpTag {
  id: number;
  nome: string;
  cor: string | null;
}

export interface AuvpOrcamento {
  chave: string;
  nome: string;
}

export interface AuvpOrcamentoMesItem {
  nome: string;
  meta: number;
  planejado: number;
  gasto: number;
  restante: number;
  utilizado: number;
}

export interface AuvpOrcamentoMes {
  ano: number;
  mes: number;
  totalPlanejado: number;
  totalGasto: number;
  semOrcamento: number;
  itens: AuvpOrcamentoMesItem[];
}

export interface AuvpConta {
  id: number;
  nome: string;
  tipo: 'cartao' | 'conta';
  saldo: number;
  numero: string | null;
  atualizadaEm: string | null;
  limiteTotal: number | null;
  limiteDisponivel: number | null;
  faturaAberta: number | null;
  mesDaFatura: string | null;
}

export interface AuvpSincronizacao {
  importadas: number;
  jaExistentes: number;
  atualizadas: number;
  foraDosTotais: number;
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

  tags(): Observable<AuvpTag[]> {
    return this.http.get<AuvpTag[]>(`${this.baseUrl}/tags`);
  }

  orcamentos(): Observable<AuvpOrcamento[]> {
    return this.http.get<AuvpOrcamento[]>(`${this.baseUrl}/orcamentos`);
  }

  orcamentoMensal(ano: number, mes: number): Observable<AuvpOrcamentoMes> {
    return this.http.get<AuvpOrcamentoMes>(`${this.baseUrl}/orcamento-mensal`, { params: { ano, mes } });
  }

  contas(): Observable<AuvpConta[]> {
    return this.http.get<AuvpConta[]>(`${this.baseUrl}/contas`);
  }

  sincronizar(): Observable<AuvpSincronizacao> {
    return this.http.post<AuvpSincronizacao>(`${this.baseUrl}/sincronizar`, {});
  }
}
