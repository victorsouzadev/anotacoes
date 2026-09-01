import { AcompanhamentoItem, SituacaoItem } from './models/orcamento.model';

export type NivelAlerta = 'atencao' | 'estourado';

export interface AlertaCategoria {
  categoria: string;
  categoriaRotulo: string;
  nivel: NivelAlerta;
  valorPlanejado: number;
  valorRealizado: number;
  /** Quanto passou do planejado (só em 'estourado'). */
  excedente: number;
}

/** Situações anteriores por categoria, para detectar apenas o que mudou. */
export type EstadoAnterior = Record<string, SituacaoItem>;

export function estadoDe(itens: AcompanhamentoItem[]): EstadoAnterior {
  const estado: EstadoAnterior = {};
  for (const item of itens) {
    estado[item.categoria] = item.situacao;
  }
  return estado;
}

const SEVERIDADE: Record<SituacaoItem, number> = {
  sem_orcamento: 0,
  ok: 1,
  atencao: 2,
  estourado: 3,
};

/**
 * Alerta só o que piorou desde a última verificação.
 *
 * Sem comparar com o estado anterior, toda recarga da tela repetiria o mesmo
 * aviso de uma categoria que já estava estourada — e o usuário aprenderia a
 * ignorá-lo. Uma categoria que volta a ficar dentro do previsto (ex.: um
 * lançamento excluído) também não gera alerta, só reduz o estado.
 */
export function alertasNovos(
  itens: AcompanhamentoItem[],
  anterior: EstadoAnterior | null,
): AlertaCategoria[] {
  // Primeira verificação do mês: sem base de comparação, não há "novidade" para
  // avisar — só registramos o estado atual.
  if (anterior === null) return [];

  const alertas: AlertaCategoria[] = [];

  for (const item of itens) {
    if (item.situacao !== 'atencao' && item.situacao !== 'estourado') continue;

    const antes = anterior[item.categoria];
    const piorou = antes === undefined || SEVERIDADE[item.situacao] > SEVERIDADE[antes];
    if (!piorou) continue;

    alertas.push({
      categoria: item.categoria,
      categoriaRotulo: item.categoriaRotulo,
      nivel: item.situacao,
      valorPlanejado: item.valorPlanejado,
      valorRealizado: item.valorRealizado,
      excedente: item.situacao === 'estourado'
        ? Math.round((item.valorRealizado - item.valorPlanejado) * 100) / 100
        : 0,
    });
  }

  // Estouro antes de atenção: é a informação mais urgente da lista.
  return alertas.sort((a, b) => SEVERIDADE[b.nivel] - SEVERIDADE[a.nivel]);
}

export function mensagemDoAlerta(alerta: AlertaCategoria): string {
  const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return alerta.nivel === 'estourado'
    ? `${alerta.categoriaRotulo} passou do orçamento em ${moeda(alerta.excedente)}.`
    : `${alerta.categoriaRotulo} já usou ${moeda(alerta.valorRealizado)} dos ${moeda(alerta.valorPlanejado)} previstos.`;
}

/** Chave por competência: o estado de agosto não deve silenciar um alerta de setembro. */
export function chaveDoEstado(ano: number, mes: number): string {
  return `financas:orcamento:estado:${ano}-${String(mes).padStart(2, '0')}`;
}
