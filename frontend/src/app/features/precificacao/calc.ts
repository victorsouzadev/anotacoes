/**
 * Funções puras de cálculo da precificação. Nenhuma delas depende do Angular —
 * são testadas isoladamente em calc.spec.ts e reutilizadas pela página.
 */
import {
  ConfiguracaoEnergia,
  ConfiguracaoHH,
  Equipamento,
  FaixaQuantidade,
  ItemCusto,
  OrcamentoItem,
  PersonalizacaoItem,
  TaxaItem,
  UsoMaquina,
  ValorNomeado,
} from './models';

/** Custo proporcional de um item: preço pago / quantidade comprada × quantidade usada. */
export function custoItem(item: Pick<ItemCusto, 'precoCompra' | 'qtdComprada' | 'qtdUtilizada'>): number {
  if (!item.qtdComprada) return 0;
  return (item.precoCompra / item.qtdComprada) * item.qtdUtilizada;
}

export function somaItens(itens: ItemCusto[]): number {
  return itens.reduce((soma, item) => soma + custoItem(item), 0);
}

export function somaValores(itens: ValorNomeado[]): number {
  return itens.reduce((soma, item) => soma + item.valor, 0);
}

/** Valor da hora de trabalho = remuneração mensal desejada / horas produtivas mensais. */
export function valorHora(hh: ConfiguracaoHH): number {
  const horasMensais = hh.horasPorDia * hh.diasPorMes;
  return horasMensais > 0 ? hh.valorHoraDesejado / horasMensais : 0;
}

/** Custo de mão de obra (HH) = valor da hora × tempo total gasto no produto. */
export function custoHH(minutosTotais: number, valorHoraCalculado: number): number {
  return (minutosTotais / 60) * valorHoraCalculado;
}

export function somaMinutos(atividades: { minutos: number }[]): number {
  return atividades.reduce((soma, a) => soma + a.minutos, 0);
}

/** Depreciação por hora = (preço da máquina − valor residual) / vida útil em horas. */
export function depreciacaoHora(equipamento: Pick<Equipamento, 'precoAquisicao' | 'valorResidual' | 'vidaUtilHoras'>): number {
  if (!equipamento.vidaUtilHoras) return 0;
  return (equipamento.precoAquisicao - equipamento.valorResidual) / equipamento.vidaUtilHoras;
}

/** HM = (depreciação/hora + manutenção/hora) × horas utilizadas, somado para todas as máquinas usadas. */
export function custoHM(usos: UsoMaquina[], equipamentos: Equipamento[]): number {
  return usos.reduce((total, uso) => {
    const equipamento = equipamentos.find((e) => e.id === uso.equipamentoId);
    if (!equipamento) return total;
    const custoPorHora = depreciacaoHora(equipamento) + (equipamento.manutencaoHora || 0);
    return total + custoPorHora * (uso.minutos / 60);
  }, 0);
}

/** Custo de energia por hora, a partir da conta mensal e do percentual destinado à produção. */
export function custoEnergiaHora(energia: Pick<ConfiguracaoEnergia, 'valorConta' | 'percentualProducao' | 'horasProdutivasMes'>): number {
  if (!energia.horasProdutivasMes) return 0;
  return (energia.valorConta * (energia.percentualProducao / 100)) / energia.horasProdutivasMes;
}

/** Custo de energia do produto: direto (se configurado) ou proporcional ao tempo de HM usado. */
export function custoEnergiaProduto(energia: ConfiguracaoEnergia, horasMaquinaUsadas: number): number {
  if (energia.usarCustoDireto) return energia.custoDiretoPorProduto || 0;
  return custoEnergiaHora(energia) * horasMaquinaUsadas;
}

/** Custo fixo por produto = custos fixos mensais / quantidade produzida no mês. */
export function custoFixoRateado(totalCustosFixosMensais: number, producaoMensalEstimada: number): number {
  if (!producaoMensalEstimada) return 0;
  return totalCustosFixosMensais / producaoMensalEstimada;
}

/** Custo com perdas = custo base × (1 + percentual de perda). */
export function aplicarPerda(custoBase: number, percentualPerda: number): number {
  return custoBase * (1 + percentualPerda / 100);
}

export function somaTaxas(taxas: TaxaItem[]): number {
  return taxas.reduce((soma, t) => soma + t.percentual, 0);
}

/**
 * Preço de venda = custo total / (1 − taxas − impostos − margem), todos em fração.
 * Retorna null quando a soma de taxas + impostos + margem é >= 100% (divisor inválido).
 */
export function precoVenda(custoTotal: number, taxasPercentual: number, impostosPercentual: number, margemPercentual: number): number | null {
  const divisor = 1 - (taxasPercentual + impostosPercentual + margemPercentual) / 100;
  if (divisor <= 0) return null;
  return custoTotal / divisor;
}

/** Preço mínimo: cobre custo, taxas e impostos, sem margem de lucro. */
export function precoMinimo(custoTotal: number, taxasPercentual: number, impostosPercentual: number): number | null {
  return precoVenda(custoTotal, taxasPercentual, impostosPercentual, 0);
}

/** Preço anunciado = preço necessário / (1 − desconto), para que o desconto não corroa a margem. */
export function precoComDesconto(precoNecessario: number, descontoPercentual: number): number {
  const divisor = 1 - descontoPercentual / 100;
  if (divisor <= 0) return Infinity;
  return precoNecessario / divisor;
}

export function validaComposicaoPercentual(taxasPercentual: number, impostosPercentual: number, margemPercentual: number): boolean {
  return taxasPercentual + impostosPercentual + margemPercentual < 100;
}

export interface ComposicaoCusto {
  materiais: number;
  insumos: number;
  hh: number;
  hm: number;
  embalagem: number;
  energia: number;
  custosFixos: number;
  outros: number;
  custoAntesPerda: number;
  perda: number;
  custoTotal: number;
}

export function somaValorAtivo(itens: PersonalizacaoItem[]): number {
  return itens.filter((i) => i.ativo).reduce((soma, i) => soma + i.valor, 0);
}

export interface ResultadoPrecificacao {
  composicao: ComposicaoCusto;
  precoMinimo: number | null;
  precoEquilibrio: number | null;
  precoSugerido: number | null;
  precoAnunciadoComDesconto: number | null;
  lucroUnitario: number | null;
  margemLiquidaReal: number | null;
  precoComPersonalizacoes: number | null;
  precoComUrgencia: number | null;
  precoUnitarioFinal: number | null;
  precoTotalPedido: number | null;
  lucroTotalPedido: number | null;
  taxasPercentualTotal: number;
  composicaoPercentual: { rotulo: string; percentual: number }[];
}

export interface EntradaPrecificacao {
  materiais: ItemCusto[];
  insumos: ItemCusto[];
  embalagens: ItemCusto[];
  outrosCustos: ValorNomeado[];
  minutosHH: number;
  valorHoraCalculado: number;
  usosMaquina: UsoMaquina[];
  equipamentos: Equipamento[];
  energia: ConfiguracaoEnergia;
  custosFixosMensais: number;
  producaoMensalEstimada: number;
  percentualPerda: number;
  taxas: TaxaItem[];
  impostosPercentual: number;
  margemDesejada: number;
  descontoMaximo: number;
  personalizacoes: PersonalizacaoItem[];
  urgente: boolean;
  taxaUrgenciaPercentual: number;
  quantidadeVendida: number;
}

export function calcularPrecificacao(entrada: EntradaPrecificacao): ResultadoPrecificacao {
  const materiais = somaItens(entrada.materiais);
  const insumos = somaItens(entrada.insumos);
  const embalagem = somaItens(entrada.embalagens);
  const outros = somaValores(entrada.outrosCustos);
  const hh = custoHH(entrada.minutosHH, entrada.valorHoraCalculado);
  const hm = custoHM(entrada.usosMaquina, entrada.equipamentos);
  const horasMaquinaUsadas = entrada.usosMaquina.reduce((s, u) => s + u.minutos / 60, 0);
  const energia = custoEnergiaProduto(entrada.energia, horasMaquinaUsadas);
  const custosFixos = custoFixoRateado(entrada.custosFixosMensais, entrada.producaoMensalEstimada);

  const custoAntesPerda = materiais + insumos + hh + hm + embalagem + energia + custosFixos + outros;
  const custoTotal = aplicarPerda(custoAntesPerda, entrada.percentualPerda);
  const perda = custoTotal - custoAntesPerda;

  const composicao: ComposicaoCusto = { materiais, insumos, hh, hm, embalagem, energia, custosFixos, outros, custoAntesPerda, perda, custoTotal };

  const taxasPercentualTotal = somaTaxas(entrada.taxas);
  const pMinimo = precoMinimo(custoTotal, taxasPercentualTotal, entrada.impostosPercentual);
  const pSugerido = precoVenda(custoTotal, taxasPercentualTotal, entrada.impostosPercentual, entrada.margemDesejada);
  const pAnunciado = pSugerido !== null ? precoComDesconto(pSugerido, entrada.descontoMaximo) : null;

  const extraPersonalizacoes = somaValorAtivo(entrada.personalizacoes);
  const precoComPersonalizacoes = pSugerido !== null ? pSugerido + extraPersonalizacoes : null;
  const precoComUrgencia =
    precoComPersonalizacoes !== null && entrada.urgente
      ? precoComPersonalizacoes * (1 + entrada.taxaUrgenciaPercentual / 100)
      : precoComPersonalizacoes;

  const lucroUnitario = pSugerido !== null ? pSugerido - custoTotal - (pSugerido * (taxasPercentualTotal + entrada.impostosPercentual)) / 100 : null;
  const margemLiquidaReal = pSugerido && pSugerido > 0 && lucroUnitario !== null ? (lucroUnitario / pSugerido) * 100 : null;

  const qtd = entrada.quantidadeVendida || 0;
  const precoTotalPedido = precoComUrgencia !== null ? precoComUrgencia * qtd : null;
  const lucroTotalPedido = lucroUnitario !== null ? lucroUnitario * qtd : null;

  const totalComposicao = custoTotal > 0 ? custoTotal : 1;
  const composicaoPercentual = [
    { rotulo: 'Matéria-prima', percentual: (materiais / totalComposicao) * 100 },
    { rotulo: 'Insumos', percentual: (insumos / totalComposicao) * 100 },
    { rotulo: 'Mão de obra (HH)', percentual: (hh / totalComposicao) * 100 },
    { rotulo: 'Hora-máquina (HM)', percentual: (hm / totalComposicao) * 100 },
    { rotulo: 'Embalagem', percentual: (embalagem / totalComposicao) * 100 },
    { rotulo: 'Energia', percentual: (energia / totalComposicao) * 100 },
    { rotulo: 'Custos fixos', percentual: (custosFixos / totalComposicao) * 100 },
    { rotulo: 'Outros', percentual: (outros / totalComposicao) * 100 },
    { rotulo: 'Perdas', percentual: (perda / totalComposicao) * 100 },
  ].filter((c) => c.percentual > 0.01);

  return {
    composicao,
    precoMinimo: pMinimo,
    precoEquilibrio: pMinimo,
    precoSugerido: pSugerido,
    precoAnunciadoComDesconto: pAnunciado,
    lucroUnitario,
    margemLiquidaReal,
    precoComPersonalizacoes,
    precoComUrgencia,
    precoUnitarioFinal: precoComUrgencia,
    precoTotalPedido,
    lucroTotalPedido,
    taxasPercentualTotal,
    composicaoPercentual,
  };
}

export interface SimulacaoMargem {
  margemPercentual: number;
  preco: number | null;
}

export function simularMargens(custoTotal: number, taxasPercentual: number, impostosPercentual: number, margens: number[]): SimulacaoMargem[] {
  return margens.map((margemPercentual) => ({
    margemPercentual,
    preco: precoVenda(custoTotal, taxasPercentual, impostosPercentual, margemPercentual),
  }));
}

export function totalItemOrcamento(item: OrcamentoItem): number {
  return item.quantidade * item.precoUnitario;
}

export function totalOrcamento(itens: OrcamentoItem[]): number {
  return itens.reduce((soma, item) => soma + totalItemOrcamento(item), 0);
}

export function dataValidadeOrcamento(dataISO: string, validadeDias: number): Date {
  const data = new Date(dataISO);
  data.setDate(data.getDate() + validadeDias);
  return data;
}

export interface SimulacaoQuantidade {
  faixa: FaixaQuantidade;
  precoUnitario: number | null;
  precoTotal: number | null;
  custoTotal: number;
  lucroTotal: number | null;
}

export function simularQuantidades(
  precoUnitarioBase: number | null,
  custoUnitario: number,
  faixas: FaixaQuantidade[],
): SimulacaoQuantidade[] {
  return faixas.map((faixa) => {
    const precoUnitario = precoUnitarioBase !== null ? precoUnitarioBase * (1 - faixa.descontoPercentual / 100) : null;
    const precoTotal = precoUnitario !== null ? precoUnitario * faixa.quantidade : null;
    const custoTotal = custoUnitario * faixa.quantidade;
    const lucroTotal = precoTotal !== null ? precoTotal - custoTotal : null;
    return { faixa, precoUnitario, precoTotal, custoTotal, lucroTotal };
  });
}
