import { Injectable, signal } from '@angular/core';

export type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  pref = signal<ThemePref>((localStorage.getItem(STORAGE_KEY) as ThemePref | null) ?? 'system');

  constructor() {
    this.apply();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.pref() === 'system') this.apply();
    });
  }

  /** Alterna light → dark → system → light… */
  cycle(): void {
    const order: ThemePref[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(this.pref()) + 1) % order.length];
    this.set(next);
  }

  set(pref: ThemePref): void {
    this.pref.set(pref);
    localStorage.setItem(STORAGE_KEY, pref);
    this.apply();
  }

  private apply(): void {
    const root = document.documentElement;
    const pref = this.pref();
    if (pref === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', pref);
    }
  }
}
