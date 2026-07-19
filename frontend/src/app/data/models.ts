export type ToolType = 'pen' | 'eraser-stroke' | 'eraser-area' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'sticky' | 'checklist' | 'pomodoro' | 'select' | 'pan';

export type PaperStyle = 'blank' | 'ruled' | 'grid';

export interface Point {
  x: number;
  y: number;
}

interface ElementBase {
  id: string;
  zIndex: number;
  rotation: number; // radianos, em torno do centro do bbox
}

export interface StrokeElement extends ElementBase {
  type: 'stroke';
  points: Point[];
  pressures: number[];
  color: string;
  thickness: number;
}

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  thickness: number;
  fill: boolean;
}

export interface ArrowElement extends ElementBase {
  type: 'arrow';
  from: Point;
  to: Point;
  /** Ponto pelo qual a curva deve passar (o "meio visual" arrastado pelo usuário) —
   * quando ausente, a seta é uma linha reta. */
  curve?: Point | null;
  /** Ids dos elementos às pontas estão "grudadas" — quando o elemento referenciado se
   * move, a ponta correspondente da seta acompanha automaticamente. */
  fromId?: string | null;
  toId?: string | null;
  color: string;
  thickness: number;
}

export type TextAlign = 'left' | 'center' | 'right';
export type TextFontFamily = 'sans' | 'handwriting';

export interface TextElement extends ElementBase {
  type: 'text';
  x: number;
  y: number;
  w: number;
  content: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  fontFamily: TextFontFamily;
  color: string;
}

/** Pilhas de fonte por família — "handwriting" usa fontes cursivas comuns no SO do
 * usuário (sem carregar web font) pra simular escrita manual. */
export const TEXT_FONT_STACKS: Record<TextFontFamily, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  handwriting: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
};

export interface StickyElement extends ElementBase {
  type: 'sticky';
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  color: string;
  fontSize: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface ChecklistElement extends ElementBase {
  type: 'checklist';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  fontSize: number;
  items: ChecklistItem[];
}

export interface ImageElement extends ElementBase {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Data URL (base64) — imagem colada, já redimensionada/comprimida no cliente. */
  src: string;
}

export type PomodoroPhase = 'work' | 'break';

export interface PomodoroElement extends ElementBase {
  type: 'pomodoro';
  x: number;
  y: number;
  w: number;
  h: number;
  workDurationSec: number;
  breakDurationSec: number;
  phase: PomodoroPhase;
  running: boolean;
  /** ISO — só setado enquanto running=true; null quando pausado/parado. */
  phaseEndAt: string | null;
  /** Segundos restantes na fase atual — fonte da verdade quando pausado; quando
   * running=true, o tempo exibido é derivado de phaseEndAt - agora. */
  remainingSec: number;
  /** Quantos ciclos de foco foram concluídos (contador simples, sem pausa longa). */
  cyclesCompleted: number;
}

export type CanvasElement = StrokeElement | ShapeElement | ArrowElement | TextElement | StickyElement | ChecklistElement | ImageElement | PomodoroElement;

/** Uma nota é um caderno com uma ou mais páginas — cada página tem seu próprio
 * conjunto independente de elementos. */
export interface NotePage {
  id: string;
  elements: CanvasElement[];
}

export interface NoteMeta {
  id: string;
  folderId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRecord extends NoteMeta {
  pages: NotePage[];
  deletedAt: string | null;
  dirty: boolean;
  thumbnail?: string;
  /** Preferência puramente local (não sincronizada com o servidor) — aparência do
   * fundo do canvas (papel liso/pautado/quadriculado), simulando folhas de caderno. */
  paperStyle?: PaperStyle;
}

/** Notas salvas antes do conceito de "páginas" existir tinham um array plano de
 * elementos (campo antigo `elements`, sem `pages`). Detecta o formato pelo shape do
 * JSON — um item de página tem `{id, elements: [...]}`, um CanvasElement não tem
 * campo `elements` aninhado — e migra pra uma nota de página única. */
export function parseStoredPages(raw: string): NotePage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [{ id: newPageId(), elements: [] }];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [{ id: newPageId(), elements: [] }];
  }
  const first = parsed[0] as Record<string, unknown>;
  if (first && typeof first === 'object' && Array.isArray((first as any).elements) && typeof first['id'] === 'string') {
    return parsed as NotePage[];
  }
  return [{ id: newPageId(), elements: parsed as CanvasElement[] }];
}

function newPageId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface FolderRecord {
  id: string;
  name: string;
  createdAt: string;
}

export const STICKY_COLORS = ['#FAC775', '#B7E4A0', '#F6A6C1', '#A8D8F0', '#E0C3F0'];
export const PEN_COLORS = ['#1d1d1d', '#d85a30', '#2f6fed', '#2ea44f', '#8b5cf6'];
