import { describe, expect, it } from 'vitest';
import { normalizePriority } from './priority.js';

describe('normalizePriority', () => {
  it('mapeia variações em português', () => {
    expect(normalizePriority('baixa')).toBe('Low');
    expect(normalizePriority('média')).toBe('Medium');
    expect(normalizePriority('media')).toBe('Medium');
    expect(normalizePriority('alta')).toBe('High');
    expect(normalizePriority('urgente')).toBe('High');
  });

  it('mapeia variações em inglês, case-insensitive', () => {
    expect(normalizePriority('Low')).toBe('Low');
    expect(normalizePriority('MEDIUM')).toBe('Medium');
    expect(normalizePriority('High')).toBe('High');
  });

  it('ignora espaços nas bordas', () => {
    expect(normalizePriority('  alta  ')).toBe('High');
  });

  it('retorna Medium para entrada vazia ou desconhecida', () => {
    expect(normalizePriority(undefined)).toBe('Medium');
    expect(normalizePriority('')).toBe('Medium');
    expect(normalizePriority('não sei')).toBe('Medium');
  });
});
