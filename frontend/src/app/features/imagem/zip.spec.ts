import { describe, expect, it } from 'vitest';
import { crc32, uniqueNames, zipStore } from './zip';

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('crc32', () => {
  it('bate com o valor conhecido de "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('zipStore', () => {
  it('escreve assinaturas, contagem e o conteúdo de cada arquivo', async () => {
    const zip = await bytes(zipStore([
      { name: 'a.svg', content: '<svg id="a"/>' },
      { name: 'b.svg', content: '<svg id="b"/>' },
    ]));
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // primeiro arquivo local
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50); // fim do diretório
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(2); // dois arquivos

    const texto = new TextDecoder().decode(zip);
    expect(texto).toContain('<svg id="a"/>');
    expect(texto).toContain('<svg id="b"/>');
    expect(texto).toContain('a.svg');
  });

  it('aponta o diretório central pro deslocamento certo de cada arquivo', async () => {
    const zip = await bytes(zipStore([{ name: 'x.svg', content: 'xyz' }]));
    const view = new DataView(zip.buffer);
    const inicioCentral = 30 + 'x.svg'.length + 3;
    expect(view.getUint32(inicioCentral, true)).toBe(0x02014b50);
    expect(view.getUint32(inicioCentral + 42, true)).toBe(0); // único arquivo, no início
    expect(view.getUint32(inicioCentral + 16, true)).toBe(crc32(new TextEncoder().encode('xyz')));
  });

  it('zip vazio ainda é um zip válido', async () => {
    const zip = await bytes(zipStore([]));
    expect(zip.length).toBe(22);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x06054b50);
  });
});

describe('uniqueNames', () => {
  it('numera repetidos antes da extensão e limpa caractere de caminho', () => {
    expect(uniqueNames(['polvo.svg', 'polvo.svg', 'a/b.svg'])).toEqual([
      'polvo.svg', 'polvo-2.svg', 'a-b.svg',
    ]);
  });
});
