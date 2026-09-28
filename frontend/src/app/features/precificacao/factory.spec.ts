import { describe, expect, it } from 'vitest';
import { clonarOrcamento, clonarProduto, itemCustoVazio, orcamentoItemVazio, orcamentoVazio, produtoExemplo } from './factory';
import { ConfiguracaoPrecificacao } from './models';

const config: ConfiguracaoPrecificacao = {
  hh: { valorHoraDesejado: 1500, horasPorDia: 6, diasPorMes: 22 },
  margemPadrao: 30,
  perdaPadrao: 5,
  descontoMaximoPadrao: 10,
  taxaUrgenciaPercentual: 20,
  taxas: [{ id: 't1', nome: 'Maquininha', percentual: 2 }],
  impostosPercentual: 4,
  custosFixos: [],
  producaoMensalEstimada: 100,
  equipamentos: [],
  energia: { valorConta: 150, percentualProducao: 30, horasProdutivasMes: 132, usarCustoDireto: false, custoDiretoPorProduto: 0 },
  faixasQuantidade: [{ id: 'f1', quantidade: 1, descontoPercentual: 0 }],
};

describe('clonarProduto', () => {
  it('gera nova ficha com novo id, nome marcado e mesmos valores', () => {
    const original = produtoExemplo(config);
    const clone = clonarProduto(original);
    expect(clone.id).not.toBe(original.id);
    expect(clone.nome).toBe(`${original.nome} (cópia)`);
    expect(clone.materiais.map((m) => m.nome)).toEqual(original.materiais.map((m) => m.nome));
    expect(clone.materiais[0].id).not.toBe(original.materiais[0].id);
    expect(clone.margemDesejada).toBe(original.margemDesejada);
  });

  it('não compartilha referências com a original', () => {
    const original = produtoExemplo(config);
    const clone = clonarProduto(original);
    clone.materiais.push(itemCustoVazio('Novo'));
    clone.margensSimulacao[0] = 99;
    expect(original.materiais.length).toBe(2);
    expect(original.margensSimulacao[0]).toBe(10);
  });
});

describe('clonarOrcamento', () => {
  it('copia cliente e itens com novo id e número', () => {
    const original = { ...orcamentoVazio(3), clienteNome: 'Ana', itens: [orcamentoItemVazio('Topo', 2, 30)] };
    const clone = clonarOrcamento(original, 8);
    expect(clone.id).not.toBe(original.id);
    expect(clone.numero).toBe(8);
    expect(clone.clienteNome).toBe('Ana');
    expect(clone.itens[0]).toMatchObject({ descricao: 'Topo', quantidade: 2, precoUnitario: 30 });
    expect(clone.itens[0].id).not.toBe(original.itens[0].id);
  });
});
