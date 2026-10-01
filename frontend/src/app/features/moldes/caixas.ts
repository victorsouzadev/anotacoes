/** Caixas e embalagens planificadas. Medidas digitadas são as de dentro da
 * caixa; a espessura do papel entra como folga nos painéis. No contorno, o y
 * cresce pra baixo e a volta é sempre no sentido horário da tela — é o que
 * deixa `pontosDaAba` jogar as abas pro lado de fora. */

import {
  Point,
  VPath,
  arco,
  circulo,
  curva,
  linha,
  pontoNoCirculo,
  pontosDaAba,
  poligono,
  poligonoArredondado,
  retanguloArredondado,
} from './geometria';
import { translatePaths } from '../imagem/illustration-model';
import { CAMPO_ABA, CAMPO_PAPEL, Molde, Params, Peca, TipoMolde, fmt, num, sim, str } from './modelo';

const cm = (p: Params, k: string): number => num(p, k) * 10;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const papel = (p: Params): number => num(p, 'papel', 0.25);

function furo(c: Point, diametro: number): VPath[] {
  return diametro > 0 ? [circulo(c, diametro / 2)] : [];
}

// ---------------------------------------------------------------- tubo

/** Um painel do tubo (caixa milk, sacolinha). Coordenadas do próprio painel:
 * x a partir da borda esquerda dele, y = 0 na dobra de cima do corpo. */
interface Painel {
  w: number;
  /** Contorno de baixo, da direita pra esquerda, sem os dois cantos. */
  fundo: { pt: Point; r?: number }[];
  dobras: VPath[];
  furos: VPath[];
}

interface Tubo {
  nome: string;
  paineis: Painel[];
  /** Altura acima do corpo (tampa, boca), em y negativo. */
  topo: number;
  H: number;
  aba: number;
  /** Dobras que atravessam a peça inteira. */
  horizontais: number[];
  /** Duas metades: cada uma com dois painéis e a própria aba de cola. */
  partes: number;
}

/** Painéis lado a lado com a aba de cola à esquerda, em uma ou duas peças. */
function tubo(t: Tubo): Peca[] {
  const grupos = t.partes === 2 ? [t.paineis.slice(0, 2), t.paineis.slice(2)] : [t.paineis];
  return grupos.map((paineis, gi) => {
    const xs: number[] = [0];
    for (const pn of paineis) xs.push(xs[xs.length - 1] + pn.w);
    const X = xs[xs.length - 1];
    const cg = Math.min(t.aba, (t.H + t.topo) / 4);
    const pts: Point[] = [[0, -t.topo], [X, -t.topo]];
    const raios: number[] = [0, 0];
    for (let i = paineis.length - 1; i >= 0; i--) {
      pts.push([xs[i] + paineis[i].w, t.H]);
      raios.push(0);
      for (const f of paineis[i].fundo) {
        pts.push([xs[i] + f.pt[0], f.pt[1]]);
        raios.push(f.r ?? 0);
      }
    }
    pts.push([0, t.H], [-t.aba, t.H - cg], [-t.aba, -t.topo + cg]);
    raios.push(0, 0, 0);

    const corte: VPath[] = [poligonoArredondado(pts, raios)];
    const dobra: VPath[] = [];
    for (let i = 0; i < paineis.length; i++) dobra.push(linha([xs[i], -t.topo], [xs[i], t.H]));
    for (const y of t.horizontais) dobra.push(linha([0, y], [X, y]));
    paineis.forEach((pn, i) => {
      dobra.push(...translatePaths(pn.dobras, xs[i], 0));
      corte.push(...translatePaths(pn.furos, xs[i], 0));
    });
    return { nome: grupos.length > 1 ? `${t.nome} (parte ${gi + 1})` : t.nome, corte, dobra };
  });
}

const CAMPO_PARTES = {
  chave: 'partes',
  rotulo: 'Peças',
  tipo: 'opcoes' as const,
  ajuda: 'Em duas metades o molde cabe em folha menor; cada metade tem a própria aba de cola.',
  opcoes: [{ valor: '1', rotulo: 'Uma peça só' }, { valor: '2', rotulo: 'Duas metades' }],
};

// ---------------------------------------------------------------- caixa milk

export function caixaMilk(p: Params): Molde {
  const t = papel(p);
  const W = cm(p, 'largura') + t;
  const D = cm(p, 'profundidade') + t;
  const H = cm(p, 'altura');
  const diamFuro = num(p, 'furo', 4);
  const avisos: string[] = [];

  // Os painéis da tampa se inclinam até se encontrarem: com 0,7·D de altura
  // eles sobem quase 45°. Acima disso fica a faixa onde passa a fita.
  const hv = D * 0.7;
  const faixa = clamp(D * 0.25, 8, 15);
  const Ht = hv + faixa;

  // fundo: aba de fechamento nas costas com lingueta, abas de poeira nas laterais
  const dh = Math.min(W * 0.45, D * 0.9);
  const k = clamp(D * 0.35, 8, Math.min(15, H * 0.4));
  const rk = Math.min(k * 0.7, W * 0.2);
  const frente: Painel = { w: W, fundo: [], dobras: [], furos: furo([W / 2, -hv - faixa / 2], diamFuro) };
  const costas: Painel = {
    w: W,
    fundo: [
      { pt: [W, H + D] }, { pt: [W - 1, H + D] }, { pt: [W - 1, H + D + k], r: rk },
      { pt: [1, H + D + k], r: rk }, { pt: [1, H + D] }, { pt: [0, H + D] },
    ],
    dobras: [linha([0, H], [W, H]), linha([1, H + D], [W - 1, H + D])],
    furos: furo([W / 2, -hv - faixa / 2], diamFuro),
  };
  /** Lateral: o "V" curvo da tampa e a aba de poeira, mais inclinada do lado
   * que encosta na aba de fechamento. */
  const lateral = (ingremeDireita: boolean): Painel => {
    const apice: Point = [D / 2, -hv];
    const [dir, esq] = ingremeDireita ? [0.6, 0.25] : [0.25, 0.6];
    return {
      w: D,
      fundo: [{ pt: [D - dh * dir, H + dh] }, { pt: [dh * esq, H + dh] }],
      dobras: [
        curva([0, 0], [D * 0.12, -hv * 0.62], apice),
        curva([D, 0], [D * 0.88, -hv * 0.62], apice),
        linha(apice, [D / 2, -Ht]),
        linha([0, H], [D, H]),
      ],
      furos: [],
    };
  };

  const pecas = tubo({
    nome: 'Caixa milk',
    paineis: [frente, lateral(true), costas, lateral(false)],
    topo: Ht,
    H,
    aba: num(p, 'aba', 10),
    horizontais: [0, -hv],
    partes: str(p, 'partes') === '2' ? 2 : 1,
  });
  if (diamFuro > faixa - 3) avisos.push('O furo da fita está quase do tamanho da faixa de fechamento.');
  return { pecas, avisos };
}

// ------------------------------------------------------------ caixa de bombom

/** Bandeja (fundo ou tampa): retângulo do fundo, quatro paredes e linguetas
 * nas paredes compridas que colam por dentro das curtas. */
function bandeja(nome: string, W: number, D: number, H: number, aba: number, janela: number, raioJanela: number): Peca {
  const tw = Math.min(aba, D * 0.45, H * 1.5);
  const c = Math.min(tw * 0.5, H * 0.3);
  const pts: Point[] = [
    [0, 0],
    [-tw, -c], [-tw, -H + c], [0, -H],
    [W, -H],
    [W + tw, -H + c], [W + tw, -c], [W, 0],
    [W + H, 0], [W + H, D], [W, D],
    [W + tw, D + c], [W + tw, D + H - c], [W, D + H],
    [0, D + H],
    [-tw, D + H - c], [-tw, D + c], [0, D],
    [-H, D], [-H, 0],
  ];
  const corte: VPath[] = [poligono(pts)];
  if (janela > 0 && W - 2 * janela > 10 && D - 2 * janela > 10) {
    corte.push(retanguloArredondado(janela, janela, W - 2 * janela, D - 2 * janela, raioJanela));
  }
  const dobra: VPath[] = [
    linha([0, 0], [W, 0]), linha([W, 0], [W, D]), linha([W, D], [0, D]), linha([0, D], [0, 0]),
    linha([0, 0], [0, -H]), linha([W, 0], [W, -H]),
    linha([0, D], [0, D + H]), linha([W, D], [W, D + H]),
  ];
  return { nome, corte, dobra };
}

export function caixaBombom(p: Params): Molde {
  const t = papel(p);
  const W = cm(p, 'largura') + t;
  const D = cm(p, 'profundidade') + t;
  const H = cm(p, 'altura');
  const Hl = cm(p, 'alturaTampa');
  const aba = num(p, 'aba', 12);
  const avisos: string[] = [];
  // a tampa abraça o fundo: duas espessuras de parede mais 1 mm de folga
  const folga = 2 * t + 1;
  const comJanela = sim(p, 'janela');
  const margem = comJanela ? num(p, 'margemJanela', 15) : 0;
  const tampa = bandeja('Tampa', W + folga, D + folga, Hl, aba, margem, Math.min(6, margem * 0.4));
  const fundo = bandeja('Fundo', W, D, H, aba, 0, 0);
  if (Hl > H) avisos.push('A tampa ficou mais alta que o fundo: ela vai sobrar embaixo.');
  if (comJanela && (W - 2 * margem <= 10 || D - 2 * margem <= 10)) avisos.push('A margem da janela é grande demais pra tampa — a janela foi deixada de fora.');
  return { pecas: [fundo, tampa], avisos };
}

// ---------------------------------------------------------------- sacolinha

export function sacolinha(p: Params): Molde {
  const t = papel(p);
  const W = cm(p, 'largura') + t;
  const D = cm(p, 'profundidade') + t;
  const H = cm(p, 'altura');
  const bd = cm(p, 'boca');
  const diamFuro = str(p, 'alca') === 'furos' ? num(p, 'furo', 5) : 0;
  const avisos: string[] = [];
  const bh = D * 0.75;
  // vão de 1 mm entre as abas do fundo, pra uma não prender na outra
  const n = 1;
  const fundo = (w: number) => [{ pt: [w - n, H + bh] as Point }, { pt: [n, H + bh] as Point }];

  const furosAlca: VPath[] = [];
  if (diamFuro > 0) {
    // furo na dobra da boca e no corpo, que se encontram quando a boca dobra
    const ys = bd > diamFuro + 4 ? [-bd / 2, bd / 2] : [Math.max(12, diamFuro * 2)];
    for (const dx of [W / 2 - W / 6, W / 2 + W / 6]) for (const y of ys) furosAlca.push(...furo([dx, y], diamFuro));
  }
  const frente = (): Painel => ({ w: W, fundo: fundo(W), dobras: [], furos: furosAlca });
  // sanfona: vinco do meio e o "V" que deixa o fundo abrir chato
  const lateral = (): Painel => {
    const v: Point = [D / 2, H - D / 2];
    const vf: Point = [D / 2, H + Math.min(D / 2, bh)];
    return {
      w: D,
      fundo: fundo(D),
      dobras: [linha([D / 2, -bd], v), linha(v, [0, H]), linha(v, [D, H]), linha([0, H], vf), linha([D, H], vf)],
      furos: [],
    };
  };

  const pecas = tubo({
    nome: 'Sacolinha',
    paineis: [frente(), lateral(), frente(), lateral()],
    topo: bd,
    H,
    aba: num(p, 'aba', 12),
    horizontais: bd > 0 ? [0, H] : [H],
    partes: str(p, 'partes') === '2' ? 2 : 1,
  });
  if (D > W) avisos.push('A profundidade está maior que a largura: a sacolinha fica mais estável com a sanfona menor que a frente.');
  return { pecas, avisos };
}

// ---------------------------------------------------------------- pirâmide

export function piramide(p: Params): Molde {
  const lados = clamp(Math.round(num(p, 'lados', 4)), 3, 8);
  const S = cm(p, 'lado');
  const H = cm(p, 'altura');
  const g = num(p, 'aba', 10);
  const comFita = str(p, 'fechamento') !== 'cola';
  const diamFuro = num(p, 'furo', 4);
  const avisos: string[] = [];

  const R = S / (2 * Math.sin(Math.PI / lados));
  const ap = S / (2 * Math.tan(Math.PI / lados));
  const s = Math.hypot(H, ap); // altura de cada face
  // Gira a planificação no ângulo que deixa a caixa envolvente menor: a cruz
  // da pirâmide de 4 lados, por exemplo, cabe bem menor deitada na diagonal.
  const vertices = (giro: number): Point[] =>
    Array.from({ length: lados }, (_, i) => pontoNoCirculo([0, 0], R, giro + Math.PI / 2 + Math.PI / lados + (2 * Math.PI * i) / lados));
  const tamanho = (giro: number): number => {
    const vs = vertices(giro);
    const pts = vs.flatMap((a, i) => {
      const b = vs[(i + 1) % lados];
      const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const lm = Math.hypot(m[0], m[1]);
      return [a, [m[0] + (m[0] / lm) * (s + g), m[1] + (m[1] / lm) * (s + g)] as Point];
    });
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return Math.max(w, h) + Math.min(w, h) * 1e-3;
  };
  let giro = 0;
  for (let k = 1; k < 36; k++) {
    const a = ((2 * Math.PI) / lados) * (k / 36);
    if (tamanho(a) < tamanho(giro) - 1e-6) giro = a;
  }
  const V = vertices(giro);

  const pts: Point[] = [];
  const dobra: VPath[] = [];
  const corte: VPath[] = [];
  for (let i = 0; i < lados; i++) {
    const a = V[i];
    const b = V[(i + 1) % lados];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const lm = Math.hypot(m[0], m[1]);
    const u: Point = [m[0] / lm, m[1] / lm];
    const apice: Point = [m[0] + u[0] * s, m[1] + u[1] * s];
    pts.push(a, apice);
    if (!comFita) {
      pts.push(...pontosDaAba(apice, b, g));
      dobra.push(linha(apice, b));
    } else if (diamFuro > 0) {
      const d = clamp(s * 0.12, 8, 18);
      corte.push(...furo([apice[0] - u[0] * d, apice[1] - u[1] * d], diamFuro));
    }
    dobra.push(linha(a, b));
  }
  corte.unshift(poligono(pts));
  if (H < ap * 0.3) avisos.push('Pirâmide bem baixa: as faces quase deitam na base.');
  return { pecas: [{ nome: 'Pirâmide', corte, dobra }], avisos };
}

// ---------------------------------------------------------------- cone

/** Disco do fundo com dentes que dobram pra cima e colam por dentro. */
function discoComDentes(r: number): Peca {
  const th = clamp(r * 0.35, 5, 10);
  const m = Math.max(8, Math.round((2 * Math.PI * r) / 12));
  const span = (2 * Math.PI) / m;
  const d = Math.min(span * 0.3, th / (r + th));
  const pts: Point[] = [];
  for (let j = 0; j < m; j++) {
    const a = span * j;
    pts.push(pontoNoCirculo([0, 0], r, a), pontoNoCirculo([0, 0], r + th, a + d), pontoNoCirculo([0, 0], r + th, a + span - d));
  }
  return { nome: 'Fundo', corte: [poligono(pts)], dobra: [circulo([0, 0], r)] };
}

export function cone(p: Params): Molde {
  let r1 = cm(p, 'boca') / 2;
  let r2 = cm(p, 'fundo') / 2;
  const H = cm(p, 'altura');
  const g = num(p, 'aba', 10);
  const avisos: string[] = [];
  if (r2 > r1) [r1, r2] = [r2, r1];
  const pecas: Peca[] = [];

  if (r1 - r2 < 0.05) {
    // cilindro: retângulo com a volta inteira
    const C = 2 * Math.PI * r1;
    const pts: Point[] = [[0, 0], [C, 0], ...pontosDaAba([C, 0], [C, H], g), [C, H], [0, H]];
    pecas.push({ nome: 'Corpo', corte: [poligono(pts)], dobra: [linha([C, 0], [C, H])] });
  } else {
    const L = Math.hypot(H, r1 - r2);
    const Ro = (L * r1) / (r1 - r2);
    const Ri = Ro - L;
    const theta = (2 * Math.PI * r1) / Ro;
    // com aba, o setor quase fechando a volta encostaria nele mesmo: vira duas metades
    const partes = theta > Math.PI * 1.7 ? 2 : 1;
    const phi = theta / partes;
    const a0 = Math.PI / 2 - phi / 2;
    const a1 = Math.PI / 2 + phi / 2;
    const c: Point = [0, 0];
    for (let k = 0; k < partes; k++) {
      const segments = [...arco(c, Ro, a0, a1)];
      const inA1 = pontoNoCirculo(c, Ri, a1);
      const inA0 = pontoNoCirculo(c, Ri, a0);
      const outA0 = pontoNoCirculo(c, Ro, a0);
      segments.push({ c1: null, c2: null, to: inA1 });
      if (Ri > 0.01) segments.push(...arco(c, Ri, a1, a0));
      else segments.push({ c1: null, c2: null, to: inA0 });
      const [q0, q1] = pontosDaAba(inA0, outA0, g);
      segments.push({ c1: null, c2: null, to: q0 }, { c1: null, c2: null, to: q1 }, { c1: null, c2: null, to: outA0 });
      const nome = partes === 1 ? 'Cone' : `Cone (metade ${k + 1})`;
      pecas.push({ nome, corte: [{ start: outA0, closed: true, segments }], dobra: [linha(inA0, outA0)] });
    }
    if (partes === 2) avisos.push('O cone é largo e baixo: o molde saiu em duas metades. Cole a aba de cada metade na borda da outra.');
  }

  if (r2 > 0 && str(p, 'tampaFundo') === 'dentes') pecas.push(discoComDentes(r2));
  return { pecas, avisos };
}

// ---------------------------------------------------------------- catálogo

export const CAIXA_MILK: TipoMolde = {
  id: 'caixa-milk',
  nome: 'Caixa milk',
  categoria: 'Caixas e embalagens',
  descricao: 'Caixinha de leite com a tampa em "V" curvo e furo para a fita.',
  campos: [
    { chave: 'largura', rotulo: 'Largura (frente)', tipo: 'numero', unidade: 'cm', min: 3, max: 30, passo: 0.5 },
    { chave: 'profundidade', rotulo: 'Profundidade (lateral)', tipo: 'numero', unidade: 'cm', min: 3, max: 30, passo: 0.5 },
    { chave: 'altura', rotulo: 'Altura do corpo', tipo: 'numero', unidade: 'cm', min: 3, max: 40, passo: 0.5 },
    { chave: 'furo', rotulo: 'Furo da fita (diâmetro)', tipo: 'numero', unidade: 'mm', min: 0, max: 10, passo: 0.5, ajuda: '0 tira o furo.' },
    CAMPO_ABA,
    CAMPO_PAPEL,
    CAMPO_PARTES,
  ],
  padrao: { largura: 5, profundidade: 5, altura: 7.5, furo: 4, aba: 10, papel: '0.25', partes: '1' },
  montagem: [
    'Vinque todas as linhas azuis antes de dobrar (régua + ponta seca, ou a lâmina em "vinco").',
    'Cole a aba lateral por dentro do último painel, formando o tubo (em duas metades, cole uma na outra pelas abas).',
    'Feche o fundo: abas laterais pra dentro, depois a aba grande com a lingueta encaixada.',
    'Na tampa, empurre as laterais pra dentro pelo "V", junte frente e costas e passe a fita pelos furos.',
  ],
  nomeArquivo: (p) => `caixa-milk-${fmt(num(p, 'largura'))}x${fmt(num(p, 'profundidade'))}x${fmt(num(p, 'altura'))}cm`,
  gerar: caixaMilk,
};

export const CAIXA_BOMBOM: TipoMolde = {
  id: 'caixa-bombom',
  nome: 'Caixa de bombom',
  categoria: 'Caixas e embalagens',
  descricao: 'Fundo e tampa encaixáveis, com janela opcional na tampa para acetato ou foto.',
  campos: [
    { chave: 'largura', rotulo: 'Largura (por dentro)', tipo: 'numero', unidade: 'cm', min: 3, max: 30, passo: 0.5 },
    { chave: 'profundidade', rotulo: 'Profundidade (por dentro)', tipo: 'numero', unidade: 'cm', min: 3, max: 30, passo: 0.5 },
    { chave: 'altura', rotulo: 'Altura do fundo', tipo: 'numero', unidade: 'cm', min: 1, max: 15, passo: 0.5 },
    { chave: 'alturaTampa', rotulo: 'Altura da tampa', tipo: 'numero', unidade: 'cm', min: 1, max: 15, passo: 0.5 },
    { chave: 'janela', rotulo: 'Janela na tampa (acetato / foto)', tipo: 'sim-nao' },
    { chave: 'margemJanela', rotulo: 'Borda em volta da janela', tipo: 'numero', unidade: 'mm', min: 5, max: 60, passo: 1, visivel: (p) => sim(p, 'janela') },
    { ...CAMPO_ABA, rotulo: 'Lingueta dos cantos' },
    CAMPO_PAPEL,
  ],
  padrao: { largura: 8, profundidade: 8, altura: 3, alturaTampa: 2, janela: false, margemJanela: 15, aba: 12, papel: '0.3' },
  montagem: [
    'Vinque as linhas azuis das duas peças.',
    'Levante as paredes e cole as linguetas dos cantos por dentro das paredes curtas.',
    'A tampa já sai um pouco maior (duas espessuras de papel + 1 mm) pra encaixar por fora do fundo.',
    'Com janela: cole o acetato ou a foto por dentro da tampa antes de montar.',
  ],
  nomeArquivo: (p) => `caixa-bombom-${fmt(num(p, 'largura'))}x${fmt(num(p, 'profundidade'))}x${fmt(num(p, 'altura'))}cm`,
  gerar: caixaBombom,
};

export const SACOLINHA: TipoMolde = {
  id: 'sacolinha',
  nome: 'Sacolinha',
  categoria: 'Caixas e embalagens',
  descricao: 'Sacola de papel com sanfona lateral, fundo quadrado e boca reforçada.',
  campos: [
    { chave: 'largura', rotulo: 'Largura (frente)', tipo: 'numero', unidade: 'cm', min: 4, max: 40, passo: 0.5 },
    { chave: 'profundidade', rotulo: 'Sanfona (lateral)', tipo: 'numero', unidade: 'cm', min: 2, max: 20, passo: 0.5 },
    { chave: 'altura', rotulo: 'Altura', tipo: 'numero', unidade: 'cm', min: 5, max: 50, passo: 0.5 },
    { chave: 'boca', rotulo: 'Dobra da boca', tipo: 'numero', unidade: 'cm', min: 0, max: 8, passo: 0.5, ajuda: 'Faixa que dobra pra dentro e reforça a alça. 0 tira.' },
    { chave: 'alca', rotulo: 'Alça', tipo: 'opcoes', opcoes: [{ valor: 'furos', rotulo: 'Furos para fita/cordão' }, { valor: 'nenhuma', rotulo: 'Sem furos' }] },
    { chave: 'furo', rotulo: 'Diâmetro dos furos', tipo: 'numero', unidade: 'mm', min: 2, max: 12, passo: 0.5, visivel: (p) => str(p, 'alca') === 'furos' },
    CAMPO_ABA,
    CAMPO_PAPEL,
    CAMPO_PARTES,
  ],
  padrao: { largura: 8, profundidade: 4, altura: 12, boca: 2.5, alca: 'furos', furo: 4, aba: 12, papel: '0.2', partes: '1' },
  montagem: [
    'Vinque todas as linhas azuis, inclusive o "V" das laterais.',
    'Dobre a faixa da boca pra dentro e cole (reforça a alça).',
    'Cole a aba lateral formando o tubo e dobre a sanfona pra dentro pelo vinco do meio.',
    'Feche o fundo: laterais em triângulo, depois as duas abas grandes por cima, coladas.',
  ],
  nomeArquivo: (p) => `sacolinha-${fmt(num(p, 'largura'))}x${fmt(num(p, 'profundidade'))}x${fmt(num(p, 'altura'))}cm`,
  gerar: sacolinha,
};

export const PIRAMIDE: TipoMolde = {
  id: 'piramide',
  nome: 'Pirâmide',
  categoria: 'Caixas e embalagens',
  descricao: 'Caixa pirâmide de 3 a 8 lados, fechada com fita ou com abas de cola.',
  campos: [
    { chave: 'lados', rotulo: 'Lados da base', tipo: 'numero', unidade: 'un', min: 3, max: 8, passo: 1 },
    { chave: 'lado', rotulo: 'Medida de cada lado da base', tipo: 'numero', unidade: 'cm', min: 2, max: 30, passo: 0.5 },
    { chave: 'altura', rotulo: 'Altura', tipo: 'numero', unidade: 'cm', min: 2, max: 40, passo: 0.5 },
    { chave: 'fechamento', rotulo: 'Fechamento', tipo: 'opcoes', opcoes: [{ valor: 'fita', rotulo: 'Fita (furo na ponta de cada face)' }, { valor: 'cola', rotulo: 'Abas de cola' }] },
    { chave: 'furo', rotulo: 'Diâmetro do furo', tipo: 'numero', unidade: 'mm', min: 0, max: 10, passo: 0.5, visivel: (p) => str(p, 'fechamento') !== 'cola' },
    { ...CAMPO_ABA, visivel: (p) => str(p, 'fechamento') === 'cola' },
  ],
  padrao: { lados: 4, lado: 6, altura: 8, fechamento: 'fita', furo: 4, aba: 10 },
  montagem: [
    'Vinque as linhas azuis da base.',
    'Levante as faces até as pontas se encontrarem.',
    'Com fita: passe a fita pelos furos e dê o laço. Com abas: cole cada aba por dentro da face vizinha.',
  ],
  nomeArquivo: (p) => `piramide-${num(p, 'lados')}lados-${fmt(num(p, 'lado'))}x${fmt(num(p, 'altura'))}cm`,
  gerar: piramide,
};

export const CONE: TipoMolde = {
  id: 'cone',
  nome: 'Cone',
  categoria: 'Caixas e embalagens',
  descricao: 'Cone de guloseimas ou copinho (cone cortado), com aba de cola e fundo opcional.',
  campos: [
    { chave: 'boca', rotulo: 'Diâmetro da boca', tipo: 'numero', unidade: 'cm', min: 2, max: 30, passo: 0.5 },
    { chave: 'fundo', rotulo: 'Diâmetro do fundo', tipo: 'numero', unidade: 'cm', min: 0, max: 30, passo: 0.5, ajuda: '0 = cone de ponta. Igual à boca = cilindro.' },
    { chave: 'altura', rotulo: 'Altura', tipo: 'numero', unidade: 'cm', min: 2, max: 40, passo: 0.5 },
    {
      chave: 'tampaFundo', rotulo: 'Fundo', tipo: 'opcoes',
      opcoes: [{ valor: 'dentes', rotulo: 'Disco com dentes para colar' }, { valor: 'nenhum', rotulo: 'Sem fundo' }],
      visivel: (p) => num(p, 'fundo') > 0,
    },
    CAMPO_ABA,
  ],
  padrao: { boca: 7, fundo: 0, altura: 14, tampaFundo: 'dentes', aba: 10 },
  montagem: [
    'Vinque a linha da aba.',
    'Enrole o setor até a borda encostar na linha da aba e cole por dentro.',
    'Com fundo: dobre os dentes do disco pra cima e cole por dentro da base do cone.',
  ],
  nomeArquivo: (p) => `cone-${fmt(num(p, 'boca'))}x${fmt(num(p, 'altura'))}cm`,
  gerar: cone,
};
