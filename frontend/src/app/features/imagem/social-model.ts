/** Modelo do modo "Redes Sociais": formatos de post, ajustes de cor, filtros
 * prontos e as duas funções puras que decidem o que o canvas desenha. Fica fora
 * do componente porque o store do projeto e os testes também dependem disso. */

/** Formato de saída: proporção e o lado maior em pixels na exportação. */
export interface SocialFormat {
  id: string;
  label: string;
  hint: string;
  ratio: number;
  /** Largura de exportação em px; a altura sai da proporção. */
  width: number;
}

export const SOCIAL_FORMATS: SocialFormat[] = [
  { id: 'feed', label: 'Feed 1:1', hint: 'Post quadrado', ratio: 1, width: 1080 },
  { id: 'retrato', label: 'Retrato 4:5', hint: 'Feed vertical', ratio: 4 / 5, width: 1080 },
  { id: 'story', label: 'Story 9:16', hint: 'Stories e Reels', ratio: 9 / 16, width: 1080 },
  { id: 'paisagem', label: 'Paisagem 16:9', hint: 'YouTube e capas', ratio: 16 / 9, width: 1920 },
  { id: 'retrato23', label: 'Pinterest 2:3', hint: 'Pin vertical', ratio: 2 / 3, width: 1000 },
  { id: 'capa', label: 'Capa 3:1', hint: 'Banner largo', ratio: 3, width: 1500 },
];

/** Ajustes de cor. Os quatro primeiros viram um `filter` de canvas; os outros
 * são camadas desenhadas por cima. */
export interface Adjustments {
  /** % — 100 é neutro. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Graus de rotação de matiz, -30..30. */
  hue: number;
  /** -100 (frio/azulado) a 100 (quente/alaranjado). */
  temperature: number;
  /** 0..100 — quanto a imagem desbota pro branco (efeito "fade"). */
  fade: number;
  /** 0..100 — escurecimento das bordas. */
  vignette: number;
  /** 0..100 — sépia. */
  sepia: number;
  /** 0..100 — preto e branco. */
  grayscale: number;
  /** 0..100 — desfoque, em décimos de px do lado maior/1000. */
  blur: number;
}

export const NEUTRAL: Adjustments = {
  brightness: 100, contrast: 100, saturation: 100, hue: 0,
  temperature: 0, fade: 0, vignette: 0, sepia: 0, grayscale: 0, blur: 0,
};

export interface FilterPreset {
  id: string;
  label: string;
  /** Família do filtro — vira um grupo no painel. */
  group: string;
  values: Partial<Adjustments>;
}

/** Filtros prontos: combinações de ajuste que o usuário aplica num clique e
 * pode continuar mexendo depois. São agrupados por família porque a lista é
 * longa demais pra uma grade solta. */
export const FILTER_PRESETS: FilterPreset[] = [
  // --- básicos ---
  { id: 'original', label: 'Original', group: 'Básicos', values: {} },
  { id: 'vivido', label: 'Vívido', group: 'Básicos', values: { saturation: 135, contrast: 112, brightness: 103 } },
  { id: 'suave', label: 'Suave', group: 'Básicos', values: { saturation: 92, contrast: 94, brightness: 105, fade: 14 } },
  { id: 'clean', label: 'Clean', group: 'Básicos', values: { brightness: 108, contrast: 96, saturation: 96, fade: 8 } },
  { id: 'nitido', label: 'Nítido', group: 'Básicos', values: { contrast: 124, saturation: 108 } },
  { id: 'claro', label: 'Clarear', group: 'Básicos', values: { brightness: 118, contrast: 96, fade: 6 } },
  { id: 'denso', label: 'Encorpado', group: 'Básicos', values: { brightness: 94, contrast: 120, saturation: 106, vignette: 18 } },

  // --- quentes ---
  { id: 'quente', label: 'Quente', group: 'Quentes', values: { temperature: 38, saturation: 110, brightness: 103 } },
  { id: 'dourado', label: 'Dourado', group: 'Quentes', values: { temperature: 55, sepia: 18, brightness: 104, saturation: 116 } },
  { id: 'porsol', label: 'Pôr do sol', group: 'Quentes', values: { temperature: 70, contrast: 108, saturation: 124, vignette: 20 } },
  { id: 'terroso', label: 'Terroso', group: 'Quentes', values: { temperature: 30, sepia: 26, saturation: 84, contrast: 104 } },
  { id: 'pessego', label: 'Pêssego', group: 'Quentes', values: { temperature: 34, brightness: 110, saturation: 96, fade: 16 } },
  { id: 'caramelo', label: 'Caramelo', group: 'Quentes', values: { temperature: 48, sepia: 30, contrast: 112, brightness: 98 } },

  // --- frios ---
  { id: 'frio', label: 'Frio', group: 'Frios', values: { temperature: -38, saturation: 104, contrast: 106 } },
  { id: 'azulado', label: 'Azulado', group: 'Frios', values: { temperature: -62, saturation: 112, contrast: 110 } },
  { id: 'neblina', label: 'Neblina', group: 'Frios', values: { temperature: -24, brightness: 108, saturation: 82, fade: 26 } },
  { id: 'menta', label: 'Menta', group: 'Frios', values: { temperature: -30, hue: 12, saturation: 108, brightness: 104 } },
  { id: 'noturno', label: 'Noturno', group: 'Frios', values: { temperature: -50, brightness: 88, contrast: 122, vignette: 38 } },

  // --- filme ---
  { id: 'vintage', label: 'Vintage', group: 'Filme', values: { sepia: 32, saturation: 82, contrast: 92, fade: 20, vignette: 26 } },
  { id: 'cinema', label: 'Cinema', group: 'Filme', values: { contrast: 118, saturation: 88, temperature: -14, vignette: 34 } },
  { id: 'polaroid', label: 'Polaroid', group: 'Filme', values: { brightness: 108, contrast: 88, saturation: 90, fade: 34, temperature: 14 } },
  { id: 'super8', label: 'Super 8', group: 'Filme', values: { sepia: 22, temperature: 40, contrast: 116, saturation: 94, vignette: 30 } },
  { id: 'desbotado', label: 'Desbotado', group: 'Filme', values: { fade: 46, contrast: 88, saturation: 78 } },
  { id: 'lomo', label: 'Lomo', group: 'Filme', values: { saturation: 142, contrast: 126, vignette: 52 } },

  // --- preto e branco ---
  { id: 'pb', label: 'Preto e branco', group: 'Preto e branco', values: { grayscale: 100, contrast: 115 } },
  { id: 'pbsuave', label: 'P&B suave', group: 'Preto e branco', values: { grayscale: 100, contrast: 96, brightness: 106, fade: 18 } },
  { id: 'pbforte', label: 'P&B contrastado', group: 'Preto e branco', values: { grayscale: 100, contrast: 145, brightness: 96, vignette: 30 } },
  { id: 'pbsepia', label: 'Sépia clássica', group: 'Preto e branco', values: { grayscale: 100, sepia: 70, contrast: 106, fade: 10 } },

  // --- editorial ---
  { id: 'matte', label: 'Matte', group: 'Editorial', values: { fade: 30, contrast: 102, saturation: 88, brightness: 102 } },
  { id: 'moda', label: 'Moda', group: 'Editorial', values: { contrast: 114, saturation: 92, brightness: 104, temperature: -10 } },
  { id: 'produto', label: 'Produto', group: 'Editorial', values: { brightness: 112, contrast: 108, saturation: 104 } },
  { id: 'gastronomia', label: 'Gastronomia', group: 'Editorial', values: { temperature: 22, saturation: 126, contrast: 110, brightness: 104 } },
  { id: 'pastel', label: 'Pastel', group: 'Editorial', values: { saturation: 74, brightness: 110, contrast: 92, fade: 22 } },
  { id: 'dramatico', label: 'Dramático', group: 'Editorial', values: { contrast: 138, saturation: 96, brightness: 92, vignette: 46 } },
];

/** Os filtros na ordem em que o painel mostra, já separados por família. */
export const FILTER_GROUPS: { name: string; presets: FilterPreset[] }[] =
  FILTER_PRESETS.reduce<{ name: string; presets: FilterPreset[] }[]>((groups, preset) => {
    const last = groups[groups.length - 1];
    if (last && last.name === preset.group) last.presets.push(preset);
    else groups.push({ name: preset.group, presets: [preset] });
    return groups;
  }, []);

export type FitMode = 'cover' | 'contain';
export type BgMode = 'cor' | 'desfoque';

/** Monta a string de `filter` do canvas a partir dos ajustes. O desfoque escala
 * com o tamanho do destino pra prévia e exportação ficarem iguais. */
export function filterString(a: Adjustments, sizePx: number): string {
  const parts = [
    `brightness(${a.brightness}%)`,
    `contrast(${a.contrast}%)`,
    `saturate(${a.saturation}%)`,
  ];
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.sepia) parts.push(`sepia(${a.sepia}%)`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.blur) parts.push(`blur(${(a.blur / 100) * sizePx * 0.03}px)`);
  return parts.join(' ');
}

/** Retângulo da foto dentro do quadro, para "preencher" ou "caber", já com o
 * zoom e o deslocamento do usuário aplicados. */
/** Reduz (só se precisar) para caber num teto de pixels, mantendo a proporção.
 * O ampliador roda numa GPU e recusa foto acima de um tamanho; reduzir antes de
 * enviar é melhor que descobrir isso depois de o upload inteiro subir. */
export function fitWithinPixels(
  w: number, h: number, maxPixels: number,
): { width: number; height: number } {
  const total = w * h;
  if (!(total > maxPixels) || maxPixels <= 0) return { width: w, height: h };
  const fator = Math.sqrt(maxPixels / total);
  return { width: Math.max(1, Math.round(w * fator)), height: Math.max(1, Math.round(h * fator)) };
}

/** A foto cobre o quadro inteiro no enquadramento dado? Decide se os controles
 * de fundo têm o que fazer: em "Preencher" com escala cheia a resposta é sim,
 * mas diminuir a escala ou arrastar a foto pra fora expõe as bordas. */
export function coversFrame(
  imgW: number, imgH: number, boxW: number, boxH: number,
  fit: FitMode, scale: number, dx: number, dy: number,
): boolean {
  const r = frameRect(imgW, imgH, boxW, boxH, fit, scale, dx, dy);
  // Meio pixel de folga: a conta é em ponto flutuante e um encaixe exato não
  // pode virar "tem fundo" por arredondamento.
  const slack = 0.5;
  return r.x <= slack && r.y <= slack && r.x + r.w >= boxW - slack && r.y + r.h >= boxH - slack;
}

export function frameRect(
  imgW: number, imgH: number, boxW: number, boxH: number,
  fit: FitMode, scale: number, dx: number, dy: number,
): { x: number; y: number; w: number; h: number } {
  const base = fit === 'cover'
    ? Math.max(boxW / imgW, boxH / imgH)
    : Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * base * scale;
  const h = imgH * base * scale;
  return { x: (boxW - w) / 2 + dx * boxW, y: (boxH - h) / 2 + dy * boxH, w, h };
}
