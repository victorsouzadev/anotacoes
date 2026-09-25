import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { compactar, slugDoNome, tamanhoLegivel } from './pacote';

describe('slugDoNome', () => {
  it('tira acento, espaço e maiúscula', () => {
    expect(slugDoNome('Recados da Família')).toBe('recados-da-familia');
    expect(slugDoNome('  App -- de   Teste!! ')).toBe('app-de-teste');
  });

  it('respeita o limite de 30 caracteres sem terminar em hífen', () => {
    const s = slugDoNome('um nome muito comprido para caber no endereço');
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('tamanhoLegivel', () => {
  it('escolhe a unidade', () => {
    expect(tamanhoLegivel(500)).toBe('500 B');
    expect(tamanhoLegivel(2048)).toBe('2 KB');
    expect(tamanhoLegivel(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('compactar', () => {
  it('mantém os caminhos da pasta e ignora lixo do sistema', async () => {
    const arquivo = (nome: string, conteudo: string) => new File([conteudo], nome);
    const zip = await compactar([
      { caminho: 'meu-app/web/index.html', arquivo: arquivo('index.html', '<h1>oi</h1>') },
      { caminho: 'meu-app/api/App.dll', arquivo: arquivo('App.dll', 'MZ') },
      { caminho: 'meu-app/.DS_Store', arquivo: arquivo('.DS_Store', 'x') },
    ]);
    const conteudo = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(conteudo).sort()).toEqual(['meu-app/api/App.dll', 'meu-app/web/index.html']);
    expect(strFromU8(conteudo['meu-app/web/index.html'])).toBe('<h1>oi</h1>');
  });
});
