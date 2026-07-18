import { ArrowElement, Point } from '../../../data/models';
import type { BBox } from './hit-test';

/** O ponto de controle real da bezier quadrática, derivado do ponto "visual" que o
 * usuário arrasta (que fica sobre a curva em t=0.5) — assim, se from/to se moverem
 * (seta conectada a um elemento que foi arrastado), a curva se ajusta de forma
 * previsível em vez de guardar um offset bruto que perderia sentido geométrico. */
export function arrowControlPoint(el: ArrowElement): Point | null {
  if (!el.curve) return null;
  return {
    x: 2 * el.curve.x - (el.from.x + el.to.x) / 2,
    y: 2 * el.curve.y - (el.from.y + el.to.y) / 2,
  };
}

function quadPoint(from: Point, ctrl: Point, to: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * from.x + 2 * mt * t * ctrl.x + t * t * to.x,
    y: mt * mt * from.y + 2 * mt * t * ctrl.y + t * t * to.y,
  };
}

/** Pontos amostrados ao longo do traçado da seta (reta ou curva) — usados tanto pra
 * desenhar quanto pro hit-test, pra nunca divergirem sobre onde a seta realmente está. */
export function arrowSamplePoints(el: ArrowElement, steps = 16): Point[] {
  const ctrl = arrowControlPoint(el);
  if (!ctrl) return [el.from, el.to];
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) pts.push(quadPoint(el.from, ctrl, el.to, i / steps));
  return pts;
}

/** Ângulo tangente no fim da seta — orienta a ponta corretamente mesmo quando curvada
 * (senão a ponta apontaria na direção reta de from→to, destoando do traço curvo). */
export function arrowEndAngle(el: ArrowElement): number {
  const ctrl = arrowControlPoint(el);
  if (!ctrl) return Math.atan2(el.to.y - el.from.y, el.to.x - el.from.x);
  return Math.atan2(el.to.y - ctrl.y, el.to.x - ctrl.x);
}

export function arrowBendPoint(el: ArrowElement): Point {
  return el.curve ?? { x: (el.from.x + el.to.x) / 2, y: (el.from.y + el.to.y) / 2 };
}

/** Ponto onde um raio saindo do centro de `box` em direção a `target` cruza a borda —
 * usado para "grudar" a ponta de uma seta na borda de um elemento (voltada para a
 * outra ponta) em vez do centro, que ficaria visualmente por baixo do conteúdo. */
export function intersectRayWithBBox(center: Point, target: Point, box: BBox): Point {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return center;
  let tMin = Infinity;
  if (dx !== 0) {
    for (const bx of [box.minX, box.maxX]) {
      const t = (bx - center.x) / dx;
      if (t > 1e-6) {
        const y = center.y + t * dy;
        if (y >= box.minY - 0.01 && y <= box.maxY + 0.01) tMin = Math.min(tMin, t);
      }
    }
  }
  if (dy !== 0) {
    for (const by of [box.minY, box.maxY]) {
      const t = (by - center.y) / dy;
      if (t > 1e-6) {
        const x = center.x + t * dx;
        if (x >= box.minX - 0.01 && x <= box.maxX + 0.01) tMin = Math.min(tMin, t);
      }
    }
  }
  if (!isFinite(tMin)) return center;
  return { x: center.x + tMin * dx, y: center.y + tMin * dy };
}
