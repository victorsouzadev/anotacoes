import { describe, expect, it } from 'vitest';
import { NoteRecord } from '../../data/models';
import { contarTags, diasRestantes, filtrarNotas, normalizarTags } from './notes-filter';

function nota(p: Partial<NoteRecord>): NoteRecord {
  return {
    id: p.id ?? 'n', folderId: null, title: 'Sem título', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    pages: [{ id: 'p', elements: [] }], deletedAt: null, dirty: false, ...p,
  };
}

describe('filtrarNotas', () => {
  const notas = [
    nota({ id: 'a', title: 'Mercado', folderId: 'casa', updatedAt: '2026-01-03T00:00:00Z' }),
    nota({ id: 'b', title: 'Provas', updatedAt: '2026-01-02T00:00:00Z',
      pages: [{ id: 'p', elements: [{ id: 'c', type: 'checklist', x: 0, y: 0, w: 1, h: 1, color: '', fontSize: 12, zIndex: 0, rotation: 0,
        items: [{ id: 'i', text: 'Estudar cálculo', checked: false }] }] }] }),
    nota({ id: 'lixo', title: 'Mercado antigo', trashedAt: '2026-01-05T00:00:00Z' }),
    nota({ id: 'morta', title: 'Mercado morto', deletedAt: '2026-01-05T00:00:00Z' }),
  ];

  it('esconde lixeira e tombstones', () => {
    expect(filtrarNotas(notas, { pasta: null, busca: 'mercado', ordem: 'updated' }).map((n) => n.id)).toEqual(['a']);
  });

  it('acha pelo conteúdo do checklist', () => {
    expect(filtrarNotas(notas, { pasta: null, busca: 'cálculo', ordem: 'updated' }).map((n) => n.id)).toEqual(['b']);
  });

  it('filtra por pasta e ordena', () => {
    expect(filtrarNotas(notas, { pasta: 'casa', busca: '', ordem: 'updated' }).map((n) => n.id)).toEqual(['a']);
    expect(filtrarNotas(notas, { pasta: null, busca: '', ordem: 'title' }).map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('diasRestantes', () => {
  it('conta a partir da exclusão', () => {
    const agora = new Date('2026-01-11T00:00:00Z');
    expect(diasRestantes('2026-01-11T00:00:00Z', agora)).toBe(30);
    expect(diasRestantes('2026-01-01T00:00:00Z', agora)).toBe(20);
    expect(diasRestantes('2025-11-01T00:00:00Z', agora)).toBe(0);
  });
});

describe('tags', () => {
  const notas = [
    nota({ id: 'a', title: 'A', tags: ['faculdade', 'provas'] }),
    nota({ id: 'b', title: 'B', tags: ['provas'], folderId: 'outra' }),
    nota({ id: 'c', title: 'C', tags: ['provas'], trashedAt: '2026-01-01T00:00:00Z' }),
  ];

  it('normaliza', () => {
    expect(normalizarTags([' Faculdade ', 'faculdade', '', 'PROVAS'])).toEqual(['faculdade', 'provas']);
    expect(normalizarTags(Array.from({ length: 25 }, (_, i) => `t${i}`))).toHaveLength(20);
    expect(normalizarTags(['x'.repeat(50)])[0]).toHaveLength(40);
  });

  it('filtra com E entre as tags, em qualquer pasta', () => {
    expect(filtrarNotas(notas, { pasta: null, busca: '', ordem: 'title', tags: ['provas'] }).map((n) => n.id)).toEqual(['a', 'b']);
    expect(filtrarNotas(notas, { pasta: null, busca: '', ordem: 'title', tags: ['provas', 'faculdade'] }).map((n) => n.id)).toEqual(['a']);
  });

  it('a busca acha pela tag', () => {
    expect(filtrarNotas(notas, { pasta: null, busca: 'facul', ordem: 'title' }).map((n) => n.id)).toEqual(['a']);
  });

  it('conta sem a lixeira', () => {
    expect(contarTags(notas)).toEqual([{ tag: 'faculdade', total: 1 }, { tag: 'provas', total: 2 }]);
  });
});
