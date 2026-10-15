import { describe, expect, it } from 'vitest';
import { inline, parseMarkdown } from './markdown';

describe('markdown do Cérebro', () => {
  it('reconhece wikilinks com rótulo e âncora', () => {
    expect(inline('Ver [[Pessoas/Pedro#Contato|o Pedro]] e [[GPPv2]].')).toEqual([
      { t: 'text', v: 'Ver ' },
      { t: 'wiki', alvo: 'Pessoas/Pedro', rotulo: 'o Pedro' },
      { t: 'text', v: ' e ' },
      { t: 'wiki', alvo: 'GPPv2', rotulo: 'GPPv2' },
      { t: 'text', v: '.' },
    ]);
  });

  it('só deixa clicáveis links http(s) e mailto', () => {
    expect(inline('[ok](https://x.com) [ruim](javascript:alert(1))')).toEqual([
      { t: 'link', href: 'https://x.com', v: 'ok' },
      { t: 'text', v: ' [ruim](javascript:alert(1))' },
    ]);
  });

  it('negrito, itálico, código, tags e URL solta', () => {
    const r = inline('**a** *b* _c_ `d` #ideia/ia #2026 https://ex.com/p');
    expect(r.filter((x) => x.t !== 'text')).toEqual([
      { t: 'b', v: 'a' },
      { t: 'i', v: 'b' },
      { t: 'i', v: 'c' },
      { t: 'code', v: 'd' },
      { t: 'tag', v: 'ideia/ia' },
      { t: 'link', href: 'https://ex.com/p', v: 'https://ex.com/p' },
    ]);
  });

  it('blocos: título, callout, checklist, listas, código e parágrafo', () => {
    const blocos = parseMarkdown([
      '# Título',
      '',
      '> [!summary] Resumo',
      '> Uma frase.',
      '',
      '- [ ] fazer',
      '- [x] feito',
      '- item',
      '1. um',
      '```',
      '# não é título',
      '```',
      'linha um',
      'linha dois',
      '---',
    ].join('\n'));
    expect(blocos.map((b) => b.t)).toEqual(['h', 'quote', 'todo', 'ul', 'ol', 'code', 'p', 'hr']);
    expect(blocos[1]).toMatchObject({ t: 'quote', tipo: 'summary', linhas: [[{ t: 'text', v: 'Uma frase.' }]] });
    expect(blocos[2]).toMatchObject({ t: 'todo', itens: [{ feito: false }, { feito: true }] });
    expect(blocos[5]).toEqual({ t: 'code', v: '# não é título' });
    expect(blocos[6]).toEqual({ t: 'p', inl: [{ t: 'text', v: 'linha um linha dois' }] });
  });
});
