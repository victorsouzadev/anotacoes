import { describe, expect, it } from 'vitest';
import { aparar, ocorrencias, partir } from './trechos';

describe('partir', () => {
  it('preserva a posição original de cada pedaço, com as tags no meio', () => {
    const texto = 'NOME: ANA<BR>FONE';
    const pedacos = partir(texto, [{ id: 1, tipo: 'PERSON', inicio: 6, fim: 9, removida: false }]);
    for (const p of pedacos) expect(texto.slice(p.inicio, p.inicio + p.texto.length)).toBe(p.texto);
    expect(pedacos.map((p) => p.kind)).toEqual(['texto', 'marca', 'texto', 'texto']);
    expect(pedacos[2]).toMatchObject({ texto: '<BR>', tag: true, quebra: true });
  });

  it('ignora no texto uma marcação sobreposta a outra', () => {
    const pedacos = partir('ANA PRADO', [
      { id: 1, tipo: 'PERSON', inicio: 0, fim: 9, removida: false },
      { id: 2, tipo: 'PERSON', inicio: 4, fim: 9, removida: false },
    ]);
    expect(pedacos.filter((p) => p.kind === 'marca')).toHaveLength(1);
  });
});

describe('ocorrencias', () => {
  it('acha todas as repetições sem cortar palavras', () => {
    expect(ocorrencias('TIM, TIMBIRAS E TIM', 'TIM')).toEqual([[0, 3], [16, 19]]);
  });

  it('aceita número colado em letra', () => {
    expect(ocorrencias('9BD341QUE', '9BD341')).toEqual([[0, 6]]);
  });
});

describe('aparar', () => {
  it('tira os espaços das pontas da seleção', () => {
    expect(aparar('  ANA  ', 0, 7)).toEqual([2, 5]);
  });
});
