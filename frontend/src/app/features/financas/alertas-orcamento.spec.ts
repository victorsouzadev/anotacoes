import { describe, expect, it } from 'vitest';
import {
  alertasNovos,
  chaveDoEstado,
  estadoDe,
  mensagemDoAlerta,
} from './alertas-orcamento';
import { AcompanhamentoItem, SituacaoItem } from './models/orcamento.model';

function item(categoria: string, situacao: SituacaoItem, over: Partial<AcompanhamentoItem> = {}): AcompanhamentoItem {
  return {
    categoria: categoria as AcompanhamentoItem['categoria'],
    categoriaRotulo: categoria,
    grupo: 'Essenciais',
    percentual: 25,
    valorPlanejado: 1000,
    valorRealizado: situacao === 'estourado' ? 1200 : 850,
    valorRestante: situacao === 'estourado' ? -200 : 150,
    percentualUtilizado: situacao === 'estourado' ? 120 : 85,
    situacao,
    ...over,
  };
}

describe('alertasNovos', () => {
  it('não alerta na primeira verificação, sem base de comparação', () => {
    // Senão, abrir a tela pela primeira vez despejaria um aviso para cada
    // categoria já estourada no passado.
    expect(alertasNovos([item('Moradia', 'estourado')], null)).toEqual([]);
  });

  it('alerta quando uma categoria passa de ok para estourado', () => {
    const anterior = estadoDe([item('Moradia', 'ok')]);
    const alertas = alertasNovos([item('Moradia', 'estourado')], anterior);

    expect(alertas).toHaveLength(1);
    expect(alertas[0].nivel).toBe('estourado');
    expect(alertas[0].excedente).toBe(200);
  });

  it('alerta quando entra em atenção', () => {
    const anterior = estadoDe([item('Lazer', 'ok')]);
    const alertas = alertasNovos([item('Lazer', 'atencao')], anterior);

    expect(alertas).toHaveLength(1);
    expect(alertas[0].nivel).toBe('atencao');
    expect(alertas[0].excedente).toBe(0);
  });

  it('não repete o alerta de uma categoria que já estava estourada', () => {
    const anterior = estadoDe([item('Moradia', 'estourado')]);
    expect(alertasNovos([item('Moradia', 'estourado')], anterior)).toEqual([]);
  });

  it('alerta de novo quando a situação piora de atenção para estourado', () => {
    const anterior = estadoDe([item('Moradia', 'atencao')]);
    const alertas = alertasNovos([item('Moradia', 'estourado')], anterior);

    expect(alertas).toHaveLength(1);
  });

  it('não alerta quando a situação melhora', () => {
    // Excluir um lançamento pode tirar a categoria do vermelho; isso não é aviso.
    const anterior = estadoDe([item('Moradia', 'estourado')]);
    expect(alertasNovos([item('Moradia', 'atencao')], anterior)).toEqual([]);
    expect(alertasNovos([item('Moradia', 'ok')], anterior)).toEqual([]);
  });

  it('alerta uma categoria que não existia no estado anterior', () => {
    const anterior = estadoDe([item('Moradia', 'ok')]);
    const alertas = alertasNovos([item('Moradia', 'ok'), item('Lazer', 'estourado')], anterior);

    expect(alertas.map((a) => a.categoria)).toEqual(['Lazer']);
  });

  it('ignora categorias sem orçamento', () => {
    const anterior = estadoDe([item('Educacao', 'ok')]);
    expect(alertasNovos([item('Educacao', 'sem_orcamento')], anterior)).toEqual([]);
  });

  it('coloca os estouros antes dos avisos de atenção', () => {
    const anterior = estadoDe([item('Lazer', 'ok'), item('Moradia', 'ok')]);
    const alertas = alertasNovos(
      [item('Lazer', 'atencao'), item('Moradia', 'estourado')],
      anterior,
    );

    expect(alertas.map((a) => a.nivel)).toEqual(['estourado', 'atencao']);
  });

  it('arredonda o excedente em centavos', () => {
    const anterior = estadoDe([item('Moradia', 'ok')]);
    const alertas = alertasNovos(
      [item('Moradia', 'estourado', { valorPlanejado: 1000.1, valorRealizado: 1200.35 })],
      anterior,
    );

    expect(alertas[0].excedente).toBe(200.25);
  });

  it('lista vazia não gera alerta', () => {
    expect(alertasNovos([], estadoDe([item('Moradia', 'ok')]))).toEqual([]);
  });
});

describe('mensagemDoAlerta', () => {
  it('diz quanto passou, num estouro', () => {
    const anterior = estadoDe([item('Moradia', 'ok')]);
    const [alerta] = alertasNovos([item('Moradia', 'estourado')], anterior);

    const msg = mensagemDoAlerta(alerta);
    expect(msg).toContain('passou do orçamento');
    expect(msg).toContain('200,00');
  });

  it('diz quanto já foi usado, num aviso de atenção', () => {
    const anterior = estadoDe([item('Lazer', 'ok')]);
    const [alerta] = alertasNovos([item('Lazer', 'atencao')], anterior);

    expect(mensagemDoAlerta(alerta)).toContain('850,00');
  });
});

describe('chaveDoEstado', () => {
  it('separa por competência, com mês de dois dígitos', () => {
    // Sem isso o estado de agosto silenciaria um alerta legítimo de setembro.
    expect(chaveDoEstado(2026, 8)).toBe('financas:orcamento:estado:2026-08');
    expect(chaveDoEstado(2026, 12)).toBe('financas:orcamento:estado:2026-12');
    expect(chaveDoEstado(2026, 8)).not.toBe(chaveDoEstado(2026, 9));
  });
});
