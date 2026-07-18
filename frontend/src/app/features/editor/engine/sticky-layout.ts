export const STICKY_PADDING = 12;
export const STICKY_FONT_SIZE = 14;
export const STICKY_MIN_H = 70;

/** Altura de linha escala com o tamanho da fonte — antes era um valor fixo (18px),
 * o que fazia aumentar a fonte da nota adesiva sobrepor as linhas em vez de crescer
 * o espaçamento junto. */
export function stickyLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.3);
}

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(fontSize: number): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  measureCtx.font = `${fontSize}px sans-serif`;
  return measureCtx;
}

/** Altura necessária para caber o conteúdo sem cortar texto — mesma lógica de quebra
 * de linha usada pelo renderer (wrapText), mas só contando linhas em vez de desenhar,
 * pra manter a nota adesiva sempre do tamanho do que está escrito nela. */
export function stickyContentHeight(content: string, w: number, fontSize: number = STICKY_FONT_SIZE): number {
  const ctx = getMeasureCtx(fontSize);
  const maxWidth = Math.max(10, w - STICKY_PADDING * 2);
  const lineHeight = stickyLineHeight(fontSize);
  let lines = 0;
  for (const paragraph of content.split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines++;
        line = word;
      } else {
        line = test;
      }
    }
    lines++;
  }
  return Math.max(STICKY_MIN_H, STICKY_PADDING * 2 + lines * lineHeight);
}
