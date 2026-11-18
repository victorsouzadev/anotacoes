/** Gerador de PDF mínimo, sem dependência: páginas com uma imagem JPEG de fundo e operadores de
 * desenho. Usado pelo Editor de Imagens (folhas de impressão e corte) e pelo PDF das Notas. */

export const MM_TO_PT = 72 / 25.4;

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
