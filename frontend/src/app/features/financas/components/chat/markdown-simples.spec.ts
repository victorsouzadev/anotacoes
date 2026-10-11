import { describe, expect, it } from 'vitest';
import { markdownSimples } from './markdown-simples';

describe('markdownSimples', () => {
  it('escapa HTML', () => {
    expect(markdownSimples('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('formata negrito, listas e tabelas', () => {
    const html = markdownSimples('Total **R$ 10**\n\n- a\n- b\n\n| Cat | Valor |\n|---|---|\n| Lazer | 5 |');
    expect(html).toContain('<strong>R$ 10</strong>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('<th>Cat</th>');
    expect(html).toContain('<td>Lazer</td>');
  });
});
