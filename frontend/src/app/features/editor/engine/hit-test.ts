import { CanvasElement, Point } from '../../../data/models';
import { arrowSamplePoints } from './arrow-geometry';
import { textContentHeight } from './text-layout';

// Maior que o quadrado desenhado (ver Renderer.drawHandleSquare) só na área de
// detecção de clique — alças de 8px eram fáceis de errar (arrastava o elemento
// inteiro em vez de redimensionar), sobretudo pra diminuir/aumentar o tamanho do
// texto pela alça de canto.
export const HANDLE_SIZE = 8;
export const HANDLE_HIT_SIZE = 13;

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function elementBBox(e: CanvasElement): BBox {
  switch (e.type) {
    case 'stroke': {
      const xs = e.points.map((p) => p.x);
      const ys = e.points.map((p) => p.y);
      const pad = e.thickness;
      return {
        minX: Math.min(...xs) - pad,
        minY: Math.min(...ys) - pad,
        maxX: Math.max(...xs) + pad,
        maxY: Math.max(...ys) + pad,
      };
    }
    case 'shape':
    case 'sticky':
    case 'checklist':
    case 'image':
      return { minX: e.x, minY: e.y, maxX: e.x + (e.w ?? 0), maxY: e.y + ('h' in e ? e.h : 20) };
    case 'text': {
      // Sem isso, o "hit box" de um texto de várias linhas fica preso a uma faixa fixa
      // de 20px (independente do tamanho real da fonte/quebra), tornando impossível
      // selecionar ou reeditar boa parte do texto renderizado.
      const h = textContentHeight(e.content, e.w, e.fontSize, e.fontFamily, e.bold, e.italic);
      return { minX: e.x, minY: e.y, maxX: e.x + e.w, maxY: e.y + h };
    }
    case 'arrow': {
      const pts = arrowSamplePoints(e);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return {
        minX: Math.min(...xs) - 4,
        minY: Math.min(...ys) - 4,
        maxX: Math.max(...xs) + 4,
        maxY: Math.max(...ys) + 4,
      };
    }
  }
}

export function unionBBox(boxes: BBox[]): BBox {
  return boxes.reduce(
    (acc, b) => ({
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function bboxIntersectsRect(b: BBox, rect: BBox): boolean {
  return b.minX <= rect.maxX && b.maxX >= rect.minX && b.minY <= rect.maxY && b.maxY >= rect.minY;
}

export function pointInBBox(p: Point, b: BBox): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** Distância mínima do ponto a um segmento (para hit-test fino de traços/setas/linhas). */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function hitTestElement(p: Point, e: CanvasElement): boolean {
  const box = elementBBox(e);
  if (!pointInBBox(p, box)) return false;

  switch (e.type) {
    case 'stroke': {
      const threshold = Math.max(6, e.thickness);
      for (let i = 0; i < e.points.length - 1; i++) {
        if (distToSegment(p, e.points[i], e.points[i + 1]) <= threshold) return true;
      }
      return e.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) <= threshold);
    }
    case 'arrow': {
      const threshold = Math.max(6, e.thickness);
      const pts = arrowSamplePoints(e);
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(p, pts[i], pts[i + 1]) <= threshold) return true;
      }
      return false;
    }
    case 'shape': {
      if (e.fill || e.shape === 'line') return true;
      // vazado: só a borda conta (aprox. com margem)
      const margin = Math.max(6, e.thickness);
      const insideOuter = pointInBBox(p, box);
      const insideInner = pointInBBox(p, {
        minX: box.minX + margin,
        minY: box.minY + margin,
        maxX: box.maxX - margin,
        maxY: box.maxY - margin,
      });
      return insideOuter && !insideInner;
    }
    case 'text':
    case 'sticky':
    case 'checklist':
    case 'image':
      return true;
  }
}
