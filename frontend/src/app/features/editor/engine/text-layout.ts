import { TextFontFamily } from '../../../data/models';
import { textListLayout } from './text-list-layout';

/** Altura necessária pra caber o texto sem cortar — usa o mesmo layout (incluindo
 * quebra de linha de listas com recuo pendurado) que o renderer pinta, pra dimensionar
 * a caixa de edição do jeito exato que o resultado final vai ocupar. */
export function textContentHeight(
  content: string,
  w: number,
  fontSize: number,
  fontFamily: TextFontFamily,
  bold: boolean,
  italic: boolean,
): number {
  const lineHeight = fontSize * 1.3;
  const lines = textListLayout(content, 0, 0, w, fontSize, fontFamily, bold, italic);
  return Math.max(lineHeight, lines.length * lineHeight);
}
