/** Espaços de foto: o que faz o modelo de entregas receber várias fotos de uma
 * vez. Cada foto escolhida entra no próximo espaço vazio, recortada pro
 * tamanho dele; quando os espaços acabam, a página do último espaço é
 * repetida (antes da chamada final) e o carrossel cresce, até o limite.
 *
 * Tudo aqui é conta pura sobre as camadas — o store só aplica o resultado. */

import { uuid } from '../../core/uuid';
import { Overlay, PhotoOverlay, ShapeOverlay } from './social-overlays';

export interface SlotPhoto {
  src: string;
  /** Largura ÷ altura da foto. */
  aspect: number;
}

export function isPlaceholder(o: Overlay): o is ShapeOverlay {
  return o.kind === 'forma' && !!o.placeholder;
}

/** Post (0..slides-1) em que a camada está, pelo centro dela. */
export function slideOf(o: { x: number }, slides: number): number {
  return Math.min(slides - 1, Math.max(0, Math.floor(o.x * slides)));
}

/** Espaços de foto na ordem de leitura: post a post, de cima pra baixo, da
 * esquerda pra direita. */
export function placeholders(overlays: Overlay[], slides: number): ShapeOverlay[] {
  return overlays.filter(isPlaceholder).sort((a, b) =>
    slideOf(a, slides) - slideOf(b, slides) || a.y - b.y || a.x - b.x);
}

/** Espaços que ainda não têm foto por cima. */
export function emptyPlaceholders(overlays: Overlay[], slides: number): ShapeOverlay[] {
  const filled = new Set(overlays.filter((o): o is PhotoOverlay => o.kind === 'foto' && !!o.slotId).map((o) => o.slotId));
  return placeholders(overlays, slides).filter((p) => !filled.has(p.id));
}

/** A foto que preenche um espaço: mesma caixa, mesmos cantos. */
export function photoForPlaceholder(ph: ShapeOverlay, photo: SlotPhoto): PhotoOverlay {
  // O raio do espaço é fração do lado menor do quadro; o da foto, do lado
  // menor dela — que é a altura (`size`) vezes a menor proporção.
  const side = ph.size * Math.min(ph.aspect, 1);
  return {
    id: uuid(), kind: 'foto', src: photo.src,
    x: ph.x, y: ph.y, size: ph.size, rotation: ph.rotation,
    aspect: ph.aspect, natural: photo.aspect, slotId: ph.id,
    radius: side > 0 ? Math.min(0.5, ph.radius / side) : 0,
    border: '', borderWidth: 0,
  };
}

/** Muda a quantidade de posts inserindo `count` posts em branco depois do
 * post `after`. As camadas continuam no mesmo lugar do post delas (as de
 * depois andam pra frente), e tudo que é medido pelo lado menor do quadro é
 * corrigido — no carrossel ele deixa de ser a largura e passa a ser a altura. */
export function insertSlides(overlays: Overlay[], slides: number, after: number, count: number, ratio: number): Overlay[] {
  if (count <= 0) return overlays;
  const next = slides + count;
  // Lado menor do quadro, em alturas de post.
  const k = Math.min(slides * ratio, 1) / Math.min(next * ratio, 1);
  return overlays.map((o) => {
    const unit = o.x * slides;
    const moved = slideOf(o, slides) > after ? unit + count : unit;
    const out = { ...o, x: moved / next, size: o.size * k } as Overlay;
    if (out.kind === 'forma') {
      out.strokeWidth *= k;
      out.radius *= k;
    }
    return out;
  });
}

/** Cópia das camadas de um post (sem as fotos que preenchem espaços), com ids
 * novos, deslocada `offset` posts pra frente. */
function clonePage(overlays: Overlay[], slides: number, page: number, offset: number): Overlay[] {
  return overlays
    .filter((o) => slideOf(o, slides) === page && !(o.kind === 'foto' && o.slotId))
    .map((o) => ({ ...o, id: uuid(), x: o.x + offset / slides }) as Overlay);
}

export interface FillResult {
  overlays: Overlay[];
  slides: number;
  /** Quantas fotos entraram. */
  placed: number;
  /** Quantos posts foram acrescentados. */
  added: number;
}

/** Põe as fotos nos espaços vazios, a partir de `startId` (ou do primeiro
 * vazio). Sobrando foto, repete a página do último espaço até caber, sem
 * passar de `maxSlides`. Cada foto entra logo acima do espaço dela. */
export function fillPhotoSlots(
  overlays: Overlay[], slides: number, photos: SlotPhoto[], ratio: number, maxSlides = 10, startId?: string,
): FillResult {
  let list = overlays;
  let n = slides;
  let added = 0;

  const all = placeholders(list, n);
  if (!all.length || !photos.length) return { overlays, slides, placed: 0, added: 0 };

  // Quantas páginas a mais seriam precisas.
  const lastPage = slideOf(all[all.length - 1], n);
  const perPage = all.filter((p) => slideOf(p, n) === lastPage).length;
  const startIndex = startId ? Math.max(0, all.findIndex((p) => p.id === startId)) : 0;
  const empties = emptyPlaceholders(list, n).filter((p) => all.indexOf(p) >= startIndex).length;
  const missing = photos.length - empties;
  if (missing > 0) {
    const pages = Math.min(Math.ceil(missing / perPage), maxSlides - n);
    if (pages > 0) {
      // Abre as páginas em branco logo depois da última com espaço e repete
      // nelas o que essa página tem.
      list = insertSlides(list, n, lastPage, pages, ratio);
      n += pages;
      const copies: Overlay[] = [];
      for (let p = 1; p <= pages; p++) copies.push(...clonePage(list, n, lastPage, p));
      list = [...list, ...copies];
      added = pages;
    }
  }

  // Depois de crescer, a ordem dos espaços é refeita; o ponto de partida
  // continua sendo o mesmo espaço.
  const ordered = placeholders(list, n);
  const from = startId ? Math.max(0, ordered.findIndex((p) => p.id === startId)) : 0;
  const filled = new Set(list.filter((o): o is PhotoOverlay => o.kind === 'foto' && !!o.slotId).map((o) => o.slotId));
  const targets = ordered.slice(from).filter((p) => !filled.has(p.id));

  const pairs = new Map<string, PhotoOverlay>();
  targets.slice(0, photos.length).forEach((ph, i) => pairs.set(ph.id, photoForPlaceholder(ph, photos[i])));
  const result: Overlay[] = [];
  for (const o of list) {
    result.push(o);
    const photo = pairs.get(o.id);
    if (photo) result.push(photo);
  }
  return { overlays: result, slides: n, placed: pairs.size, added };
}
