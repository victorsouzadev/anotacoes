import { describe, expect, it } from 'vitest';
import { flattenPath, pathsBounds } from '../imagem/illustration-model';
import { FontLike, GlyphLike } from '../imagem/svg-text';
import { CAIXA_BOMBOM, CAIXA_MILK, CONE, PIRAMIDE, SACOLINHA, caixaBombom, caixaMilk, cone, piramide, sacolinha } from './caixas';
import { FORMATOS, distribuir, dxfDaFolha, limitesDaPeca, svgDaFolha } from './folha';
import { arco, comprimento, juntarRetas, poligono, poligonoArredondado, tracejar } from './geometria';
import { Peca } from './modelo';
import { montarTopo, topperFoto } from './toppers';

const fecha = (p: { start: [number, number]; segments: { to: [number, number] }[] }): number => {
  const fim = p.segments[p.segments.length - 1].to;
  return Math.hypot(fim[0] - p.start[0], fim[1] - p.start[1]);
};

describe('geometria', () => {
  it('arco de cúbicas fica em cima do círculo e tem o comprimento certo', () => {
    const p = { start: [50, 0] as [number, number], closed: false, segments: arco([0, 0], 50, 0, Math.PI) };
    for (const [x, y] of flattenPath(p, 0.2)) expect(Math.abs(Math.hypot(x, y) - 50)).toBeLessThan(0.02);
    expect(comprimento(p)).toBeCloseTo(Math.PI * 50, 0);
  });

  it('polígono arredondado termina onde começa e respeita o raio', () => {
    const p = poligonoArredondado([[0, 0], [40, 0], [40, 20], [0, 20]], [5, 0, 5, 0]);
    expect(fecha(p)).toBeLessThan(1e-9);
    const b = pathsBounds([p])!;
    expect(b.minX).toBeCloseTo(0, 3);
    expect(b.maxX).toBeCloseTo(40, 3);
    // a quina (0,0) foi arredondada: o ponto mais perto dela fica a ~ (√2−1)·5 mm
    const perto = Math.min(...flattenPath(p, 0.1).map(([x, y]) => Math.hypot(x, y)));
    expect(perto).toBeGreaterThan(1.8);
    expect(perto).toBeLessThan(2.4);
  });

  it('junta trechos retos colineares e mantém as quinas', () => {
    const p = poligono([[0, 0], [10, 0], [20, 0.001], [30, 0], [30, 10], [30, 20], [0, 20]]);
    const [j] = juntarRetas([p]);
    expect(j.segments.map((s) => s.to)).toEqual([[30, 0], [30, 20], [0, 20], [0, 0]]);
    // ponto que volta pra trás na mesma reta é quina (ida e volta), não junta
    const [v] = juntarRetas([poligono([[0, 0], [10, 0], [5, 0]], false)]);
    expect(v.segments).toHaveLength(2);
  });

  it('tracejado reparte a linha em traços do tamanho pedido', () => {
    const tr = tracejar({ start: [0, 0], closed: false, segments: [{ c1: null, c2: null, to: [100, 0] }] }, 3, 2);
    expect(tr.length).toBe(20);
    for (const t of tr) expect(comprimento(t)).toBeCloseTo(3, 5);
    expect(tr[0].start[0]).toBeGreaterThan(0);
  });
});

describe('caixas', () => {
  it('caixa milk: quatro painéis + aba, com a espessura do papel nos painéis', () => {
    const m = caixaMilk({ ...CAIXA_MILK.padrao, largura: 8, profundidade: 6, altura: 12, papel: '0.2', aba: 10 });
    expect(m.pecas).toHaveLength(1);
    const peca = m.pecas[0];
    const b = limitesDaPeca(peca)!;
    expect(b.maxX - b.minX).toBeCloseTo(2 * 80.2 + 2 * 60.2 + 10, 3);
    expect(fecha(peca.corte[0])).toBeLessThan(1e-9);
    expect(peca.corte[0].closed).toBe(true);
    // dois furos da fita (frente e costas)
    expect(peca.corte).toHaveLength(3);
    // as dobras ficam dentro do contorno
    const bc = pathsBounds([peca.corte[0]])!;
    const bd = pathsBounds(peca.dobra)!;
    expect(bd.minX).toBeGreaterThanOrEqual(bc.minX - 1e-6);
    expect(bd.maxY).toBeLessThanOrEqual(bc.maxY + 1e-6);
  });

  it('caixa de bombom: tampa maior que o fundo pela folga e janela opcional', () => {
    const sem = caixaBombom({ ...CAIXA_BOMBOM.padrao, largura: 10, profundidade: 8, altura: 3, alturaTampa: 2, papel: '0.3' });
    const [fundo, tampa] = sem.pecas;
    expect(fundo.nome).toBe('Fundo');
    expect(tampa.corte).toHaveLength(1);
    const bf = limitesDaPeca(fundo)!;
    const bt = limitesDaPeca(tampa)!;
    // largura total = parede + fundo + parede; a tampa cresce 2·0,3 + 1 mm e tem parede menor
    expect(bf.maxX - bf.minX).toBeCloseTo(100.3 + 2 * 30, 3);
    expect(bt.maxX - bt.minX).toBeCloseTo(100.3 + 1.6 + 2 * 20, 3);
    const com = caixaBombom({ ...CAIXA_BOMBOM.padrao, janela: true, margemJanela: 15 });
    expect(com.pecas[1].corte).toHaveLength(2);
  });

  it('sacolinha: furos na dobra da boca e no corpo, sanfona com V', () => {
    const m = sacolinha({ ...SACOLINHA.padrao, boca: 3, alca: 'furos' });
    const peca = m.pecas[0];
    expect(peca.corte).toHaveLength(1 + 8);
    // 4 verticais + fundo + boca + 2 × (meio + 2 diagonais + 2 do fundo)
    expect(peca.dobra).toHaveLength(6 + 10);
    const semAlca = sacolinha({ ...SACOLINHA.padrao, alca: 'nenhuma' });
    expect(semAlca.pecas[0].corte).toHaveLength(1);
  });

  it('em duas metades cada parte leva dois painéis e a própria aba', () => {
    const p = { ...SACOLINHA.padrao, largura: 10, profundidade: 5, papel: '0.2', aba: 12, partes: '2' };
    const m = sacolinha(p);
    expect(m.pecas.map((x) => x.nome)).toEqual(['Sacolinha (parte 1)', 'Sacolinha (parte 2)']);
    for (const peca of m.pecas) {
      const b = limitesDaPeca(peca)!;
      expect(b.maxX - b.minX).toBeCloseTo(100.2 + 50.2 + 12, 3);
      expect(peca.corte).toHaveLength(1 + 4);
    }
    const milk = caixaMilk({ ...CAIXA_MILK.padrao, partes: '2' });
    expect(milk.pecas).toHaveLength(2);
    // os furos da fita ficam um em cada metade (frente e costas)
    expect(milk.pecas.map((x) => x.corte.length)).toEqual([2, 2]);
  });

  it('tamanhos padrão cabem numa folha A4', () => {
    for (const tipo of [CAIXA_MILK, CAIXA_BOMBOM, SACOLINHA, PIRAMIDE, CONE]) {
      const d = distribuir(tipo.gerar(tipo.padrao, { fonte: null, imagem: null }).pecas, { formato: FORMATOS[0], orientacao: 'auto', margem: 10, espaco: 4, copias: 1 });
      expect(d.naoCabem, tipo.nome).toEqual([]);
    }
  });

  it('pirâmide: uma face por lado; com cola, uma aba por face', () => {
    const fita = piramide({ ...PIRAMIDE.padrao, lados: 5, fechamento: 'fita', furo: 4 });
    expect(fita.pecas[0].corte).toHaveLength(1 + 5);
    expect(fita.pecas[0].dobra).toHaveLength(5);
    const cola = piramide({ ...PIRAMIDE.padrao, lados: 4, lado: 8, altura: 10, fechamento: 'cola' });
    expect(cola.pecas[0].corte).toHaveLength(1);
    expect(cola.pecas[0].dobra).toHaveLength(8);
    // a ponta de cada face fica a apótema + √(H² + apótema²) do centro da base
    const semAba = piramide({ ...PIRAMIDE.padrao, lados: 4, lado: 8, altura: 10, fechamento: 'fita', furo: 0 });
    const raio = Math.max(...flattenPath(semAba.pecas[0].corte[0], 1).map(([x, y]) => Math.hypot(x, y)));
    expect(raio).toBeCloseTo(40 + Math.hypot(100, 40), 3);
  });

  it('cone: setor com raio = geratriz e arco = circunferência da boca', () => {
    const m = cone({ ...CONE.padrao, boca: 7, fundo: 0, altura: 14 });
    expect(m.pecas).toHaveLength(1);
    const corte = m.pecas[0].corte[0];
    const L = Math.hypot(140, 35);
    expect(Math.hypot(...corte.start)).toBeCloseTo(L, 6);
    const theta = (2 * Math.PI * 35) / L;
    const nArco = Math.ceil(theta / (Math.PI / 2));
    const arcoExterno = { start: corte.start, closed: false, segments: corte.segments.slice(0, nArco) };
    expect(comprimento(arcoExterno)).toBeCloseTo(Math.PI * 70, 0);
    expect(fecha(corte)).toBeLessThan(1e-9);
  });

  it('cone cortado com fundo leva o disco; cone muito aberto sai em duas metades', () => {
    const copo = cone({ ...CONE.padrao, boca: 8, fundo: 5, altura: 9, tampaFundo: 'dentes' });
    expect(copo.pecas.map((p) => p.nome)).toEqual(['Cone', 'Fundo']);
    const aberto = cone({ ...CONE.padrao, boca: 20, fundo: 0, altura: 3 });
    expect(aberto.pecas).toHaveLength(2);
    expect(aberto.avisos.length).toBe(1);
    const cil = cone({ ...CONE.padrao, boca: 6, fundo: 6, altura: 10, tampaFundo: 'nenhum' });
    const b = limitesDaPeca(cil.pecas[0])!;
    expect(b.maxX - b.minX).toBeCloseTo(Math.PI * 60 + 10, 3);
  });
});

/** Fonte de mentira: toda letra é um quadrado de 600 × 700 unidades. */
function fonteQuadrada(): FontLike {
  const glyph = (ch: string): GlyphLike => ({
    advanceWidth: ch === ' ' ? 300 : 700,
    unicode: ch.codePointAt(0),
    getPath(x: number, y: number, size: number) {
      if (ch === ' ') return { commands: [] };
      const s = size / 1000;
      return {
        commands: [
          { type: 'M', x: x + 50 * s, y },
          { type: 'L', x: x + 650 * s, y },
          { type: 'L', x: x + 650 * s, y: y - 700 * s },
          { type: 'L', x: x + 50 * s, y: y - 700 * s },
          { type: 'Z' },
        ],
      };
    },
  });
  return { unitsPerEm: 1000, ascender: 800, descender: -200, stringToGlyphs: (t) => [...t].map(glyph), getKerningValue: () => 0 };
}

describe('toppers', () => {
  const base = { largura: 15, borda: 4, base: 'barra', alturaBarra: 5, palitos: 2, larguraPalito: 6, comprimentoPalito: 8, ponta: 'pontuda', camadaTexto: true, espacamento: 0 };

  it('topo de bolo: base inteira na largura pedida, palitos embaixo e camada do texto', () => {
    const m = montarTopo(base, fonteQuadrada(), 'ANA');
    expect(m.pecas.map((p) => p.nome)).toEqual(['Base do topo', 'Camada do texto']);
    const corte = m.pecas[0].corte;
    expect(corte).toHaveLength(1);
    const b = pathsBounds(corte)!;
    expect(b.maxX - b.minX).toBeCloseTo(150, 0);
    const bt = pathsBounds(m.pecas[1].corte)!;
    // os palitos descem 8 cm abaixo da borda de baixo da base
    expect(b.maxY - bt.maxY).toBeGreaterThan(80);
    expect(m.pecas[1].corte).toHaveLength(3);
  });

  it('topo sem barra avisa quando as letras ficam soltas', () => {
    const m = montarTopo({ ...base, base: 'nenhuma', borda: 1, palitos: 0, espacamento: 600 }, fonteQuadrada(), 'A B');
    expect(m.pecas[0].corte.length).toBeGreaterThan(1);
    expect(m.avisos.join(' ')).toContain('pedaços');
  });

  it('topper com foto: corte na largura com a borda, foto recortada na forma', () => {
    const p = { forma: 'coracao', largura: 6, altura: 5, borda: 3, corBorda: '#ff0000', zoom: 100, deslocX: 0, deslocY: 0, palitos: 1, larguraPalito: 6, comprimentoPalito: 7, ponta: 'reta' };
    const semFoto = topperFoto(p, { fonte: null, imagem: null });
    expect(semFoto.avisos[0]).toContain('Envie');
    const comFoto = topperFoto(p, { fonte: null, imagem: { src: 'data:image/png;base64,AA', w: 400, h: 200, contorno: null } });
    const peca = comFoto.pecas[0];
    const b = pathsBounds(peca.corte)!;
    expect(b.maxX - b.minX).toBeCloseTo(60, 0);
    expect(peca.arte?.foto?.clip).toHaveLength(1);
    // "cobrir": a foto 2:1 fica com a altura da forma por dentro da borda
    expect(peca.arte!.foto!.h).toBeCloseTo(44, 3);
    const contorno = topperFoto({ ...p, forma: 'contorno' }, { fonte: null, imagem: { src: 'x', w: 100, h: 100, contorno: null } });
    expect(contorno.pecas).toHaveLength(0);
  });
});

describe('folha', () => {
  const quadrado = (lado: number, nome = 'q'): Peca => ({
    nome,
    corte: [{ start: [0, 0], closed: true, segments: [{ c1: null, c2: null, to: [lado, 0] }, { c1: null, c2: null, to: [lado, lado] }, { c1: null, c2: null, to: [0, lado] }, { c1: null, c2: null, to: [0, 0] }] }],
    dobra: [],
  });
  const a4 = FORMATOS[0];

  it('distribui cópias em linhas e abre folha nova quando acaba o espaço', () => {
    const d = distribuir([quadrado(60)], { formato: a4, orientacao: 'retrato', margem: 10, espaco: 5, copias: 13 });
    // 190 mm úteis: 3 por linha (60+5+60+5+60); 277 mm: 4 linhas → 12 por folha
    expect(d.folhas).toHaveLength(2);
    expect(d.folhas[0].itens).toHaveLength(12);
    expect(d.folhas[1].itens).toHaveLength(1);
    expect(d.naoCabem).toEqual([]);
  });

  it('gira a peça comprida pra caber e avisa da que não cabe de jeito nenhum', () => {
    const comprida: Peca = { ...quadrado(10, 'comprida'), corte: [{ start: [0, 0], closed: false, segments: [{ c1: null, c2: null, to: [250, 20] }] }] };
    const d = distribuir([comprida], { formato: a4, orientacao: 'retrato', margem: 10, espaco: 5, copias: 1 });
    expect(d.folhas[0].itens[0].girada).toBe(true);
    const enorme = distribuir([quadrado(400, 'enorme')], { formato: a4, orientacao: 'retrato', margem: 10, espaco: 5, copias: 1 });
    expect(enorme.naoCabem).toEqual(['enorme']);
  });

  it('peça girada cai dentro da caixa reservada na folha', () => {
    const molde = caixaMilk(CAIXA_MILK.padrao);
    const d = distribuir(molde.pecas, { formato: a4, orientacao: 'retrato', margem: 10, espaco: 5, copias: 1 });
    const item = d.folhas[0].itens[0];
    const svg = svgDaFolha(d.folhas[0], { dobra: 'linha', traco: 3, vao: 2, arte: false, linhas: true });
    expect(svg).toContain('width="210mm"');
    expect(svg).toContain('id="corte"');
    expect(svg).toContain('id="dobra"');
    const pts = svg.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...pts)).toBeGreaterThanOrEqual(0);
    expect(item.x).toBe(10);
  });

  it('DXF com camadas de corte e dobra; tracejado manda a dobra pro corte', () => {
    const molde = piramide(PIRAMIDE.padrao);
    const d = distribuir(molde.pecas, { formato: a4, orientacao: 'auto', margem: 10, espaco: 5, copias: 1 });
    const dxf = dxfDaFolha(d.folhas[0], { dobra: 'linha', traco: 3, vao: 2 });
    expect(dxf).toContain('\r\nDOBRA\r\n');
    const tracejado = dxfDaFolha(d.folhas[0], { dobra: 'tracejado', traco: 3, vao: 2 });
    expect(tracejado.split('\r\n8\r\nDOBRA\r\n').length).toBe(1);
    const svg = svgDaFolha(d.folhas[0], { dobra: 'nenhuma', traco: 3, vao: 2, arte: false, linhas: true });
    expect(svg).not.toContain('id="dobra"');
  });
});
