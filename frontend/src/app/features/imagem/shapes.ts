/** Formas de corte alternativas à silhueta: polígonos analíticos (retângulo,
 * retângulo arredondado, elipse) que envolvem a arte com a margem pedida —
 * exatos, sem precisar vetorizar pixel. */

import { Polygon } from './contour';

export type CutShape = 'silhueta' | 'retangulo' | 'arredondado' | 'elipse';

/** Retângulo com cantos arredondados (raio 0 = retângulo puro), centrado no
 * canvas de W×H, encolhido `inset` px a partir da borda. Sentido horário. */
export function roundedRectPolygon(W: number, H: number, inset: number, radius: number): Polygon {
  const x0 = inset;
  const y0 = inset;
  const x1 = W - inset;
  const y1 = H - inset;
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  if (r < 0.5) {
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  const seg = 8;
  const pts: Polygon = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i <= seg; i++) {
      const a = from + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2); // canto superior direito
  corner(x1 - r, y1 - r, 0);            // inferior direito
  corner(x0 + r, y1 - r, Math.PI / 2);  // inferior esquerdo
  corner(x0 + r, y0 + r, Math.PI);      // superior esquerdo
  return pts;
}

/** Elipse inscrita no canvas de W×H, encolhida `inset` px por lado. */
export function ellipsePolygon(W: number, H: number, inset: number): Polygon {
  const a = Math.max(1, W / 2 - inset);
  const b = Math.max(1, H / 2 - inset);
  const cx = W / 2;
  const cy = H / 2;
  const seg = 72;
  const pts: Polygon = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pts.push([cx + Math.cos(t) * a, cy + Math.sin(t) * b]);
  }
  return pts;
}

/** Dimensões do canvas da peça pra uma forma analítica envolvendo uma arte de
 * artW×artH com `total` px de folga por lado. Pra elipse, os semi-eixos
 * precisam de √2 por eixo pra conter os cantos do retângulo da arte. */
export function shapeCanvasSize(shape: CutShape, artW: number, artH: number, total: number): { W: number; H: number } {
  if (shape === 'elipse') {
    return {
      W: Math.ceil(artW * Math.SQRT2 + total * 2),
      H: Math.ceil(artH * Math.SQRT2 + total * 2),
    };
  }
  return { W: artW + total * 2, H: artH + total * 2 };
}

/** Polígono da forma no canvas W×H, encolhido `inset` px a partir da borda. */
export function shapePolygon(shape: CutShape, W: number, H: number, inset: number, cornerRadius: number): Polygon {
  if (shape === 'elipse') return ellipsePolygon(W, H, inset);
  if (shape === 'arredondado') return roundedRectPolygon(W, H, inset, cornerRadius - inset);
  return roundedRectPolygon(W, H, inset, 0);
}

export function fillPolygon(ctx: CanvasRenderingContext2D, poly: Polygon, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.fill();
}
