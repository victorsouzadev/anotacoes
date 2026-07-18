import { ChecklistElement, ChecklistItem } from '../../../data/models';

export const CHECKLIST_PADDING = 10;
export const CHECKLIST_DEFAULT_FONT_SIZE = 14;

export interface ChecklistItemLayout {
  item: ChecklistItem;
  index: number;
  checkbox: { x: number; y: number; w: number; h: number };
  textX: number;
  textY: number;
}

/** Altura de linha e tamanho do quadradinho escalam com a fonte — sem isso, diminuir
 * a fonte não mudava nada visualmente porque a altura de linha ficava fixa em 24px. */
export function checklistRowHeight(fontSize: number): number {
  return Math.round(fontSize * 1.7);
}

export function checklistBoxSize(fontSize: number): number {
  return Math.round(fontSize);
}

/** Layout dos itens em coordenadas de mundo — usado tanto pelo renderer (desenhar)
 * quanto pelo hit-test (clicar no quadradinho para marcar/desmarcar), para os dois
 * nunca divergirem sobre onde cada checkbox está. */
export function checklistItemLayouts(el: ChecklistElement): ChecklistItemLayout[] {
  const rowHeight = checklistRowHeight(el.fontSize);
  const boxSize = checklistBoxSize(el.fontSize);
  return el.items.map((item, index) => {
    const rowY = el.y + CHECKLIST_PADDING + index * rowHeight;
    return {
      item,
      index,
      checkbox: { x: el.x + CHECKLIST_PADDING, y: rowY + (rowHeight - boxSize) / 2, w: boxSize, h: boxSize },
      textX: el.x + CHECKLIST_PADDING + boxSize + 8,
      textY: rowY + (rowHeight - el.fontSize) / 2,
    };
  });
}

export function checklistHeight(itemCount: number, fontSize: number): number {
  return CHECKLIST_PADDING * 2 + Math.max(1, itemCount) * checklistRowHeight(fontSize);
}
