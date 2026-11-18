import { uuid } from '../../../core/uuid';
import { CanvasElement, NotePage } from '../../../data/models';

/**
 * Cópia de uma página (spec 020): ids novos em tudo e setas ligadas a elementos da própria
 * página apontando para as cópias. Seta ligada a algo que não está na página fica solta.
 */
export function duplicatePage(page: NotePage, novoId: () => string = uuid): NotePage {
  const mapa = new Map<string, string>();
  for (const el of page.elements) mapa.set(el.id, novoId());
  const elements: CanvasElement[] = structuredClone(page.elements).map((el) => {
    const copia = { ...el, id: mapa.get(el.id)! } as CanvasElement;
    if (copia.type === 'arrow') {
      copia.fromId = copia.fromId ? (mapa.get(copia.fromId) ?? null) : copia.fromId ?? null;
      copia.toId = copia.toId ? (mapa.get(copia.toId) ?? null) : copia.toId ?? null;
      if (copia.fromId === null) copia.fromAnchor = null;
      if (copia.toId === null) copia.toAnchor = null;
    }
    return copia;
  });
  return {
    id: novoId(),
    ...(page.title ? { title: `${page.title} (cópia)` } : {}),
    ...(page.color ? { color: page.color } : {}),
    elements,
  };
}

/** Move a página de `de` para `para` (índices na lista final). Fora dos limites: lista igual. */
export function movePage<T>(pages: T[], de: number, para: number): T[] {
  if (de === para || de < 0 || para < 0 || de >= pages.length || para >= pages.length) return pages;
  const copia = [...pages];
  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item);
  return copia;
}
