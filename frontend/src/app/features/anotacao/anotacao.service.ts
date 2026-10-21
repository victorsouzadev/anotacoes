import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export const TIPOS = [
  'PERSON', 'CPF', 'RG', 'CNPJ', 'CNH', 'PHONE', 'EMAIL', 'ADDRESS', 'VEHICLE', 'COMPANY', 'BANK', 'CARD',
] as const;
export type Tipo = (typeof TIPOS)[number];

/** Inicio e Fim são índices de string do JavaScript sobre o texto do relato. */
export interface EntidadeDto {
  tipo: Tipo;
  inicio: number;
  fim: number;
  texto: string;
}

export interface EstadoAnotacao {
  habilitado: boolean;
  pendentes: number;
  aprovadas: number;
}

export interface DocumentoAnotacao {
  rowId: string;
  texto: string;
  entidades: EntidadeDto[];
  modelo: string | null;
  pendentes: number;
  aprovadas: number;
}

const BASE = '/api/anotacao';

@Injectable({ providedIn: 'root' })
export class AnotacaoService {
  constructor(private http: HttpClient) {}

  estado(): Promise<EstadoAnotacao> {
    return firstValueFrom(this.http.get<EstadoAnotacao>(`${BASE}/estado`));
  }

  /** null quando não há mais proposta pendente. */
  proximo(pular: string[]): Promise<DocumentoAnotacao | null> {
    return firstValueFrom(this.http.get<DocumentoAnotacao | null>(`${BASE}/proximo`, { params: { pular: pular.join(',') } }));
  }

  decidir(rowId: string, entidades: EntidadeDto[], observacao: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${BASE}/${encodeURIComponent(rowId)}/decisao`, { entidades, observacao }));
  }
}
