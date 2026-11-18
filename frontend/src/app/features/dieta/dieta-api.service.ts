import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { uuid } from '../../core/uuid';
import {
  Agua, Alimento, Compartilhamento, DiaResposta, MensagemChat, Perfil, PerfilResposta, Peso, PlanoItem, Progresso,
  Refeicao, Registro, RespostaChat,
} from './dieta.models';

const API = '/api/dieta';

/**
 * Tela web da Dieta (spec 016): grava direto na API, com id gerado aqui e updatedAt de agora —
 * o mesmo contrato last-write-wins que o app Android usa, então o que é feito aqui aparece lá.
 */
@Injectable({ providedIn: 'root' })
export class DietaApiService {
  private http = inject(HttpClient);

  private agora(): string {
    return new Date().toISOString();
  }

  dia(data: string): Promise<DiaResposta> {
    return firstValueFrom(this.http.get<DiaResposta>(`${API}/dia/${data}`));
  }

  perfil(): Promise<PerfilResposta> {
    return firstValueFrom(this.http.get<PerfilResposta>(`${API}/perfil`));
  }

  salvarPerfil(p: Omit<Perfil, 'updatedAt'>): Promise<Perfil> {
    return firstValueFrom(this.http.put<Perfil>(`${API}/perfil`, { ...p, updatedAt: this.agora() }));
  }

  buscarAlimentos(q: string, limite = 30): Promise<Alimento[]> {
    return firstValueFrom(this.http.get<Alimento[]>(`${API}/alimentos`, { params: { q, limite } }));
  }

  /** Registra um item pelo alimento: com valores zerados o servidor calcula pela porção. */
  registrar(data: string, refeicao: Refeicao, alimento: Alimento, gramas: number): Promise<Registro> {
    const agora = this.agora();
    return firstValueFrom(this.http.put<Registro>(`${API}/registros/${uuid()}`, {
      data, refeicao, alimentoId: alimento.id, nome: alimento.nome, quantidadeG: gramas,
      kcal: 0, proteina: 0, carbo: 0, gordura: 0, fibra: 0, fotoId: null,
      createdAt: agora, updatedAt: agora, deletedAt: null,
    }));
  }

  /** Muda a quantidade (recalculando os valores proporcionalmente) ou exclui (deletedAt). */
  atualizarRegistro(r: Registro, gramas: number | null): Promise<Registro> {
    const f = gramas !== null && r.quantidadeG > 0 ? gramas / r.quantidadeG : 1;
    return firstValueFrom(this.http.put<Registro>(`${API}/registros/${r.id}`, {
      data: r.data, refeicao: r.refeicao, alimentoId: r.alimentoId, nome: r.nome,
      quantidadeG: gramas ?? r.quantidadeG,
      kcal: r.kcal * f, proteina: r.proteina * f, carbo: r.carbo * f, gordura: r.gordura * f, fibra: r.fibra * f,
      fotoId: r.fotoId, createdAt: r.createdAt, updatedAt: this.agora(),
      deletedAt: gramas === null ? this.agora() : null,
    }));
  }

  repetir(de: string, para: string, refeicao: Refeicao): Promise<Registro[]> {
    return firstValueFrom(this.http.post<Registro[]>(`${API}/registros/repetir`, null, { params: { de, para, refeicao } }));
  }

  agua(data: string, ml: number): Promise<Agua> {
    return firstValueFrom(this.http.put<Agua>(`${API}/agua/${uuid()}`, { data, ml, updatedAt: this.agora(), deletedAt: null }));
  }

  excluirAgua(a: Agua): Promise<Agua> {
    return firstValueFrom(this.http.put<Agua>(`${API}/agua/${a.id}`, { data: a.data, ml: a.ml, updatedAt: this.agora(), deletedAt: this.agora() }));
  }

  pesos(): Promise<Peso[]> {
    return firstValueFrom(this.http.get<Peso[]>(`${API}/pesos`));
  }

  /** Um peso por dia: reaproveita o registro do dia se já existir. */
  async salvarPeso(data: string, kg: number): Promise<Peso> {
    const existente = (await this.pesos()).find((p) => p.data === data && !p.deletedAt);
    return firstValueFrom(this.http.put<Peso>(`${API}/pesos/${existente?.id ?? uuid()}`, { data, kg, updatedAt: this.agora(), deletedAt: null }));
  }

  plano(): Promise<PlanoItem[]> {
    return firstValueFrom(this.http.get<PlanoItem[]>(`${API}/plano`));
  }

  salvarPlanoItem(item: Omit<PlanoItem, 'id' | 'updatedAt' | 'deletedAt'> & { id?: string }, excluir = false): Promise<PlanoItem> {
    const { id, ...resto } = item;
    return firstValueFrom(this.http.put<PlanoItem>(`${API}/plano/${id ?? uuid()}`, {
      ...resto, updatedAt: this.agora(), deletedAt: excluir ? this.agora() : null,
    }));
  }

  progresso(): Promise<Progresso> {
    return firstValueFrom(this.http.get<Progresso>(`${API}/progresso`));
  }

  csv(inicio: string, fim: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${API}/export.csv`, { params: { inicio, fim }, responseType: 'blob' }));
  }

  compartilhamentos(): Promise<Compartilhamento[]> {
    return firstValueFrom(this.http.get<Compartilhamento[]>(`${API}/compartilhamentos`));
  }

  compartilhar(titulo: string, escopos: string[], diasValidade: number | null): Promise<Compartilhamento> {
    return firstValueFrom(this.http.post<Compartilhamento>(`${API}/compartilhamentos`, { titulo, escopos, diasValidade }));
  }

  revogar(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${API}/compartilhamentos/${id}`));
  }

  chat(mensagens: MensagemChat[]): Promise<RespostaChat> {
    return firstValueFrom(this.http.post<RespostaChat>(`${API}/chat`, { mensagens, imagem: null }));
  }

  /** A foto exige o token: vem como blob e vira URL local para o <img>. */
  async fotoUrl(id: string): Promise<string> {
    const blob = await firstValueFrom(this.http.get(`${API}/fotos/${id}/arquivo`, { responseType: 'blob' }));
    return URL.createObjectURL(blob);
  }
}
