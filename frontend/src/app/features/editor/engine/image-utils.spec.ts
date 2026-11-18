import { describe, expect, it } from 'vitest';
import { cabeNoLimite, cascata, ehImagem } from './image-utils';

describe('inserir imagens na nota', () => {
  it('cascata a partir do ponto solto', () => {
    expect(cascata({ x: 100, y: 50 }, 0)).toEqual({ x: 100, y: 50 });
    expect(cascata({ x: 100, y: 50 }, 2)).toEqual({ x: 148, y: 98 });
  });

  it('respeita o limite de 8 MB da nota', () => {
    const img = 'x'.repeat(1_000_000);
    expect(cabeNoLimite(1_000_000, img)).toBe(true);
    expect(cabeNoLimite(7_500_000, img)).toBe(false);
  });

  it('reconhece imagens, inclusive HEIC sem tipo', () => {
    expect(ehImagem({ name: 'a.png', type: 'image/png' })).toBe(true);
    expect(ehImagem({ name: 'IMG_0001.HEIC', type: '' })).toBe(true);
    expect(ehImagem({ name: 'contrato.pdf', type: 'application/pdf' })).toBe(false);
  });
});
