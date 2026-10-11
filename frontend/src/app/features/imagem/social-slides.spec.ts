import { Overlay, PhotoOverlay, ShapeOverlay, TextOverlay } from './social-overlays';
import { clearSlidePhotos, spotFromSlot, duplicateSlide, insertBlank, insertForeignPage, moveSlide, removeSlide } from './social-slides';
import { slideOf } from './social-photo-slots';

const text = (id: string, page: number, slides: number, size = 0.1): TextOverlay => ({
  id, kind: 'texto', text: id, x: (page + 0.5) / slides, y: 0.5, size, rotation: 0,
  fontId: 'montserrat', bold: false, color: '#000', style: 'simples', accent: '#f00',
});
const spot = (id: string, page: number, slides: number): ShapeOverlay => ({
  id, kind: 'forma', shape: 'retangulo', x: (page + 0.5) / slides, y: 0.5, size: 0.5, rotation: 0, aspect: 1,
  fill: '', stroke: '', strokeWidth: 0.01, radius: 0.02, placeholder: true,
});
const photo = (id: string, slotId: string, page: number, slides: number): PhotoOverlay => ({
  id, kind: 'foto', src: 'data:', x: (page + 0.5) / slides, y: 0.5, size: 0.5, rotation: 0, aspect: 1,
  radius: 0, border: '', borderWidth: 0, slotId,
});
const pages = (o: Overlay[], n: number) => o.map((x) => `${x.id}@${slideOf(x, n)}`);
const strip = (overlays: Overlay[], slides: number) => ({ overlays, slides, slot: null, guides: [] });
const RATIO = 4 / 5;

describe('posts do carrossel', () => {
  const base = [text('a', 0, 3), spot('s', 1, 3), photo('f', 's', 1, 3), text('c', 2, 3)];

  it('tira um post e o que vem depois anda pra trás', () => {
    const r = removeSlide(strip(base, 3), 1, RATIO);
    expect(r.slides).toBe(2);
    expect(pages(r.overlays, 2)).toEqual(['a@0', 'c@1']);
    // Carrossel é medido pela altura: o tamanho não muda.
    expect(r.overlays[0].size).toBeCloseTo(0.1);
  });

  it('voltar a um post só mede pela largura (retrato): a letra é reescalada', () => {
    const r = removeSlide(strip([text('a', 0, 2), text('b', 1, 2)], 2), 1, RATIO);
    expect(r.slides).toBe(1);
    expect(r.overlays[0].size).toBeCloseTo(0.1 / RATIO);
    expect(r.overlays[0].x).toBeCloseTo(0.5);
  });

  it('move um post pro lado', () => {
    const r = moveSlide(strip(base, 3), 2, -1, RATIO);
    expect(pages(r.overlays, 3)).toEqual(['a@0', 's@2', 'f@2', 'c@1']);
    expect(moveSlide(strip(base, 3), 0, -1, RATIO).overlays).toBe(base);
  });

  it('duplica um post com o espaço e a foto ligados', () => {
    const r = duplicateSlide(strip(base, 3), 1, RATIO);
    expect(r.slides).toBe(4);
    const copies = r.overlays.filter((o) => slideOf(o, 4) === 2);
    const sp = copies.find((o) => o.kind === 'forma')!;
    const ph = copies.find((o) => o.kind === 'foto') as PhotoOverlay;
    expect(sp.id).not.toBe('s');
    expect(ph.slotId).toBe(sp.id);
    expect(pages(r.overlays, 4).filter((p) => p.startsWith('c'))).toEqual(['c@3']);
  });

  it('duplica sem a foto pra receber outra', () => {
    const r = duplicateSlide(strip(base, 3), 1, RATIO, false);
    expect(r.overlays.filter((o) => o.kind === 'foto').length).toBe(1);
  });

  it('abre post em branco no começo', () => {
    const r = insertBlank(strip(base, 3), -1, 1, RATIO);
    expect(pages(r.overlays, 4)[0]).toBe('a@1');
  });

  it('traz a página de outro modelo no tamanho certo', () => {
    const other = [text('x', 0, 6, 0.08), text('y', 4, 6, 0.08)];
    const r = insertForeignPage(strip(base, 3), 0, { overlays: other, slides: 6 }, 4, RATIO);
    expect(r.slides).toBe(4);
    const y = r.overlays.find((o) => o.kind === 'texto' && o.text === 'y')!;
    expect(slideOf(y, 4)).toBe(1);
    expect(y.size).toBeCloseTo(0.08);
    expect(r.overlays.some((o) => o.kind === 'texto' && o.text === 'x')).toBe(false);
  });

  it('tirar o post do espaço leva a foto junto; tirar só a foto deixa o espaço', () => {
    expect(removeSlide(strip(base, 3), 1, RATIO).overlays.some((o) => o.id === 'f')).toBe(false);
    expect(clearSlidePhotos(base, 3, 1).map((o) => o.id)).toEqual(['a', 's', 'c']);
  });

  it('o espaço principal da foto anda com o post dele', () => {
    const slot = { x: 0.02, y: 0.1, w: 0.3, h: 0.8, radius: 0.03 };
    const moved = moveSlide({ overlays: [], slides: 3, slot, guides: [] }, 0, 1, RATIO);
    expect(moved.slot!.x).toBeCloseTo(1 / 3 + 0.02);
    expect(removeSlide({ overlays: [], slides: 3, slot, guides: [] }, 0, RATIO).slot).toBeNull();
  });

  it('duplicar o post da foto principal leva a área da foto (e a foto) pra cópia', () => {
    const slot = { x: 0.02, y: 0.05, w: 0.3, h: 0.8, radius: 0.03 };
    const r = duplicateSlide({ overlays: [], slides: 3, slot, guides: [] }, 0, RATIO, true, { src: 'data:x', aspect: 1 });
    expect(r.slides).toBe(4);
    const spot = r.overlays.find((o) => o.kind === 'forma') as ShapeOverlay;
    expect(spot.placeholder).toBe(true);
    expect(slideOf(spot, 4)).toBe(1);
    const ph = r.overlays.find((o) => o.kind === 'foto') as PhotoOverlay;
    expect(ph.slotId).toBe(spot.id);
    // Mesma caixa do espaço principal, um post pra frente.
    const sp = spotFromSlot(r, RATIO, 0);
    expect(spot.size).toBeCloseTo(sp.size);
    expect(spot.aspect).toBeCloseTo(sp.aspect);
    expect(duplicateSlide({ overlays: [], slides: 3, slot, guides: [] }, 0, RATIO, false).overlays.some((o) => o.kind === 'foto')).toBe(false);
  });
});
