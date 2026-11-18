import { describe, expect, it } from 'vitest';
import { barrasDoDia, dataLocal, heatmap, nivelDia, porRefeicao, rotuloData, somarDias, valoresDaPorcao } from './dieta-calc';
import { Registro } from './dieta.models';

const reg = (p: Partial<Registro>): Registro => ({
  id: 'r', data: '2026-11-18', refeicao: 'almoco', alimentoId: null, nome: 'Arroz', quantidadeG: 100, kcal: 128, proteina: 2.5,
  carbo: 28, gordura: 0.2, fibra: 1.6, fotoId: null, createdAt: '', updatedAt: '', deletedAt: null, ...p,
});

describe('datas da Dieta', () => {
  it('usa a data local, não UTC', () => {
    expect(dataLocal(new Date(2026, 10, 18, 23, 30))).toBe('2026-11-18');
  });

  it('soma dias atravessando o mês', () => {
    expect(somarDias('2026-11-30', 1)).toBe('2026-12-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rótulos relativos', () => {
    expect(rotuloData('2026-11-18', '2026-11-18')).toBe('Hoje');
    expect(rotuloData('2026-11-17', '2026-11-18')).toBe('Ontem');
  });
});

describe('dia da Dieta', () => {
  it('agrupa por refeição e ignora excluídos', () => {
    const grupos = porRefeicao([reg({ id: 'a' }), reg({ id: 'b', refeicao: 'cafe', kcal: 50 }), reg({ id: 'c', deletedAt: 'x' })]);
    expect(grupos.map((g) => g.itens.length)).toEqual([1, 1, 0, 0, 0]);
    expect(grupos[1].kcal).toBe(128);
  });

  it('barras contra a meta', () => {
    const b = barrasDoDia({ kcal: 1000, proteina: 50, carbo: 0, gordura: 0, aguaMl: 2000 }, { kcal: 2000, proteinaG: 100, carboG: 0, gorduraG: 60, aguaMl: 2000 });
    expect(b.map((x) => x.pct)).toEqual([50, 50, 0, 0, 100]);
  });

  it('porção a partir de 100 g', () => {
    expect(valoresDaPorcao({ kcal: 128, proteina: 2.5, carbo: 28, gordura: 0.2 }, 150).kcal).toBeCloseTo(192);
  });

  it('nível do dia igual ao servidor', () => {
    expect(nivelDia({ registros: 0, kcalNaMeta: true, proteinaNaMeta: true, aguaNaMeta: true })).toBe(0);
    expect(nivelDia({ registros: 3, kcalNaMeta: true, proteinaNaMeta: false, aguaNaMeta: true })).toBe(3);
  });
});

describe('heatmap', () => {
  it('monta semanas com domingo em cima e marca o futuro', () => {
    // 18/11/2026 é quarta
    const h = heatmap([{ data: '2026-11-16', nivel: 2 }], 2, '2026-11-18');
    expect(h).toHaveLength(2);
    expect(h[1][0].data).toBe('2026-11-15');
    expect(h[1][1].nivel).toBe(2);
    expect(h[1][4].futuro).toBe(true);
    expect(h[0][0].data).toBe('2026-11-08');
  });
});
