/** Modelos prontos do modo Ilustração: pontos de partida pros trabalhos que
 * mais se repetem (topo de bolo, tag, etiqueta, convite, adesivo de nome).
 * Cada modelo são camadas comuns — texto, forma, efeitos —, então tudo continua
 * editável; o contorno de corte é gerado de verdade depois que as fontes
 * carregam, igual ao botão "Contorno". */

import { Layer, ShapeLayer, TextLayer } from './illustration-model';
import { IllustrationStore } from './illustration-store';

export interface IllustrationTemplate {
  id: string;
  label: string;
  help: string;
  widthMm: number;
  heightMm: number;
  /** Miniatura: marcação SVG num quadro de 60×60. */
  preview: string;
  build: (s: IllustrationStore) => Layer[];
  /** Margem do contorno de corte em volta de tudo, em mm (0 = sem). */
  cutMarginMm: number;
}

function text(s: IllustrationStore, x: number, y: number, value: string, patch: Partial<TextLayer>): TextLayer {
  return { ...s.newText(x, y, value), name: value.split('\n')[0].slice(0, 24), ...patch };
}

function shape(s: IllustrationStore, kind: ShapeLayer['shape'], x: number, y: number, w: number, h: number, patch: Partial<ShapeLayer>): ShapeLayer {
  return { ...s.newShape(kind, x, y, w, h), stroke: null, ...patch };
}

const TOPPER_FX = { outline: { color: '#ffffff', widthMm: 1.6 }, outline2: { color: '#3b2a4a', widthMm: 1.1 } };

export const TEMPLATES: IllustrationTemplate[] = [
  {
    id: 'topo-bolo',
    label: 'Topo de bolo',
    help: 'Nome, idade e frase em arco, com contorno duplo e linha de corte',
    widthMm: 160,
    heightMm: 120,
    // margem larga o bastante pra juntar tudo numa peça só
    cutMarginMm: 4,
    preview: '<path d="M10 30 Q30 8 50 30" fill="none" stroke="#3b2a4a" stroke-width="2.5" stroke-dasharray="3 2"/><text x="30" y="42" font-size="15" text-anchor="middle" font-family="cursive" fill="#e91e63" stroke="#3b2a4a" stroke-width=".6">Ana</text><text x="30" y="54" font-size="8" text-anchor="middle" fill="#3b2a4a">5 anos</text>',
    build: (s) => [
      text(s, 80, 38, 'FELIZ ANIVERSÁRIO', { fontId: 'fredoka', weight: 700, sizeMm: 9, curve: 'arco', bend: 28, fill: '#3b2a4a', tracking: 60 }),
      text(s, 80, 64, 'Ana', { fontId: 'pacifico', sizeMm: 38, fill: '#e91e63', effects: TOPPER_FX }),
      text(s, 80, 88, '5 anos', { fontId: 'fredoka', weight: 700, sizeMm: 14, fill: '#6d5ef8', effects: TOPPER_FX }),
      shape(s, 'estrela', 38, 66, 16, 16, { fill: '#f6c343', effects: TOPPER_FX }),
      shape(s, 'estrela', 122, 66, 16, 16, { fill: '#f6c343', effects: TOPPER_FX }),
    ],
  },
  {
    id: 'tag',
    label: 'Tag de presente',
    help: 'Tag com furo pra fita, "com carinho" e espaço pro nome',
    widthMm: 60,
    heightMm: 95,
    cutMarginMm: 0,
    preview: '<rect x="16" y="6" width="28" height="48" rx="5" fill="#fde2e4" stroke="#c9184a" stroke-width="1.2"/><circle cx="30" cy="14" r="3" fill="#fff" stroke="#c9184a"/><text x="30" y="34" font-size="7" text-anchor="middle" font-family="cursive" fill="#c9184a">Com</text><text x="30" y="42" font-size="7" text-anchor="middle" font-family="cursive" fill="#c9184a">carinho</text>',
    build: (s) => [
      shape(s, 'retangulo', 30, 47.5, 50, 85, { radius: 8, fill: '#fde2e4', stroke: '#c9184a', strokeWidth: 0.6, cut: false }),
      shape(s, 'elipse', 30, 14, 7, 7, { fill: '#ffffff', stroke: '#c9184a', strokeWidth: 0.6 }),
      text(s, 30, 46, 'Com\ncarinho', { fontId: 'great-vibes', sizeMm: 13, fill: '#c9184a', lineHeight: 1 }),
      text(s, 30, 72, 'Para: ______', { fontId: 'quicksand', weight: 700, sizeMm: 4.5, fill: '#5c4d4d' }),
      text(s, 30, 80, 'De: ______', { fontId: 'quicksand', weight: 700, sizeMm: 4.5, fill: '#5c4d4d' }),
    ],
  },
  {
    id: 'etiqueta',
    label: 'Etiqueta redonda',
    help: 'Para potes e embalagens: frase em volta e nome no meio',
    widthMm: 60,
    heightMm: 60,
    cutMarginMm: 0,
    preview: '<circle cx="30" cy="30" r="24" fill="#e9f5db" stroke="#557c3e" stroke-width="1.5"/><circle cx="30" cy="30" r="17" fill="none" stroke="#557c3e" stroke-dasharray="2 1.5"/><text x="30" y="34" font-size="10" text-anchor="middle" font-family="cursive" fill="#557c3e">Doce</text>',
    build: (s) => [
      shape(s, 'elipse', 30, 30, 56, 56, { fill: '#e9f5db', stroke: '#557c3e', strokeWidth: 0.8 }),
      shape(s, 'elipse', 30, 30, 40, 40, { fill: null, stroke: '#557c3e', strokeWidth: 0.35 }),
      // No arco de volta inteira o raio sai do comprimento do texto: três vezes a
      // frase nesse corpo põe o anel entre os dois círculos.
      text(s, 30, 30, 'FEITO COM AMOR • FEITO COM AMOR • FEITO COM AMOR •', { fontId: 'montserrat', weight: 700, sizeMm: 4, curve: 'arco', bend: 100, fill: '#557c3e', tracking: 80 }),
      text(s, 30, 31, 'Doce de\nleite', { fontId: 'dancing-script', weight: 700, sizeMm: 8.5, fill: '#3d5a2a', lineHeight: 1 }),
    ],
  },
  {
    id: 'convite',
    label: 'Convite',
    help: 'Formato A6, com moldura, nome em destaque e dia, hora e local',
    widthMm: 105,
    heightMm: 148,
    cutMarginMm: 0,
    preview: '<rect x="13" y="4" width="34" height="52" fill="#fffaf0" stroke="#b08968" stroke-width="1.2"/><rect x="16" y="7" width="28" height="46" fill="none" stroke="#b08968" stroke-width=".5"/><text x="30" y="26" font-size="9" text-anchor="middle" font-family="cursive" fill="#7f5539">Ana</text><path d="M20 36h20M22 41h16M24 46h12" stroke="#b08968"/>',
    build: (s) => [
      shape(s, 'retangulo', 52.5, 74, 105, 148, { fill: '#fffaf0' }),
      shape(s, 'retangulo', 52.5, 74, 93, 136, { fill: null, stroke: '#b08968', strokeWidth: 0.8, radius: 3 }),
      shape(s, 'retangulo', 52.5, 74, 87, 130, { fill: null, stroke: '#b08968', strokeWidth: 0.3, radius: 2 }),
      text(s, 52.5, 30, 'VOCÊ ESTÁ CONVIDADO', { fontId: 'cinzel', weight: 700, sizeMm: 5, fill: '#7f5539', tracking: 120 }),
      text(s, 52.5, 55, 'Ana', { fontId: 'great-vibes', sizeMm: 30, fill: '#7f5539' }),
      text(s, 52.5, 78, 'para o meu aniversário de 5 anos', { fontId: 'cormorant-garamond', sizeMm: 5.5, fill: '#5c4033' }),
      shape(s, 'estrela', 52.5, 92, 6, 6, { fill: '#d4a373' }),
      text(s, 52.5, 108, 'Sábado, 12 de outubro · 16h\nRua das Flores, 123', { fontId: 'cormorant-garamond', weight: 700, sizeMm: 5, fill: '#5c4033', lineHeight: 1.5 }),
    ],
  },
  {
    id: 'adesivo-nome',
    label: 'Adesivo de nome',
    help: 'Nome grande com contorno branco e linha de corte — pra material escolar',
    widthMm: 90,
    heightMm: 40,
    cutMarginMm: 2,
    preview: '<text x="30" y="37" font-size="17" text-anchor="middle" font-family="sans-serif" font-weight="bold" fill="#2a9d8f" stroke="#264653" stroke-width="1" paint-order="stroke">Theo</text><rect x="6" y="18" width="48" height="26" rx="10" fill="none" stroke="#e53935" stroke-dasharray="2 1.5"/>',
    build: (s) => [
      text(s, 45, 20, 'Theo', { fontId: 'luckiest-guy', sizeMm: 22, fill: '#2a9d8f', effects: { outline: { color: '#ffffff', widthMm: 1.8 }, shadow: { color: '#264653', dx: 0.8, dy: 0.8, opacity: 0.5 } } }),
    ],
  },
];

/** Troca o desenho pelo modelo (um passo de desfazer só) e, quando o modelo
 * pede, gera o contorno de corte em volta de tudo. */
export async function applyTemplate(s: IllustrationStore, t: IllustrationTemplate): Promise<void> {
  const layers = t.build(s);
  await Promise.all(layers.filter((l): l is TextLayer => l.kind === 'texto').map((l) => s.fonts.load(l.fontId, l.weight)));
  s.record();
  s.widthMm.set(t.widthMm);
  s.heightMm.set(t.heightMm);
  s.layers.set(layers);
  s.selectedIds.set([]);
  if (t.cutMarginMm > 0) {
    s.selectedIds.set(layers.map((l) => l.id));
    s.outline(t.cutMarginMm, true);
    s.selectedIds.set([]);
  }
  s.status.set(`Modelo "${t.label}" aplicado — clique num texto pra trocar.`);
}
