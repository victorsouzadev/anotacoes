/** Escritor de ZIP sem compressão (método "store"), em ~80 linhas: o editor
 * exporta um SVG por elemento, e baixar seis arquivos um a um — cada um com
 * seu diálogo do navegador — não é exportar, é tarefa. SVG é texto e o ganho
 * do deflate não paga trazer uma biblioteca de compressão pro bundle. */

const CRC_TABLE = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  content: string | Uint8Array;
}

/** Data/hora no formato MS-DOS que o ZIP usa (segundos com passo de 2). */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipStore(entries: ZipEntry[], now = new Date()): Blob {
  const encoder = new TextEncoder();
  // TextEncoder sempre devolve um Uint8Array sobre ArrayBuffer comum; o tipo
  // largo da lib (que admite SharedArrayBuffer) é que não serve pro Blob.
  const encode = (texto: string): Uint8Array<ArrayBuffer> =>
    encoder.encode(texto) as Uint8Array<ArrayBuffer>;
  const { time, date } = dosDateTime(now);
  const partes: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nome = encode(entry.name);
    const dados = typeof entry.content === 'string' ? encode(entry.content) : new Uint8Array(entry.content);
    const crc = crc32(dados);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versão necessária
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint16(8, 0, true); // sem compressão
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partes.push(local.buffer, nome, dados);

    const dir = new Uint8Array(46 + nome.length);
    const view = new DataView(dir.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true); // versão de quem escreveu
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, time, true);
    view.setUint16(14, date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, dados.length, true);
    view.setUint32(24, dados.length, true);
    view.setUint16(28, nome.length, true);
    view.setUint32(42, offset, true);
    dir.set(nome, 46);
    central.push(dir);

    offset += 30 + nome.length + dados.length;
  }

  const tamanhoCentral = central.reduce((s, d) => s + d.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, entries.length, true);
  fim.setUint16(10, entries.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, offset, true);
  partes.push(...central, fim.buffer);

  return new Blob(partes, { type: 'application/zip' });
}

/** Nome de arquivo seguro dentro do ZIP: sem barra, sem acento perdido no
 * caminho e sem dois arquivos com o mesmo nome se sobrescrevendo. */
export function uniqueNames(names: string[]): string[] {
  const usados = new Map<string, number>();
  return names.map((name) => {
    const limpo = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim() || 'arquivo';
    const n = usados.get(limpo) ?? 0;
    usados.set(limpo, n + 1);
    if (!n) return limpo;
    const ponto = limpo.lastIndexOf('.');
    return ponto > 0 ? `${limpo.slice(0, ponto)}-${n + 1}${limpo.slice(ponto)}` : `${limpo}-${n + 1}`;
  });
}
