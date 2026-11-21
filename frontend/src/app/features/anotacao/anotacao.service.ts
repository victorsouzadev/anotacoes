import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** O que o plug-in hub-anotacao responde em /api/anotacao/estado (spec 035). */
export interface EstadoAnotacao {
  habilitado: boolean;
  pendentes: number;
  aprovadas: number;
}

/** A tela é do plug-in; o hub só pergunta se mostra o card (fora da lista, o plug-in responde desligado). */
@Injectable({ providedIn: 'root' })
export class AnotacaoService {
  constructor(private http: HttpClient) {}

  estado(): Promise<EstadoAnotacao> {
    return firstValueFrom(this.http.get<EstadoAnotacao>('/api/anotacao/estado'));
  }
}
