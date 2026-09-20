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
  values: Partial<Adjustments>;
}

/** Filtros prontos: combinações de ajuste que o usuário pode aplicar num clique
 * e depois continuar mexendo à mão. */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'original', label: 'Original', values: {} },
  { id: 'vivido', label: 'Vívido', values: { saturation: 135, contrast: 112, brightness: 103 } },
  { id: 'suave', label: 'Suave', values: { saturation: 92, contrast: 94, brightness: 105, fade: 14 } },
  { id: 'quente', label: 'Quente', values: { temperature: 38, saturation: 110, brightness: 103 } },
  { id: 'frio', label: 'Frio', values: { temperature: -38, saturation: 104, contrast: 106 } },
  { id: 'vintage', label: 'Vintage', values: { sepia: 32, saturation: 82, contrast: 92, fade: 20, vignette: 26 } },
  { id: 'pb', label: 'Preto e branco', values: { grayscale: 100, contrast: 115 } },
  { id: 'cinema', label: 'Cinema', values: { contrast: 118, saturation: 88, temperature: -14, vignette: 34 } },
  { id: 'dourado', label: 'Dourado', values: { temperature: 55, sepia: 18, brightness: 104, saturation: 116 } },
  { id: 'clean', label: 'Clean', values: { brightness: 108, contrast: 96, saturation: 96, fade: 8 } },
];

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
