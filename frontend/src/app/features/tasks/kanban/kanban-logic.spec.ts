import { describe, expect, it } from 'vitest';
import { reorderIds } from './kanban-logic';

describe('reorderIds', () => {
  it('move o item arrastado para antes do alvo', () => {
    expect(reorderIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  it('move o item arrastado para o fim quando alvo é null', () => {
    expect(reorderIds(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
  });

  it('coloca no fim se o alvo não existir na lista', () => {
    expect(reorderIds(['a', 'b'], 'a', 'inexistente')).toEqual(['b', 'a']);
  });

  it('não duplica o item arrastado', () => {
    const result = reorderIds(['a', 'b', 'c'], 'b', 'c');
    expect(result.filter((id) => id === 'b')).toHaveLength(1);
    expect(result).toEqual(['a', 'b', 'c']);
  });
});
