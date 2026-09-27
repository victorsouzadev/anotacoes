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
): { dx: number; dy: number; guides: Guide[] } {
  const frameRatio = slideRatio * Math.max(1, slides);
  const m = aabb(moving, frameRatio);
  const [s0, s1] = slideRange(moving.cx, slides);
  const { mx, my } = margins(slides, slideRatio);

  const xs = [s0 + mx, (s0 + s1) / 2, s1 - mx];
  const ys = [my, 0.5, 1 - my];
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
