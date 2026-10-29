import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type TipoOperacao = 'compra' | 'venda';

export interface Operacao {
  id: string;
  ticker: string;
  tipo: TipoOperacao;
  quantidade: number;
  precoUnitario: number;
  taxas: number;
  data: string;
  observacoes: string | null;
  total: number;
}

export interface NovaOperacao {
  ticker: string;
  tipo: TipoOperacao;
  quantidade: number;
  precoUnitario: number;
  taxas: number | null;
  data: string;
  observacoes: string | null;
}

export interface Posicao {
  ticker: string;
  nome: string | null;
  quantidade: number;
  precoMedio: number;
  custo: number;
  cotacao: number | null;
  variacaoDia: number | null;
  valorAtual: number | null;
  resultado: number | null;
  resultadoPercentual: number | null;
  resultadoRealizado: number;
  cotacaoEm: string | null;
}

export interface Carteira {
  posicoes: Posicao[];
  custo: number;
  valorAtual: number | null;
  resultado: number | null;
  resultadoPercentual: number | null;
  resultadoRealizado: number;
  cotacoesCompletas: boolean;
}

@Injectable({ providedIn: 'root' })
export class AcoesService {
  constructor(private http: HttpClient) {}

  carteira(): Promise<Carteira> {
    return firstValueFrom(this.http.get<Carteira>('/api/acoes/carteira'));
  }

  operacoes(): Promise<Operacao[]> {
    return firstValueFrom(this.http.get<Operacao[]>('/api/acoes/operacoes'));
  }

  registrar(op: NovaOperacao): Promise<Operacao> {
    return firstValueFrom(this.http.post<Operacao>('/api/acoes/operacoes', op));
  }

  remover(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/acoes/operacoes/${id}`));
  }
}
