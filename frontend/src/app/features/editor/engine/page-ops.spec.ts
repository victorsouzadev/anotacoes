import { describe, expect, it } from 'vitest';
import { NotePage } from '../../../data/models';
import { duplicatePage, movePage } from './page-ops';

describe('duplicatePage', () => {
  const pagina: NotePage = {
    id: 'p1',
    title: 'Mapa',
    elements: [
      { id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', thickness: 1, fill: false, zIndex: 1, rotation: 0 },
      { id: 'b', type: 'shape', shape: 'rect', x: 50, y: 0, w: 10, h: 10, color: '#000', thickness: 1, fill: false, zIndex: 2, rotation: 0 },
      { id: 's', type: 'arrow', from: { x: 10, y: 5 }, to: { x: 50, y: 5 }, fromId: 'a', toId: 'b', fromAnchor: { x: 1, y: 0.5 }, toAnchor: { x: 0, y: 0.5 },
        color: '#000', thickness: 2, startArrow: false, endArrow: true, zIndex: 3, rotation: 0 },
      { id: 'f', type: 'arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, fromId: 'fora', toId: null, fromAnchor: { x: 0, y: 0 },
        color: '#000', thickness: 2, startArrow: false, endArrow: true, zIndex: 4, rotation: 0 },
    ],
  };
  let n = 0;
  const copia = duplicatePage(pagina, () => `novo${++n}`);

  it('gera ids novos e título de cópia', () => {
    expect(copia.id).not.toBe('p1');
    expect(copia.title).toBe('Mapa (cópia)');
    const ids = copia.elements.map((e) => e.id);
    expect(ids.some((id) => ['a', 'b', 's', 'f'].includes(id))).toBe(false);
    expect(new Set(ids).size).toBe(4);
  });

  it('remapeia as setas para as cópias', () => {
    const [a, b, s] = copia.elements;
    expect(s.type === 'arrow' && s.fromId).toBe(a.id);
    expect(s.type === 'arrow' && s.toId).toBe(b.id);
  });

  it('seta ligada a algo de fora fica solta', () => {
    const f = copia.elements[3];
    expect(f.type === 'arrow' && f.fromId).toBeNull();
    expect(f.type === 'arrow' && f.fromAnchor).toBeNull();
  });

  it('não mexe na original', () => {
    expect(pagina.elements[2].id).toBe('s');
    expect(pagina.elements[2].type === 'arrow' && pagina.elements[2].fromId).toBe('a');
  });
});

describe('movePage', () => {
  it('reordena', () => {
    expect(movePage(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(movePage(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(movePage(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
