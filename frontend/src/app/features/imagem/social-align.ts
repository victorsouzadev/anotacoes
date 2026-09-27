/** Alinhamento das camadas do modo Redes sociais: alinhar a camada ao post,
 * guias magnéticas ao arrastar e a conta pra trocar o alinhamento do texto
 * sem a caixa sair do lugar.
 *
 * Tudo em fração do quadro. No carrossel o quadro é a faixa com todos os
 * posts, mas "alinhar" e "centro" valem para o post em que a camada está —
 * é ele que vai aparecer sozinho na tela. */

/** Caixa de uma camada, em fração do quadro (sem o giro aplicado). */
export interface FracBox {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
  locked?: boolean;
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Linha-guia desenhada na prévia enquanto uma camada gruda nela. */
export interface Guide {
  axis: 'x' | 'y';
  pos: number;
}

/** Margem de segurança das bordas, em fração da largura de um post: a mesma
 * da moldura dos modelos (48 px em 1080). */
export const ALIGN_MARGIN = 0.045;

/** Retângulo que a caixa ocupa depois do giro. */
export function aabb(b: FracBox, frameRatio: number): { l: number; r: number; t: number; b: number } {
  // O giro acontece em pixels: a largura em fração do quadro vale
  // `frameRatio` vezes mais que a altura.
  const a = (b.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const wPx = b.w * frameRatio, hPx = b.h;
  const halfW = (wPx * c + hPx * s) / 2 / frameRatio;
  const halfH = (wPx * s + hPx * c) / 2;
  return { l: b.cx - halfW, r: b.cx + halfW, t: b.cy - halfH, b: b.cy + halfH };
}

/** Início e fim (em fração do quadro) do post onde está o ponto x. */
export function slideRange(x: number, slides: number): [number, number] {
  const n = Math.max(1, slides);
  const i = Math.min(n - 1, Math.max(0, Math.floor(x * n)));
  return [i / n, (i + 1) / n];
}

/** Margens em fração do quadro. `slideRatio` é largura ÷ altura de um post. */
export function margins(slides: number, slideRatio: number): { mx: number; my: number } {
  const n = Math.max(1, slides);
  return { mx: ALIGN_MARGIN / n, my: ALIGN_MARGIN * slideRatio };
}

/** Quanto mover a camada pra alinhá-la ao post (dentro da margem). */
export function alignDelta(
  box: FracBox, mode: AlignMode, slides: number, slideRatio: number,
): { dx: number; dy: number } {
  const frameRatio = slideRatio * Math.max(1, slides);
  const r = aabb(box, frameRatio);
  const [s0, s1] = slideRange(box.cx, slides);
  const { mx, my } = margins(slides, slideRatio);
  switch (mode) {
    case 'left': return { dx: s0 + mx - r.l, dy: 0 };
    case 'hcenter': return { dx: (s0 + s1) / 2 - box.cx, dy: 0 };
    case 'right': return { dx: s1 - mx - r.r, dy: 0 };
    case 'top': return { dx: 0, dy: my - r.t };
    case 'vcenter': return { dx: 0, dy: 0.5 - box.cy };
    case 'bottom': return { dx: 0, dy: 1 - my - r.b };
  }
}

/** Guias magnéticas: dada a caixa já na posição que o arraste pede, devolve o
 * ajuste que a faz grudar na linha mais próxima (centro e margens do post,
 * bordas e centro das outras camadas) e as linhas pra desenhar.
 * `tx`/`ty` são a distância máxima, em fração do quadro. */
export function snapBox(
  moving: FracBox, others: FracBox[], slides: number, slideRatio: number, tx: number, ty: number,
  extra: { xs: number[]; ys: number[] } = { xs: [], ys: [] },
): { dx: number; dy: number; guides: Guide[] } {
  const frameRatio = slideRatio * Math.max(1, slides);
  const m = aabb(moving, frameRatio);
  const [s0, s1] = slideRange(moving.cx, slides);
  const { mx, my } = margins(slides, slideRatio);

  const xs = [s0 + mx, (s0 + s1) / 2, s1 - mx, ...extra.xs];
  const ys = [my, 0.5, 1 - my, ...extra.ys];
  for (const o of others) {
    if (o.id === moving.id) continue;
    const r = aabb(o, frameRatio);
    xs.push(r.l, o.cx, r.r);
    ys.push(r.t, o.cy, r.b);
  }

  const best = (cands: number[], targets: number[], limit: number) => {
    let found: { d: number; pos: number } | null = null;
    for (const c of cands) {
      for (const t of targets) {
        const d = t - c;
        if (Math.abs(d) <= limit && (!found || Math.abs(d) < Math.abs(found.d))) found = { d, pos: t };
      }
    }
    return found;
  };

  const bx = best([m.l, moving.cx, m.r], xs, tx);
  const by = best([m.t, moving.cy, m.b], ys, ty);
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: 'x', pos: bx.pos });
  if (by) guides.push({ axis: 'y', pos: by.pos });
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides };
}

/** Trocar o alinhamento do texto muda o que `x` significa (borda esquerda,
 * centro ou borda direita). Esta é a posição nova que mantém a caixa onde ela
 * está. `pad` é a meia margem interna da caixa, em fração do quadro. */
export function anchorForAlign(box: FracBox, align: 'left' | 'center' | 'right', pad: number): number {
  if (align === 'left') return box.cx - box.w / 2 + pad;
  if (align === 'right') return box.cx + box.w / 2 - pad;
  return box.cx;
}

/** Caixa que envolve várias camadas (já contando o giro de cada uma). */
export function groupBox(boxes: FracBox[], frameRatio: number): FracBox {
  const rs = boxes.map((b) => aabb(b, frameRatio));
  const l = Math.min(...rs.map((r) => r.l)), r = Math.max(...rs.map((x) => x.r));
  const t = Math.min(...rs.map((x) => x.t)), b = Math.max(...rs.map((x) => x.b));
  return { id: '__grupo__', cx: (l + r) / 2, cy: (t + b) / 2, w: r - l, h: b - t, rotation: 0 };
}

export type Deltas = Map<string, { dx: number; dy: number }>;

/** Alinha as camadas entre si: todas encostam na borda (ou no centro) da
 * caixa que envolve o grupo. */
export function alignWithin(boxes: FracBox[], mode: AlignMode, frameRatio: number): Deltas {
  const out: Deltas = new Map();
  if (boxes.length < 2) return out;
  const g = aabb(groupBox(boxes, frameRatio), frameRatio);
  for (const b of boxes) {
    const r = aabb(b, frameRatio);
    let dx = 0, dy = 0;
    if (mode === 'left') dx = g.l - r.l;
    if (mode === 'right') dx = g.r - r.r;
    if (mode === 'hcenter') dx = (g.l + g.r) / 2 - b.cx;
    if (mode === 'top') dy = g.t - r.t;
    if (mode === 'bottom') dy = g.b - r.b;
    if (mode === 'vcenter') dy = (g.t + g.b) / 2 - b.cy;
    out.set(b.id, { dx, dy });
  }
  return out;
}

/** Distribui as camadas com o mesmo espaço entre elas, sem mexer nas duas
 * das pontas. Precisa de três ou mais. */
export function distribute(boxes: FracBox[], axis: 'x' | 'y', frameRatio: number): Deltas {
  const out: Deltas = new Map();
  if (boxes.length < 3) return out;
  const items = boxes
    .map((b) => ({ b, r: aabb(b, frameRatio) }))
    .sort((p, q) => (axis === 'x' ? p.r.l - q.r.l : p.r.t - q.r.t));
  const start = axis === 'x' ? items[0].r.l : items[0].r.t;
  const end = axis === 'x' ? Math.max(...items.map((i) => i.r.r)) : Math.max(...items.map((i) => i.r.b));
  const sizes = items.map((i) => (axis === 'x' ? i.r.r - i.r.l : i.r.b - i.r.t));
  const gap = (end - start - sizes.reduce((a, v) => a + v, 0)) / (items.length - 1);
  let pos = start;
  items.forEach((i, k) => {
    const cur = axis === 'x' ? i.r.l : i.r.t;
    const d = pos - cur;
    out.set(i.b.id, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    pos += sizes[k] + gap;
  });
  return out;
}

/** Linhas da grade, em fração do quadro: `cols` colunas em cada post (entre
 * as margens) e `rows` linhas na altura. */
export function gridLines(slides: number, slideRatio: number, cols: number, rows: number): { xs: number[]; ys: number[] } {
  const n = Math.max(1, slides);
  const { mx, my } = margins(n, slideRatio);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = i / n + mx, s1 = (i + 1) / n - mx;
    for (let c = 0; c <= cols; c++) xs.push(s0 + ((s1 - s0) * c) / Math.max(1, cols));
  }
  const ys: number[] = [];
  for (let r = 0; r <= rows; r++) ys.push(my + ((1 - 2 * my) * r) / Math.max(1, rows));
  return { xs, ys };
}
