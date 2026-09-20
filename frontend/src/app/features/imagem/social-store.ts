/** Estado do modo "Redes Sociais". Fica num serviço, e não no componente, pelo
 * mesmo motivo do molde: o componente é destruído ao trocar de modo, e a page
 * precisa ler tudo isso pra salvar o projeto no backend. */

import { Injectable, computed, signal } from '@angular/core';
import {
  Adjustments, BgMode, FitMode, NEUTRAL, SOCIAL_FORMATS, SocialFormat,
} from './social-model';

export interface SocialProjectData {
  version: number;
  /** Data URL da foto já reduzida — é o que vai pro backend. */
  src: string;
  fileName: string;
  formatId: string;
  fit: FitMode;
  scale: number;
  dx: number;
  dy: number;
  bgMode: BgMode;
  bgColor: string;
  adjust: Adjustments;
  /** Força da redução de ruído, 0..100. */
  denoise: number;
  type: 'jpeg' | 'png';
  quality: number;
  exportW: number;
}

/** A foto vai embutida no projeto salvo (teto de 9 MB no backend) — 2000 px já
 * cobre qualquer formato de post com folga. É o mesmo teto do modo molde. */
export const MAX_PHOTO_DIMENSION = 2000;

@Injectable()
export class SocialStore {
  /** Elemento pronto pra desenhar; `null` enquanto não há foto. */
  readonly image = signal<HTMLImageElement | null>(null);
  /** Data URL correspondente ao elemento acima, guardada pra salvar o projeto. */
  readonly src = signal('');
  readonly fileName = signal('');

  readonly format = signal<SocialFormat>(SOCIAL_FORMATS[0]);
  readonly fit = signal<FitMode>('cover');
  readonly scale = signal(1);
  readonly offsetX = signal(0);
  readonly offsetY = signal(0);
  readonly bgMode = signal<BgMode>('desfoque');
  readonly bgColor = signal('#ffffff');

  readonly adjust = signal<Adjustments>({ ...NEUTRAL });
  readonly preset = signal('original');
  /** Redução de ruído. Fica fora de `adjust` de propósito: não é um look, é um
   * conserto da foto — por isso trocar de filtro ou zerar os ajustes não mexe
   * nela, e ela roda antes de tudo, sobre os pixels originais. */
  readonly denoise = signal(0);

  readonly type = signal<'jpeg' | 'png'>('jpeg');
  readonly quality = signal(92);
  readonly exportW = signal(SOCIAL_FORMATS[0].width);

  readonly hasImage = computed(() => this.image() !== null);
  readonly exportH = computed(() => Math.round(this.exportW() / this.format().ratio));

  setImage(img: HTMLImageElement, src: string, name: string): void {
    this.image.set(img);
    this.src.set(src);
    this.fileName.set(name);
    this.resetFraming();
  }

  resetFraming(): void {
    this.scale.set(1);
    this.offsetX.set(0);
    this.offsetY.set(0);
  }

  clear(): void {
    this.image.set(null);
    this.src.set('');
    this.fileName.set('');
    this.format.set(SOCIAL_FORMATS[0]);
    this.fit.set('cover');
    this.bgMode.set('desfoque');
    this.bgColor.set('#ffffff');
    this.adjust.set({ ...NEUTRAL });
    this.preset.set('original');
    this.denoise.set(0);
    this.type.set('jpeg');
    this.quality.set(92);
    this.exportW.set(SOCIAL_FORMATS[0].width);
    this.resetFraming();
  }

  // ---------- projeto ----------

  serialize(): SocialProjectData | null {
    const src = this.src();
    if (!src) return null;
    return {
      version: 1,
      src,
      fileName: this.fileName(),
      formatId: this.format().id,
      fit: this.fit(),
      scale: this.scale(),
      dx: this.offsetX(),
      dy: this.offsetY(),
      bgMode: this.bgMode(),
      bgColor: this.bgColor(),
      adjust: { ...NEUTRAL, ...this.adjust() },
      denoise: this.denoise(),
      type: this.type(),
      quality: this.quality(),
      exportW: this.exportW(),
    };
  }

  /** Reabre um post salvo. Campos que faltam voltam ao padrão, então projeto
   * salvo por uma versão anterior do modo continua abrindo. */
  async hydrate(data: SocialProjectData, load: (src: string) => Promise<HTMLImageElement>): Promise<void> {
    const format = SOCIAL_FORMATS.find((f) => f.id === data.formatId) ?? SOCIAL_FORMATS[0];
    this.format.set(format);
    this.fit.set(data.fit === 'contain' ? 'contain' : 'cover');
    this.scale.set(data.scale || 1);
    this.offsetX.set(data.dx ?? 0);
    this.offsetY.set(data.dy ?? 0);
    this.bgMode.set(data.bgMode === 'cor' ? 'cor' : 'desfoque');
    this.bgColor.set(data.bgColor || '#ffffff');
    // O preset não é guardado: os valores é que mandam, e o usuário pode ter
    // mexido nos controles depois de aplicar um filtro.
    this.adjust.set({ ...NEUTRAL, ...(data.adjust ?? {}) });
    this.preset.set('original');
    this.denoise.set(data.denoise ?? 0);
    this.type.set(data.type === 'png' ? 'png' : 'jpeg');
    this.quality.set(data.quality || 92);
    this.exportW.set(data.exportW || format.width);

    const img = await load(data.src);
    this.image.set(img);
    this.src.set(data.src);
    this.fileName.set(data.fileName ?? '');
  }
}

/** Reduz a foto pro teto de projeto e devolve a data URL a guardar. Reencoda em
 * PNG quando há transparência (o fundo "caber" depende dela) e em JPEG quando
 * não há, que é o que cabe no limite do backend. */
export function normalizeSocialPhoto(img: HTMLImageElement, original: string, mime: string): string {
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;
  const factor = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(natW, natH));
  if (factor === 1 && mime === 'image/jpeg') return original;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(natW * factor));
  canvas.height = Math.max(1, Math.round(natH * factor));
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif';
  return canvas.toDataURL(png ? 'image/png' : 'image/jpeg', png ? undefined : 0.92);
}
