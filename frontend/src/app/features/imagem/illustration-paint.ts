/** Pintura além da cor sólida no modo Ilustração: degradê, padrão, contornos
 * de efeito, sombra e máscara de recorte. Tudo vira SVG comum (defs +
 * caminhos), então o que aparece no palco é o mesmo que sai no arquivo, no PNG
 * e no PDF. Puro: o palco e a exportação montam a marcação daqui. */

import { FillPaint, Layer, Matrix, PatternKind, matrixAttr, round } from './illustration-model';

export const PATTERNS: { id: PatternKind; label: string }[] = [
  { id: 'bolinhas', label: 'Bolinhas' },
  { id: 'listras', label: 'Listras' },
  { id: 'xadrez', label: 'Xadrez' },
  { id: 'grade', label: 'Quadriculado' },
  { id: 'coracoes', label: 'Corações' },
];

function n(v: number): string {
  return String(round(v, 4));
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, '');
}

export function paintId(prefix: string, l: Layer): string {
  return `${prefix}f-${l.id}`;
}

export function clipId(prefix: string, maskId: string): string {
  return `${prefix}c-${maskId}`;
}

/** O `fill` da camada: a cor, ou a referência ao degradê/padrão. */
export function fillRef(prefix: string, l: Layer): string {
  if (l.mask) return 'none';
  if (l.paint && l.kind !== 'imagem') return `url(#${paintId(prefix, l)})`;
  return l.fill ?? 'none';
}

/** Desenho de uma célula do padrão, com lado `s`. */
function patternCell(kind: PatternKind, s: number, color: string): string {
  const c = esc(color);
  switch (kind) {
    case 'bolinhas':
      return `<circle cx="${n(s / 2)}" cy="${n(s / 2)}" r="${n(s * 0.22)}" fill="${c}"/>`;
    case 'listras':
      return `<rect x="0" y="0" width="${n(s / 2)}" height="${n(s)}" fill="${c}"/>`;
    case 'xadrez':
      return `<rect x="0" y="0" width="${n(s / 2)}" height="${n(s / 2)}" fill="${c}"/><rect x="${n(s / 2)}" y="${n(s / 2)}" width="${n(s / 2)}" height="${n(s / 2)}" fill="${c}"/>`;
    case 'grade': {
      const w = s * 0.08;
      return `<rect x="0" y="0" width="${n(s)}" height="${n(w)}" fill="${c}"/><rect x="0" y="0" width="${n(w)}" height="${n(s)}" fill="${c}"/>`;
    }
    case 'coracoes': {
      // coração numa caixa de 1×1, escalado pra 60% da célula
      const k = s * 0.6, o = s * 0.2;
      const p = (x: number, y: number): string => `${n(o + x * k)} ${n(o + y * k)}`;
      return `<path d="M${p(0.5, 0.95)}C${p(0.1, 0.65)} ${p(-0.05, 0.35)} ${p(0.2, 0.15)}C${p(0.35, 0.03)} ${p(0.5, 0.15)} ${p(0.5, 0.28)}` +
        `C${p(0.5, 0.15)} ${p(0.65, 0.03)} ${p(0.8, 0.15)}C${p(1.05, 0.35)} ${p(0.9, 0.65)} ${p(0.5, 0.95)}Z" fill="${c}"/>`;
    }
  }
}

/** Marcação do degradê ou padrão da camada. `world` é a matriz da camada
 * quando os caminhos saem já na prancheta (exportação): o padrão acompanha
 * giro e escala igual no palco, onde o caminho é desenhado com transform. */
export function paintDef(prefix: string, l: Layer, world: Matrix | null): string {
  const p: FillPaint | null | undefined = l.paint;
  if (!p || l.kind === 'imagem') return '';
  const id = paintId(prefix, l);
  if (p.type === 'pattern') {
    const s = Math.max(0.5, p.sizeMm);
    const rot = p.angle ? ` rotate(${n(p.angle)})` : '';
    const base = world ? matrixAttr(world) : '';
    const transform = base || rot ? ` patternTransform="${(base + rot).trim()}"` : '';
    const bg = p.bg ? `<rect width="${n(s)}" height="${n(s)}" fill="${esc(p.bg)}"/>` : '';
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(s)}" height="${n(s)}"${transform}>${bg}${patternCell(p.pattern, s, p.color)}</pattern>`;
  }
  const stops = [...p.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((st) => `<stop offset="${n(Math.min(1, Math.max(0, st.offset)))}" stop-color="${esc(st.color)}"/>`)
    .join('');
  if (p.type === 'radial') return `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.6">${stops}</radialGradient>`;
  return `<linearGradient id="${id}" gradientTransform="rotate(${n(p.angle)} 0.5 0.5)">${stops}</linearGradient>`;
}

export function clipDef(prefix: string, maskId: string, worldD: string): string {
  return `<clipPath id="${clipId(prefix, maskId)}" clipPathUnits="userSpaceOnUse"><path d="${worldD}" clip-rule="evenodd"/></clipPath>`;
}

/** Uma camada de efeito, atrás da arte: o mesmo contorno pintado com traço
 * largo e redondo. Largura em mm da prancheta. */
export interface Underlay {
  color: string;
  widthMm: number;
  dx: number;
  dy: number;
  opacity: number;
}

/** De baixo pra cima: sombra, segundo contorno, primeiro contorno. O traço
 * cresce pros dois lados, então a largura é o dobro do contorno visível mais
 * o traço que a camada já tem. */
export function underlays(l: Layer): Underlay[] {
  const e = l.effects;
  if (!e || l.kind === 'imagem' || l.mask) return [];
  const base = l.stroke && l.strokeWidth > 0 ? l.strokeWidth : 0;
  const o1 = e.outline && e.outline.widthMm > 0 ? e.outline.widthMm : 0;
  const o2 = e.outline2 && e.outline2.widthMm > 0 ? e.outline2.widthMm : 0;
  const out: Underlay[] = [];
  if (e.shadow) {
    out.push({ color: e.shadow.color, widthMm: base + 2 * (o1 + o2), dx: e.shadow.dx, dy: e.shadow.dy, opacity: e.shadow.opacity });
  }
  if (o2) out.push({ color: e.outline2!.color, widthMm: base + 2 * (o1 + o2), dx: 0, dy: 0, opacity: 1 });
  if (o1) out.push({ color: e.outline!.color, widthMm: base + 2 * o1, dx: 0, dy: 0, opacity: 1 });
  return out;
}

/** Quanto os efeitos engordam a camada, em mm (pra caixa de exportação). */
export function effectsPad(l: Layer): number {
  return underlays(l).reduce((m, u) => Math.max(m, u.widthMm / 2 + Math.hypot(u.dx, u.dy)), 0);
}
