import { describe, expect, it } from 'vitest';
import { nomeDoLink, pareceLink } from './entrada-imagem';

describe('entrada de imagem', () => {
  it('reconhece link colado', () => {
    expect(pareceLink('https://br.pinterest.com/pin/123/')).toBe(true);
    expect(pareceLink('  http://site.com/a.png ')).toBe(true);
    expect(pareceLink('caixa milk 8x8')).toBe(false);
    expect(pareceLink('javascript:alert(1)')).toBe(false);
    expect(pareceLink('https://a.com/x y')).toBe(false);
  });

  it('dá nome curto ao arquivo baixado', () => {
    expect(nomeDoLink('https://i.pinimg.com/originals/aa/bb/molde-caixa.jpg')).toBe('molde-caixa');
    expect(nomeDoLink('https://br.pinterest.com/pin/123456/')).toBe('123456');
    expect(nomeDoLink('https://site.com/')).toBe('site.com');
    expect(nomeDoLink('não é link')).toBe('imagem');
  });
});
