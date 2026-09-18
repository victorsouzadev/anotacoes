import { describe, expect, it } from 'vitest';
import {
  aplicarPerda,
  calcularPrecificacao,
  custoEnergiaHora,
  custoEnergiaProduto,
  custoFixoRateado,
  custoHH,
  custoHM,
  custoItem,
  depreciacaoHora,
  precoComDesconto,
  precoMinimo,
  precoVenda,
  simularMargens,
  simularQuantidades,
  somaItens,
  somaMinutos,
  valorHora,
  validaComposicaoPercentual,
} from './calc';
import { ConfiguracaoEnergia, Equipamento, ItemCusto, UsoMaquina } from './models';

describe('custoItem', () => {
  it('calcula o custo proporcional do exemplo do papel', () => {
    // R$ 30 por 100 folhas, usando 2 folhas => R$ 0,60
    expect(custoItem({ precoCompra: 30, qtdComprada: 100, qtdUtilizada: 2 })).toBeCloseTo(0.6);
  });

  it('retorna 0 quando a quantidade comprada é zero', () => {
    expect(custoItem({ precoCompra: 10, qtdComprada: 0, qtdUtilizada: 5 })).toBe(0);
  });
});

describe('somaItens', () => {
  it('soma o custo de vários itens', () => {
    const itens: ItemCusto[] = [
      { id: '1', nome: 'Papel', unidade: 'folha', precoCompra: 30, qtdComprada: 100, qtdUtilizada: 2 },
      { id: '2', nome: 'Cola', unidade: 'un', precoCompra: 8, qtdComprada: 10, qtdUtilizada: 1 },
    ];
    expect(somaItens(itens)).toBeCloseTo(0.6 + 0.8);
  });
});

describe('valorHora e custoHH', () => {
  it('calcula o valor da hora a partir da remuneração mensal desejada', () => {
    // R$ 1500 / (6h x 25 dias) = R$ 10/h
    expect(valorHora({ valorHoraDesejado: 1500, horasPorDia: 6, diasPorMes: 25 })).toBeCloseTo(10);
  });

  it('calcula o custo de HH a partir dos minutos totais', () => {
    // 50 minutos a R$ 20/h => R$ 16,67
    expect(custoHH(50, 20)).toBeCloseTo(16.6667, 3);
  });

  it('soma minutos de várias atividades', () => {
    expect(somaMinutos([{ minutos: 10 }, { minutos: 5 }, { minutos: 10 }, { minutos: 15 }, { minutos: 10 }])).toBe(50);
  });
});

describe('depreciacaoHora e custoHM', () => {
  const plotter: Equipamento = {
    id: 'eq1',
    nome: 'Plotter de corte',
    precoAquisicao: 2500,
    valorResidual: 500,
    vidaUtilHoras: 5000,
    manutencaoHora: 0,
    consumoWatts: 0,
  };

  it('calcula a depreciação por hora do exemplo do plotter', () => {
    expect(depreciacaoHora(plotter)).toBeCloseTo(0.4);
  });

  it('calcula o custo de HM somando depreciação e manutenção', () => {
    const usos: UsoMaquina[] = [{ id: 'u1', equipamentoId: 'eq1', minutos: 30 }];
    // 0,4/h de depreciação x 0,5h = 0,20
    expect(custoHM(usos, [plotter])).toBeCloseTo(0.2);
  });

  it('ignora usos de equipamentos que não existem mais', () => {
    const usos: UsoMaquina[] = [{ id: 'u1', equipamentoId: 'inexistente', minutos: 30 }];
    expect(custoHM(usos, [plotter])).toBe(0);
  });
});

describe('energia', () => {
  const energia: ConfiguracaoEnergia = { valorConta: 150, percentualProducao: 30, horasProdutivasMes: 150, usarCustoDireto: false, custoDiretoPorProduto: 0 };

  it('calcula o custo de energia por hora', () => {
    // 150 x 0,30 / 150 = 0,30/h
    expect(custoEnergiaHora(energia)).toBeCloseTo(0.3);
  });

  it('usa o custo direto quando configurado', () => {
    const direto: ConfiguracaoEnergia = { ...energia, usarCustoDireto: true, custoDiretoPorProduto: 1.5 };
    expect(custoEnergiaProduto(direto, 10)).toBe(1.5);
  });
});

describe('custoFixoRateado', () => {
  it('calcula o rateio do exemplo do enunciado', () => {
    expect(custoFixoRateado(1000, 200)).toBeCloseTo(5);
  });

  it('retorna 0 quando a produção mensal é zero', () => {
    expect(custoFixoRateado(1000, 0)).toBe(0);
  });
});

describe('aplicarPerda', () => {
  it('calcula o custo com perda do exemplo do enunciado', () => {
    expect(aplicarPerda(20, 5)).toBeCloseTo(21);
  });
});

describe('precoVenda / precoMinimo / precoComDesconto', () => {
  it('calcula o preço de venda a partir do custo total e dos percentuais', () => {
    // custo 21 / (1 - 0,11 - 0,30) = 21 / 0,59
    const preco = precoVenda(21, 11, 0, 30);
    expect(preco).toBeCloseTo(21 / 0.59, 4);
  });

  it('retorna null quando taxas + impostos + margem somam 100% ou mais', () => {
    expect(precoVenda(100, 50, 30, 20)).toBeNull();
    expect(precoVenda(100, 60, 30, 20)).toBeNull();
  });

  it('preço mínimo cobre custo e taxas, sem margem', () => {
    expect(precoMinimo(100, 10, 5)).toBeCloseTo(100 / 0.85);
  });

  it('calcula o preço anunciado do exemplo do enunciado', () => {
    expect(precoComDesconto(50, 10)).toBeCloseTo(55.56, 2);
  });
});

describe('validaComposicaoPercentual', () => {
  it('valida quando a soma fica abaixo de 100%', () => {
    expect(validaComposicaoPercentual(11, 4, 30)).toBe(true);
  });

  it('invalida quando a soma chega a 100% ou mais', () => {
    expect(validaComposicaoPercentual(40, 30, 30)).toBe(false);
  });
});

describe('simularMargens', () => {
  it('gera uma linha por margem informada', () => {
    const linhas = simularMargens(100, 10, 5, [10, 20, 30]);
    expect(linhas).toHaveLength(3);
    expect(linhas[0].preco).toBeCloseTo(100 / 0.75);
    expect(linhas[2].preco).toBeCloseTo(100 / 0.55);
  });
});

describe('simularQuantidades', () => {
  it('aplica o desconto progressivo e recalcula o lucro', () => {
    const faixas = [
      { id: '1', quantidade: 1, descontoPercentual: 0 },
      { id: '2', quantidade: 10, descontoPercentual: 5 },
    ];
    const linhas = simularQuantidades(20, 10, faixas);
    expect(linhas[0].precoTotal).toBeCloseTo(20);
    expect(linhas[1].precoUnitario).toBeCloseTo(19);
    expect(linhas[1].precoTotal).toBeCloseTo(190);
    expect(linhas[1].lucroTotal).toBeCloseTo(190 - 100);
  });
});

describe('calcularPrecificacao — exemplo do topo de bolo', () => {
  it('calcula o preço final do exemplo do enunciado', () => {
    const resultado = calcularPrecificacao({
      materiais: [
        { id: '1', nome: 'Papel', unidade: 'folha', precoCompra: 2.5, qtdComprada: 1, qtdUtilizada: 1 },
        { id: '2', nome: 'Papel fotográfico', unidade: 'folha', precoCompra: 1.5, qtdComprada: 1, qtdUtilizada: 1 },
      ],
      insumos: [
        { id: '3', nome: 'Cola', unidade: 'un', precoCompra: 0.8, qtdComprada: 1, qtdUtilizada: 1 },
        { id: '4', nome: 'Tinta', unidade: 'un', precoCompra: 1.2, qtdComprada: 1, qtdUtilizada: 1 },
      ],
      embalagens: [{ id: '5', nome: 'Saquinho', unidade: 'un', precoCompra: 1.5, qtdComprada: 1, qtdUtilizada: 1 }],
      outrosCustos: [],
      minutosHH: 30,
      valorHoraCalculado: 20,
      usosMaquina: [{ id: 'u1', equipamentoId: 'eq1', minutos: 10 }],
      equipamentos: [{ id: 'eq1', nome: 'Máquina', precoAquisicao: 1500, valorResidual: 0, vidaUtilHoras: 5000, manutencaoHora: 0, consumoWatts: 0 }],
      energia: { valorConta: 0, percentualProducao: 0, horasProdutivasMes: 1, usarCustoDireto: false, custoDiretoPorProduto: 0 },
      custosFixosMensais: 0,
      producaoMensalEstimada: 100,
      percentualPerda: 5,
      taxas: [],
      impostosPercentual: 0,
      margemDesejada: 30,
      descontoMaximo: 0,
      personalizacoes: [],
      urgente: false,
      taxaUrgenciaPercentual: 20,
      quantidadeVendida: 1,
    });

    // materiais 4 + insumos 2 + HH 10 + HM (0,3/h x 1/6h = 0,05) + embalagem 1,5 = 17,55; com 5% de perda => 18,4275
    expect(resultado.composicao.custoAntesPerda).toBeCloseTo(17.55, 2);
    expect(resultado.composicao.custoTotal).toBeCloseTo(18.4275, 3);
    expect(resultado.precoSugerido).toBeCloseTo(18.4275 / 0.7, 2);
    expect(resultado.precoMinimo).toBeCloseTo(18.4275, 3);
    expect(resultado.lucroUnitario).toBeCloseTo(resultado.precoSugerido! - 18.4275, 2);
  });
});
