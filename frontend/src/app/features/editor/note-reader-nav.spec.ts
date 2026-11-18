import { describe, expect, it } from 'vitest';
import { acaoDaTecla, acaoDoGesto, acaoDoToque, navegar } from './note-reader-nav';

describe('modo leitura: navegação', () => {
  it('não dá a volta nas pontas', () => {
    expect(navegar(0, 3, 'anterior')).toBe(0);
    expect(navegar(2, 3, 'proxima')).toBe(2);
    expect(navegar(1, 3, 'proxima')).toBe(2);
    expect(navegar(1, 3, 'primeira')).toBe(0);
    expect(navegar(0, 3, 'ultima')).toBe(2);
    expect(navegar(0, 0, 'proxima')).toBe(0);
  });

  it('mapeia teclas', () => {
    expect(acaoDaTecla('ArrowRight')).toBe('proxima');
    expect(acaoDaTecla('PageUp')).toBe('anterior');
    expect(acaoDaTecla('End')).toBe('ultima');
    expect(acaoDaTecla('a')).toBeNull();
  });

  it('toque nas bordas', () => {
    expect(acaoDoToque(10, 1000)).toBe('anterior');
    expect(acaoDoToque(990, 1000)).toBe('proxima');
    expect(acaoDoToque(500, 1000)).toBeNull();
  });

  it('deslizar', () => {
    expect(acaoDoGesto(-120, 10, 200)).toBe('proxima');
    expect(acaoDoGesto(120, 10, 200)).toBe('anterior');
    expect(acaoDoGesto(-120, 100, 200)).toBeNull();
    expect(acaoDoGesto(-30, 0, 200)).toBeNull();
    expect(acaoDoGesto(-120, 0, 900)).toBeNull();
  });
});
