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

/** Monta um PDF de página única com o JPEG ocupando a página inteira, no
 * tamanho físico em mm. Estrutura mínima: catálogo, página, conteúdo e o
 * XObject de imagem com DCTDecode (JPEG cru, sem recomprimir). */
export function jpegToPdf(jpeg: Uint8Array, wMm: number, hMm: number, pxW: number, pxH: number): Blob {
  const wPt = wMm * MM_TO_PT;
  const hPt = hMm * MM_TO_PT;
  const enc = new TextEncoder();

  const content = `q\n${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
  const contentBytes = enc.encode(content);

  const objects: Uint8Array[] = [];
  const push = (s: string): void => { objects.push(enc.encode(s)); };

  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] ` +
    `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );
  push(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  objects.push(contentBytes);
  push('endstream\nendobj\n');
  push(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  objects.push(jpeg);
  push('\nendstream\nendobj\n');

  const header = enc.encode('%PDF-1.4\n%âãÏÓ\n');
  // offsets em bytes de cada objeto numerado (1..5)
  const offsets: number[] = [];
  let pos = header.length;
  const objStarts = [0, 1, 2, 3, 6]; // índice em `objects` onde cada obj (1..5) começa
  for (let i = 0; i < objects.length; i++) {
    if (objStarts.includes(i)) offsets.push(pos);
    pos += objects[i].length;
  }

  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;

  const parts: Uint8Array[] = [header, ...objects, enc.encode(xref + trailer)];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(totalLen);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return new Blob([out], { type: 'application/pdf' });
}
