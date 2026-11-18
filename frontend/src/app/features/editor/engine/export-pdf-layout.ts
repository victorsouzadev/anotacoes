/** Encaixe de uma página da nota numa página de PDF (spec 019). Puro, sem DOM. */

export type TamanhoPdf = 'a4' | 'conteudo';

export interface Caixa {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LayoutPdf {
  wMm: number;
  hMm: number;
  /** Tamanho do canvas que vira a imagem da página, em pixels reais. */
  pxW: number;
  pxH: number;
  /** Pixels por unidade do mundo da nota e o ponto do mundo no canto de cima à esquerda. */
  escala: number;
  offsetX: number;
  offsetY: number;
  paisagem: boolean;
}

export const DPI_PDF = 200;
const MARGEM_MM = 12;
const PADDING_MUNDO = 40;
/** O mundo da nota é medido em px de CSS (96 por polegada). */
const PX_CSS_POR_MM = 96 / 25.4;
const PX_PDF_POR_MM = DPI_PDF / 25.4;
/** Tamanho real: 1 px de CSS vira o equivalente físico no PDF; não amplia além disso. */
const ESCALA_REAL = DPI_PDF / 96;

function escalaA4(w: number, h: number, paisagem: boolean): number {
  const areaW = ((paisagem ? 297 : 210) - MARGEM_MM * 2) * PX_PDF_POR_MM;
  const areaH = ((paisagem ? 210 : 297) - MARGEM_MM * 2) * PX_PDF_POR_MM;
  return Math.min(areaW / w, areaH / h, ESCALA_REAL);
}

export function layoutPdf(caixa: Caixa | null, tamanho: TamanhoPdf): LayoutPdf {
  const vazia = caixa === null;
  const b = caixa ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);

  if (tamanho === 'conteudo' && !vazia) {
    const wMm = (w + PADDING_MUNDO * 2) / PX_CSS_POR_MM;
    const hMm = (h + PADDING_MUNDO * 2) / PX_CSS_POR_MM;
    return {
      wMm, hMm,
      pxW: Math.round(wMm * PX_PDF_POR_MM),
      pxH: Math.round(hMm * PX_PDF_POR_MM),
      escala: ESCALA_REAL,
      offsetX: b.minX - PADDING_MUNDO,
      offsetY: b.minY - PADDING_MUNDO,
      paisagem: wMm > hMm,
    };
  }

  // Paisagem só quando ela deixa o conteúdo bem maior (25%) que em pé: uma linha de texto larga
  // num caderno continua em pé, um diagrama largo vira paisagem.
  const paisagem = !vazia && escalaA4(w, h, true) > escalaA4(w, h, false) * 1.25;
  const wMm = paisagem ? 297 : 210;
  const hMm = paisagem ? 210 : 297;
  const pxW = Math.round(wMm * PX_PDF_POR_MM);
  const pxH = Math.round(hMm * PX_PDF_POR_MM);
  const margem = MARGEM_MM * PX_PDF_POR_MM;
  const areaW = pxW - margem * 2;
  const areaH = pxH - margem * 2;
  const escala = Math.min(areaW / w, areaH / h, ESCALA_REAL);
  // Centralizado na horizontal e encostado em cima, como uma folha escrita.
  const esquerda = margem + (areaW - w * escala) / 2;
  return {
    wMm, hMm, pxW, pxH, escala,
    offsetX: b.minX - esquerda / escala,
    offsetY: b.minY - margem / escala,
    paisagem,
  };
}
