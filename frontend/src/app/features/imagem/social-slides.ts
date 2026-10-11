/** Mexer nos posts de um carrossel: tirar, mover, duplicar e trazer a página
 * de outro modelo. O carrossel é uma faixa só, com as camadas em fração da
 * faixa inteira; mudar a quantidade de posts muda a escala de tudo, então
 * cada operação aqui é um remapeamento de posts — conta pura sobre as camadas.
 *
 * Tamanho de letra, forma e raio são medidos pelo lado menor da faixa, que no
 * carrossel é a altura e no post comum (retrato/quadrado) é a largura. */

import { uuid } from '../../core/uuid';
import { PhotoSlot } from './social-model';
import { Guide } from './social-align';
import { Overlay } from './social-overlays';
import { slideOf } from './social-photo-slots';

export interface Strip {
  overlays: Overlay[];
  slides: number;
  slot: PhotoSlot | null;
  guides: Guide[];
}

/** Lado menor da faixa, em alturas de post. */
function base(slides: number, ratio: number): number {
  return Math.min(slides * ratio, 1);
}

function rescale(o: Overlay, k: number): Overlay {
  const out = { ...o, size: o.size * k } as Overlay;
  if (out.kind === 'forma') {
    out.strokeWidth *= k;
    out.radius *= k;
  }
  return out;
}

/** Leva cada post `p` para `map[p]` (null = some) numa faixa de `next` posts. */
export function remapSlides(s: Strip, map: (number | null)[], next: number, ratio: number): Strip {
  const k = base(s.slides, ratio) / base(next, ratio);
  const move = (x: number, page: number, to: number) => (x * s.slides - page + to) / next;

  const overlays: Overlay[] = [];
  for (const o of s.overlays) {
    const page = slideOf(o, s.slides);
    const to = map[page];
    if (to === null || to === undefined) continue;
    overlays.push(rescale({ ...o, x: move(o.x, page, to) } as Overlay, k));
  }
  // A foto presa a um espaço que sumiu vai junto com ele.
  const ids = new Set(overlays.map((o) => o.id));
  const kept = overlays.filter((o) => !(o.kind === 'foto' && o.slotId && !ids.has(o.slotId)));

  let slot = s.slot;
  if (slot) {
    const page = Math.min(s.slides - 1, Math.floor((slot.x + slot.w / 2) * s.slides));
    const to = map[page];
    slot = to === null || to === undefined ? null : {
      ...slot, x: move(slot.x, page, to), w: (slot.w * s.slides) / next, radius: slot.radius * k,
    };
  }

  const guides = s.guides.flatMap((g) => {
    if (g.axis !== 'x') return [g];
    const page = Math.min(s.slides - 1, Math.floor(g.pos * s.slides));
    const to = map[page];
    return to === null || to === undefined ? [] : [{ ...g, pos: move(g.pos, page, to) }];
  });
  return { overlays: kept, slides: next, slot, guides };
}

const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

export function removeSlide(s: Strip, page: number, ratio: number): Strip {
  if (s.slides <= 1) return s;
  const map = identity(s.slides).map((p) => (p === page ? null : p > page ? p - 1 : p));
  return remapSlides(s, map, s.slides - 1, ratio);
}

/** Troca o post `page` de lugar com o vizinho (`dir` = -1 ou 1). */
export function moveSlide(s: Strip, page: number, dir: -1 | 1, ratio: number): Strip {
  const other = page + dir;
  if (other < 0 || other >= s.slides) return s;
  const map = identity(s.slides).map((p) => (p === page ? other : p === other ? page : p));
  return remapSlides(s, map, s.slides, ratio);
}

/** Abre `count` posts em branco depois de `after` (-1 = no começo). */
export function insertBlank(s: Strip, after: number, count: number, ratio: number): Strip {
  const map = identity(s.slides).map((p) => (p > after ? p + count : p));
  return remapSlides(s, map, s.slides + count, ratio);
}

/** Cópia das camadas de um post, com ids novos — os espaços de foto e as
 * fotos dentro deles continuam ligados. `withPhotos` falso deixa os espaços
 * vazios (pra receber outra foto). */
function copyPage(overlays: Overlay[], slides: number, page: number, offset: number, withPhotos: boolean): Overlay[] {
  const ids = new Map<string, string>();
  const src = overlays.filter((o) => slideOf(o, slides) === page && (withPhotos || !(o.kind === 'foto' && o.slotId)));
  for (const o of src) ids.set(o.id, uuid());
  return src.map((o) => {
    const c = { ...o, id: ids.get(o.id)!, x: o.x + offset / slides } as Overlay;
    if (c.kind === 'foto' && c.slotId) c.slotId = ids.get(c.slotId) ?? c.slotId;
    return c;
  });
}

/** Duplica o post logo depois dele. A foto do espaço principal do modelo
 * (`slot`) é uma só, então não se copia. */
export function duplicateSlide(s: Strip, page: number, ratio: number, withPhotos = true): Strip {
  const opened = insertBlank(s, page, 1, ratio);
  return { ...opened, overlays: [...opened.overlays, ...copyPage(opened.overlays, opened.slides, page, 1, withPhotos)] };
}

/** Traz o post `page` de outro modelo (mesmo formato) para depois de `after`. */
export function insertForeignPage(
  s: Strip, after: number, from: { overlays: Overlay[]; slides: number }, page: number, ratio: number,
): Strip {
  const opened = insertBlank(s, after, 1, ratio);
  const k = base(from.slides, ratio) / base(opened.slides, ratio);
  const fresh = copyPage(from.overlays, from.slides, page, 0, false).map((o) =>
    rescale({ ...o, x: (o.x * from.slides - page + after + 1) / opened.slides } as Overlay, k));
  return { ...opened, overlays: [...opened.overlays, ...fresh] };
}

/** Tira a foto que está num espaço de foto do post (o espaço fica). */
export function clearSlidePhotos(overlays: Overlay[], slides: number, page: number): Overlay[] {
  return overlays.filter((o) => !(o.kind === 'foto' && o.slotId && slideOf(o, slides) === page));
}
