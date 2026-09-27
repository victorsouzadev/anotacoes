import { ALIGN_MARGIN, FracBox, aabb, alignDelta, alignWithin, anchorForAlign, distribute, gridLines, groupBox, slideRange, snapBox } from './social-align';

const box = (over: Partial<FracBox> = {}): FracBox => ({ id: 'a', cx: 0.3, cy: 0.4, w: 0.2, h: 0.1, rotation: 0, ...over });

describe('alinhamento das camadas', () => {
  it('acha o post do carrossel em que a camada está', () => {
    expect(slideRange(0.1, 1)).toEqual([0, 1]);
    expect(slideRange(0.5, 3)).toEqual([1 / 3, 2 / 3]);
    expect(slideRange(1, 3)).toEqual([2 / 3, 1]);
  });

  it('encosta nas bordas respeitando a margem e centraliza', () => {
    const b = box();
    const left = alignDelta(b, 'left', 1, 1);
    expect(b.cx - b.w / 2 + left.dx).toBeCloseTo(ALIGN_MARGIN, 6);
    const right = alignDelta(b, 'right', 1, 1);
    expect(b.cx + b.w / 2 + right.dx).toBeCloseTo(1 - ALIGN_MARGIN, 6);
    expect(b.cx + alignDelta(b, 'hcenter', 1, 1).dx).toBeCloseTo(0.5, 6);
    expect(b.cy + alignDelta(b, 'vcenter', 1, 1).dy).toBeCloseTo(0.5, 6);
    // story (9:16): a margem de cima é a mesma em px, então menor em fração da altura
    const top = alignDelta(b, 'top', 1, 9 / 16);
    expect(b.cy - b.h / 2 + top.dy).toBeCloseTo(ALIGN_MARGIN * (9 / 16), 6);
  });

  it('no carrossel, centraliza no post da camada, não na faixa', () => {
    const b = box({ cx: 0.45, w: 0.05 }); // segundo de três posts
    expect(b.cx + alignDelta(b, 'hcenter', 3, 1).dx).toBeCloseTo(0.5, 6);
    const b2 = box({ cx: 0.8, w: 0.05 }); // terceiro post
    expect(b2.cx + alignDelta(b2, 'hcenter', 3, 1).dx).toBeCloseTo(5 / 6, 6);
  });

  it('usa a caixa girada pra encostar', () => {
    const r = aabb(box({ w: 0.2, h: 0.2, rotation: 90 }), 1);
    expect(r.r - r.l).toBeCloseTo(0.2, 6);
    const giro = aabb(box({ w: 0.4, h: 0.1, rotation: 90 }), 1);
    expect(giro.r - giro.l).toBeCloseTo(0.1, 6);
    expect(giro.b - giro.t).toBeCloseTo(0.4, 6);
  });

  it('gruda no centro do post e nas outras camadas, dentro do limite', () => {
    const quase = box({ cx: 0.505, cy: 0.2 });
    const r = snapBox(quase, [], 1, 1, 0.01, 0.01);
    expect(r.dx).toBeCloseTo(-0.005, 6);
    expect(r.guides).toContainEqual({ axis: 'x', pos: 0.5 });

    const outra = box({ id: 'b', cx: 0.7, cy: 0.3, w: 0.2, h: 0.1 });
    const perto = box({ cx: 0.2, cy: 0.305, w: 0.1, h: 0.1 });
    const s = snapBox(perto, [outra], 1, 1, 0.01, 0.01);
    expect(perto.cy + s.dy).toBeCloseTo(0.3, 6);

    const longe = snapBox(box({ cx: 0.3, cy: 0.2 }), [], 1, 1, 0.01, 0.01);
    expect(longe.dx).toBe(0);
    expect(longe.guides.filter((g) => g.axis === 'x')).toEqual([]);
  });

  it('troca o alinhamento do texto sem mover a caixa', () => {
    const b = box({ cx: 0.5, w: 0.4 });
    expect(anchorForAlign(b, 'left', 0.01)).toBeCloseTo(0.31, 6);
    expect(anchorForAlign(b, 'right', 0.01)).toBeCloseTo(0.69, 6);
    expect(anchorForAlign(b, 'center', 0.01)).toBe(0.5);
  });
});

describe('alinhamento entre várias camadas', () => {
  const b = (id: string, cx: number, cy: number, w = 0.1, h = 0.1): FracBox => ({ id, cx, cy, w, h, rotation: 0 });

  it('alinha pelas esquerdas, centros e bases da caixa do grupo', () => {
    const boxes = [b('a', 0.2, 0.2), b('c', 0.5, 0.6, 0.2, 0.2)];
    const left = alignWithin(boxes, 'left', 1);
    expect(0.5 - 0.1 + left.get('c')!.dx).toBeCloseTo(0.15, 6);
    expect(left.get('a')!.dx).toBeCloseTo(0, 6);
    const bottom = alignWithin(boxes, 'bottom', 1);
    expect(0.2 + 0.05 + bottom.get('a')!.dy).toBeCloseTo(0.7, 6);
    const centro = alignWithin(boxes, 'hcenter', 1);
    expect(0.2 + centro.get('a')!.dx).toBeCloseTo(0.5 + centro.get('c')!.dx, 6);
    expect(alignWithin([boxes[0]], 'left', 1).size).toBe(0);
  });

  it('distribui com espaço igual sem mexer nas pontas', () => {
    const boxes = [b('a', 0.1, 0.5), b('b', 0.3, 0.5), b('c', 0.9, 0.5)];
    const d = distribute(boxes, 'x', 1);
    expect(d.get('a')!.dx).toBeCloseTo(0, 6);
    expect(d.get('c')!.dx).toBeCloseTo(0, 6);
    // pontas em 0.05..0.95, três de 0.1: espaço (0.9 - 0.3) / 2 = 0.3
    expect(0.3 + d.get('b')!.dx).toBeCloseTo(0.5, 6);
    expect(distribute(boxes.slice(0, 2), 'x', 1).size).toBe(0);
  });

  it('caixa do grupo envolve todas', () => {
    const g = groupBox([b('a', 0.2, 0.2), b('c', 0.6, 0.7)], 1);
    expect(g.cx).toBeCloseTo(0.4, 6);
    expect(g.w).toBeCloseTo(0.5, 6);
    expect(g.h).toBeCloseTo(0.6, 6);
  });

  it('grade: colunas em cada post, entre as margens, e ímã nas linhas dela', () => {
    const { xs, ys } = gridLines(2, 1, 4, 3);
    expect(xs.length).toBe(10);
    expect(xs[0]).toBeCloseTo(ALIGN_MARGIN / 2, 6);
    expect(xs[4]).toBeCloseTo(0.5 - ALIGN_MARGIN / 2, 6);
    expect(ys.length).toBe(4);
    const r = snapBox(b('m', 0.18, 0.3), [], 2, 1, 0.02, 0.02, { xs: [0.195], ys: [] });
    expect(r.dx).toBeCloseTo(0.015, 6);
  });
});
