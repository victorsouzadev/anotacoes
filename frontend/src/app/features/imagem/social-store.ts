/** Estado do modo "Redes Sociais". Fica num serviço, e não no componente, pelo
 * mesmo motivo do molde: o componente é destruído ao trocar de modo, e a page
 * precisa ler tudo isso pra salvar o projeto no backend. */

import { Injectable, computed, signal } from '@angular/core';
import {
  Adjustments, BgMode, FitMode, NEUTRAL, SOCIAL_FORMATS, SocialFormat,
} from './social-model';
import { PhotoSource, sourceOf, stepDownscale } from './social-render';

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
  /** Força da máscara de nitidez, 0..100. */
  sharpen: number;
  /** Mapa de luz da IA, em PNG cinza minúsculo (vazio = não há). */
  luzIa: string;
  /** Quanto dessa luz aplicar, 0..100. */
  luzForca: number;
  type: 'jpeg' | 'png';
  quality: number;
  exportW: number;
}

/** A foto vai embutida no projeto salvo (teto de 9 MB no backend) — 2000 px já
 * cobre qualquer formato de post com folga. É o mesmo teto do modo molde. */
export const MAX_PHOTO_DIMENSION = 2000;

/** Tudo que um "desfazer" precisa devolver. Fica de fora a foto em si: trocar
 * de foto começa uma edição nova, não é um passo pra voltar. */
export interface LookSnapshot {
  formatId: string;
  fit: FitMode;
  scale: number;
  dx: number;
  dy: number;
  bgMode: BgMode;
  bgColor: string;
  adjust: Adjustments;
  preset: string;
  denoise: number;
  sharpen: number;
  luzIa: string;
  luzForca: number;
}

/** Teto do histórico. Cada passo é um punhado de números, mas guardar sem
 * limite é vazamento lento. */
const MAX_HISTORY = 60;

function sameLook(a: LookSnapshot, b: LookSnapshot): boolean {
  return a.formatId === b.formatId && a.fit === b.fit && a.scale === b.scale
    && a.dx === b.dx && a.dy === b.dy && a.bgMode === b.bgMode && a.bgColor === b.bgColor
    && a.preset === b.preset && a.denoise === b.denoise && a.sharpen === b.sharpen
    && a.luzIa === b.luzIa && a.luzForca === b.luzForca
    && (Object.keys(NEUTRAL) as (keyof Adjustments)[]).every((k) => a.adjust[k] === b.adjust[k]);
}

@Injectable()
export class SocialStore {
  /** A foto de trabalho, na maior resolução que vale a pena manter — é dela
   * que sai tudo. Reduzir na importação, como antes, jogava fora resolução que
   * a exportação ainda ia querer. */
  readonly image = signal<PhotoSource | null>(null);
  /** Data URL de origem. Pode ser grande: a versão que vai pro projeto salvo é
   * reduzida na hora de salvar, não na hora de importar. */
  readonly src = signal('');
  /** Tipo do arquivo de origem, pra decidir o formato do que é guardado. */
  readonly mime = signal('image/jpeg');
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
  /** Nitidez. Como a redução de ruído, é conserto e não look — e é a última
   * coisa aplicada, depois de a imagem já estar no tamanho final. */
  readonly sharpen = signal(0);
  /** Mapa de luz vindo da IA, guardado como PNG cinza de ~96 px — cabe no
   * projeto salvo e no histórico sem pesar, e é tudo o que sobra da
   * reiluminação: a foto continua sendo a sua. */
  readonly luzIa = signal('');
  /** 60 é o padrão: luz suficiente pra mudar a foto, discreta o bastante pra
   * ela continuar parecendo uma foto, e não uma montagem. */
  readonly luzForca = signal(60);

  readonly type = signal<'jpeg' | 'png'>('jpeg');
  readonly quality = signal(92);
  readonly exportW = signal(SOCIAL_FORMATS[0].width);

  readonly hasImage = computed(() => this.image() !== null);
  readonly exportH = computed(() => Math.round(this.exportW() / this.format().ratio));

  // ---------- desfazer ----------

  /** Passos já dados. O primeiro é o estado inicial, então `index` 0 é "nada
   * pra desfazer" — e não um histórico vazio, que não saberia pra onde voltar. */
  private history: LookSnapshot[] = [];
  private index = 0;
  private readonly revision = signal(0);

  readonly canUndo = computed(() => { this.revision(); return this.index > 0; });
  readonly canRedo = computed(() => { this.revision(); return this.index < this.history.length - 1; });

  snapshot(): LookSnapshot {
    return {
      formatId: this.format().id,
      fit: this.fit(),
      scale: this.scale(),
      dx: this.offsetX(),
      dy: this.offsetY(),
      bgMode: this.bgMode(),
      bgColor: this.bgColor(),
      adjust: { ...this.adjust() },
      preset: this.preset(),
      denoise: this.denoise(),
      sharpen: this.sharpen(),
      luzIa: this.luzIa(),
      luzForca: this.luzForca(),
    };
  }

  /** Marca um passo concluído. Chamado ao soltar um controle, não a cada
   * movimento: arrastar um slider é uma edição só, não trinta. */
  commit(): void {
    const current = this.snapshot();
    const top = this.history[this.index];
    if (top && sameLook(top, current)) return;
    // Um passo novo depois de desfazer descarta o que estava à frente.
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(current);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.index = this.history.length - 1;
    this.revision.update((v) => v + 1);
  }

  undo(): void {
    if (this.index <= 0) return;
    this.index--;
    this.apply(this.history[this.index]);
  }

  redo(): void {
    if (this.index >= this.history.length - 1) return;
    this.index++;
    this.apply(this.history[this.index]);
  }

  /** Recomeça o histórico a partir do estado atual — foto nova, projeto aberto. */
  private resetHistory(): void {
    this.history = [this.snapshot()];
    this.index = 0;
    this.revision.update((v) => v + 1);
  }

  private apply(look: LookSnapshot): void {
    this.format.set(SOCIAL_FORMATS.find((f) => f.id === look.formatId) ?? SOCIAL_FORMATS[0]);
    this.fit.set(look.fit);
    this.scale.set(look.scale);
    this.offsetX.set(look.dx);
    this.offsetY.set(look.dy);
    this.bgMode.set(look.bgMode);
    this.bgColor.set(look.bgColor);
    this.adjust.set({ ...look.adjust });
    this.preset.set(look.preset);
    this.denoise.set(look.denoise);
    this.sharpen.set(look.sharpen);
    this.luzIa.set(look.luzIa);
    this.luzForca.set(look.luzForca);
    this.revision.update((v) => v + 1);
  }

  setImage(img: PhotoSource, src: string, name: string, mime = 'image/jpeg'): void {
    this.image.set(img);
    this.src.set(src);
    this.mime.set(mime);
    this.fileName.set(name);
    this.storedCache = null;
    this.resetFraming();
    this.resetHistory();
  }

  /** Troca a foto de trabalho por uma versão melhor da MESMA foto (ampliada por
   * IA, por exemplo). Diferente de `setImage`: enquadramento, ajustes e
   * histórico continuam valendo, porque o que mudou foi a resolução, não a
   * imagem — e o deslocamento é guardado em fração do quadro justamente pra
   * sobreviver a isso. */
  replacePhoto(img: PhotoSource, src: string, mime = 'image/png'): void {
    this.image.set(img);
    this.src.set(src);
    this.mime.set(mime);
    this.storedCache = null;
  }

  resetFraming(): void {
    this.scale.set(1);
    this.offsetX.set(0);
    this.offsetY.set(0);
  }

  clear(): void {
    this.image.set(null);
    this.src.set('');
    this.storedCache = null;
    this.fileName.set('');
    this.format.set(SOCIAL_FORMATS[0]);
    this.fit.set('cover');
    this.bgMode.set('desfoque');
    this.bgColor.set('#ffffff');
    this.adjust.set({ ...NEUTRAL });
    this.preset.set('original');
    this.denoise.set(0);
    this.sharpen.set(0);
    this.luzIa.set('');
    this.luzForca.set(60);
    this.type.set('jpeg');
    this.quality.set(92);
    this.exportW.set(SOCIAL_FORMATS[0].width);
    this.resetFraming();
    this.resetHistory();
  }

  // ---------- projeto ----------

  /** A versão reduzida da foto, calculada só quando o projeto é salvo (e
   * lembrada, porque salvar de novo não muda a foto). */
  private storedCache: { key: string; src: string } | null = null;

  private storedSrc(): string {
    const photo = this.image();
    const original = this.src();
    if (!photo) return '';
    const key = `${original.length}|${this.mime()}`;
    if (this.storedCache?.key === key) return this.storedCache.src;
    const src = normalizeSocialPhoto(photo, original, this.mime());
    this.storedCache = { key, src };
    return src;
  }

  serialize(): SocialProjectData | null {
    if (!this.image()) return null;
    const src = this.storedSrc();
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
      sharpen: this.sharpen(),
      luzIa: this.luzIa(),
      luzForca: this.luzForca(),
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
    this.sharpen.set(data.sharpen ?? 0);
    this.luzIa.set(data.luzIa ?? '');
    this.luzForca.set(data.luzForca ?? 60);
    this.type.set(data.type === 'png' ? 'png' : 'jpeg');
    this.quality.set(data.quality || 92);
    this.exportW.set(data.exportW || format.width);

    const img = await load(data.src);
    this.image.set(img);
    this.src.set(data.src);
    this.mime.set('image/jpeg');
    this.storedCache = { key: `${data.src.length}|image/jpeg`, src: data.src };
    this.fileName.set(data.fileName ?? '');
    this.resetHistory();
  }
}

/** Reduz a foto pro teto de projeto e devolve a data URL a guardar. Reencoda em
 * PNG quando há transparência (o fundo "caber" depende dela) e em JPEG quando
 * não há, que é o que cabe no limite do backend. */
export function normalizeSocialPhoto(photo: PhotoSource, original: string, mime: string): string {
  const source = sourceOf(photo);
  const factor = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(source.width, source.height));
  if (factor === 1 && mime === 'image/jpeg') return original;
  const canvas = stepDownscale(source, source.width * factor, source.height * factor);
  const png = mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif';
  return canvas.toDataURL(png ? 'image/png' : 'image/jpeg', png ? undefined : 0.92);
}
