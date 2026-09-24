/** Texto do modo Ilustração: diagramação feita aqui, glifo a glifo, a partir
 * dos contornos da fonte (opentype.js). O que aparece no palco já são as
 * curvas das letras — a prévia é idêntica ao SVG exportado, funciona com fonte
 * enviada pelo usuário e dá pra soldar, contornar e recortar o texto como
 * qualquer outra forma. */

import { Point } from './contour';
import { Bounds, TextLayer, VPath, boundsCenter, flattenPath, growBounds, pathsBounds, translatePaths } from './illustration-model';

/** Comando de caminho no formato do opentype.js (y já pra baixo). */
export interface GlyphCommand {
  type: 'M' | 'L' | 'C' | 'Q' | 'Z';
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

/** O pedaço do glifo do opentype.js que a diagramação usa. */
export interface GlyphLike {
  advanceWidth?: number;
  unicode?: number;
  getPath(x: number, y: number, fontSize: number): { commands: GlyphCommand[] };
}

/** O pedaço da fonte do opentype.js que a diagramação usa — os testes passam
 * uma fonte de mentira com este formato. */
export interface FontLike {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  stringToGlyphs(text: string): GlyphLike[];
  getKerningValue(left: GlyphLike, right: GlyphLike): number;
}

export type TextSpec = Pick<
  TextLayer,
  'text' | 'sizeMm' | 'tracking' | 'lineHeight' | 'align' | 'curve' | 'bend' | 'guide' | 'guideOffset'
>;

export interface TextLayout {
  /** Contornos de cada glifo, na ordem do texto (espaço = lista vazia). */
  glyphs: VPath[][];
  /** Caractere de cada glifo, pra dar nome às letras separadas. */
  chars: string[];
  paths: VPath[];
}

interface PlacedGlyph {
  glyph: GlyphLike;
  line: number;
  /** Centro do glifo ao longo da linha, em mm, já alinhado. */
  center: number;
  advance: number;
}

/** Converte os comandos do glifo em subcaminhos, passando cada ponto por `f`. */
export function commandsToPaths(commands: GlyphCommand[], f: (p: Point) => Point): VPath[] {
  const out: VPath[] = [];
  let cur: VPath | null = null;
  let last: Point = [0, 0];
  const close = (): void => {
    if (!cur) return;
    if (cur.segments.length) {
      const end = cur.segments[cur.segments.length - 1].to;
      if (Math.hypot(end[0] - cur.start[0], end[1] - cur.start[1]) > 1e-9) {
        cur.segments.push({ c1: null, c2: null, to: cur.start });
      }
      cur.closed = true;
      out.push(cur);
    }
    cur = null;
  };
  for (const c of commands) {
    const p = (x = 0, y = 0): Point => f([x, y]);
    switch (c.type) {
      case 'M':
        close();
        last = p(c.x, c.y);
        cur = { start: last, segments: [], closed: false };
        break;
      case 'L':
        if (!cur) break;
        last = p(c.x, c.y);
        cur.segments.push({ c1: null, c2: null, to: last });
        break;
      case 'C':
        if (!cur) break;
        cur.segments.push({ c1: p(c.x1, c.y1), c2: p(c.x2, c.y2), to: (last = p(c.x, c.y)) });
        break;
      case 'Q': {
        if (!cur) break;
        // Quadrática vira cúbica exata: alças a 2/3 do caminho até o controle.
        const q = p(c.x1, c.y1);
        const to = p(c.x, c.y);
        const c1: Point = [last[0] + (2 / 3) * (q[0] - last[0]), last[1] + (2 / 3) * (q[1] - last[1])];
        const c2: Point = [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])];
        cur.segments.push({ c1, c2, to });
        last = to;
        break;
      }
      case 'Z':
        close();
        break;
    }
  }
  close();
  return out;
}

function placeGlyphs(font: FontLike, spec: TextSpec): { placed: PlacedGlyph[]; widths: number[] } {
  const scale = spec.sizeMm / font.unitsPerEm;
  const track = (spec.tracking / 1000) * spec.sizeMm;
  const lines = spec.text.split('\n');
  const placed: PlacedGlyph[] = [];
  const widths: number[] = [];
  lines.forEach((line, li) => {
    const glyphs = line ? font.stringToGlyphs(line) : [];
    const row: PlacedGlyph[] = [];
    let pen = 0;
    glyphs.forEach((g, i) => {
      const advance = (g.advanceWidth ?? 0) * scale;
      row.push({ glyph: g, line: li, center: pen + advance / 2, advance });
      pen += advance + track;
      const next = glyphs[i + 1];
      if (next) pen += font.getKerningValue(g, next) * scale;
    });
    const width = glyphs.length ? pen - track : 0;
    const shift = spec.align === 'center' ? -width / 2 : spec.align === 'right' ? -width : 0;
    for (const p of row) p.center += shift;
    placed.push(...row);
    widths.push(width);
  });
  return { placed, widths };
}

/** Contorno do glifo centrado na horizontal em 0, com a linha de base em y=0,
 * girado por `angle` e levado até `at`. */
function glyphOutline(p: PlacedGlyph, size: number, angle: number, at: Point): VPath[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cmds = p.glyph.getPath(-p.advance / 2, 0, size).commands;
  return commandsToPaths(cmds, ([x, y]) => [at[0] + x * cos - y * sin, at[1] + x * sin + y * cos]);
}

function charOf(g: GlyphLike): string {
  return g.unicode !== undefined ? String.fromCodePoint(g.unicode) : '?';
}

export function layoutText(font: FontLike, spec: TextSpec): TextLayout {
  const { placed, widths } = placeGlyphs(font, spec);
  const lh = spec.lineHeight * spec.sizeMm;
  const size = spec.sizeMm;
  const scale = size / font.unitsPerEm;
  const chars = placed.map((p) => charOf(p.glyph));

  if (spec.curve === 'caminho' && spec.guide) {
    const glyphs = placeOnGuide(placed, spec.guide, spec.guideOffset, lh, size);
    return { glyphs, chars, paths: glyphs.flat() };
  }

  const maxW = Math.max(0, ...widths);
  const span = (Math.abs(spec.bend) / 100) * Math.PI * 2;
  if (spec.curve === 'arco' && span > 0.01 && maxW > 0) {
    const R = maxW / span;
    const up = spec.bend > 0;
    const glyphs = placed.map((p) => {
      // Linhas de baixo ficam por dentro do arco de cima (e vice-versa).
      const Ri = up ? Math.max(1e-3, R - p.line * lh) : R + p.line * lh;
      const theta = p.center / Ri;
      const at: Point = up
        ? [Ri * Math.sin(theta), R - Ri * Math.cos(theta)]
        : [Ri * Math.sin(theta), -R + Ri * Math.cos(theta)];
      return glyphOutline(p, size, up ? theta : -theta, at);
    });
    return centered(glyphs, chars, null);
  }

  const glyphs = placed.map((p) => glyphOutline(p, size, 0, [p.center, p.line * lh]));
  // O centro vem das métricas (caixa da linha), não da tinta: assim o texto
  // não pula de lugar quando uma letra com descendente entra ou sai.
  let box: Bounds | null = null;
  widths.forEach((w, li) => {
    const x0 = spec.align === 'center' ? -w / 2 : spec.align === 'right' ? -w : 0;
    box = growBounds(box, [x0, li * lh - font.ascender * scale]);
    box = growBounds(box, [x0 + w, li * lh - font.descender * scale]);
  });
  return centered(glyphs, chars, box);
}

function centered(glyphs: VPath[][], chars: string[], box: Bounds | null): TextLayout {
  const b = box ?? pathsBounds(glyphs.flat());
  if (!b) return { glyphs, chars, paths: [] };
  const [cx, cy] = boundsCenter(b);
  const moved = glyphs.map((g) => translatePaths(g, -cx, -cy));
  return { glyphs: moved, chars, paths: moved.flat() };
}

/** Texto correndo por um caminho: cada glifo vai pro ponto do caminho que
 * corresponde ao seu centro, girado na direção da tangente. */
function placeOnGuide(placed: PlacedGlyph[], guide: VPath, offset: number, lh: number, size: number): VPath[][] {
  const pts = flattenPath(guide, 0.2);
  if (guide.closed) pts.push(pts[0]);
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  if (L <= 0) return placed.map(() => []);
  const base = Math.max(0, Math.min(1, offset)) * L;
  return placed.map((p) => {
    let s = base + p.center;
    if (guide.closed) s = ((s % L) + L) % L;
    else if (s < 0 || s > L) return [];
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i];
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / segLen;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const off = p.line * lh;
    const at: Point = [a[0] + (b[0] - a[0]) * t - Math.sin(angle) * off, a[1] + (b[1] - a[1]) * t + Math.cos(angle) * off];
    return glyphOutline(p, size, angle, at);
  });
}
