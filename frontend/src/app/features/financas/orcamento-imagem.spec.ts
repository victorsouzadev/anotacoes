import { describe, expect, it } from 'vitest';
import {
  DadosCartao,
  moedaBr,
  montarCartao,
  nomeArquivoImagem,
  percentualBr,
  quebrarLinhas,
} from './orcamento-imagem';
import { Acompanhamento, AcompanhamentoItem, Orcamento, SituacaoItem } from './models/orcamento.model';

function item(rotulo: string, over: Partial<AcompanhamentoItem> = {}): AcompanhamentoItem {
  return {
    categoria: 'alimentacao' as AcompanhamentoItem['categoria'],
    categoriaRotulo: rotulo,
    grupo: 'Essenciais',
    percentual: 25,
    valorPlanejado: 1000,
    valorRealizado: 850,
    valorRestante: 150,
    percentualUtilizado: 85,
    situacao: 'ok' as SituacaoItem,
    ...over,
  };
}

function dados(over: { acompanhamento?: Partial<Acompanhamento>; orcamento?: Partial<Orcamento> } = {}): DadosCartao {
  const acompanhamento: Acompanhamento = {
    ano: 2026,
    mes: 9,
    temOrcamento: true,
    valorTotal: 5000,
    totalPlanejado: 5000,
    totalRealizado: 3200,
    saldoDisponivel: 1800,
    percentualUtilizado: 64,
    percentualDoMesDecorrido: 50,
    projecaoFimDoMes: 6400,
    itens: [item('Alimentação')],
    grupos: [{ grupo: 'Essenciais', grupoRotulo: 'Essenciais', percentual: 50, valorPlanejado: 2500, valorRealizado: 1800 }],
    ...over.acompanhamento,
  };

  const orcamento: Orcamento = {
    id: 'x',
    ano: 2026,
    mes: 9,
    valorTotal: 5000,
    observacoes: null,
    itens: [],
    criadoEm: '',
    atualizadoEm: '',
    ...over.orcamento,
  };

  return {
    nomeDoMes: 'setembro de 2026',
    orcamento,
    acompanhamento,
    diagnostico: { tom: 'ok' as never, texto: 'Gasto dentro do ritmo do mês.' },
    geradoEm: new Date(2026, 8, 2),
  };
}

describe('moedaBr', () => {
  // O Intl insere espaço não separável e depende dos dados de locale do
  // ambiente; num texto que vira pixels o formato tem de ser sempre o mesmo.
  it.each([
    [0, 'R$ 0,00'],
    [42.5, 'R$ 42,50'],
    [1234.5, 'R$ 1.234,50'],
    [1234567.891, 'R$ 1.234.567,89'],
    [-1234.5, '-R$ 1.234,50'],
  ])('formata %s como %s', (valor, esperado) => {
    expect(moedaBr(valor)).toBe(esperado);
  });

  it('usa espaço comum depois do R$, e não espaço não separável', () => {
    expect(moedaBr(10)).toBe('R$ 10,00');
    expect(moedaBr(10)).not.toContain(' ');
  });
});

describe('percentualBr', () => {
  it('arredonda e usa vírgula decimal', () => {
    expect(percentualBr(64.4)).toBe('64%');
    expect(percentualBr(12.25, 1)).toBe('12,3%');
  });
});

describe('quebrarLinhas', () => {
  const medir = (t: string) => t.length * 10;

  it('quebra por palavra dentro da largura', () => {
    expect(quebrarLinhas('mes com viagem marcada', 100, medir)).toEqual(['mes com', 'viagem', 'marcada']);
  });

  it('devolve vazio para texto em branco', () => {
    expect(quebrarLinhas('   ', 100, medir)).toEqual([]);
  });

  it('marca o corte quando passa do limite de linhas', () => {
    const linhas = quebrarLinhas('um dois tres quatro cinco seis sete oito', 60, medir, 2);

    expect(linhas).toHaveLength(2);
    expect(linhas[1].endsWith('…')).toBe(true);
  });
});

describe('montarCartao', () => {
  it('monta título, total e métricas', () => {
    const c = montarCartao(dados());

    expect(c.titulo).toBe('Orçamento de setembro de 2026');
    expect(c.total).toBe('R$ 5.000,00');
    expect(c.metricas.map((m) => m.rotulo)).toEqual(['Gasto', 'Disponível', 'Projeção do mês']);
    expect(c.metricas[0].valor).toBe('R$ 3.200,00');
  });

  it('marca saldo negativo e projeção acima do total', () => {
    const c = montarCartao(dados({ acompanhamento: { saldoDisponivel: -300, projecaoFimDoMes: 6400 } }));

    expect(c.metricas[1].tom).toBe('negativo');
    expect(c.metricas[2].tom).toBe('negativo');
  });

  it('trata projeção dentro do orçamento como neutra', () => {
    const c = montarCartao(dados({ acompanhamento: { projecaoFimDoMes: 4800 } }));

    expect(c.metricas[2].tom).toBe('neutro');
  });

  // A barra cheia com cor de estouro é o que diferencia 100% de 130% na imagem:
  // sem o limite a barra vazaria para fora do cartão.
  it('limita a barra em 100% e muda o tom no estouro', () => {
    const c = montarCartao(dados({ acompanhamento: { percentualUtilizado: 130 } }));

    expect(c.barraGeral.fracao).toBe(1);
    expect(c.barraGeral.tom).toBe('negativo');
    expect(c.legendaBarra).toBe('130% do orçamento');
  });

  it('não deixa fração negativa nem inválida virar barra', () => {
    expect(montarCartao(dados({ acompanhamento: { percentualUtilizado: -5 } })).barraGeral.fracao).toBe(0);
    expect(montarCartao(dados({ acompanhamento: { percentualUtilizado: NaN } })).barraGeral.fracao).toBe(0);
  });

  it('só mostra a marca de ritmo dentro do mês corrente', () => {
    expect(montarCartao(dados()).marcaRitmo).toBe(0.5);
    expect(montarCartao(dados({ acompanhamento: { percentualDoMesDecorrido: 0 } })).marcaRitmo).toBeNull();
    expect(montarCartao(dados({ acompanhamento: { percentualDoMesDecorrido: 100 } })).marcaRitmo).toBeNull();
  });

  it('descreve a categoria com planejado, restante e percentuais', () => {
    const c = montarCartao(dados());

    expect(c.categorias[0].valores).toBe('R$ 850,00 de R$ 1.000,00');
    expect(c.categorias[0].rodape).toBe('85% usado · 25,0% do total · restam R$ 150,00');
    expect(c.categorias[0].barra?.tom).toBe('positivo');
  });

  it('diz "excedeu" com o valor em positivo quando o restante é negativo', () => {
    const c = montarCartao(dados({
      acompanhamento: {
        itens: [item('Lazer', { valorRestante: -225, percentualUtilizado: 122, situacao: 'estourado' })],
      },
    }));

    expect(c.categorias[0].rodape).toContain('excedeu R$ 225,00');
    expect(c.categorias[0].rodape).not.toContain('-R$');
    expect(c.categorias[0].barra?.tom).toBe('negativo');
  });

  it('categoria sem planejado sai sem barra e marcada como fora do orçamento', () => {
    const c = montarCartao(dados({
      acompanhamento: {
        itens: [item('Outros', { valorPlanejado: 0, valorRealizado: 90, situacao: 'sem_orcamento' })],
      },
    }));

    expect(c.categorias[0].barra).toBeNull();
    expect(c.categorias[0].valores).toBe('R$ 90,00');
    expect(c.categorias[0].foraDoOrcamento).toBe(true);
  });

  it('usa o tom de atenção antes do estouro', () => {
    const c = montarCartao(dados({ acompanhamento: { itens: [item('Mercado', { situacao: 'atencao' })] } }));

    expect(c.categorias[0].barra?.tom).toBe('atencao');
  });

  it('inclui as observações quebradas em linhas', () => {
    const c = montarCartao(dados({ orcamento: { observacoes: 'mês com viagem marcada' } }));

    expect(c.observacoes.join(' ')).toBe('mês com viagem marcada');
  });

  it('sem observações, não ocupa linha nenhuma', () => {
    expect(montarCartao(dados()).observacoes).toEqual([]);
  });

  // A altura é o que define o tamanho do canvas; se ela não acompanhar o
  // conteúdo, a imagem sai com as últimas categorias cortadas.
  it('cresce a altura conforme o conteúdo', () => {
    const base = montarCartao(dados()).altura;

    const comMaisCategorias = montarCartao(dados({
      acompanhamento: { itens: [item('A'), item('B'), item('C')] },
    })).altura;
    const semDiagnostico = montarCartao({ ...dados(), diagnostico: null }).altura;
    const comObservacoes = montarCartao(dados({ orcamento: { observacoes: 'uma nota qualquer' } })).altura;
    const semGrupos = montarCartao(dados({ acompanhamento: { grupos: [] } })).altura;

    expect(comMaisCategorias).toBeGreaterThan(base);
    expect(semDiagnostico).toBeLessThan(base);
    expect(comObservacoes).toBeGreaterThan(base);
    expect(semGrupos).toBeLessThan(base);
  });

  it('categoria sem barra ocupa menos altura que uma com barra', () => {
    const comBarra = montarCartao(dados({ acompanhamento: { itens: [item('A')] } })).altura;
    const semBarra = montarCartao(dados({
      acompanhamento: { itens: [item('A', { valorPlanejado: 0, situacao: 'sem_orcamento' })] },
    })).altura;

    expect(semBarra).toBeLessThan(comBarra);
  });

  // Sem categorias o título "Por categoria" ficaria sozinho na imagem,
  // anunciando uma lista que não vem.
  it('não reserva a seção de categorias quando não há nenhuma', () => {
    const comCategorias = montarCartao(dados()).altura;
    const semCategorias = montarCartao(dados({ acompanhamento: { itens: [] } }));

    expect(semCategorias.categorias).toEqual([]);
    expect(semCategorias.altura).toBeLessThan(comCategorias - 66);
  });

  it('assina a data de geração no rodapé', () => {
    expect(montarCartao(dados()).rodape).toBe('Gerado em 02/09/2026 · Anotações');
  });
});

describe('nomeArquivoImagem', () => {
  it('zera o mês à esquerda para os arquivos ordenarem certo', () => {
    expect(nomeArquivoImagem(2026, 9)).toBe('orcamento-2026-09.png');
    expect(nomeArquivoImagem(2026, 12)).toBe('orcamento-2026-12.png');
  });
});
