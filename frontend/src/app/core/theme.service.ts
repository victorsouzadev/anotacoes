import { Injectable, signal } from '@angular/core';
import { DEFAULT_THEME_ID, findTheme, ThemeDef, ThemeTokens } from './themes.data';

export type ThemePref = 'light' | 'dark' | 'system';

const MODE_KEY = 'theme';
const PALETTE_KEY = 'theme-palette';

/** Mapa token → nome da custom property CSS (--kebab-case). */
const CSS_VAR_MAP: Record<keyof ThemeTokens, string> = {
  bg: '--bg',
  bgCard: '--bg-card',
  text: '--text',
  textMuted: '--text-muted',
  accent: '--accent',
  accentDark: '--accent-dark',
  accentSoft: '--accent-soft',
  accentContrast: '--accent-contrast',
  border: '--border',
  divider: '--divider',
  positivo: '--positivo',
  negativo: '--negativo',
  atencao: '--atencao',
  fontHeading: '--font-heading',
  fontBody: '--font-body',
  radius: '--radius',
  radiusSm: '--radius-sm',
  radiusLg: '--radius-lg',
  radiusCard: '--radius-card',
  radiusCheck: '--radius-check',
  shadowSm: '--shadow-sm',
  shadow: '--shadow',
  shadowLg: '--shadow-lg',
  checkboxBorder: '--checkbox-border',
  checkboxFill: '--checkbox-fill',
  checkboxIcon: '--checkbox-icon',
  tagBg: '--tag-bg',
  tagText: '--tag-text',
  fabBg: '--fab-bg',
  fabFg: '--fab-fg',
  cardBorderWidth: '--card-border-width',
  cardBorderStyle: '--card-border-style',
  cardTransform: '--card-transform',
  cardBackdrop: '--card-backdrop',
  cardClip: '--card-clip',
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** Preferência de dia/noite — só tem efeito visível quando a paleta ativa é o Monocromático. */
  pref = signal<ThemePref>((localStorage.getItem(MODE_KEY) as ThemePref | null) ?? 'system');

  /** Paleta ativa (id de ThemeDef). */
  paletteId = signal<string>(localStorage.getItem(PALETTE_KEY) ?? DEFAULT_THEME_ID);

  constructor() {
    this.apply();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.pref() === 'system') this.apply();
    });
  }

  /** Alterna light → dark → system → light… (Monocromático) */
  cycle(): void {
    const order: ThemePref[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(this.pref()) + 1) % order.length];
    this.set(next);
  }

  set(pref: ThemePref): void {
    this.pref.set(pref);
    localStorage.setItem(MODE_KEY, pref);
    this.apply();
  }

  setPalette(id: string): void {
    this.paletteId.set(id);
    localStorage.setItem(PALETTE_KEY, id);
    this.apply();
  }

  /** true quando a paleta ativa é o Monocromático (única com alternância dia/noite). */
  isMono(): boolean {
    return this.paletteId() === DEFAULT_THEME_ID;
  }

  private resolvedMode(): 'light' | 'dark' {
    const pref = this.pref();
    if (pref === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return pref;
  }

  private apply(): void {
    const root = document.documentElement;
    const theme: ThemeDef = findTheme(this.paletteId());
    const mode = this.resolvedMode();

    // Mantém o atributo por compatibilidade (imprimir / seletores legados) e para o
    // toggle refletir o modo resolvido mesmo fora do Monocromático.
    if (this.pref() === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.pref());

    root.setAttribute('data-app-theme', theme.id);

    const tokens: ThemeTokens =
      theme.supportsDayNight && mode === 'dark' && theme.dark ? theme.dark : theme.light;

    for (const key of Object.keys(CSS_VAR_MAP) as (keyof ThemeTokens)[]) {
      root.style.setProperty(CSS_VAR_MAP[key], tokens[key]);
    }
    // Alias usado por estilos legados que ainda leem --surface diretamente.
    root.style.setProperty('--surface', tokens.bgCard);
  }
}
