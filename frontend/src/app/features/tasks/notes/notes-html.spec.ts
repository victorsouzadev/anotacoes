import { describe, expect, it } from 'vitest';
import {
  attachmentIdsInNotes,
  isNotesEmpty,
  notesToPlainText,
  sanitizeNotesHtml,
  stripNotesImages,
  withResolvedImages,
} from './notes-html';

describe('sanitizeNotesHtml', () => {
  it('mantém a formatação permitida', () => {
    const html = sanitizeNotesHtml('<p>Oi <b>forte</b> e <i>torto</i></p><ul><li>um</li></ul>');
    expect(html).toBe('<p>Oi <b>forte</b> e <i>torto</i></p><ul><li>um</li></ul>');
  });

  it('remove script e mantém o texto ao redor', () => {
    const html = sanitizeNotesHtml('<p>antes</p><script>alert(1)</script><p>depois</p>');
    expect(html).toBe('<p>antes</p><p>depois</p>');
  });

  it('remove atributos de evento e estilo', () => {
    const html = sanitizeNotesHtml('<p onclick="hack()" style="color:red">texto</p>');
    expect(html).toBe('<p>texto</p>');
  });

  it('descarta href com javascript:', () => {
    const html = sanitizeNotesHtml('<a href="javascript:alert(1)">clique</a>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('clique');
  });

  it('marca links externos como noopener', () => {
    const html = sanitizeNotesHtml('<a href="https://exemplo.com">link</a>');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('desembrulha tags sem papel próprio', () => {
    expect(sanitizeNotesHtml('<div><span>texto</span></div>')).toBe('texto');
  });

  it('normaliza strike/del para s', () => {
    expect(sanitizeNotesHtml('<strike>ido</strike>')).toBe('<s>ido</s>');
  });

  it('descarta o src volátil da imagem, preservando o id do anexo', () => {
    const html = sanitizeNotesHtml('<img data-attachment-id="a1" alt="foto" src="blob:http://x/1">');
    expect(html).toContain('data-attachment-id="a1"');
    expect(html).toContain('alt="foto"');
    expect(html).not.toContain('src=');
  });

  it('remove imagem sem anexo por trás', () => {
    expect(sanitizeNotesHtml('<img src="https://externo/x.png">')).toBe('');
  });

  it('trata nulo como vazio', () => {
    expect(sanitizeNotesHtml(null)).toBe('');
  });
});

describe('leitura das anotações', () => {
  it('extrai o texto puro', () => {
    expect(notesToPlainText('<p>uma <b>coisa</b></p><p>outra</p>')).toBe('uma coisa outra');
  });

  it('considera vazia uma anotação só com marcação', () => {
    expect(isNotesEmpty('<p><br></p>')).toBe(true);
    expect(isNotesEmpty(null)).toBe(true);
  });

  it('não considera vazia uma anotação só com imagem', () => {
    expect(isNotesEmpty('<img data-attachment-id="a1">')).toBe(false);
  });

  it('lista os anexos citados sem repetir', () => {
    const html = '<img data-attachment-id="a1"><p>x</p><img data-attachment-id="a1"><img data-attachment-id="a2">';
    expect(attachmentIdsInNotes(html)).toEqual(['a1', 'a2']);
  });
});

describe('transformações', () => {
  it('remove imagens preservando o texto', () => {
    expect(stripNotesImages('<p>fica</p><img data-attachment-id="a1">')).toBe('<p>fica</p>');
  });

  it('resolve o src das imagens para exibição', () => {
    const html = withResolvedImages('<img data-attachment-id="a1">', (id) => (id === 'a1' ? 'blob:x' : null));
    expect(html).toContain('src="blob:x"');
  });

  it('deixa sem src o anexo que não resolveu', () => {
    const html = withResolvedImages('<img data-attachment-id="sumiu" src="blob:velho">', () => null);
    expect(html).not.toContain('src=');
  });
});
