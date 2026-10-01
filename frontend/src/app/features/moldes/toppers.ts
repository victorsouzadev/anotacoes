/** Toppers: topo de bolo com nome (texto + barra que une as letras + palitos,
 * tudo contornado por uma borda) e topper com foto encaixada numa forma. As
 * operações de área (soldar, contornar) usam o mesmo Clipper do modo
 * Ilustração do Editor de Imagens. */

import { Polygon } from '../imagem/contour';
import { mapVPath, pathsBounds, polygonToVPath } from '../imagem/illustration-model';
import { FontLike, layoutText } from '../imagem/svg-text';
import { AreaSource, booleanPaths, offsetOutline } from '../imagem/vector-ops';
import { Point, VPath, circulo, elipse, juntarRetas, poligono, poligonoArredondado, retangulo, retanguloArredondado } from './geometria';
import { Arte, Contexto, Molde, Params, TipoMolde, fmt, num, sim, str } from './modelo';

const area = (paths: VPath[]): AreaSource => ({ paths, pad: 0, strokeOnly: false, nonzero: true });

/** Palitos saindo de baixo do contorno. `topo` é onde o palito começa (dentro
 * da peça, pra soldar), `fundo` é a borda de baixo da peça. */
function palitos(p: Params, larguraArte: number, topo: number, fundo: number): VPath[] {
  const qtd = Math.max(0, Math.min(3, Math.round(num(p, 'palitos', 1))));
  if (!qtd) return [];
  const w = num(p, 'larguraPalito', 6);
  const L = num(p, 'comprimentoPalito', 8) * 10;
  const pontuda = str(p, 'ponta') === 'pontuda';
  const xs = qtd === 1 ? [0] : qtd === 2 ? [-0.25, 0.25] : [-0.32, 0, 0.32];
  const yFim = fundo + L;
  return xs.map((f) => {
    const x = f * larguraArte;
    if (!pontuda) return retangulo(x - w / 2, topo, w, yFim - topo);
    return poligono([[x - w / 2, topo], [x + w / 2, topo], [x + w / 2, yFim - w], [x, yFim], [x - w / 2, yFim - w]]);
  });
}

const CAMPOS_PALITO = [
  { chave: 'palitos', rotulo: 'Palitos', tipo: 'numero' as const, unidade: 'un' as const, min: 0, max: 3, passo: 1, ajuda: '0 = sem palito (para colar num espeto ou fita).' },
  { chave: 'larguraPalito', rotulo: 'Largura do palito', tipo: 'numero' as const, unidade: 'mm' as const, min: 3, max: 15, passo: 0.5, visivel: (p: Params) => num(p, 'palitos') > 0 },
  { chave: 'comprimentoPalito', rotulo: 'Comprimento do palito', tipo: 'numero' as const, unidade: 'cm' as const, min: 2, max: 20, passo: 0.5, visivel: (p: Params) => num(p, 'palitos') > 0 },
  {
    chave: 'ponta', rotulo: 'Ponta do palito', tipo: 'opcoes' as const,
    opcoes: [{ valor: 'pontuda', rotulo: 'Pontuda (entra fácil no bolo)' }, { valor: 'reta', rotulo: 'Reta' }],
    visivel: (p: Params) => num(p, 'palitos') > 0,
  },
];

// ---------------------------------------------------------------- topo de bolo

export function topoDeBolo(p: Params, ctx: Contexto): Molde {
  const font = ctx.fonte;
  const texto = str(p, 'texto').replace(/\r/g, '').trim();
  if (!texto) return { pecas: [], avisos: ['Digite o nome ou a frase do topo.'] };
  if (!font) return { pecas: [], avisos: ['Carregando a fonte…'] };
  return montarTopo(p, font, texto);
}

/** Separado da leitura do contexto pra dar pra testar com uma fonte de mentira. */
export function montarTopo(p: Params, font: FontLike, texto: string): Molde {
  const borda = num(p, 'borda', 4);
  const largura = num(p, 'largura', 15) * 10;
  const linhas = texto.split('\n').length;
  const lh = 1.05;
  const corpo = 100;
  const layout = layoutText(font, {
    text: texto, sizeMm: corpo, tracking: num(p, 'espacamento', 0), lineHeight: lh, align: 'center',
    curve: 'reta', bend: 0, guide: null, guideOffset: 0,
  });
  const b0 = pathsBounds(layout.paths);
  if (!b0 || b0.maxX - b0.minX < 1e-6) return { pecas: [], avisos: ['A fonte escolhida não tem essas letras.'] };
  const larguraTexto = Math.max(10, largura - 2 * borda);
  const s = larguraTexto / (b0.maxX - b0.minX);
  const cx = (b0.minX + b0.maxX) / 2;
  const texto_ = layout.paths.map((q) => mapVPath(q, ([x, y]) => [(x - cx) * s, y * s]));
  const b = pathsBounds(texto_)!;

  // linha de base da última linha, com o mesmo centro de métrica do layoutText
  const esc = corpo / font.unitsPerEm;
  const asc = font.ascender * esc;
  const desc = font.descender * esc;
  const cy = (-asc + (linhas - 1) * lh * corpo - desc) / 2;
  const base = ((linhas - 1) * lh * corpo - cy) * s;

  const fontes: AreaSource[] = [area(texto_)];
  const avisos: string[] = [];
  if (str(p, 'base') !== 'nenhuma') {
    const hBarra = num(p, 'alturaBarra', 5);
    const recuo = Math.min(borda, (b.maxX - b.minX) * 0.04);
    fontes.push(area([retanguloArredondado(b.minX + recuo, base - hBarra * 0.6, b.maxX - b.minX - 2 * recuo, hBarra, hBarra / 2)]));
  }
  let contorno = offsetOutline(fontes, borda, { outerOnly: true });
  if (contorno.length > 1 && str(p, 'base') === 'nenhuma') {
    avisos.push('As letras não se encostam: sem a barra de base o topo sai em pedaços. Aumente a borda ou ligue a barra.');
  }
  const bc = pathsBounds(contorno);
  if (bc) {
    const pal = palitos(p, b.maxX - b.minX, base - 1, bc.maxY);
    if (pal.length) contorno = booleanPaths('unir', [area(contorno), area(pal)]);
  }

  const pecas = [{ nome: 'Base do topo', corte: juntarRetas(contorno), dobra: [] }];
  if (sim(p, 'camadaTexto')) {
    pecas.push({ nome: 'Camada do texto', corte: juntarRetas(booleanPaths('unir', [area(texto_)])), dobra: [] });
  }
  if (b.maxY - b.minY < 12) avisos.push('Letras com menos de 1,2 cm de altura ficam frágeis no corte — aumente a largura.');
  return { pecas, avisos };
}

// ---------------------------------------------------------------- topper com foto

/** Coração dentro da caixa w × h, centrado na origem. */
export function coracao(w: number, h: number): VPath {
  const f = ([x, y]: Point): Point => [(x - 0.5) * w, ((y - 0.15) / 0.85 - 0.5) * h];
  const seg = (c1: Point, c2: Point, to: Point) => ({ c1: f(c1), c2: f(c2), to: f(to) });
  return {
    start: f([0.5, 0.3]),
    closed: true,
    segments: [
      seg([0.5, 0.27], [0.45, 0.15], [0.25, 0.15]),
      seg([0.05, 0.15], [0, 0.3], [0, 0.42]),
      seg([0, 0.6], [0.2, 0.82], [0.5, 1]),
      seg([0.8, 0.82], [1, 0.6], [1, 0.42]),
      seg([1, 0.3], [0.95, 0.15], [0.75, 0.15]),
      seg([0.55, 0.15], [0.5, 0.27], [0.5, 0.3]),
    ],
  };
}

function estrela(w: number, h: number): VPath {
  const pts: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.48 : 1;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // a estrela de 5 pontas não ocupa a caixa inteira em y: reescala pra caber
  const ys = pts.map((q) => q[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const q = pts.map(([x, y]): Point => [(x / 2) * w * 1.05, ((y - y0) / (y1 - y0) - 0.5) * h]);
  return poligonoArredondado(q, q.map((_, i) => (i % 2 ? 0 : Math.min(w, h) * 0.02)));
}

/** Silhueta da imagem (px) em mm, centrada, com `largura` mm. */
function contornoEmMm(poly: Polygon, imgW: number, imgH: number, largura: number): { path: VPath; w: number; h: number } {
  const s = largura / imgW;
  const path = polygonToVPath(poly.map(([x, y]): Point => [(x - imgW / 2) * s, (y - imgH / 2) * s]));
  return { path, w: largura, h: imgH * s };
}

export function topperFoto(p: Params, ctx: Contexto): Molde {
  const forma = str(p, 'forma', 'circulo');
  const borda = num(p, 'borda', 3);
  const W = num(p, 'largura', 8) * 10;
  let H = num(p, 'altura', 8) * 10;
  if (forma === 'circulo') H = W;
  const iw = Math.max(5, W - 2 * borda);
  let ih = Math.max(5, H - 2 * borda);
  const img = ctx.imagem;
  const avisos: string[] = [];

  let interno: VPath;
  let foto: Arte['foto'] | undefined;
  if (forma === 'contorno') {
    if (!img) return { pecas: [], avisos: ['Envie um PNG com fundo transparente: o corte segue o desenho.'] };
    if (!img.contorno) {
      return { pecas: [], avisos: ['Essa imagem não tem fundo transparente. Tire o fundo no Editor de Imagens ou escolha uma forma.'] };
    }
    const c = contornoEmMm(img.contorno, img.w, img.h, iw);
    interno = c.path;
    ih = c.h;
    foto = { src: img.src, x: -iw / 2, y: -ih / 2, w: iw, h: ih, clip: null };
  } else {
    switch (forma) {
      case 'oval': interno = elipse([0, 0], iw / 2, ih / 2); break;
      case 'coracao': interno = coracao(iw, ih); break;
      case 'retangulo': interno = retanguloArredondado(-iw / 2, -ih / 2, iw, ih, Math.min(iw, ih) * 0.08); break;
      case 'estrela': interno = estrela(iw, ih); break;
      default: interno = circulo([0, 0], iw / 2); ih = iw;
    }
    if (img) {
      // "cobrir": a foto preenche a forma inteira, com zoom e deslocamento por cima
      const zoom = Math.max(0.1, num(p, 'zoom', 100) / 100);
      const s = Math.max(iw / img.w, ih / img.h) * zoom;
      const dw = img.w * s, dh = img.h * s;
      const dx = (num(p, 'deslocX', 0) / 100) * iw;
      const dy = (num(p, 'deslocY', 0) / 100) * ih;
      foto = { src: img.src, x: -dw / 2 + dx, y: -dh / 2 + dy, w: dw, h: dh, clip: [interno] };
    } else {
      avisos.push('Envie uma foto para ver o encaixe (o molde de corte já está pronto).');
    }
  }

  let contorno = offsetOutline([area([interno])], borda, { outerOnly: true });
  const bc = pathsBounds(contorno);
  if (bc) {
    const pal = palitos(p, iw, bc.maxY - Math.max(borda, 2) - 1, bc.maxY);
    if (pal.length) contorno = booleanPaths('unir', [area(contorno), area(pal)]);
  }
  contorno = juntarRetas(contorno);
  const arte: Arte = { fundo: { paths: contorno, cor: str(p, 'corBorda', '#ffffff') }, foto };
  return { pecas: [{ nome: 'Topper', corte: contorno, dobra: [], arte }], avisos };
}

// ---------------------------------------------------------------- catálogo

export const TOPO_DE_BOLO: TipoMolde = {
  id: 'topo-de-bolo',
  nome: 'Topo de bolo (nome)',
  categoria: 'Toppers',
  descricao: 'Nome ou frase na fonte que você escolher, com barra de base, borda e palitos.',
  campos: [
    { chave: 'texto', rotulo: 'Nome ou frase', tipo: 'texto', multilinha: true, max: 80, ajuda: 'Enter quebra a linha.' },
    { chave: 'fonte', rotulo: 'Fonte', tipo: 'fonte' },
    { chave: 'negrito', rotulo: 'Negrito (quando a fonte tem)', tipo: 'sim-nao' },
    { chave: 'largura', rotulo: 'Largura total', tipo: 'numero', unidade: 'cm', min: 4, max: 40, passo: 0.5 },
    { chave: 'espacamento', rotulo: 'Espaço entre letras', tipo: 'numero', unidade: 'un', min: -100, max: 300, passo: 10, ajuda: 'Em milésimos da altura da letra. Negativo aproxima.' },
    { chave: 'borda', rotulo: 'Borda (sombra) em volta', tipo: 'numero', unidade: 'mm', min: 1, max: 15, passo: 0.5 },
    {
      chave: 'base', rotulo: 'Ligação das letras', tipo: 'opcoes',
      opcoes: [{ valor: 'barra', rotulo: 'Barra embaixo do texto' }, { valor: 'nenhuma', rotulo: 'Só a borda (fonte cursiva já ligada)' }],
    },
    { chave: 'alturaBarra', rotulo: 'Altura da barra', tipo: 'numero', unidade: 'mm', min: 2, max: 20, passo: 0.5, visivel: (p) => str(p, 'base') !== 'nenhuma' },
    ...CAMPOS_PALITO,
    { chave: 'camadaTexto', rotulo: 'Cortar o texto como camada separada', tipo: 'sim-nao', ajuda: 'Pra topo em camadas: base em glitter e o nome em outra cor por cima.' },
  ],
  padrao: {
    texto: 'Maria', fonte: 'pacifico', negrito: false, largura: 15, espacamento: 0, borda: 4, base: 'barra', alturaBarra: 5,
    palitos: 2, larguraPalito: 6, comprimentoPalito: 8, ponta: 'pontuda', camadaTexto: true,
  },
  montagem: [
    'Corte a base em papel mais grosso (glitter, perolado 250 g ou mais).',
    'Se cortou a camada do texto, cole por cima da base alinhando pelas letras.',
    'Para firmar, cole um palito de churrasco atrás dos palitos de papel.',
  ],
  nomeArquivo: (p) => `topo-${str(p, 'texto').replace(/\s+/g, '-').normalize('NFD').replace(/[^\w-]/g, '').toLowerCase().slice(0, 30) || 'nome'}-${fmt(num(p, 'largura'))}cm`,
  gerar: topoDeBolo,
};

export const TOPPER_FOTO: TipoMolde = {
  id: 'topper-foto',
  nome: 'Topper com foto',
  categoria: 'Toppers',
  descricao: 'Foto encaixada em círculo, coração, estrela… ou seguindo o contorno de um PNG. Sai pronto para Print & Cut.',
  campos: [
    { chave: 'imagem', rotulo: 'Foto ou desenho', tipo: 'imagem' },
    {
      chave: 'forma', rotulo: 'Forma', tipo: 'opcoes',
      opcoes: [
        { valor: 'circulo', rotulo: 'Círculo' },
        { valor: 'oval', rotulo: 'Oval' },
        { valor: 'coracao', rotulo: 'Coração' },
        { valor: 'retangulo', rotulo: 'Retângulo arredondado' },
        { valor: 'estrela', rotulo: 'Estrela' },
        { valor: 'contorno', rotulo: 'Contorno do desenho (PNG sem fundo)' },
      ],
    },
    { chave: 'largura', rotulo: 'Largura', tipo: 'numero', unidade: 'cm', min: 2, max: 30, passo: 0.5 },
    { chave: 'altura', rotulo: 'Altura', tipo: 'numero', unidade: 'cm', min: 2, max: 30, passo: 0.5, visivel: (p) => !['circulo', 'contorno'].includes(str(p, 'forma')) },
    { chave: 'borda', rotulo: 'Borda em volta da foto', tipo: 'numero', unidade: 'mm', min: 0, max: 15, passo: 0.5 },
    { chave: 'corBorda', rotulo: 'Cor da borda (impressa)', tipo: 'cor' },
    { chave: 'zoom', rotulo: 'Zoom da foto', tipo: 'numero', unidade: '%', min: 50, max: 400, passo: 5, visivel: (p) => str(p, 'forma') !== 'contorno' },
    { chave: 'deslocX', rotulo: 'Mover foto ← →', tipo: 'numero', unidade: '%', min: -100, max: 100, passo: 1, visivel: (p) => str(p, 'forma') !== 'contorno' },
    { chave: 'deslocY', rotulo: 'Mover foto ↑ ↓', tipo: 'numero', unidade: '%', min: -100, max: 100, passo: 1, visivel: (p) => str(p, 'forma') !== 'contorno' },
    ...CAMPOS_PALITO,
  ],
  padrao: {
    forma: 'circulo', largura: 6, altura: 6, borda: 3, corBorda: '#ffffff', zoom: 100, deslocX: 0, deslocY: 0,
    palitos: 1, larguraPalito: 6, comprimentoPalito: 7, ponta: 'pontuda',
  },
  montagem: [
    'Baixe o PNG de impressão e o SVG de corte da mesma folha — eles têm o mesmo tamanho e posição.',
    'No Silhouette Studio: abra o PNG, ligue as marcas de registro, importe o SVG por cima e alinhe pela moldura da página.',
    'Imprima, coloque na base de corte e mande cortar: a máquina lê as marcas e corta no contorno.',
  ],
  nomeArquivo: (p) => `topper-${str(p, 'forma', 'circulo')}-${fmt(num(p, 'largura'))}cm`,
  gerar: topperFoto,
};
