import { TextFontFamily, TEXT_FONT_STACKS } from '../../../data/models';

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  return measureCtx;
}

/** Altura necessária pra caber o texto sem cortar — mesma lógica de quebra de linha
 * do renderer (drawText/wrapLines), usada pra dimensionar a caixa de edição do mesmo
 * jeito que o resultado final vai ocupar, em vez de uma altura fixa arbitrária. */
export function textContentHeight(
  content: string,
  w: number,
  fontSize: number,
  fontFamily: TextFontFamily,
  bold: boolean,
  italic: boolean,
): number {
  const ctx = getMeasureCtx();
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${TEXT_FONT_STACKS[fontFamily]}`;
  const lineHeight = fontSize * 1.3;
  let lines = 0;
  for (const paragraph of content.split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > w && line) {
        lines++;
        line = word;
      } else {
        line = test;
      }
    }
    lines++;
  }
  return Math.max(lineHeight, lines * lineHeight);
}
