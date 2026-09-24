import { describe, expect, it } from 'vitest';
import { FontLibrary } from './fonts';
import { PathLayer, ShapeLayer, flattenPath } from './illustration-model';
import { IllustrationStore } from './illustration-store';
import { polygonArea } from './contour';

function store(): IllustrationStore {
  return new IllustrationStore(new FontLibrary());
}

function squareAt(s: IllustrationStore, x: number, y: number, size = 10): ShapeLayer {
  const l = s.newShape('retangulo', x, y, size, size);
  s.addLayers([l]);
  return l;
}

describe('IllustrationStore', () => {
  it('desfaz e refaz, e arrasto vira um passo só', () => {
    const s = store();
    const a = squareAt(s, 20, 20);
    s.begin();
    for (let i = 1; i <= 5; i++) s.patch(a.id, { x: 20 + i }, false);
    s.end();
    expect(s.layer(a.id)!.x).toBe(25);
    s.undo();
    expect(s.layer(a.id)!.x).toBe(20);
    s.undo();
    expect(s.layers()).toHaveLength(0);
    s.redo();
    s.redo();
    expect(s.layer(a.id)!.x).toBe(25);
    expect(s.canRedo()).toBe(false);
  });

  it('arrasto sem mudança não entra no histórico', () => {
    const s = store();
    squareAt(s, 20, 20);
    s.begin();
    s.end();
    s.undo();
    expect(s.layers()).toHaveLength(0);
  });

  it('clique num membro seleciona o grupo inteiro', () => {
    const s = store();
    const a = squareAt(s, 10, 10);
    const b = squareAt(s, 40, 10);
    s.selectedIds.set([a.id, b.id]);
    s.group();
    s.select(a.id);
    expect(new Set(s.selectedIds())).toEqual(new Set([a.id, b.id]));
    expect(s.primary()!.id).toBe(a.id);
  });

  it('alinha à prancheta com uma peça e entre si com várias', () => {
    const s = store();
    const a = squareAt(s, 30, 30);
    s.select(a.id);
    s.align('hcenter');
    expect(s.layer(a.id)!.x).toBeCloseTo(100);
    const b = squareAt(s, 150, 80, 20);
    s.selectedIds.set([a.id, b.id]);
    s.align('top');
    expect(s.worldBounds(s.layer(a.id)!).minY).toBeCloseTo(25);
    expect(s.worldBounds(s.layer(b.id)!).minY).toBeCloseTo(25);
  });

  it('distribui com o mesmo espaço entre as peças', () => {
    const s = store();
    const a = squareAt(s, 10, 50, 10);
    const b = squareAt(s, 30, 50, 20);
    const c = squareAt(s, 100, 50, 10);
    s.selectedIds.set([a.id, b.id, c.id]);
    s.distribute('h');
    const [ba, bb, bc] = [a, b, c].map((l) => s.worldBounds(s.layer(l.id)!));
    expect(bb.minX - ba.maxX).toBeCloseTo(bc.minX - bb.maxX, 6);
  });

  it('solda as selecionadas numa camada de caminho, no lugar da de baixo', () => {
    const s = store();
    const back = squareAt(s, 100, 100, 50);
    const a = squareAt(s, 20, 20);
    const b = squareAt(s, 25, 20);
    s.selectedIds.set([a.id, b.id]);
    expect(s.combine('unir')).toBe(true);
    expect(s.layers()).toHaveLength(2);
    expect(s.layers()[0].id).toBe(back.id);
    const u = s.layers()[1] as PathLayer;
    expect(u.kind).toBe('caminho');
    const b2 = s.worldBounds(u);
    expect(b2.maxX - b2.minX).toBeCloseTo(15, 1);
    expect(Math.abs(polygonArea(flattenPath(s.worldPaths(u)[0], 0.05)))).toBeCloseTo(150, 0);
  });

  it('contorno de corte vai pro fundo, marcado como corte', () => {
    const s = store();
    squareAt(s, 50, 50, 10);
    s.select(null);
    expect(s.outline(2, true)).toBe(true);
    const c = s.layers()[0];
    expect(c.cut).toBe(true);
    expect(c.fill).toBeNull();
    const b = s.worldBounds(c);
    expect(b.maxX - b.minX).toBeCloseTo(14, 1);
  });

  it('separar formas mantém cada ilha no mesmo lugar da prancheta', () => {
    const s = store();
    const a = squareAt(s, 20, 20);
    const b = squareAt(s, 60, 20);
    s.selectedIds.set([a.id, b.id]);
    s.combine('unir');
    s.patch(s.selectedIds()[0], { rotation: 30, scaleX: 2 });
    const before = s.worldBounds(s.layer(s.selectedIds()[0])!);
    s.breakApart();
    expect(s.layers()).toHaveLength(2);
    const after = s.layers().map((l) => s.worldBounds(l)).reduce((acc, x) => ({
      minX: Math.min(acc.minX, x.minX), minY: Math.min(acc.minY, x.minY), maxX: Math.max(acc.maxX, x.maxX), maxY: Math.max(acc.maxY, x.maxY),
    }));
    expect(after.minX).toBeCloseTo(before.minX, 3);
    expect(after.maxY).toBeCloseTo(before.maxY, 3);
  });

  it('converter forma em caminho preserva a geometria e o transform', () => {
    const s = store();
    const a = s.newShape('estrela', 50, 50, 30, 30);
    s.addLayers([{ ...a, rotation: 15 }]);
    const before = s.worldBounds(s.layer(a.id)!);
    s.convertToPath([a.id]);
    const p = s.layer(a.id)!;
    expect(p.kind).toBe('caminho');
    expect(p.rotation).toBe(15);
    const after = s.worldBounds(p);
    expect(after.minX).toBeCloseTo(before.minX, 6);
  });

  it('troca de cor em tudo e paleta do documento', () => {
    const s = store();
    const a = squareAt(s, 10, 10);
    s.patch(a.id, { fill: '#FF0000', stroke: '#00ff00' });
    expect(s.palette()).toEqual(['#ff0000', '#00ff00']);
  });

  it('salva e reabre o projeto com coordenadas compactas', () => {
    const s = store();
    squareAt(s, 10, 10);
    const pen = s.newPathLayer('p', [{ start: [1.123456789, 2], closed: false, segments: [{ c1: null, c2: null, to: [5.987654321, 7] }] }]);
    s.addLayers([pen]);
    s.setDocSize(300, 150);
    const data = JSON.parse(JSON.stringify(s.serialize()));
    const t = store();
    t.hydrate(data);
    expect(t.widthMm()).toBe(300);
    expect(t.heightMm()).toBe(150);
    expect(t.layers()).toHaveLength(2);
    const p = t.layers()[1] as PathLayer;
    expect(String(p.paths[0].start[0]).length).toBeLessThanOrEqual(6);
    expect(t.canUndo()).toBe(false);
  });

  it('documento vazio não gera seção no projeto', () => {
    expect(store().serialize()).toBeNull();
  });
});
