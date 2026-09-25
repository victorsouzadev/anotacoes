/** Simulação do corte: a lâmina percorre as linhas na ordem em que a máquina
 * cortaria, por cima da prévia. Serve pra conferir o que vai ser cortado (e o
 * que não vai) antes de gastar material. */

import { CubicPath, Point } from './contour';

/** Uma linha de corte já no espaço do canvas, como polilinha. */
export type SimLine = Point[];

export function flattenCubic(path: CubicPath, map: (p: Point) => Point, steps = 10): SimLine {
  const out: Point[] = [map(path.start)];
  let a = path.start;
  for (const s of path.segments) {
    if (s.c1 && s.c2) {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
        out.push(map([
          w0 * a[0] + w1 * s.c1[0] + w2 * s.c2[0] + w3 * s.to[0],
          w0 * a[1] + w1 * s.c1[1] + w2 * s.c2[1] + w3 * s.to[1],
        ]));
      }
    } else {
      out.push(map(s.to));
    }
    a = s.to;
  }
  out.push(out[0]);
  return out;
}

export function lineLength(line: SimLine): number {
  let l = 0;
  for (let i = 1; i < line.length; i++) l += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return l;
}

/** Roda a animação no canvas: guarda a imagem de base e redesenha o trecho já
 * cortado a cada quadro. Devolve uma função que interrompe. */
export function animateCut(canvas: HTMLCanvasElement, lines: SimLine[], durationMs: number, lineWidth: number, onEnd: () => void): () => void {
  const ctx = canvas.getContext('2d')!;
  const base = document.createElement('canvas');
  base.width = canvas.width;
  base.height = canvas.height;
  base.getContext('2d')!.drawImage(canvas, 0, 0);
  const lens = lines.map(lineLength);
  const total = lens.reduce((s, l) => s + l, 0) || 1;
  let raf = 0;
  const t0 = performance.now();
  const frame = (now: number): void => {
    const k = Math.min(1, (now - t0) / durationMs);
    let budget = k * total;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.save();
    ctx.strokeStyle = '#d00000';
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let blade: Point | null = null;
    for (let i = 0; i < lines.length && budget > 0; i++) {
      const line = lines[i];
      ctx.beginPath();
      ctx.moveTo(line[0][0], line[0][1]);
      blade = line[0];
      for (let j = 1; j < line.length && budget > 0; j++) {
        const [x0, y0] = line[j - 1], [x1, y1] = line[j];
        const seg = Math.hypot(x1 - x0, y1 - y0);
        if (seg <= budget) {
          ctx.lineTo(x1, y1);
          blade = line[j];
          budget -= seg;
        } else {
          const f = budget / seg;
          blade = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
          ctx.lineTo(blade[0], blade[1]);
          budget = 0;
        }
      }
      ctx.stroke();
    }
    if (blade && k < 1) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#d00000';
      ctx.lineWidth = Math.max(1, lineWidth * 0.7);
      ctx.beginPath();
      ctx.arc(blade[0], blade[1], lineWidth * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    if (k < 1) raf = requestAnimationFrame(frame);
    else onEnd();
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
