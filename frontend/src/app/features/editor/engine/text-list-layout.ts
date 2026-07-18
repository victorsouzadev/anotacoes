import { TextFontFamily, TEXT_FONT_STACKS } from '../../../data/models';
import { checklistBoxSize } from './checklist-layout';

export type ListMarkerKind = 'none' | 'bullet' | 'number' | 'checklist';

export const MAX_LIST_INDENT = 3;
export const INDENT_SPACES_PER_LEVEL = 2;
export const BULLET_GLYPHS = ['•', '◦', '▪', '‣'];

/** "  - texto", "  1. texto", "  [ ] texto" / "  [x] texto" — grupo 1 é o recuo (2
 * espaços por nível), grupo 2 identifica o tipo de marcador, grupo 3 é o conteúdo.
 * Uma linha que não bate com isso é texto comum, sem nenhuma mudança de
 * comportamento em relação a notas já existentes. */
const LIST_LINE_RE = /^( *)(\[[ xX]\]|-|\d+\.) (.*)$/;

export interface ParsedListLine {
  marker: ListMarkerKind;
  indent: number;
  indentCharLen: number;
  checked: boolean;
  text: string;
}

export function parseListLine(raw: string): ParsedListLine {
  const match = LIST_LINE_RE.exec(raw);
  if (!match) {
    return { marker: 'none', indent: 0, indentCharLen: 0, checked: false, text: raw };
  }
  const [, spaces, token, text] = match;
  const indentCharLen = spaces.length;
  const indent = Math.min(MAX_LIST_INDENT, Math.floor(indentCharLen / INDENT_SPACES_PER_LEVEL));
  if (token === '-') return { marker: 'bullet', indent, indentCharLen, checked: false, text };
  if (token[0] === '[') return { marker: 'checklist', indent, indentCharLen, checked: token[1] !== ' ', text };
  return { marker: 'number', indent, indentCharLen, checked: false, text };
}

export function markerPrefixFor(
  marker: Exclude<ListMarkerKind, 'none'>,
  opts?: { number?: number; checked?: boolean },
): string {
  switch (marker) {
    case 'bullet':
      return '- ';
    case 'number':
      return `${opts?.number ?? 1}. `;
    case 'checklist':
      return `[${opts?.checked ? 'x' : ' '}] `;
  }
}

/** Quais linhas (índices de content.split('\n')) uma seleção da textarea cobre —
 * usado por Tab/Shift+Tab e pelo toggle de marcador da toolbar pra agir em todas as
 * linhas selecionadas, não só na do cursor. */
export function selectedLineRange(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { startLine: number; endLine: number } {
  const startLine = value.slice(0, selectionStart).split('\n').length - 1;
  const endLine = value.slice(0, selectionEnd).split('\n').length - 1;
  return { startLine, endLine };
}

export interface TextLayoutLine {
  /** Texto já quebrado, pronto pra ctx.fillText — marcador já removido. */
  text: string;
  x: number;
  y: number;
  paragraphIndex: number;
  marker: ListMarkerKind;
  /** true só na primeira linha visual do item — só ela carrega glifo/número/checkbox. */
  isMarkerLine: boolean;
  bulletGlyph?: string;
  numberLabel?: string;
  markerX?: number;
  /** Presente em todas as linhas visuais de um item de checklist (pra riscar o texto
   * mesmo quando ele quebra em mais de uma linha). */
  checked?: boolean;
  /** Retângulo do quadradinho em coordenadas de mundo — só na linha marcadora. */
  checkbox?: { x: number; y: number; w: number; h: number };
  /** Offset absoluto do token "[ ]"/"[x]" dentro de `content` — permite reescrever só
   * esses 3 caracteres ao marcar/desmarcar por clique, sem reconstruir o parse. */
  checkboxCharOffset?: number;
}

export function listIndentUnit(fontSize: number): number {
  return Math.round(fontSize * 1.4);
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')!;
  }
  return measureCtx;
}

function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  lines.push(line);
  return lines;
}

/** Fonte única de verdade pro layout de um TextElement (incluindo listas inline) —
 * consumida por drawText (pintar), textContentHeight (medir a caixa de edição) e
 * hitTextCheckbox (clicar num quadradinho pra marcar/desmarcar). Nunca deixar
 * nenhum desses três reimplementar a quebra de linha por conta própria — foi
 * exatamente essa duplicação que causava divergência entre render e hit-test antes
 * de existir esta função (ver checklistItemLayouts, mesmo padrão). */
export function textListLayout(
  content: string,
  x: number,
  y: number,
  w: number,
  fontSize: number,
  fontFamily: TextFontFamily,
  bold: boolean,
  italic: boolean,
): TextLayoutLine[] {
  const ctx = getMeasureCtx();
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${TEXT_FONT_STACKS[fontFamily]}`;
  const lineHeight = fontSize * 1.3;
  const unit = listIndentUnit(fontSize);
  const boxSize = checklistBoxSize(fontSize);
  const result: TextLayoutLine[] = [];
  const paragraphs = content.split('\n');

  let curY = y;
  let paragraphStart = 0;
  const numberCounters: number[] = new Array(MAX_LIST_INDENT + 1).fill(0);
  let prevNumberDepth = -1;

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const raw = paragraphs[paragraphIndex];
    const parsed = parseListLine(raw);

    let resolvedNumber = 0;
    if (parsed.marker === 'number') {
      // Reseta pra 1 a menos que o parágrafo imediatamente anterior já fosse
      // numerado no mesmo nível de recuo — regra simples de "olhar 1 linha atrás",
      // não tenta reproduzir a retomada de contagem do Word em sublistas aninhadas.
      numberCounters[parsed.indent] = prevNumberDepth === parsed.indent ? numberCounters[parsed.indent] + 1 : 1;
      resolvedNumber = numberCounters[parsed.indent];
      prevNumberDepth = parsed.indent;
    } else {
      prevNumberDepth = -1;
    }

    const hasMarker = parsed.marker !== 'none';
    const indentLevels = hasMarker ? parsed.indent + 1 : 0;
    const textX = x + indentLevels * unit;
    const availW = Math.max(10, w - indentLevels * unit);
    const wrapped = wrapWords(ctx, parsed.text, availW);
    const checkboxCharOffset = parsed.marker === 'checklist' ? paragraphStart + parsed.indentCharLen : undefined;

    for (let li = 0; li < wrapped.length; li++) {
      const isMarkerLine = li === 0;
      const line: TextLayoutLine = {
        text: wrapped[li],
        x: textX,
        y: curY,
        paragraphIndex,
        marker: parsed.marker,
        isMarkerLine,
      };
      if (parsed.marker === 'checklist') line.checked = parsed.checked;
      if (isMarkerLine && hasMarker) {
        line.markerX = x + parsed.indent * unit;
        if (parsed.marker === 'bullet') {
          line.bulletGlyph = BULLET_GLYPHS[parsed.indent];
        } else if (parsed.marker === 'number') {
          line.numberLabel = `${resolvedNumber}.`;
        } else if (parsed.marker === 'checklist') {
          line.checkbox = {
            x: x + parsed.indent * unit + (unit - boxSize) / 2,
            y: curY + (lineHeight - boxSize) / 2,
            w: boxSize,
            h: boxSize,
          };
          line.checkboxCharOffset = checkboxCharOffset;
        }
      }
      result.push(line);
      curY += lineHeight;
    }

    paragraphStart += raw.length + 1; // +1 pelo '\n' separador entre parágrafos
  }

  return result;
}
