import { ALIGN_MARGIN, FracBox, aabb, alignDelta, anchorForAlign, slideRange, snapBox } from './social-align';

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
