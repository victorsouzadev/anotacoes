/** Modelos prontos de post da Viih Mimos: story, feed e carrossel na
 * identidade da marca (rosa nuvem, laço, Dancing Script nos títulos,
 * Montserrat espaçada no apoio, @viihmimos_ no rodapé).
 *
 * Cada modelo são camadas comuns do modo Redes sociais — texto, forma e
 * arquivo da marca —, então tudo continua editável depois de aplicado. As
 * medidas são escritas em px de um post de 1080 de largura, como num arquivo
 * de design, e convertidas aqui pra frações do quadro inteiro (no carrossel, a
 * faixa com todos os posts lado a lado). */

import { uuid } from '../../core/uuid';
import { PhotoSlot, SOCIAL_FORMATS } from './social-model';
import { ImageOverlay, Overlay, ShapeOverlay, TextOverlay } from './social-overlays';
import { brandAssetDef } from './brand-assets';
import { TemplateLook } from './social-store';

export const VM = {
  rosa: '#E7548C',
  algodao: '#F28BAE',
  bebe: '#F7B6C7',
  nuvem: '#FFE6EE',
  profundo: '#C2185B',
  grafite: '#4D4D4D',
  branco: '#FFFFFF',
} as const;

export const VM_INSTAGRAM = '@viihmimos_';
export const VM_WHATSAPP = '(91) 99373-1794';

export type TemplateGroup = 'Story' | 'Feed' | 'Carrossel';

export interface SocialTemplate {
  id: string;
  label: string;
  group: TemplateGroup;
  help: string;
  formatId: string;
  slides: number;
  /** O modelo reserva um espaço pra foto. */
  photo: boolean;
  build: () => TemplateLook;
}

/** Largura de cada post no desenho dos modelos. */
const W = 1080;

type TextOpts = Partial<Omit<TextOverlay, 'kind' | 'id' | 'x' | 'y' | 'size' | 'text'>>;

/** Escreve camadas em px de design e devolve frações do quadro. */
export class TemplateBuilder {
  readonly H: number;
  readonly frameW: number;
  readonly base: number;
  readonly overlays: Overlay[] = [];
  slot: PhotoSlot | null = null;

  constructor(readonly formatId: string, readonly slides = 1) {
    const format = SOCIAL_FORMATS.find((f) => f.id === formatId);
    if (!format) throw new Error(`Formato desconhecido: ${formatId}`);
    this.H = Math.round(W / format.ratio);
    this.frameW = W * slides;
    // O mesmo lado menor que o desenho usa pra medir letra e forma.
    this.base = Math.min(this.frameW, this.H);
  }

  private fx(slide: number, x: number): number {
    return (slide * W + x) / this.frameW;
  }

  text(slide: number, x: number, y: number, text: string, sizePx: number, opts: TextOpts = {}): TextOverlay {
    const o: TextOverlay = {
      id: uuid(), kind: 'texto', text,
      x: this.fx(slide, x), y: y / this.H, size: sizePx / this.base, rotation: 0,
      fontId: 'montserrat', bold: false, color: VM.grafite, style: 'simples', accent: VM.rosa,
      ...opts,
    };
    this.overlays.push(o);
    return o;
  }

  /** Título na letra cursiva da marca. */
  script(slide: number, y: number, text: string, sizePx: number, opts: TextOpts = {}): TextOverlay {
    return this.text(slide, W / 2, y, text, sizePx, { fontId: 'dancing-script', bold: true, color: VM.rosa, ...opts });
  }

  /** Apoio em caixa alta espaçada. */
  caps(slide: number, y: number, text: string, sizePx: number, opts: TextOpts = {}): TextOverlay {
    return this.text(slide, W / 2, y, text.toUpperCase(), sizePx, { bold: true, color: VM.rosa, tracking: 0.3, ...opts });
  }

  rect(slide: number, x: number, y: number, w: number, h: number, opts: Partial<ShapeOverlay> = {}): ShapeOverlay {
    const o: ShapeOverlay = {
      id: uuid(), kind: 'forma', shape: 'retangulo',
      x: this.fx(slide, x + w / 2), y: (y + h / 2) / this.H, size: h / this.base, rotation: 0,
      aspect: w / h, fill: '', stroke: '', strokeWidth: 0, radius: 0,
      ...opts,
    };
    // Espessura e raio chegam em px de design, como o resto.
    o.strokeWidth = (opts.strokeWidth ?? 0) / this.base;
    o.radius = (opts.radius ?? 0) / this.base;
    this.overlays.push(o);
    return o;
  }

  circle(slide: number, cx: number, cy: number, d: number, fill: string): ShapeOverlay {
    const o = this.rect(slide, cx - d / 2, cy - d / 2, d, d, { fill });
    o.shape = 'circulo';
    return o;
  }

  asset(slide: number, id: string, cx: number, cy: number, hPx: number, opts: Partial<ImageOverlay> = {}): ImageOverlay {
    const def = brandAssetDef(id);
    if (!def) throw new Error(`Arquivo da marca desconhecido: ${id}`);
    const o: ImageOverlay = {
      id: uuid(), kind: 'imagem', asset: id, aspect: def.aspect,
      x: this.fx(slide, cx), y: cy / this.H, size: hPx / this.base, rotation: 0,
      ...opts,
    };
    this.overlays.push(o);
    return o;
  }

  /** Espaço da foto, em px de design. */
  photo(slide: number, x: number, y: number, w: number, h: number, radius: number): void {
    this.slot = {
      x: this.fx(slide, x), y: y / this.H, w: w / this.frameW, h: h / this.H, radius: radius / this.base,
    };
  }

  // --- peças que se repetem ---

  /** Moldura fina arredondada, a 48 px da borda — a assinatura das artes da
   * marca. Travada, pra não roubar o arraste da foto. */
  frame(slide: number): void {
    this.rect(slide, 44, 44, W - 88, this.H - 88, { stroke: VM.bebe, strokeWidth: 3, radius: 30, locked: true });
  }

  divider(slide: number, y: number, hPx = 34): void {
    this.asset(slide, 'divisor', W / 2, y, hPx);
  }

  bow(slide: number, y: number, hPx = 110): void {
    this.asset(slide, 'laco', W / 2, y, hPx);
  }

  handle(slide: number, y: number, sizePx = 28): void {
    this.caps(slide, y, VM_INSTAGRAM, sizePx, { tracking: 0.28 });
  }

  look(templateId: string, bgColor: string = VM.nuvem, bgPattern = ''): TemplateLook {
    return {
      templateId, formatId: this.formatId, slides: this.slides,
      bgColor, bgPattern, slot: this.slot, overlays: this.overlays,
    };
  }
}

// ---------------------------------------------------------------- story ---

function storyEncomendas(): TemplateLook {
  const b = new TemplateBuilder('story');
  b.frame(0);
  b.bow(0, 690, 120);
  b.script(0, 915, 'encomendas\nabertas', 150);
  b.divider(0, 1110);
  b.text(0, W / 2, 1200, 'topos de bolo · kits festa · agendas', 44);
  b.caps(0, 1305, 'chama no direct 💕', 34);
  b.handle(0, 1790);
  return b.look('vm-story-encomendas');
}

function storyNovidade(): TemplateLook {
  const b = new TemplateBuilder('story');
  b.frame(0);
  b.bow(0, 215, 100);
  b.photo(0, 120, 320, 840, 1020, 36);
  b.script(0, 1470, 'novidade', 140);
  b.text(0, W / 2, 1585, 'arraste e veja o que saiu do ateliê hoje', 38);
  b.divider(0, 1680);
  b.handle(0, 1790);
  return b.look('vm-story-novidade');
}

function storyObrigada(): TemplateLook {
  const b = new TemplateBuilder('story');
  b.rect(0, 110, 520, 860, 880, { fill: VM.branco, radius: 44, locked: true });
  b.bow(0, 660, 120);
  b.script(0, 850, 'obrigada!', 150);
  b.divider(0, 990);
  b.text(0, W / 2, 1125, 'cada encomenda entregue\né uma festa que ficou\ncom a sua cara 💕', 42);
  b.handle(0, 1290, 30);
  return b.look('vm-story-obrigada', VM.nuvem, 'padrao-coracoes');
}

function storyBastidores(): TemplateLook {
  const b = new TemplateBuilder('story');
  b.photo(0, 60, 60, 960, 1480, 40);
  b.script(0, 1655, 'bastidores', 120);
  b.text(0, W / 2, 1765, 'cortado, montado e conferido à mão ✂️', 38);
  b.handle(0, 1850, 26);
  return b.look('vm-story-bastidores');
}

// ----------------------------------------------------------------- feed ---

function feedProduto(): TemplateLook {
  const b = new TemplateBuilder('retrato');
  b.frame(0);
  b.photo(0, 100, 100, 880, 880, 32);
  b.script(0, 1070, 'topo de bolo', 104);
  b.caps(0, 1160, 'com o nome, o tema e as cores da festa', 26, { color: VM.grafite, bold: false, tracking: 0.18 });
  b.text(0, W / 2, 1240, 'ENCOMENDE PELO DIRECT', 28, { bold: true, color: VM.branco, style: 'fundo', accent: VM.rosa, tracking: 0.14 });
  return b.look('vm-feed-produto');
}

function feedNovidade(): TemplateLook {
  const b = new TemplateBuilder('feed');
  b.frame(0);
  b.bow(0, 160, 100);
  b.photo(0, 150, 290, 780, 480, 28);
  b.script(0, 850, 'novidade', 100);
  b.caps(0, 925, 'topo de bolo personalizado', 32, { color: VM.grafite, bold: false, tracking: 0.25 });
  b.divider(0, 985, 30);
  b.handle(0, 1022, 26);
  return b.look('vm-feed-novidade');
}

function feedDepoimento(): TemplateLook {
  const b = new TemplateBuilder('feed');
  b.frame(0);
  b.script(0, 185, 'quem encomendou, amou', 84);
  b.divider(0, 265);
  b.text(0, W / 2, 360, '★ ★ ★ ★ ★', 44, { color: VM.rosa });
  b.text(0, W / 2, 530, '"a festa ficou do jeitinho\nque eu sonhei. cada detalhe\nperfeito, obrigada Viih!"', 44);
  b.caps(0, 720, 'Ana, mãe da Alice', 28, { tracking: 0.2 });
  b.asset(0, 'coracao', W / 2, 820, 60);
  b.handle(0, 1000, 26);
  return b.look('vm-feed-depoimento');
}

function feedObrigada(): TemplateLook {
  const b = new TemplateBuilder('feed');
  b.rect(0, 140, 140, 800, 800, { fill: VM.branco, radius: 44, locked: true });
  b.bow(0, 310, 110);
  b.script(0, 480, 'obrigada!', 140);
  b.text(0, W / 2, 615, 'pela confiança de sempre 💕', 38);
  b.divider(0, 700);
  b.handle(0, 810, 28);
  return b.look('vm-feed-obrigada', VM.nuvem, 'padrao-coracoes');
}

// ------------------------------------------------------------ carrossel ---

function carrosselLancamento(): TemplateLook {
  const b = new TemplateBuilder('feed', 6);
  for (let i = 0; i < 6; i++) b.frame(i);

  // 1. capa
  b.asset(0, 'logo', W / 2, 470, 640);
  b.caps(0, 850, 'chegou a sua papelaria personalizada', 25, { tracking: 0.22 });
  b.caps(0, 960, 'arrasta pro lado →', 24, { color: VM.grafite, bold: false, tracking: 0.25 });

  // 2. quem faz
  b.bow(1, 250, 120);
  b.script(1, 400, 'oi, eu sou a Viih', 104);
  b.divider(1, 500);
  b.text(1, W / 2, 680, 'Faço papelaria personalizada em casa,\nà mão, aqui em Marabá-PA. Cada peça\nsai com o nome de alguém — e com o\ncapricho de quem gosta do que faz.', 36);
  b.handle(1, 1000, 26);

  // 3. o que eu faço
  b.script(2, 200, 'o que eu faço', 96);
  b.divider(2, 285);
  const produtos: [string, string, string][] = [
    ['icone-topo-de-bolo', 'topo de bolo', 'personalizado com nome, tema\nou silhueta'],
    ['icone-kit-festa', 'kit festa', 'caixinhas, tags, rótulos,\nsaquinhos e convites'],
    ['icone-agendas', 'agendas', 'capa personalizada, para\npresente ou brinde'],
  ];
  produtos.forEach(([icone, nome, nota], k) => {
    const y = 440 + k * 175;
    b.circle(2, 250, y, 112, VM.branco);
    b.asset(2, icone, 250, y, 70);
    b.text(2, 340, y - 32, nome.toUpperCase(), 30, { align: 'left', bold: true, color: VM.rosa, tracking: 0.12 });
    b.text(2, 340, y + 28, nota, 27, { align: 'left' });
  });
  b.handle(2, 1000, 26);

  // 4. como encomendar
  b.script(3, 230, 'como encomendar', 96);
  b.divider(3, 315);
  const passos = [
    'me chama no direct ou no WhatsApp',
    'conta o tema, a quantidade e a data',
    'eu mando o valor e a arte para aprovar',
    'aprovou, eu produzo e te entrego',
  ];
  passos.forEach((p, k) => {
    const y = 480 + k * 102;
    b.circle(3, 217, y, 78, VM.rosa);
    b.text(3, 217, y, String(k + 1), 36, { bold: true, color: VM.branco });
    b.text(3, 285, y, p, 32, { align: 'left' });
  });
  b.handle(3, 1000, 26);

  // 5. prazos e pagamento
  b.bow(4, 230, 110);
  b.script(4, 370, 'prazos e pagamento', 96);
  b.divider(4, 465);
  b.text(4, W / 2, 660, 'Produção em até 5 dias úteis\ndepois da arte aprovada.\n\n50% de sinal para começar,\n50% na entrega.\n\nPix, dinheiro ou cartão.', 34);
  b.handle(4, 1000, 26);

  // 6. chamada
  b.bow(5, 280, 120);
  b.script(5, 440, 'bora combinar?', 112);
  b.divider(5, 545);
  b.text(5, W / 2, 680, 'Me chama no direct ou no WhatsApp\ncom o tema da sua festa.\nEu respondo em até 12 horas.', 36);
  b.caps(5, 850, `${VM_INSTAGRAM} · ${VM_WHATSAPP}`, 28, { tracking: 0.12 });

  return b.look('vm-carrossel-lancamento');
}

function carrosselProduto(): TemplateLook {
  const b = new TemplateBuilder('retrato', 3);

  // 1. capa com a foto
  b.photo(0, 70, 70, 940, 1010, 36);
  b.script(0, 1175, 'topo de bolo', 104);
  b.caps(0, 1265, 'arrasta pro lado →', 24, { color: VM.grafite, bold: false, tracking: 0.25 });

  // 2. detalhes
  b.frame(1);
  b.bow(1, 250, 110);
  b.script(1, 400, 'os detalhes', 104);
  b.divider(1, 500);
  const itens = [
    'nome e idade de quem faz a festa',
    'tema e cores do jeitinho que você pedir',
    'recortado e montado à mão, peça por peça',
    'prazo de 5 dias úteis depois da arte aprovada',
  ];
  itens.forEach((t, k) => {
    const y = 640 + k * 110;
    b.asset(1, 'coracao', 120, y, 44);
    b.text(1, 165, y, t, 33, { align: 'left' });
  });
  b.handle(1, 1250, 26);

  // 3. chamada
  b.frame(2);
  b.bow(2, 360, 130);
  b.script(2, 530, 'gostou?', 140);
  b.divider(2, 650);
  b.text(2, W / 2, 790, 'encomende o seu pelo direct\nou pelo WhatsApp', 40);
  b.text(2, W / 2, 960, VM_WHATSAPP, 38, { bold: true, color: VM.branco, style: 'fundo', accent: VM.rosa, tracking: 0.06 });
  b.handle(2, 1250, 26);

  return b.look('vm-carrossel-produto');
}

export const SOCIAL_TEMPLATES: SocialTemplate[] = [
  { id: 'vm-story-encomendas', label: 'Encomendas abertas', group: 'Story', help: 'Início de semana ou quando abrir agenda', formatId: 'story', slides: 1, photo: false, build: storyEncomendas },
  { id: 'vm-story-novidade', label: 'Novidade', group: 'Story', help: 'Foto de uma peça nova, com laço e título', formatId: 'story', slides: 1, photo: true, build: storyNovidade },
  { id: 'vm-story-obrigada', label: 'Obrigada', group: 'Story', help: 'Depois de entregar uma encomenda', formatId: 'story', slides: 1, photo: false, build: storyObrigada },
  { id: 'vm-story-bastidores', label: 'Bastidores', group: 'Story', help: 'Foto grande da produção, com legenda', formatId: 'story', slides: 1, photo: true, build: storyBastidores },
  { id: 'vm-feed-produto', label: 'Produto em destaque', group: 'Feed', help: 'Retrato 4:5 com a foto, o nome e o convite pra encomendar', formatId: 'retrato', slides: 1, photo: true, build: feedProduto },
  { id: 'vm-feed-novidade', label: 'Novidade', group: 'Feed', help: 'Quadrado com espaço pra foto do produto', formatId: 'feed', slides: 1, photo: true, build: feedNovidade },
  { id: 'vm-feed-depoimento', label: 'Depoimento', group: 'Feed', help: 'Frase de cliente com estrelas', formatId: 'feed', slides: 1, photo: false, build: feedDepoimento },
  { id: 'vm-feed-obrigada', label: 'Obrigada', group: 'Feed', help: 'Agradecer clientes, fim de semana, fim de mês', formatId: 'feed', slides: 1, photo: false, build: feedObrigada },
  { id: 'vm-carrossel-lancamento', label: 'Apresentação', group: 'Carrossel', help: '6 posts: capa, quem faz, o que faço, como encomendar, prazos e chamada', formatId: 'feed', slides: 6, photo: false, build: carrosselLancamento },
  { id: 'vm-carrossel-produto', label: 'Produto', group: 'Carrossel', help: '3 posts 4:5: foto de capa, detalhes e chamada', formatId: 'retrato', slides: 3, photo: true, build: carrosselProduto },
];

export const TEMPLATE_GROUPS: { name: TemplateGroup; templates: SocialTemplate[] }[] =
  (['Story', 'Feed', 'Carrossel'] as TemplateGroup[]).map((name) => ({
    name, templates: SOCIAL_TEMPLATES.filter((t) => t.group === name),
  }));
