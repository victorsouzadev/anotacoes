import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Situacao = 'no-ar' | 'com-falha' | 'desligado' | 'pronto' | 'incompleto';
export type EstadoDaEtapa = 'feita' | 'pendente' | 'falhou' | 'nao-conferida';

export interface Etapa {
  nome: string;
  estado: EstadoDaEtapa;
  detalhe: string | null;
}

export interface PluginNoPainel {
  id: string;
  nome: string;
  situacao: Situacao;
  versao: string | null;
  versaoAnterior: string | null;
  health: boolean | null;
  ultimaFalha: string | null;
  congelado: boolean;
  memoriaMb: number | null;
  limiteMb: number | null;
  etapas: Etapa[];
}

export interface Recursos {
  memoriaLivreMb: number | null;
  memoriaTotalMb: number | null;
  limiteDoPluginMb: number;
  conexoesLivres: number | null;
  poolsSomados: number;
  avisos: string[];
}

export interface Painel {
  plugins: PluginNoPainel[];
  recursos: Recursos;
  avisos: string[];
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  'no-ar': 'No ar',
  'com-falha': 'Com falha',
  desligado: 'Desligado',
  pronto: 'Pronto para ligar',
  incompleto: 'Incompleto',
};

export const ROTULO_ESTADO: Record<EstadoDaEtapa, string> = {
  feita: 'feita',
  pendente: 'pendente',
  falhou: 'falhou',
  'nao-conferida': 'não deu para conferir',
};

const ROTULO_ETAPA: Record<string, string> = {
  ci: 'CI da main',
  manifesto: 'Manifesto',
  imagem: 'Imagem publicada',
  papel: 'Papel no banco',
  schema: 'Schema no banco',
  conexao: 'Conexão',
  permissoes: 'Permissões',
  registro: 'Registro',
  'no-ar': 'No ar',
};

const NOME_CURTO: Record<string, string> = {
  ci: 'CI', manifesto: 'manifesto', imagem: 'imagem', papel: 'banco', schema: 'banco', conexao: 'banco', permissoes: 'banco', registro: 'registro',
};

/** Primeiro o que pede atenção. */
const ORDEM: Situacao[] = ['com-falha', 'incompleto', 'pronto', 'desligado', 'no-ar'];

export function rotuloDaEtapa(nome: string): string {
  return ROTULO_ETAPA[nome] ?? nome;
}

export function ordenar(plugins: PluginNoPainel[]): PluginNoPainel[] {
  return [...plugins].sort((a, b) => ORDEM.indexOf(a.situacao) - ORDEM.indexOf(b.situacao) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** "Falta: banco, registro" para quem não está no ar; null quando nada falta ou é falha de health. */
export function oQueFalta(p: PluginNoPainel): string | null {
  if (p.situacao === 'no-ar') return null;
  const nomes = (estados: EstadoDaEtapa[]) => [
    ...new Set(p.etapas.filter((e) => estados.includes(e.estado)).map((e) => NOME_CURTO[e.nome]).filter((n): n is string => !!n)),
  ];
  const falta = nomes(['pendente', 'falhou']);
  const semConferir = nomes(['nao-conferida']).filter((n) => !falta.includes(n));
  const partes = [];
  if (falta.length) partes.push(`Falta: ${falta.join(', ')}`);
  if (semConferir.length) partes.push(`sem conferir: ${semConferir.join(', ')}`);
  return partes.length ? partes.join('; ') + '.' : null;
}

/** Painel de plug-ins (spec 040): nesta entrega, só leitura. */
@Injectable({ providedIn: 'root' })
export class PainelService {
  private readonly http = inject(HttpClient);

  permissao(): Promise<{ administrador: boolean }> {
    return firstValueFrom(this.http.get<{ administrador: boolean }>('/api/painel/plugins/permissao'));
  }

  listar(): Promise<Painel> {
    return firstValueFrom(this.http.get<Painel>('/api/painel/plugins'));
  }
}
