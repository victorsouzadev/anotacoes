import { describe, expect, it } from 'vitest';
import { transparentRegions } from './png-template';
import { applyTextEdits, listTemplateTexts, parseTemplateSvg } from './svg-template';

describe('molde de PNG', () => {
  it('acha a janela fechada e ignora o fundo que toca a borda', () => {
    // 8×6: fundo transparente em volta, moldura opaca, janela 2×2 no meio
    const w = 8, h = 6;
    const a = new Uint8Array(w * h);
    for (let y = 1; y < 5; y++) for (let x = 1; x < 7; x++) a[y * w + x] = 255;
    for (let y = 2; y < 4; y++) for (let x = 3; x < 5; x++) a[y * w + x] = 0;
    const r = transparentRegions(a, w, h);
    const fechadas = r.sizes.filter((_, i) => !r.border[i]);
    expect(fechadas).toEqual([4]);
    expect(r.border.filter(Boolean).length).toBe(1);
  });
});

describe('textos do molde', () => {
  it('troca o texto e a cor, e volta ao original sem edição', () => {
    const parsed = parseTemplateSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text fill="#111111">Olá</text><text><tspan>A</tspan><tspan>B</tspan></text></svg>');
    const originals = listTemplateTexts(parsed.root);
    expect(originals.map((t) => t.lines)).toEqual([['Olá'], ['A', 'B']]);
    applyTextEdits(parsed.root, originals, { 0: { text: 'Oi', color: '#ff0000' }, 1: { text: 'X\nY' } });
    const texts = parsed.root.querySelectorAll('text');
    expect(texts[0].textContent).toBe('Oi');
    expect(texts[0].getAttribute('fill')).toBe('#ff0000');
    expect([...texts[1].querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['X', 'Y']);
    applyTextEdits(parsed.root, originals, {});
    expect(texts[0].textContent).toBe('Olá');
    expect([...texts[1].querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['A', 'B']);
  });
});
