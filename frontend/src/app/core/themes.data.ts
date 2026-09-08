/**
 * Catálogo de temas visuais do site. Cada tema é um conjunto de tokens (cores, fontes,
 * raios, sombras) aplicado via CSS custom properties em `document.documentElement`.
 * Só o "Monocromático" tem variação dia/noite — os demais têm uma única paleta.
 */

export interface ThemeTokens {
  bg: string;
  bgCard: string;
  text: string;
  textMuted: string;
  accent: string;
  accentDark: string;
  accentSoft: string;
  accentContrast: string;
  border: string;
  divider: string;
  positivo: string;
  negativo: string;
  atencao: string;
  fontHeading: string;
  fontBody: string;
  radius: string;
  radiusSm: string;
  radiusLg: string;
  radiusCard: string;
  radiusCheck: string;
  shadowSm: string;
  shadow: string;
  shadowLg: string;
  checkboxBorder: string;
  checkboxFill: string;
  checkboxIcon: string;
  tagBg: string;
  tagText: string;
  fabBg: string;
  fabFg: string;
  cardBorderWidth: string;
  cardBorderStyle: string;
  cardTransform: string;
  cardBackdrop: string;
  cardClip: string;
}

export interface ThemeDef {
  id: string;
  name: string;
  supportsDayNight: boolean;
  light: ThemeTokens;
  dark?: ThemeTokens;
  /** Amostra usada na miniatura da tela de configurações. */
  preview: { bg: string; accent: string; text: string };
}

// ------------------------------------------------------------------ helpers

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Cor de texto legível (preto ou branco) sobre um fundo `hex` — usada onde botões/badges
 * pintam o fundo com --accent e precisam de um --accent-contrast que não dependa de o
 * accent do tema ser escuro ou claro. */
function contrastOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#FFFFFF';
}

function mix(hexA: string, hexB: string, weightB: number): string {
  const [ar, ag, ab] = hexToRgb(hexA);
  const [br, bg, bb] = hexToRgb(hexB);
  const r = Math.round(ar + (br - ar) * weightB);
  const g = Math.round(ag + (bg - ag) * weightB);
  const b = Math.round(ab + (bb - ab) * weightB);
  return `rgb(${r}, ${g}, ${b})`;
}

interface Partial_ {
  bg: string;
  card: string;
  text: string;
  accent: string;
  textMuted?: string;
  accentDark?: string;
  accentSoft?: string;
  accentContrast?: string;
  border?: string;
  divider?: string;
  positivo?: string;
  negativo?: string;
  atencao?: string;
  fontHeading: string;
  fontBody: string;
  radius?: string;
  radiusSm?: string;
  radiusLg?: string;
  radiusCard?: string;
  radiusCheck?: string;
  shadowSm?: string;
  shadow?: string;
  shadowLg?: string;
  checkboxBorder?: string;
  checkboxFill?: string;
  checkboxIcon?: string;
  tagBg?: string;
  tagText?: string;
  fabBg?: string;
  fabFg?: string;
  cardBorderWidth?: string;
  cardBorderStyle?: string;
  cardTransform?: string;
  cardBackdrop?: string;
  cardClip?: string;
}

function build(p: Partial_): ThemeTokens {
  const textMuted = p.textMuted ?? alpha(p.text, 0.55);
  const border = p.border ?? alpha(p.text, 0.12);
  return {
    bg: p.bg,
    bgCard: p.card,
    text: p.text,
    textMuted,
    accent: p.accent,
    accentDark: p.accentDark ?? mix(p.accent, '#000000', 0.18),
    accentSoft: p.accentSoft ?? alpha(p.accent, 0.14),
    accentContrast: p.accentContrast ?? contrastOn(p.accent),
    border,
    divider: p.divider ?? border,
    positivo: p.positivo ?? '#16a34a',
    negativo: p.negativo ?? '#dc2626',
    atencao: p.atencao ?? '#d97706',
    fontHeading: p.fontHeading,
    fontBody: p.fontBody,
    radius: p.radius ?? '14px',
    radiusSm: p.radiusSm ?? '8px',
    radiusLg: p.radiusLg ?? '20px',
    radiusCard: p.radiusCard ?? p.radius ?? '14px',
    radiusCheck: p.radiusCheck ?? '6px',
    shadowSm: p.shadowSm ?? '0 1px 2px rgba(0,0,0,0.08)',
    shadow: p.shadow ?? '0 6px 20px rgba(0,0,0,0.1)',
    shadowLg: p.shadowLg ?? '0 20px 50px rgba(0,0,0,0.16)',
    checkboxBorder: p.checkboxBorder ?? alpha(p.text, 0.35),
    checkboxFill: p.checkboxFill ?? p.text,
    checkboxIcon: p.checkboxIcon ?? p.bg,
    tagBg: p.tagBg ?? alpha(p.text, 0.08),
    tagText: p.tagText ?? textMuted,
    fabBg: p.fabBg ?? p.text,
    fabFg: p.fabFg ?? p.bg,
    cardBorderWidth: p.cardBorderWidth ?? '1px',
    cardBorderStyle: p.cardBorderStyle ?? 'solid',
    cardTransform: p.cardTransform ?? 'none',
    cardBackdrop: p.cardBackdrop ?? 'none',
    cardClip: p.cardClip ?? 'none',
  };
}

const POS_DARK = '#4ade80';
const NEG_DARK = '#f87171';
const ATT_DARK = '#fbbf24';

const INTER = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// ------------------------------------------------------------------ catálogo

export const THEMES: ThemeDef[] = [
  // 0. Monocromático (padrão, com dia/noite) -----------------------------
  {
    id: 'mono',
    name: 'Monocromático',
    supportsDayNight: true,
    preview: { bg: '#FFFFFF', accent: '#171717', text: '#171717' },
    light: build({
      bg: '#FFFFFF',
      card: '#FFFFFF',
      text: '#171717',
      textMuted: alpha('#171717', 0.55),
      accent: '#171717',
      accentDark: '#000000',
      accentSoft: alpha('#171717', 0.08),
      border: '#EFEFEF',
      divider: '#EFEFEF',
      fontHeading: INTER,
      fontBody: INTER,
      radius: '10px',
      radiusSm: '8px',
      checkboxBorder: '#A3A3A3',
      checkboxFill: '#171717',
      checkboxIcon: '#FFFFFF',
      tagBg: '#F2F2F2',
      tagText: '#737373',
      fabBg: '#171717',
      fabFg: '#FFFFFF',
      cardBorderWidth: '0px',
      shadowSm: 'none',
      shadow: 'none',
      shadowLg: '0 20px 50px rgba(0,0,0,0.16)',
    }),
    dark: build({
      bg: '#0E0E10',
      card: '#0E0E10',
      text: '#EDEDED',
      textMuted: alpha('#EDEDED', 0.55),
      accent: '#EDEDED',
      accentDark: '#FFFFFF',
      accentSoft: alpha('#EDEDED', 0.1),
      border: '#232323',
      divider: '#232323',
      positivo: POS_DARK,
      negativo: NEG_DARK,
      atencao: ATT_DARK,
      fontHeading: INTER,
      fontBody: INTER,
      radius: '10px',
      radiusSm: '8px',
      checkboxBorder: '#52525B',
      checkboxFill: '#EDEDED',
      checkboxIcon: '#0E0E10',
      tagBg: '#1C1C1F',
      tagText: '#A1A1AA',
      fabBg: '#EDEDED',
      fabFg: '#0E0E10',
      cardBorderWidth: '0px',
      shadowSm: 'none',
      shadow: 'none',
      shadowLg: '0 20px 50px rgba(0,0,0,0.5)',
    }),
  },

  // 1. Minimalista claro ----------------------------------------------------
  {
    id: 'minimal-claro',
    name: 'Minimalista claro',
    supportsDayNight: false,
    preview: { bg: '#FAFAF9', accent: '#10B981', text: '#18181B' },
    light: build({
      bg: '#FAFAF9', card: '#FFFFFF', text: '#18181B', accent: '#10B981',
      border: '#EDEDEC', fontHeading: INTER, fontBody: INTER,
    }),
  },

  // 2. Dark produtividade ---------------------------------------------------
  {
    id: 'dark-produtividade',
    name: 'Dark produtividade',
    supportsDayNight: false,
    preview: { bg: '#0F172A', accent: '#22D3EE', text: '#E2E8F0' },
    light: build({
      bg: '#0F172A', card: '#1E293B', text: '#E2E8F0', accent: '#22D3EE',
      accentSoft: alpha('#8B5CF6', 0.18), border: '#2D3B52',
      fontHeading: "'Space Grotesk', sans-serif", fontBody: "'Space Grotesk', sans-serif",
      positivo: POS_DARK, negativo: NEG_DARK, atencao: ATT_DARK,
      shadow: '0 6px 20px rgba(0,0,0,0.35)',
    }),
  },

  // 3. Pastel soft ------------------------------------------------------------
  {
    id: 'pastel-soft',
    name: 'Pastel soft',
    supportsDayNight: false,
    preview: { bg: 'linear-gradient(135deg,#F3F0FF,#FDF2F8)', accent: '#C084FC', text: '#4C1D95' },
    light: build({
      bg: 'linear-gradient(135deg, #F3F0FF 0%, #FDF2F8 100%)',
      card: '#FFFFFF', text: '#4C1D95', accent: '#C084FC',
      border: alpha('#4C1D95', 0.1),
      fontHeading: "'Poppins', sans-serif", fontBody: "'Poppins', sans-serif",
      shadow: '0 10px 30px rgba(192,132,252,0.22)',
      shadowSm: '0 4px 12px rgba(192,132,252,0.16)',
    }),
  },

  // 4. Notion-like --------------------------------------------------------
  {
    id: 'notion',
    name: 'Notion-like',
    supportsDayNight: false,
    preview: { bg: '#FFFFFF', accent: '#37352F', text: '#37352F' },
    light: build({
      bg: '#FFFFFF', card: '#FFFFFF', text: '#37352F', accent: '#37352F',
      accentSoft: alpha('#37352F', 0.06),
      border: '#EDECE9', divider: '#EDECE9',
      fontHeading: "'Fraunces', serif", fontBody: INTER,
      cardBorderWidth: '0px', shadowSm: 'none', shadow: 'none',
    }),
  },

  // 5. Gamificado -----------------------------------------------------------
  {
    id: 'gamificado',
    name: 'Gamificado',
    supportsDayNight: false,
    preview: { bg: 'linear-gradient(135deg,#6D28D9,#DB2777)', accent: '#FBBF24', text: '#FFFFFF' },
    light: build({
      bg: 'linear-gradient(135deg, #6D28D9 0%, #DB2777 100%)',
      card: 'rgba(255,255,255,0.14)', text: '#FFFFFF', accent: '#FBBF24',
      textMuted: 'rgba(255,255,255,0.72)',
      border: 'rgba(255,255,255,0.28)',
      fontHeading: "'Poppins', sans-serif", fontBody: "'Poppins', sans-serif",
      tagBg: 'rgba(255,255,255,0.18)', tagText: '#FFFFFF',
      fabBg: '#FBBF24', fabFg: '#3B1D63',
      cardBackdrop: 'blur(14px)',
      shadow: '0 10px 30px rgba(0,0,0,0.25)',
      positivo: POS_DARK, negativo: NEG_DARK, atencao: '#FBBF24',
    }),
  },

  // 6. Neobrutalista --------------------------------------------------------
  {
    id: 'neobrutalista',
    name: 'Neobrutalista',
    supportsDayNight: false,
    preview: { bg: '#FFF8E7', accent: '#111111', text: '#111111' },
    light: build({
      bg: '#FFF8E7', card: '#FFFFFF', text: '#111111', accent: '#111111',
      accentSoft: alpha('#111111', 0.08),
      border: '#111111',
      fontHeading: "'Archivo Black', sans-serif", fontBody: INTER,
      radius: '0px', radiusSm: '0px', radiusLg: '0px', radiusCheck: '0px',
      cardBorderWidth: '2.5px',
      shadowSm: '3px 3px 0 0 #111111', shadow: '4px 4px 0 0 #111111', shadowLg: '6px 6px 0 0 #111111',
    }),
  },

  // 7. Terminal retrô -------------------------------------------------------
  {
    id: 'terminal',
    name: 'Terminal retrô',
    supportsDayNight: false,
    preview: { bg: '#0A0E0A', accent: '#4AFF7A', text: '#4AFF7A' },
    light: build({
      bg: '#0A0E0A', card: '#0A0E0A', text: '#4AFF7A', accent: '#4AFF7A',
      textMuted: alpha('#4AFF7A', 0.55),
      border: alpha('#4AFF7A', 0.35),
      fontHeading: "'Space Mono', monospace", fontBody: "'Space Mono', monospace",
      radius: '2px', radiusSm: '2px', radiusLg: '2px', radiusCheck: '2px',
      cardBorderWidth: '1px', shadowSm: 'none', shadow: 'none',
      tagBg: 'transparent', tagText: '#4AFF7A',
      checkboxFill: 'transparent', checkboxIcon: '#4AFF7A',
      fabBg: '#4AFF7A', fabFg: '#0A0E0A',
      positivo: '#4AFF7A', negativo: '#FF5C5C', atencao: '#FFD84A',
    }),
  },

  // 8. Neumorfismo ------------------------------------------------------------
  {
    id: 'neumorfismo',
    name: 'Neumorfismo',
    supportsDayNight: false,
    preview: { bg: '#E6E7EE', accent: '#7C8CF8', text: '#3A3D52' },
    light: build({
      bg: '#E6E7EE', card: '#E6E7EE', text: '#3A3D52', accent: '#7C8CF8',
      border: 'transparent', divider: 'rgba(58,61,82,0.1)',
      fontHeading: INTER, fontBody: INTER,
      cardBorderWidth: '0px',
      shadowSm: '4px 4px 8px #c7c9d4, -4px -4px 8px #ffffff',
      shadow: '6px 6px 14px #c7c9d4, -6px -6px 14px #ffffff',
      shadowLg: '10px 10px 22px #c7c9d4, -10px -10px 22px #ffffff',
    }),
  },

  // 9. Botânico ---------------------------------------------------------------
  {
    id: 'botanico',
    name: 'Botânico',
    supportsDayNight: false,
    preview: { bg: '#F3EEE3', accent: '#6B8F5E', text: '#2F3B2C' },
    light: build({
      bg: '#F3EEE3', card: '#FBF9F3', text: '#2F3B2C', accent: '#6B8F5E',
      border: alpha('#2F3B2C', 0.1),
      fontHeading: "'DM Serif Display', serif", fontBody: INTER,
      cardBorderWidth: '0 0 0 3px', cardBorderStyle: 'solid',
    }),
  },

  // 10. Vaporwave ---------------------------------------------------------------
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    supportsDayNight: false,
    preview: { bg: 'linear-gradient(180deg,#2B1055,#7597DE)', accent: '#FF71CE', text: '#FFFFFF' },
    light: build({
      bg: [
        'repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 26px)',
        'repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 26px)',
        'linear-gradient(180deg, #2B1055 0%, #7597DE 100%)',
      ].join(', '),
      card: 'rgba(255,255,255,0.12)', text: '#FFFFFF', accent: '#FF71CE',
      accentSoft: alpha('#01CDFE', 0.22),
      textMuted: 'rgba(255,255,255,0.7)',
      border: 'rgba(255,255,255,0.3)',
      fontHeading: "'Poppins', sans-serif", fontBody: "'Poppins', sans-serif",
      tagBg: 'rgba(1,205,254,0.25)', tagText: '#FFFFFF',
      fabBg: '#FF71CE', fabFg: '#2B1055',
      cardBackdrop: 'blur(10px)',
      positivo: POS_DARK, negativo: NEG_DARK, atencao: '#01CDFE',
    }),
  },

  // 11. Swiss Grid ----------------------------------------------------------
  {
    id: 'swiss-grid',
    name: 'Swiss Grid',
    supportsDayNight: false,
    preview: { bg: '#FFFFFF', accent: '#E30613', text: '#000000' },
    light: build({
      bg: '#FFFFFF', card: '#FFFFFF', text: '#000000', accent: '#E30613',
      border: '#000000', divider: '#000000',
      fontHeading: "'Bebas Neue', sans-serif", fontBody: INTER,
      radius: '0px', radiusSm: '0px', radiusLg: '0px', radiusCheck: '0px',
      cardBorderWidth: '0 0 2px 0', shadowSm: 'none', shadow: 'none',
    }),
  },

  // 12. Editorial Luxo -------------------------------------------------------
  {
    id: 'editorial-luxo',
    name: 'Editorial Luxo',
    supportsDayNight: false,
    preview: { bg: '#0D0D0D', accent: '#C6A15B', text: '#EDEDED' },
    light: build({
      bg: '#0D0D0D', card: '#0D0D0D', text: '#EDEDED', accent: '#C6A15B',
      border: alpha('#C6A15B', 0.3), divider: alpha('#C6A15B', 0.3),
      fontHeading: "'Cormorant Garamond', serif", fontBody: "'Cormorant Garamond', serif",
      cardBorderWidth: '0px', shadowSm: 'none', shadow: 'none',
      positivo: POS_DARK, negativo: NEG_DARK, atencao: ATT_DARK,
    }),
  },

  // 13. Kids --------------------------------------------------------------------
  {
    id: 'kids',
    name: 'Kids',
    supportsDayNight: false,
    preview: { bg: '#FFF4E0', accent: '#FF6B6B', text: '#4A3728' },
    light: build({
      bg: '#FFF4E0', card: '#FFFFFF', text: '#4A3728', accent: '#FF6B6B',
      accentSoft: alpha('#6ECBF5', 0.25),
      border: '#FFD93D',
      fontHeading: "'Baloo 2', sans-serif", fontBody: "'Baloo 2', sans-serif",
      radius: '20px', radiusSm: '14px', radiusLg: '26px', radiusCheck: '10px',
      cardBorderWidth: '3px',
      tagBg: '#6ECBF5', tagText: '#1B4B63',
      fabBg: '#FF6B6B', fabFg: '#FFFFFF',
    }),
  },

  // 14. Zen Japonês -----------------------------------------------------------
  {
    id: 'zen',
    name: 'Zen Japonês',
    supportsDayNight: false,
    preview: { bg: '#F2EEE6', accent: '#B24A3C', text: '#3E3A34' },
    light: build({
      bg: '#F2EEE6', card: 'rgba(255,255,255,0.55)', text: '#3E3A34', accent: '#B24A3C',
      border: alpha('#3E3A34', 0.08),
      fontHeading: "'Zen Maru Gothic', sans-serif", fontBody: "'Zen Maru Gothic', sans-serif",
      cardBorderWidth: '1px', shadowSm: 'none', shadow: 'none',
      cardBackdrop: 'blur(4px)',
      radius: '18px',
    }),
  },

  // 15. Cyberpunk Glitch -------------------------------------------------------
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Glitch',
    supportsDayNight: false,
    preview: { bg: '#08060F', accent: '#FF2E92', text: '#FFFFFF' },
    light: build({
      bg: '#08060F', card: '#12101C', text: '#FFFFFF', accent: '#FF2E92',
      accentSoft: alpha('#00F0FF', 0.16),
      border: alpha('#00F0FF', 0.35),
      fontHeading: "'Orbitron', sans-serif", fontBody: "'Orbitron', sans-serif",
      radius: '2px', radiusSm: '2px', radiusLg: '4px',
      cardClip: 'polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
      shadow: '0 0 0 1px #FF2E92, 0 0 18px rgba(255,46,146,0.35)',
      positivo: POS_DARK, negativo: NEG_DARK, atencao: '#00F0FF',
    }),
  },

  // 16. Art Déco ---------------------------------------------------------------
  {
    id: 'art-deco',
    name: 'Art Déco',
    supportsDayNight: false,
    preview: { bg: '#0E1F1C', accent: '#C9A24B', text: '#C9A24B' },
    light: build({
      bg: '#0E1F1C', card: '#122824', text: '#E7DCC0', accent: '#C9A24B',
      border: alpha('#C9A24B', 0.4),
      fontHeading: "'Cinzel', serif", fontBody: "'Cinzel', serif",
      cardClip: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)',
      positivo: POS_DARK, negativo: NEG_DARK, atencao: ATT_DARK,
    }),
  },

  // 17. Memphis ------------------------------------------------------------------
  {
    id: 'memphis',
    name: 'Memphis',
    supportsDayNight: false,
    preview: { bg: '#FDF6EC', accent: '#FF4D6D', text: '#111111' },
    light: build({
      bg: '#FDF6EC', card: '#FFFFFF', text: '#111111', accent: '#FF4D6D',
      border: '#111111',
      fontHeading: "'Poppins', sans-serif", fontBody: "'Poppins', sans-serif",
      cardBorderWidth: '2px',
      shadowSm: '3px 3px 0 0 #FFD93D', shadow: '5px 5px 0 0 #6ECBF5', shadowLg: '7px 7px 0 0 #FF4D6D',
    }),
  },

  // 18. Riso/Zine -----------------------------------------------------------------
  {
    id: 'riso',
    name: 'Riso/Zine',
    supportsDayNight: false,
    preview: { bg: '#F2EFE6', accent: '#FF4FC3', text: '#111111' },
    light: build({
      bg: '#F2EFE6', card: '#FFFFFF', text: '#111111', accent: '#FF4FC3',
      accentSoft: alpha('#00A6FB', 0.2),
      border: '#111111',
      fontHeading: "'Archivo', sans-serif", fontBody: "'Archivo', sans-serif",
      tagBg: alpha('#00A6FB', 0.25), tagText: '#111111',
    }),
  },

  // 19. Glassmorphism ---------------------------------------------------------------
  {
    id: 'glass',
    name: 'Glassmorphism',
    supportsDayNight: false,
    preview: { bg: 'linear-gradient(135deg,#667EEA,#764BA2,#F093FB)', accent: '#FFFFFF', text: '#FFFFFF' },
    light: build({
      bg: 'linear-gradient(135deg, #667EEA 0%, #764BA2 55%, #F093FB 100%)',
      card: 'rgba(255,255,255,0.16)', text: '#FFFFFF', accent: '#FFFFFF',
      accentSoft: 'rgba(255,255,255,0.25)',
      textMuted: 'rgba(255,255,255,0.75)',
      border: 'rgba(255,255,255,0.4)',
      fontHeading: INTER, fontBody: INTER,
      tagBg: 'rgba(255,255,255,0.22)', tagText: '#FFFFFF',
      fabBg: 'rgba(255,255,255,0.9)', fabFg: '#5B3E9E',
      cardBackdrop: 'blur(16px)',
      positivo: POS_DARK, negativo: NEG_DARK, atencao: ATT_DARK,
    }),
  },

  // 20. Bauhaus -------------------------------------------------------------------
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    supportsDayNight: false,
    preview: { bg: '#F5F1E8', accent: '#D62828', text: '#111111' },
    light: build({
      bg: '#F5F1E8', card: '#FFFFFF', text: '#111111', accent: '#D62828',
      border: '#111111',
      fontHeading: INTER, fontBody: INTER,
      radius: '0px', radiusSm: '0px', radiusLg: '0px', radiusCheck: '0px',
      cardBorderWidth: '2px',
    }),
  },

  // 21. Art Nouveau -----------------------------------------------------------------
  {
    id: 'art-nouveau',
    name: 'Art Nouveau',
    supportsDayNight: false,
    preview: { bg: '#F6F1E4', accent: '#3B4A38', text: '#3B4A38' },
    light: build({
      bg: '#F6F1E4', card: '#FFFCF4', text: '#3B4A38', accent: '#8A7233',
      border: alpha('#3B4A38', 0.15),
      fontHeading: "'Alex Brush', cursive", fontBody: INTER,
      radiusCard: '32px 8px 32px 8px',
    }),
  },

  // 22. Grunge/Punk -----------------------------------------------------------------
  {
    id: 'grunge',
    name: 'Grunge/Punk',
    supportsDayNight: false,
    preview: { bg: '#E8E4DA', accent: '#7A1F1F', text: '#1B1B1B' },
    light: build({
      bg: '#E8E4DA', card: '#FFFFFF', text: '#1B1B1B', accent: '#7A1F1F',
      border: '#1B1B1B',
      fontHeading: "'Permanent Marker', cursive", fontBody: "'Special Elite', monospace",
      cardTransform: 'rotate(-0.6deg)',
      shadow: '5px 6px 0 rgba(0,0,0,0.18)',
    }),
  },

  // 23. Escandinavo ------------------------------------------------------------------
  {
    id: 'escandinavo',
    name: 'Escandinavo',
    supportsDayNight: false,
    preview: { bg: '#FFFFFF', accent: '#3D5A6C', text: '#2E2E2E' },
    light: build({
      bg: '#FFFFFF', card: '#FFFFFF', text: '#2E2E2E', accent: '#3D5A6C',
      border: '#EDEDED',
      fontHeading: "'Quicksand', sans-serif", fontBody: "'Quicksand', sans-serif",
      cardBorderWidth: '0 0 0 3px',
    }),
  },

  // 24. Y2K/Frutiger Aero -----------------------------------------------------------
  {
    id: 'y2k',
    name: 'Y2K / Frutiger Aero',
    supportsDayNight: false,
    preview: { bg: 'linear-gradient(180deg,#BFEFFF,#CFF9E7)', accent: '#0EA5B8', text: '#0B3B44' },
    light: build({
      bg: 'linear-gradient(180deg, #BFEFFF 0%, #CFF9E7 100%)',
      card: 'rgba(255,255,255,0.55)', text: '#0B3B44', accent: '#0EA5B8',
      border: 'rgba(255,255,255,0.7)',
      fontHeading: "'Quicksand', sans-serif", fontBody: "'Quicksand', sans-serif",
      cardBackdrop: 'blur(10px)',
      shadow: '0 8px 24px rgba(14,165,184,0.25)',
    }),
  },

  // 25. Blueprint técnico -------------------------------------------------------------
  {
    id: 'blueprint',
    name: 'Blueprint técnico',
    supportsDayNight: false,
    preview: { bg: '#0B3D62', accent: '#CFE8FF', text: '#CFE8FF' },
    light: build({
      bg: [
        'repeating-linear-gradient(0deg, rgba(207,232,255,0.08) 0 1px, transparent 1px 24px)',
        'repeating-linear-gradient(90deg, rgba(207,232,255,0.08) 0 1px, transparent 1px 24px)',
        '#0B3D62',
      ].join(', '),
      card: 'rgba(207,232,255,0.06)', text: '#CFE8FF', accent: '#CFE8FF',
      textMuted: alpha('#CFE8FF', 0.6),
      border: alpha('#CFE8FF', 0.4),
      fontHeading: "'Chakra Petch', sans-serif", fontBody: "'Chakra Petch', sans-serif",
      cardBorderStyle: 'dashed',
      positivo: POS_DARK, negativo: NEG_DARK, atencao: ATT_DARK,
    }),
  },

  // 26. Editorial minimal --------------------------------------------------------------
  {
    id: 'editorial-minimal',
    name: 'Editorial minimal',
    supportsDayNight: false,
    preview: { bg: '#FDFDFB', accent: '#1A1A1A', text: '#1A1A1A' },
    light: build({
      bg: '#FDFDFB', card: '#FDFDFB', text: '#1A1A1A', accent: '#1A1A1A',
      border: '#E7E5DE', divider: '#E7E5DE',
      fontHeading: "'Source Serif 4', serif", fontBody: INTER,
      cardBorderWidth: '0 0 1px 0', shadowSm: 'none', shadow: 'none',
    }),
  },

  // 27. Ultra minimal --------------------------------------------------------------------
  {
    id: 'ultra-minimal',
    name: 'Ultra minimal',
    supportsDayNight: false,
    preview: { bg: '#FAFAFA', accent: '#111111', text: '#111111' },
    light: build({
      bg: '#FAFAFA', card: '#FAFAFA', text: '#111111', accent: '#111111',
      border: 'transparent', divider: 'transparent',
      fontHeading: INTER, fontBody: INTER,
      cardBorderWidth: '0px', shadowSm: 'none', shadow: 'none',
      radiusCheck: '999px',
      tagBg: 'transparent', tagText: alpha('#111111', 0.55),
    }),
  },

  // 28. Soft Rounded (estilo Apple) --------------------------------------------------------
  {
    id: 'soft-rounded',
    name: 'Soft Rounded',
    supportsDayNight: false,
    preview: { bg: '#F5F6F8', accent: '#0A84FF', text: '#1C1C1E' },
    light: build({
      bg: '#F5F6F8', card: '#FFFFFF', text: '#1C1C1E', accent: '#0A84FF',
      border: '#EDEEF1',
      fontHeading: "'Manrope', sans-serif", fontBody: "'Manrope', sans-serif",
      radius: '18px', radiusSm: '12px', radiusLg: '24px',
      shadow: '0 4px 16px rgba(0,0,0,0.06)',
    }),
  },

  // 29. Neutro Quente -------------------------------------------------------------------------
  {
    id: 'neutro-quente',
    name: 'Neutro Quente',
    supportsDayNight: false,
    preview: { bg: '#F7F4EF', accent: '#A8703F', text: '#3A342C' },
    light: build({
      bg: '#F7F4EF', card: '#FFFFFF', text: '#3A342C', accent: '#A8703F',
      border: '#EBE5D8',
      fontHeading: INTER, fontBody: INTER,
    }),
  },
];

export const DEFAULT_THEME_ID = 'mono';

export function findTheme(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
