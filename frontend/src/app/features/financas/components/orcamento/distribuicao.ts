import { Categoria } from '../../models/transacao.model';
import { GrupoCategoria } from '../../models/orcamento.model';

/** Uma linha da distribuição enquanto o usuário edita. */
export interface LinhaDistribuicao {
  categoria: Categoria;
  rotulo: string;
  grupo: GrupoCategoria;
  percentual: number;
}

/** Arredonda para 2 casas sem o ruído de ponto flutuante de `toFixed`. */
export function arredondar2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export function somaPercentuais(linhas: readonly LinhaDistribuicao[]): number {
  return arredondar2(linhas.reduce((soma, l) => soma + (Number(l.percentual) || 0), 0));
}

export function restanteParaCem(linhas: readonly LinhaDistribuicao[]): number {
  return arredondar2(100 - somaPercentuais(linhas));
}

export function distribuicaoFechada(linhas: readonly LinhaDistribuicao[]): boolean {
  return Math.abs(restanteParaCem(linhas)) < 0.01;
}

/**
 * Divide o que falta (ou sobra) igualmente entre as linhas, garantindo que o
 * resultado some exatamente 100%. O resto do arredondamento vai para a maior
 * fatia, onde uma diferença de centésimos é a menos perceptível.
 */
export function ajustarParaCem(linhas: readonly LinhaDistribuicao[]): LinhaDistribuicao[] {
  if (linhas.length === 0) return [];

  const sobra = restanteParaCem(linhas);
  const porLinha = sobra / linhas.length;

  const ajustadas = linhas.map((l) => ({
    ...l,
    percentual: Math.max(arredondar2((Number(l.percentual) || 0) + porLinha), 0),
  }));

  const resto = arredondar2(100 - ajustadas.reduce((s, l) => s + l.percentual, 0));
  if (resto !== 0) {
    const maior = ajustadas.reduce((a, b) => (b.percentual > a.percentual ? b : a));
    maior.percentual = arredondar2(maior.percentual + resto);
  }

  return ajustadas;
}

/** Converte a fatia percentual em reais, para exibição e edição direta. */
export function valorDaLinha(valorTotal: number, percentual: number): number {
  return arredondar2((valorTotal * (Number(percentual) || 0)) / 100);
}

/** Caminho inverso: o usuário digitou reais e queremos o percentual. */
export function percentualDoValor(valorTotal: number, valorEmReais: number): number {
  if (!(valorTotal > 0)) return 0;
  const bruto = ((Number(valorEmReais) || 0) / valorTotal) * 100;
  return arredondar2(Math.min(Math.max(bruto, 0), 100));
}

export function limitarPercentual(valor: number): number {
  return arredondar2(Math.min(Math.max(Number(valor) || 0, 0), 100));
}
