/** Fontes do modo Ilustração: o catálogo servido pelo próprio app (em
 * `public/fonts`, WOFF que o opentype.js lê) mais as fontes que o usuário
 * envia, que viajam dentro do projeto salvo. O opentype.js só é baixado
 * quando o primeiro texto precisa de uma fonte. */

import { Injectable, signal } from '@angular/core';
import { FontLike } from './svg-text';

export type FontCategory = 'Sem serifa' | 'Serifa' | 'Manuscrita' | 'Decorativa' | 'Mono' | 'Enviadas';

export interface FontFamily {
  id: string;
  name: string;
  category: FontCategory;
  weights: number[];
}

export interface UploadedFont {
  id: string;
  name: string;
  /** Arquivo inteiro em data URL — é o que vai pro projeto salvo. */
  dataUrl: string;
}

const REG = [400];
const REG_BOLD = [400, 700];

export const FONT_CATALOG: FontFamily[] = [
  { id: 'poppins', name: 'Poppins', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'montserrat', name: 'Montserrat', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'inter', name: 'Inter', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'roboto', name: 'Roboto', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'quicksand', name: 'Quicksand', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'manrope', name: 'Manrope', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'space-grotesk', name: 'Space Grotesk', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'archivo', name: 'Archivo', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'oswald', name: 'Oswald', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'zen-maru-gothic', name: 'Zen Maru Gothic', category: 'Sem serifa', weights: REG_BOLD },
  { id: 'playfair-display', name: 'Playfair Display', category: 'Serifa', weights: REG_BOLD },
  { id: 'fraunces', name: 'Fraunces', category: 'Serifa', weights: REG_BOLD },
  { id: 'cormorant-garamond', name: 'Cormorant Garamond', category: 'Serifa', weights: REG_BOLD },
  { id: 'cinzel', name: 'Cinzel', category: 'Serifa', weights: REG_BOLD },
  { id: 'source-serif-4', name: 'Source Serif 4', category: 'Serifa', weights: REG_BOLD },
  { id: 'dm-serif-display', name: 'DM Serif Display', category: 'Serifa', weights: REG },
  { id: 'dancing-script', name: 'Dancing Script', category: 'Manuscrita', weights: REG_BOLD },
  { id: 'great-vibes', name: 'Great Vibes', category: 'Manuscrita', weights: REG },
  { id: 'pacifico', name: 'Pacifico', category: 'Manuscrita', weights: REG },
  { id: 'sacramento', name: 'Sacramento', category: 'Manuscrita', weights: REG },
  { id: 'parisienne', name: 'Parisienne', category: 'Manuscrita', weights: REG },
  { id: 'alex-brush', name: 'Alex Brush', category: 'Manuscrita', weights: REG },
  { id: 'satisfy', name: 'Satisfy', category: 'Manuscrita', weights: REG },
  { id: 'caveat', name: 'Caveat', category: 'Manuscrita', weights: REG_BOLD },
  { id: 'amatic-sc', name: 'Amatic SC', category: 'Manuscrita', weights: REG_BOLD },
  { id: 'permanent-marker', name: 'Permanent Marker', category: 'Manuscrita', weights: REG },
  { id: 'fredoka', name: 'Fredoka', category: 'Decorativa', weights: REG_BOLD },
  { id: 'baloo-2', name: 'Baloo 2', category: 'Decorativa', weights: REG_BOLD },
  { id: 'lobster', name: 'Lobster', category: 'Decorativa', weights: REG },
  { id: 'luckiest-guy', name: 'Luckiest Guy', category: 'Decorativa', weights: REG },
  { id: 'bungee', name: 'Bungee', category: 'Decorativa', weights: REG },
  { id: 'bebas-neue', name: 'Bebas Neue', category: 'Decorativa', weights: REG },
  { id: 'archivo-black', name: 'Archivo Black', category: 'Decorativa', weights: REG },
  { id: 'orbitron', name: 'Orbitron', category: 'Decorativa', weights: REG_BOLD },
  { id: 'chakra-petch', name: 'Chakra Petch', category: 'Decorativa', weights: REG_BOLD },
  { id: 'special-elite', name: 'Special Elite', category: 'Mono', weights: REG },
  { id: 'space-mono', name: 'Space Mono', category: 'Mono', weights: REG_BOLD },
];

export const DEFAULT_FONT_ID = 'poppins';
export const FONT_CATEGORIES: FontCategory[] = ['Sem serifa', 'Serifa', 'Manuscrita', 'Decorativa', 'Mono', 'Enviadas'];
/** Fonte enviada acima disto não cabe bem no projeto salvo (teto de 9 MB). */
export const MAX_UPLOAD_FONT_BYTES = 1_500_000;

const UPLOAD_PREFIX = 'up:';

export class FontError extends Error {}

/** O peso disponível mais perto do pedido (Pacifico não tem negrito). */
export function nearestWeight(weights: number[], wanted: number): number {
  return weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), weights[0] ?? 400);
}

function fontUrl(id: string, weight: number): string {
  return new URL(`fonts/${id}-${weight}.woff`, document.baseURI).href;
}

function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufferToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:font/sfnt;base64,${btoa(bin)}`;
}

async function parseFont(buffer: ArrayBuffer): Promise<FontLike & { names?: { fontFamily?: Record<string, string> } }> {
  const opentype = await import('opentype.js');
  return opentype.parse(buffer) as unknown as FontLike & { names?: { fontFamily?: Record<string, string> } };
}

type CacheEntry = FontLike | 'carregando' | 'erro';

@Injectable()
export class FontLibrary {
  /** Sobe a cada fonte que termina de carregar: quem desenha texto lê este
   * sinal pra refazer a diagramação quando a fonte chega. */
  readonly version = signal(0);
  readonly uploads = signal<UploadedFont[]>([]);

  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<FontLike | null>>();
  private previews = new Set<string>();

  families(): FontFamily[] {
    return [
      ...FONT_CATALOG,
      ...this.uploads().map((u) => ({ id: UPLOAD_PREFIX + u.id, name: u.name, category: 'Enviadas' as const, weights: REG })),
    ];
  }

  family(fontId: string): FontFamily {
    return this.families().find((f) => f.id === fontId) ?? FONT_CATALOG[0];
  }

  /** A fonte pronta, ou null enquanto carrega (e aí o carregamento começa). */
  get(fontId: string, weight: number): FontLike | null {
    const key = this.key(fontId, weight);
    const hit = this.cache.get(key);
    if (hit && hit !== 'carregando' && hit !== 'erro') return hit;
    if (!hit) void this.load(fontId, weight);
    return null;
  }

  failed(fontId: string, weight: number): boolean {
    return this.cache.get(this.key(fontId, weight)) === 'erro';
  }

  /** Espera a fonte — a exportação usa pra não sair com texto faltando. */
  load(fontId: string, weight: number): Promise<FontLike | null> {
    const key = this.key(fontId, weight);
    const hit = this.cache.get(key);
    if (hit && hit !== 'carregando' && hit !== 'erro') return Promise.resolve(hit);
    const running = this.pending.get(key);
    if (running) return running;
    this.cache.set(key, 'carregando');
    const job = (async () => {
      try {
        const buffer = await this.bufferOf(fontId, key);
        const font = await parseFont(buffer);
        this.cache.set(key, font);
        return font as FontLike;
      } catch {
        this.cache.set(key, 'erro');
        return null;
      } finally {
        this.pending.delete(key);
        this.version.update((v) => v + 1);
      }
    })();
    this.pending.set(key, job);
    return job;
  }

  /** Nome de família CSS pra mostrar a amostra da fonte no seletor. */
  previewFamily(fontId: string): string {
    const name = `il-${fontId.replace(/[^a-z0-9-]/gi, '')}`;
    if (!this.previews.has(name) && typeof FontFace !== 'undefined') {
      this.previews.add(name);
      const src = fontId.startsWith(UPLOAD_PREFIX)
        ? this.uploads().find((u) => UPLOAD_PREFIX + u.id === fontId)?.dataUrl
        : fontUrl(fontId, 400);
      if (src) {
        try {
          document.fonts.add(new FontFace(name, `url(${src})`));
        } catch { /* amostra é só conveniência */ }
      }
    }
    return `"${name}", sans-serif`;
  }

  async addUpload(file: File, id: string): Promise<UploadedFont> {
    if (file.size > MAX_UPLOAD_FONT_BYTES) throw new FontError('Fonte grande demais (máximo 1,5 MB). Prefira o arquivo .woff ou um subconjunto.');
    const buffer = await file.arrayBuffer();
    let font: Awaited<ReturnType<typeof parseFont>>;
    try {
      font = await parseFont(buffer.slice(0));
    } catch {
      throw new FontError('Não consegui ler essa fonte. Use .ttf, .otf ou .woff (WOFF2 não é aceito).');
    }
    const fromFile = file.name.replace(/\.(ttf|otf|woff)$/i, '');
    const name = font.names?.fontFamily?.['en'] ?? Object.values(font.names?.fontFamily ?? {})[0] ?? fromFile;
    const upload: UploadedFont = { id, name, dataUrl: bufferToDataUrl(buffer) };
    this.cache.set(this.key(UPLOAD_PREFIX + id, 400), font);
    this.uploads.update((list) => [...list, upload]);
    this.version.update((v) => v + 1);
    return upload;
  }

  removeUpload(id: string): void {
    this.cache.delete(this.key(UPLOAD_PREFIX + id, 400));
    this.uploads.update((list) => list.filter((u) => u.id !== id));
  }

  setUploads(list: UploadedFont[]): void {
    for (const u of this.uploads()) this.cache.delete(this.key(UPLOAD_PREFIX + u.id, 400));
    this.uploads.set(list);
    this.version.update((v) => v + 1);
  }

  isUpload(fontId: string): boolean {
    return fontId.startsWith(UPLOAD_PREFIX);
  }

  uploadIdOf(fontId: string): string {
    return fontId.slice(UPLOAD_PREFIX.length);
  }

  uploadFontId(id: string): string {
    return UPLOAD_PREFIX + id;
  }

  private key(fontId: string, weight: number): string {
    const fam = this.family(fontId);
    return `${fam.id}@${nearestWeight(fam.weights, weight)}`;
  }

  private async bufferOf(fontId: string, key: string): Promise<ArrayBuffer> {
    if (fontId.startsWith(UPLOAD_PREFIX)) {
      const up = this.uploads().find((u) => UPLOAD_PREFIX + u.id === fontId);
      if (!up) throw new FontError('Fonte enviada não encontrada.');
      return dataUrlToBuffer(up.dataUrl);
    }
    const [id, weight] = key.split('@');
    const res = await fetch(fontUrl(id, Number(weight)));
    if (!res.ok) throw new FontError(`Falha ao baixar a fonte ${id}.`);
    return res.arrayBuffer();
  }
}
