/** Caixa silhueta: o contorno de um desenho (PNG sem fundo) vira a frente e o
 * verso de uma caixa, ligados por uma tira lateral com abas dentadas que dobram
 * pra dentro e colam por baixo da frente e do verso. As abas são estreitas e
 * separadas por um "V" justamente pra tira acompanhar as curvas do desenho. */

import { mapVPath, pathsBounds } from '../imagem/illustration-model';
import { offsetOutline } from '../imagem/vector-ops';
import { Point, VPath, comprimento, juntarRetas, linha, poligono, retangulo, retanguloArredondado } from './geometria';
import { CAMPO_ABA, CAMPO_PAPEL, Contexto, Molde, Params, Peca, TipoMolde, fmt, num, str } from './modelo';
import { area, contornoEmMm } from './toppers';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Um pedaço da tira lateral: retângulo `s` × `D` com abas dentadas em cima e
 * embaixo e a aba de emenda na ponta direita (cola por baixo do começo do
 * próximo pedaço, ou do primeiro, fechando o anel). */
export function pedacoDaTira(s: number, D: number, alturaAba: number, aba: number, passo = 10): { corte: VPath; dobra: VPath[] } {
  const vao = Math.min(2.5, passo * 0.25);
  const largura = passo - vao;
  const ch = Math.min(alturaAba * 0.35, largura * 0.3);
  const n = Math.max(1, Math.floor(s / passo));
  const ini = (s - n * passo) / 2 + vao / 2;
  const pts: Point[] = [[0, 0]];
  for (let k = 0; k < n; k++) {
    const x0 = ini + k * passo;
    const x1 = x0 + largura;
    pts.push([x0, 0], [x0 + ch, -alturaAba], [x1 - ch, -alturaAba], [x1, 0]);
  }
  const ce = Math.min(aba * 0.6, D / 4);
  pts.push([s, 0], [s + aba, ce], [s + aba, D - ce], [s, D]);
  for (let k = n - 1; k >= 0; k--) {
    const x0 = ini + k * passo;
    const x1 = x0 + largura;
    pts.push([x1, D], [x1 - ch, D + alturaAba], [x0 + ch, D + alturaAba], [x0, D]);
  }
  pts.push([0, D]);
  return { corte: poligono(pts), dobra: [linha([0, 0], [s, 0]), linha([0, D], [s, D]), linha([s, 0], [s, D])] };
}

export function caixaSilhueta(p: Params, ctx: Contexto): Molde {
  const img = ctx.imagem;
  if (!img) return { pecas: [], avisos: ['Envie o desenho (PNG sem fundo): a frente e o verso da caixa seguem o contorno dele.'] };
  const avisos: string[] = [];
  const W = num(p, 'largura', 10) * 10;
  const D = num(p, 'profundidade', 4) * 10;
  const borda = num(p, 'borda', 2);
  const aba = num(p, 'aba', 8);
  const t = num(p, 'papel', 0.25);
  const maxTira = Math.max(60, num(p, 'maxTira', 26) * 10);
  const cor = str(p, 'corFundo', '#ffffff');
  const iw = Math.max(10, W - 2 * borda);

  let interno: VPath;
  let foto: { x: number; y: number; w: number; h: number };
  if (img.contorno) {
    const c = contornoEmMm(img.contorno, img.w, img.h, iw);
    interno = c.path;
    foto = c.foto;
  } else {
    const ih = (iw * img.h) / img.w;
    interno = retanguloArredondado(-iw / 2, -ih / 2, iw, ih, Math.min(iw, ih) * 0.06);
    foto = { x: -iw / 2, y: -ih / 2, w: iw, h: ih };
    avisos.push('A imagem tem fundo: a caixa saiu retangular. Para seguir o desenho, tire o fundo no Editor de Imagens e envie o PNG.');
  }
  const contorno = juntarRetas(offsetOutline([area([interno])], borda, { outerOnly: true }));
  if (!contorno.length) return { pecas: [], avisos: ['Não consegui tirar o contorno desse desenho.'] };
  if (contorno.length > 1) avisos.push('O desenho tem partes soltas: só a maior vira caixa. Aumente a borda para juntar tudo.');
  const frente = contorno.reduce((a, b) => (comprimento(b) > comprimento(a) ? b : a));

  const espelho = (q: VPath): VPath => mapVPath(q, ([x, y]) => [-x, y]);
  const verso = espelho(frente);
  const versoArte = str(p, 'verso', 'espelho');
  const pecas: Peca[] = [
    { nome: 'Frente', corte: [frente], dobra: [], arte: { fundo: { paths: [frente], cor }, foto: { src: img.src, ...foto, clip: [frente] } } },
    {
      nome: 'Verso',
      corte: [verso],
      dobra: [],
      arte: {
        fundo: { paths: [verso], cor },
        // espelhada em torno do mesmo eixo do contorno (x = 0), não do centro da imagem
        foto: versoArte === 'espelho' ? { src: img.src, ...foto, x: -foto.x - foto.w, clip: [verso], espelhar: true } : undefined,
      },
    },
  ];

  // A tira dá a volta por fora da frente: o perímetro do contorno mais a folga
  // do papel dobrando na quina.
  const perimetro = comprimento(frente) + Math.PI * t * 2;
  const partes = Math.max(1, Math.ceil(perimetro / maxTira));
  const s = perimetro / partes;
  const alturaAba = clamp(aba, 4, D * 0.45);
  for (let i = 0; i < partes; i++) {
    const tira = pedacoDaTira(s, D, alturaAba, aba);
    pecas.push({
      nome: partes > 1 ? `Lateral (${i + 1} de ${partes})` : 'Lateral',
      corte: [tira.corte],
      dobra: tira.dobra,
      arte: { fundo: { paths: [retangulo(0, 0, s, D)], cor } },
    });
  }

  const b = pathsBounds([frente]);
  if (b) {
    // Curva fechada demais (bico, reentrância funda) a tira não acompanha bem.
    const raioMin = Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2;
    if (raioMin < D * 0.6) avisos.push('A lateral está funda para um desenho tão estreito: a tira vai sofrer nas curvas. Diminua a profundidade.');
  }
  return { pecas, avisos };
}

export const CAIXA_SILHUETA: TipoMolde = {
  id: 'caixa-silhueta',
  nome: 'Caixa no formato do desenho',
  categoria: 'A partir de imagem',
  descricao: 'Frente e verso no contorno de um PNG sem fundo (personagem, letra, número), ligados por uma lateral com abas.',
  campos: [
    { chave: 'imagem', rotulo: 'Desenho (PNG sem fundo)', tipo: 'imagem' },
    { chave: 'largura', rotulo: 'Largura da caixa', tipo: 'numero', unidade: 'cm', min: 4, max: 40, passo: 0.5 },
    { chave: 'profundidade', rotulo: 'Profundidade (lateral)', tipo: 'numero', unidade: 'cm', min: 1, max: 15, passo: 0.5 },
    { chave: 'borda', rotulo: 'Borda em volta do desenho', tipo: 'numero', unidade: 'mm', min: 0, max: 15, passo: 0.5, ajuda: 'Arredonda os detalhes finos que a lateral não conseguiria acompanhar.' },
    {
      chave: 'verso', rotulo: 'Verso', tipo: 'opcoes',
      opcoes: [{ valor: 'espelho', rotulo: 'Desenho espelhado (costas do personagem)' }, { valor: 'liso', rotulo: 'Só a cor de fundo' }],
    },
    { chave: 'corFundo', rotulo: 'Cor da borda e da lateral', tipo: 'cor' },
    { chave: 'maxTira', rotulo: 'Comprimento máximo da lateral', tipo: 'numero', unidade: 'cm', min: 8, max: 60, passo: 1, ajuda: 'Lateral maior que isso é dividida em pedaços emendados pelas abas.' },
    { ...CAMPO_ABA, rotulo: 'Abas da lateral' },
    CAMPO_PAPEL,
  ],
  padrao: { largura: 10, profundidade: 4, borda: 3, verso: 'espelho', corFundo: '#ffffff', maxTira: 26, aba: 8, papel: '0.25' },
  montagem: [
    'Imprima a folha (PNG de impressão) e corte com o SVG ou DXF por cima (Print & Cut).',
    'Vinque as linhas da lateral e dobre todas as abas dentadas pra dentro.',
    'Emende os pedaços da lateral pelas abas da ponta, formando um anel.',
    'Cole as abas de um lado por baixo da frente, acompanhando o contorno; depois o verso do outro lado.',
  ],
  nomeArquivo: (p) => `caixa-silhueta-${fmt(num(p, 'largura'))}x${fmt(num(p, 'profundidade'))}cm`,
  gerar: caixaSilhueta,
};
