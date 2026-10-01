import { describe, expect, it } from 'vitest';
import { flattenPath, pathsBounds } from '../imagem/illustration-model';
import { aplicarValores, catalogoParaIa } from './analise-ia.service';
import { CAIXA_MILK, PIRAMIDE } from './caixas';
import { MOLDE_DE_FOTO, tamanhoDoPapel } from './decalque-tipo';
import { comprimento, linha, retangulo } from './geometria';
import { caixaSilhueta, pedacoDaTira } from './silhueta';

// estrela "desenhada" em px, como sairia da silhueta de um PNG sem fundo
const estrela: [number, number][] = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 120 : 280;
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  return [300 + r * Math.cos(a), 300 + r * Math.sin(a)];
});
const imagem = { src: 'data:image/png;base64,AA', w: 600, h: 600, contorno: estrela };

describe('caixa no formato do desenho', () => {
  const p = { largura: 10, profundidade: 4, borda: 3, verso: 'espelho', corFundo: '#fff', maxTira: 26, aba: 8, papel: '0.25' };

  it('frente e verso espelhados, lateral do tamanho do perímetro', () => {
    const m = caixaSilhueta(p, { fonte: null, imagem });
    const [frente, verso, ...laterais] = m.pecas;
    expect(frente.nome).toBe('Frente');
    expect(verso.nome).toBe('Verso');
    const bf = pathsBounds(frente.corte)!;
    expect(bf.maxX - bf.minX).toBeCloseTo(100, 0);
    const bv = pathsBounds(verso.corte)!;
    expect(bv.minX).toBeCloseTo(-bf.maxX, 3);
    expect(verso.arte?.foto?.espelhar).toBe(true);
    // a foto do verso é a da frente refletida em x = 0
    const ff = frente.arte!.foto!, fv = verso.arte!.foto!;
    expect(fv.x).toBeCloseTo(-(ff.x + ff.w), 6);
    expect(fv.y).toBeCloseTo(ff.y, 6);
    // as laterais somadas dão a volta inteira (o perímetro + a folga do papel)
    const perimetro = comprimento(frente.corte[0]);
    const soma = laterais.reduce((s, l) => s + (pathsBounds([l.dobra[0]])!.maxX - pathsBounds([l.dobra[0]])!.minX), 0);
    expect(soma).toBeCloseTo(perimetro + Math.PI * 0.5, 1);
    // cada pedaço cabe no comprimento máximo
    for (const l of laterais) expect(pathsBounds([l.dobra[0]])!.maxX).toBeLessThanOrEqual(260 + 1e-6);
    expect(laterais.length).toBe(Math.ceil((perimetro + Math.PI * 0.5) / 260));
  });

  it('pedaço da tira: abas dos dois lados, emenda na ponta', () => {
    const t = pedacoDaTira(100, 40, 8, 8);
    const b = pathsBounds([t.corte])!;
    expect(b.minY).toBeCloseTo(-8, 6);
    expect(b.maxY).toBeCloseTo(48, 6);
    expect(b.maxX).toBeCloseTo(108, 6);
    expect(t.dobra).toHaveLength(3);
    // 10 abas em cima e 10 embaixo: 4 pontos cada, mais os cantos e a emenda
    expect(t.corte.segments.length).toBe(1 + 40 + 4 + 40 + 1);
  });

  it('sem imagem pede o desenho; foto com fundo vira retângulo com aviso', () => {
    expect(caixaSilhueta(p, { fonte: null, imagem: null }).pecas).toHaveLength(0);
    const m = caixaSilhueta(p, { fonte: null, imagem: { ...imagem, contorno: null } });
    expect(m.pecas.length).toBeGreaterThan(2);
    expect(m.avisos.join(' ')).toContain('fundo');
  });
});

describe('molde de uma foto', () => {
  it('monta a peça com as linhas revisadas e aplica a escala', () => {
    const decalque = { corte: [retangulo(0, 0, 100, 50)], dobra: [linha([50, 0], [50, 50])], w: 210, h: 297 };
    const m = MOLDE_DE_FOTO.gerar({ ...MOLDE_DE_FOTO.padrao, escala: 150 }, { fonte: null, imagem: null, decalque });
    const b = pathsBounds(m.pecas[0].corte)!;
    expect(b.maxX).toBeCloseTo(150, 6);
    expect(flattenPath(m.pecas[0].dobra[0], 1)[0][0]).toBeCloseTo(75, 6);
    expect(MOLDE_DE_FOTO.gerar(MOLDE_DE_FOTO.padrao, { fonte: null, imagem: null, decalque: null }).avisos[0]).toContain('foto');
  });

  it('o papel fotografado dá a escala', () => {
    expect(tamanhoDoPapel({ papelFoto: 'a5' })).toEqual([148, 210]);
    expect(tamanhoDoPapel({ papelFoto: 'personalizado', larguraFoto: 10, alturaFoto: 15 })).toEqual([100, 150]);
  });
});

describe('reconhecer embalagem (IA)', () => {
  it('catálogo leva só o que a foto mostra', () => {
    const [milk] = catalogoParaIa([CAIXA_MILK]);
    const chaves = milk.campos.map((c) => c.chave);
    expect(chaves).toContain('largura');
    expect(chaves).not.toContain('papel');
    expect(chaves).not.toContain('aba');
    expect(chaves).not.toContain('partes');
    expect(milk.campos.find((c) => c.chave === 'largura')).toMatchObject({ unidade: 'cm', min: 3, max: 30 });
  });

  it('valores da IA arredondam no passo e respeitam limites e opções', () => {
    const p = aplicarValores(PIRAMIDE, PIRAMIDE.padrao, { lado: 7.34, altura: 99, fechamento: 'grampo', lados: 5, aba: 3 });
    expect(p['lado']).toBe(7.5);
    expect(p['altura']).toBe(40);
    expect(p['fechamento']).toBe(PIRAMIDE.padrao['fechamento']);
    expect(p['lados']).toBe(5);
    expect(p['aba']).toBe(PIRAMIDE.padrao['aba']);
  });
});
