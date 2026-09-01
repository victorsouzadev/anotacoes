import { describe, expect, it } from 'vitest';
import {
  LinhaDistribuicao,
  ajustarParaCem,
  distribuicaoFechada,
  limitarPercentual,
  percentualDoValor,
  restanteParaCem,
  somaPercentuais,
  valorDaLinha,
} from './distribuicao';

function linha(categoria: string, percentual: number): LinhaDistribuicao {
  return {
    categoria: categoria as LinhaDistribuicao['categoria'],
    rotulo: categoria,
    grupo: 'Essenciais',
    percentual,
  };
}

describe('somaPercentuais', () => {
  it('soma sem ruído de ponto flutuante', () => {
    const linhas = [linha('Moradia', 33.33), linha('Lazer', 33.33), linha('Saude', 33.34)];
    expect(somaPercentuais(linhas)).toBe(100);
  });

  it('trata lista vazia', () => {
    expect(somaPercentuais([])).toBe(0);
  });
});

describe('restanteParaCem', () => {
  it('informa quanto falta', () => {
    expect(restanteParaCem([linha('Moradia', 60), linha('Lazer', 30)])).toBe(10);
  });

  it('fica negativo quando passa de 100', () => {
    expect(restanteParaCem([linha('Moradia', 70), linha('Lazer', 50)])).toBe(-20);
  });
});

describe('distribuicaoFechada', () => {
  it('aceita a soma exata', () => {
    expect(distribuicaoFechada([linha('Moradia', 50), linha('Lazer', 50)])).toBe(true);
  });

  it('recusa uma distribuição incompleta', () => {
    expect(distribuicaoFechada([linha('Moradia', 50), linha('Lazer', 49)])).toBe(false);
  });
});

describe('ajustarParaCem', () => {
  it('completa o que falta', () => {
    const r = ajustarParaCem([linha('Moradia', 50), linha('Lazer', 30)]);
    expect(somaPercentuais(r)).toBe(100);
  });

  it('corta o excedente', () => {
    const r = ajustarParaCem([linha('Moradia', 70), linha('Lazer', 50), linha('Saude', 20)]);
    expect(somaPercentuais(r)).toBe(100);
  });

  it('fecha em 100 mesmo quando a divisão não é exata', () => {
    const r = ajustarParaCem([linha('A', 0), linha('B', 0), linha('C', 0)]);
    expect(somaPercentuais(r)).toBe(100);
  });

  it('nunca gera percentual negativo', () => {
    const r = ajustarParaCem([linha('Moradia', 95), linha('Lazer', 1), linha('Saude', 1)]);
    expect(r.every((l) => l.percentual >= 0)).toBe(true);
    expect(somaPercentuais(r)).toBe(100);
  });

  it('preserva as categorias e a ordem', () => {
    const original = [linha('Moradia', 50), linha('Lazer', 20)];
    const r = ajustarParaCem(original);
    expect(r.map((l) => l.categoria)).toEqual(['Moradia', 'Lazer']);
  });

  it('trata lista vazia', () => {
    expect(ajustarParaCem([])).toEqual([]);
  });
});

describe('conversão entre percentual e reais', () => {
  it('converte percentual em reais', () => {
    expect(valorDaLinha(4000, 25)).toBe(1000);
    expect(valorDaLinha(1234.56, 33.33)).toBe(411.48);
  });

  it('converte reais em percentual', () => {
    expect(percentualDoValor(4000, 1000)).toBe(25);
  });

  it('ida e volta preserva o valor', () => {
    const total = 3500;
    expect(valorDaLinha(total, percentualDoValor(total, 875))).toBe(875);
  });

  it('não divide por zero quando não há valor total', () => {
    expect(percentualDoValor(0, 500)).toBe(0);
  });

  it('limita o percentual a 100 mesmo com um valor acima do total', () => {
    expect(percentualDoValor(1000, 5000)).toBe(100);
  });
});

describe('limitarPercentual', () => {
  it('trava entre 0 e 100', () => {
    expect(limitarPercentual(-5)).toBe(0);
    expect(limitarPercentual(150)).toBe(100);
    expect(limitarPercentual(42.567)).toBe(42.57);
  });

  it('trata entrada não numérica como zero', () => {
    expect(limitarPercentual(NaN)).toBe(0);
  });
});
