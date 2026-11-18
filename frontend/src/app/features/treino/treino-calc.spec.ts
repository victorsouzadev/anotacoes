import { describe, expect, it } from 'vitest';
import { duracao, inicioDaSemana, km, porSemana, ritmo, totais } from './treino-calc';
import { Atividade } from './treino.models';

const at = (p: Partial<Atividade>): Atividade => ({
  id: 'a', inicio: '2026-11-17T10:00:00Z', tipo: 'livre', titulo: 'Corrida', duracaoSeg: 1800, distanciaM: 5000,
  maiorCorridaSeg: null, esforco: null, dor: false, meta: null, fcMedia: null, fcMax: null, nota: null,
  updatedAt: '', deletedAt: null, ...p,
});

describe('formatos iguais ao MCP', () => {
  it('km, duração e ritmo', () => {
    expect(km(5230)).toBe('5,23 km');
    expect(duracao(1805)).toBe('30:05');
    expect(duracao(3725)).toBe('1h02');
    expect(ritmo({ duracaoSeg: 1800, distanciaM: 5000 })).toBe('6:00/km');
    expect(ritmo({ duracaoSeg: 600, distanciaM: 50 })).toBeNull();
  });
});

describe('totais', () => {
  const agora = new Date('2026-11-18T12:00:00Z');
  const lista = [
    at({ id: '1', inicio: '2026-11-17T10:00:00Z', esforco: 6 }),
    at({ id: '2', inicio: '2026-11-05T10:00:00Z', distanciaM: 3000, duracaoSeg: 1200, esforco: 8, dor: true }),
    at({ id: '3', inicio: '2026-11-16T10:00:00Z', deletedAt: 'x' }),
  ];

  it('janela de 7 e 30 dias, sem excluídas', () => {
    const t7 = totais(lista, 7, agora);
    expect([t7.treinos, t7.metros, t7.segundos, t7.esforcoMedio]).toEqual([1, 5000, 1800, 6]);
    const t30 = totais(lista, 30, agora);
    expect([t30.treinos, t30.metros, t30.esforcoMedio, t30.comDor]).toEqual([2, 8000, 7, 1]);
  });

  it('agrupa por semana começando na segunda', () => {
    expect(inicioDaSemana(new Date(2026, 10, 18))).toBe('2026-11-16');
    expect(inicioDaSemana(new Date(2026, 10, 22))).toBe('2026-11-16');
    const s = porSemana(lista, 3, new Date(2026, 10, 18, 12));
    expect(s.map((x) => x.semana)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(s[2].km).toBe(5);
    expect(s[0].km).toBe(3);
    expect(s[2].ritmoSegKm).toBe(360);
  });
});
