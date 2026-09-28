import { PhotoOverlay, ShapeOverlay, photoPanDelta, photoRect } from './social-overlays';
import { emptyPlaceholders, fillPhotoSlots, insertSlides, placeholders, slideOf } from './social-photo-slots';
import { SocialStore } from './social-store';
import { SOCIAL_TEMPLATES } from './social-templates';
import { galleryEntries } from './social-templates.service';

const RETRATO = 4 / 5;
const entregas = () => SOCIAL_TEMPLATES.find((t) => t.id === 'vm-carrossel-entregas')!;
const fotos = (n: number) => Array.from({ length: n }, (_, i) => ({ src: `data:image/jpeg;base64,${i}`, aspect: 4 / 3 }));
const fotosDe = (list: { kind: string }[]) => list.filter((o): o is PhotoOverlay => o.kind === 'foto');

describe('carrossel de entregas', () => {
  it('tem capa, um espaço de foto por post de entrega e a chamada', () => {
    const t = entregas();
    expect(t.group).toBe('Carrossel');
    expect(t.photos).toBe(true);
    const look = t.build();
    const spots = placeholders(look.overlays, look.slides);
    expect(spots.length).toBe(look.slides - 2);
    expect(spots.map((p) => slideOf(p, look.slides))).toEqual([1, 2, 3, 4]);
    // espaço vazio fica clicável (não travado)
    expect(spots.every((p) => !p.locked)).toBe(true);
    expect(galleryEntries([]).find((e) => e.id === t.id)!.photos).toBe(true);
  });

  it('põe as fotos nos espaços em ordem, recortadas pro tamanho deles', () => {
    const look = entregas().build();
    const r = fillPhotoSlots(look.overlays, look.slides, fotos(3), RETRATO);
    expect(r.placed).toBe(3);
    expect(r.added).toBe(0);
    expect(r.slides).toBe(look.slides);
    const spots = placeholders(r.overlays, r.slides);
    const placed = fotosDe(r.overlays);
    expect(placed.map((f) => f.slotId)).toEqual(spots.slice(0, 3).map((p) => p.id));
    for (const f of placed) {
      const spot = spots.find((p) => p.id === f.slotId)!;
      expect(f.x).toBe(spot.x);
      expect(f.size).toBe(spot.size);
      expect(f.aspect).toBe(spot.aspect);
      expect(f.natural).toBeCloseTo(4 / 3, 6);
      // logo acima do espaço dele
      expect(r.overlays.indexOf(f)).toBe(r.overlays.indexOf(spot) + 1);
    }
    expect(emptyPlaceholders(r.overlays, r.slides).length).toBe(1);
  });

  it('com mais fotos que espaços, repete a página de entrega antes da chamada', () => {
    const look = entregas().build();
    const r = fillPhotoSlots(look.overlays, look.slides, fotos(7), RETRATO);
    expect(r.added).toBe(3);
    expect(r.slides).toBe(9);
    expect(r.placed).toBe(7);
    const spots = placeholders(r.overlays, r.slides);
    expect(spots.map((p) => slideOf(p, r.slides))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // a chamada (WhatsApp) continua no último post
    const zap = r.overlays.find((o) => o.kind === 'texto' && o.text.includes('99373'))!;
    expect(slideOf(zap, r.slides)).toBe(r.slides - 1);
    // cada post novo tem o nome da festa pra trocar
    for (let s = 5; s <= 7; s++) {
      expect(r.overlays.some((o) => o.kind === 'texto' && o.text === 'festa da Alice' && slideOf(o, r.slides) === s)).toBe(true);
    }
    // ids novos nas cópias
    expect(new Set(r.overlays.map((o) => o.id)).size).toBe(r.overlays.length);
  });

  it('para no teto de posts e diz quantas entraram', () => {
    const look = entregas().build();
    const r = fillPhotoSlots(look.overlays, look.slides, fotos(20), RETRATO, 10);
    expect(r.slides).toBe(10);
    expect(r.placed).toBe(8);
  });

  it('continua de onde parou e começa pelo espaço clicado', () => {
    const look = entregas().build();
    const first = fillPhotoSlots(look.overlays, look.slides, fotos(1), RETRATO);
    const spots = placeholders(first.overlays, first.slides);
    const second = fillPhotoSlots(first.overlays, first.slides, fotos(1), RETRATO, 10, spots[3].id);
    expect(fotosDe(second.overlays).map((f) => f.slotId)).toEqual([spots[0].id, spots[3].id]);
    const third = fillPhotoSlots(second.overlays, second.slides, fotos(2), RETRATO);
    expect(fotosDe(third.overlays).map((f) => f.slotId).sort()).toEqual(spots.map((p) => p.id).sort());
  });

  it('crescer o carrossel mantém cada camada no mesmo lugar do post dela', () => {
    const look = entregas().build();
    const W = 1080, H = 1350;
    const px = (o: { x: number; y: number; size: number }, n: number) => ({
      x: (o.x * n) % 1 * W, y: o.y * H, size: o.size * Math.min(n * W, H),
    });
    const moved = insertSlides(look.overlays, look.slides, 4, 2, RETRATO);
    look.overlays.forEach((o, i) => {
      const a = px(o, look.slides), b = px(moved[i], look.slides + 2);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
      expect(b.size).toBeCloseTo(a.size, 6);
      const s = slideOf(o, look.slides);
      expect(slideOf(moved[i], look.slides + 2)).toBe(s > 4 ? s + 2 : s);
    });
  });

  it('no store: um passo de histórico, e o Ctrl+Z tira fotos e posts novos', () => {
    const store = new SocialStore();
    store.applyTemplate(entregas().build());
    const before = store.overlays();
    const r = store.fillPhotoSlots(fotos(6), 10);
    expect(r).toEqual({ placed: 6, added: 2 });
    expect(store.slides()).toBe(8);
    store.undo();
    expect(store.slides()).toBe(6);
    expect(store.overlays()).toBe(before);
  });

  it('modelo salvo guarda os espaços, mas não as fotos', () => {
    const store = new SocialStore();
    store.applyTemplate(entregas().build());
    store.fillPhotoSlots(fotos(2), 10);
    const kept = store.overlays().filter((o) => o.kind !== 'foto');
    expect(kept.filter((o) => (o as ShapeOverlay).placeholder).length).toBe(4);
  });
});

describe('foto dentro da caixa', () => {
  it('sem proporção natural, ocupa a caixa', () => {
    expect(photoRect({ aspect: 4 / 3 }, 400, 300)).toEqual([0, 0, 400, 300]);
  });

  it('foto larga numa caixa em pé sobra nas laterais, centrada', () => {
    const [x, y, w, h] = photoRect({ aspect: 0.5, natural: 4 / 3 }, 100, 200);
    expect(h).toBe(200);
    expect(w).toBeCloseTo(800 / 3, 6);
    expect(x).toBeCloseTo((100 - 800 / 3) / 2, 6);
    expect(y).toBe(0);
  });

  it('foto em pé numa caixa larga sobra em cima e embaixo', () => {
    const [x, y, w, h] = photoRect({ aspect: 1, natural: 0.75 }, 300, 300);
    expect([x, w]).toEqual([0, 300]);
    expect(h).toBeCloseTo(400, 6);
    expect(y).toBeCloseTo(-50, 6);
  });

  it('escala acima de 100% aproxima pelo centro', () => {
    const [x, y, w, h] = photoRect({ aspect: 1, natural: 1, zoom: 2 }, 100, 100);
    expect([x, y, w, h]).toEqual([-50, -50, 200, 200]);
  });

  it('escala abaixo de 100% encolhe a foto no meio da caixa', () => {
    const [x, y, w, h] = photoRect({ aspect: 1, natural: 4 / 3, zoom: 0.5 }, 300, 300);
    // cobrir: 400 × 300; pela metade: 200 × 150, centrada
    expect(w).toBeCloseTo(200, 6);
    expect(h).toBeCloseTo(150, 6);
    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(75, 6);
    // "caber a foto inteira" é a escala em que a largura dela é a da caixa
    const [, , wFit, hFit] = photoRect({ aspect: 1, natural: 4 / 3, zoom: 0.75 }, 300, 300);
    expect(wFit).toBeCloseTo(300, 6);
    expect(hFit).toBeLessThan(300);
  });

  it('enquadramento encosta a foto na borda; valores fora da faixa são contidos', () => {
    expect(photoRect({ aspect: 1, natural: 4 / 3, panX: -1 }, 300, 300)[0]).toBeCloseTo(0, 6);
    const [x, , w] = photoRect({ aspect: 1, natural: 4 / 3, panX: 1 }, 300, 300);
    expect(x + w).toBeCloseTo(300, 6);
    const [x2, y2, w2, h2] = photoRect({ aspect: 1, natural: 1, zoom: 99, panX: 5, panY: -5 }, 100, 100);
    expect(w2).toBe(500);
    expect(x2 + w2).toBeCloseTo(100, 6);
    expect(y2).toBeCloseTo(0, 6);
    expect(h2).toBe(500);
    expect(photoRect({ aspect: 1, natural: 1, zoom: 0.01 }, 100, 100)[2]).toBeCloseTo(20, 6);
  });

  it('arrastada, a foto acompanha o dedo — maior ou menor que a caixa', () => {
    const big = { aspect: 1, natural: 4 / 3 };
    // caixa de 300: a foto cobre com 400 de largura, sobra 100
    const d = photoPanDelta(big, 300, 300, 10, 10);
    expect(d.panX).toBeCloseTo(-0.2, 6);
    expect(d.panY).toBe(0);
    const [x0] = photoRect(big, 300, 300);
    const [x1] = photoRect({ ...big, panX: d.panX }, 300, 300);
    expect(x1 - x0).toBeCloseTo(10, 6);

    const small = { aspect: 1, natural: 1, zoom: 0.5 };
    const d2 = photoPanDelta(small, 300, 300, 15, -15);
    const [sx0, sy0] = photoRect(small, 300, 300);
    const [sx1, sy1] = photoRect({ ...small, panX: d2.panX, panY: d2.panY }, 300, 300);
    expect(sx1 - sx0).toBeCloseTo(15, 6);
    expect(sy1 - sy0).toBeCloseTo(-15, 6);
  });
});
