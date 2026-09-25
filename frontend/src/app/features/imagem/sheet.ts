/** Folha de montagem: empacotamento das peças em folha A4/A3 (shelf packing) e
 * gerador de PDF mínimo (uma página com a folha como JPEG embutido), pra
 * imprimir no tamanho físico exato sem depender de biblioteca externa. */

export type SheetSize = 'A4' | 'A3';
export type SheetOrientation = 'retrato' | 'paisagem';

const SHEET_MM: Record<SheetSize, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
};

export function sheetDimensionsMm(size: SheetSize, orientation: SheetOrientation): { wMm: number; hMm: number } {
  const [w, h] = SHEET_MM[size];
  return orientation === 'retrato' ? { wMm: w, hMm: h } : { wMm: h, hMm: w };
}

export interface PackInput {
  id: string;
  wMm: number;
  hMm: number;
}

export interface PlacedPiece extends PackInput {
  xMm: number;
  yMm: number;
  rot?: Rotation;
}

export interface PackResult {
  placed: PlacedPiece[];
  overflow: PackInput[];
}

/** Empacota em prateleiras (linhas): ordena por altura decrescente e preenche
 * linha a linha. Simples e previsível — bom o bastante pra folhas de corte. */
export function packShelves(
  pieces: PackInput[],
  sheetWMm: number,
  sheetHMm: number,
  sheetMarginMm: number,
  spacingMm: number,
): PackResult {
  const usableW = sheetWMm - sheetMarginMm * 2;
  const usableH = sheetHMm - sheetMarginMm * 2;
  const sorted = [...pieces].sort((a, b) => b.hMm - a.hMm);
  const placed: PlacedPiece[] = [];
  const overflow: PackInput[] = [];

  let x = 0;
  let y = 0;
  let shelfH = 0;
  for (const p of sorted) {
    if (p.wMm > usableW || p.hMm > usableH) {
      overflow.push(p);
      continue;
    }
    if (x + p.wMm > usableW + 1e-6) {
      // próxima prateleira
      x = 0;
      y += shelfH + spacingMm;
      shelfH = 0;
    }
    if (y + p.hMm > usableH + 1e-6) {
      overflow.push(p);
      continue;
    }
    placed.push({ ...p, xMm: sheetMarginMm + x, yMm: sheetMarginMm + y });
    x += p.wMm + spacingMm;
    shelfH = Math.max(shelfH, p.hMm);
  }
  return { placed, overflow };
}

const MM_TO_PT = 72 / 25.4;

/** Peça posta na folha. `wMm`/`hMm` são da caixa já girada; `rot` é o giro
 * da peça em volta do próprio centro. */
export type Rotation = 0 | 90 | 180 | 270;

// ---------- marcas de registro ----------

/** Área reservada às marcas nas bordas da folha (a peça não entra ali). */
export const REG_MARGIN_MM = 20;
const REG_INSET_MM = 10;
const REG_SQUARE_MM = 5;
const REG_ARM_MM = 20;
const REG_LINE_MM = 0.5;

export interface MarkRect { x: number; y: number; w: number; h: number }

/** Marcas no padrão das plotters de impressão-e-corte (quadrado cheio no canto
 * de cima à esquerda, cantoneiras nos outros dois): o leitor óptico acha a
 * folha por elas. Em mm, como retângulos cheios. */
export function registrationMarks(wMm: number, hMm: number): MarkRect[] {
  const i = REG_INSET_MM, a = REG_ARM_MM, t = REG_LINE_MM;
  return [
    { x: i, y: i, w: REG_SQUARE_MM, h: REG_SQUARE_MM },
    // cima à direita
    { x: wMm - i - a, y: i, w: a, h: t },
    { x: wMm - i - t, y: i, w: t, h: a },
    // baixo à esquerda
    { x: i, y: hMm - i - t, w: a, h: t },
    { x: i, y: hMm - i - a, w: t, h: a },
  ];
}

// ---------- PDF ----------

export interface PdfPage {
  wMm: number;
  hMm: number;
  /** Operadores de desenho, já em pontos (origem embaixo à esquerda). */
  content: string;
  /** Imagem que cobre a página inteira, desenhada antes do conteúdo. */
  image?: { jpeg: Uint8Array; pxW: number; pxH: number };
}

/** PDF mínimo de várias páginas: catálogo, páginas, conteúdos e imagens JPEG
 * (DCTDecode, sem recomprimir). */
export function buildPdf(pages: PdfPage[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const add = (b: Uint8Array): void => { chunks.push(b); pos += b.length; };
  const header = enc.encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  add(header);

  // numeração: 1 catálogo, 2 páginas, depois 3 objetos por página (página, conteúdo, imagem)
  const pageIds = pages.map((_, k) => 3 + k * 3);
  const obj = (id: number, body: Uint8Array[]): void => {
    offsets[id] = pos;
    add(enc.encode(`${id} 0 obj\n`));
    for (const b of body) add(b);
    add(enc.encode('\nendobj\n'));
  };
  obj(1, [enc.encode('<< /Type /Catalog /Pages 2 0 R >>')]);
  obj(2, [enc.encode(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`)]);
  pages.forEach((pg, k) => {
    const id = pageIds[k];
    const wPt = pg.wMm * MM_TO_PT, hPt = pg.hMm * MM_TO_PT;
    const img = pg.image ? `q\n${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n` : '';
    const content = enc.encode(img + pg.content);
    const res = pg.image ? `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> ` : '/Resources << >> ';
    obj(id, [enc.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] ${res}/Contents ${id + 1} 0 R >>`)]);
    obj(id + 1, [enc.encode(`<< /Length ${content.length} >>\nstream\n`), content, enc.encode('\nendstream')]);
    if (pg.image) {
      obj(id + 2, [
        enc.encode(`<< /Type /XObject /Subtype /Image /Width ${pg.image.pxW} /Height ${pg.image.pxH} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.image.jpeg.length} >>\nstream\n`),
        pg.image.jpeg,
        enc.encode('\nendstream'),
      ]);
    } else {
      obj(id + 2, [enc.encode('null')]);
    }
  });
  const size = 3 + pages.length * 3;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id++) xref += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  const startxref = pos;
  add(enc.encode(xref + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`));
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return new Blob([out], { type: 'application/pdf' });
}

/** Monta um PDF de página única com o JPEG ocupando a página inteira, no
 * tamanho físico em mm. */
export function jpegToPdf(jpeg: Uint8Array, wMm: number, hMm: number, pxW: number, pxH: number): Blob {
  return buildPdf([{ wMm, hMm, content: '', image: { jpeg, pxW, pxH } }]);
}

type Pt = [number, number];
interface CubicSeg { c1: Pt | null; c2: Pt | null; to: Pt }

/** Caminhos em mm (origem em cima) como operadores de PDF em pontos. */
export function pdfPathOps(paths: { start: Pt; segments: CubicSeg[] }[], hMm: number): string {
  const k = MM_TO_PT;
  const p = ([x, y]: Pt): string => `${(x * k).toFixed(2)} ${((hMm - y) * k).toFixed(2)}`;
  let out = '';
  for (const path of paths) {
    if (!path.segments.length) continue;
    out += `${p(path.start)} m\n`;
    for (const s of path.segments) out += s.c1 && s.c2 ? `${p(s.c1)} ${p(s.c2)} ${p(s.to)} c\n` : `${p(s.to)} l\n`;
    out += 'h\n';
  }
  return out;
}

export function pdfRectOps(rects: MarkRect[], hMm: number): string {
  const k = MM_TO_PT;
  return rects.map((r) => `${(r.x * k).toFixed(2)} ${((hMm - r.y - r.h) * k).toFixed(2)} ${(r.w * k).toFixed(2)} ${(r.h * k).toFixed(2)} re f\n`).join('');
}
