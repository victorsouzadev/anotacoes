/** Modo "Redes Sociais" do Editor de Imagens: uma foto, um formato de post e
 * ajustes de cor. Tudo roda num canvas só — o mesmo caminho desenha a prévia e
 * a exportação, então o que aparece na tela é o que sai no arquivo.
 *
 * A interface é a área de trabalho comum do editor (classes `il-`); o que é
 * só deste modo usa o prefixo `sm-`. */

import {
  Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild,
  viewChildren,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { DesktopService, bytesToBase64 } from '../../core/desktop';
import { uuid } from '../../core/uuid';
import { IlIconComponent } from './illustration-icons';
import { IlNumComponent } from './illustration-num';
import { BridgeTarget, ModeBridge } from './mode-bridge';
import {
  Adjustments, BgMode, FILTER_GROUPS, FILTER_PRESETS, FilterPreset, FitMode, NEUTRAL,
  SOCIAL_FORMATS, SocialFormat, coversFrame, filterString, fitWithinPixels, frameRect,
} from './social-model';
import { FrameOptions, PhotoSource, Source, paintFrame, sourceOf, stepDownscale } from './social-render';
import { sharpenRgba } from './sharpen';
import { melhorarAutomaticamente } from './auto';
import { aplicarRazaoDeLuz, razaoDeLuz, tamanhoDaRazao } from './light';
import { SocialStore } from './social-store';
import { ImageUpscaleService } from './image-upscale.service';
import { aiCutout } from './ai-cutout';
import { downloadBlob, loadImageElement } from './svg-template';
import { Overlay, OverlayBox, PhotoOverlay, PHOTO_ZOOM_MAX, PHOTO_ZOOM_MIN, drawOverlays, ensureOverlayAssets, ensureOverlayFonts, hitOverlay, photoPanDelta, preloadPhotos } from './social-overlays';
import { SocialOverlaysPanelComponent } from './social-overlays-panel';
import { SocialTemplateGalleryComponent } from './social-template-gallery';
import { SocialCaptionPanelComponent } from './social-caption-panel';
import { FracBox, Guide, gridLines, groupBox, slideRange, snapBox } from './social-align';
import { GalleryEntry } from './social-templates.service';
import { emptyPlaceholders, isPlaceholder } from './social-photo-slots';
import { BRAND_COLORS, BRAND_PATTERNS, ensureBrandAssets } from './brand-assets';
import { FontLibrary } from './fonts';
import { ZipEntry, zipStore } from './zip';

type SectionId = 'foto' | 'formato' | 'filtros' | 'cor' | 'exportar';
type TabId = 'modelos' | 'filtros' | 'ajustes' | 'foto' | 'texto' | 'exportar';

export const PREFS_KEY = 'imagem-social-prefs';
const GRID_KEY = 'imagem-social-grade';
const RULERS_KEY = 'imagem-social-reguas';

export interface GridPrefs {
  on: boolean;
  /** Colunas em cada post. */
  cols: number;
  rows: number;
  /** As camadas grudam nas linhas da grade. */
  snap: boolean;
}

export function loadGrid(): GridPrefs {
  const fallback: GridPrefs = { on: false, cols: 6, rows: 6, snap: true };
  try {
    const raw = localStorage.getItem(GRID_KEY);
    if (!raw) return fallback;
    const g = { ...fallback, ...(JSON.parse(raw) as Partial<GridPrefs>) };
    return { on: !!g.on, snap: g.snap !== false, cols: clampInt(g.cols, 1, 24, 6), rows: clampInt(g.rows, 1, 24, 6) };
  } catch {
    return fallback;
  }
}

function loadRulers(): boolean {
  try {
    return localStorage.getItem(RULERS_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* conveniência */ }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Só os filtros abertos: é por onde se começa, e as outras seções empurravam
 * cor e exportação pra fora da tela. O que o usuário abrir fica guardado. */
export const DEFAULT_SECTIONS: Record<SectionId, boolean> = {
  foto: false, formato: false, filtros: true, cor: false, exportar: false,
};

export interface SocialPrefs {
  sections: Record<SectionId, boolean>;
  advanced: boolean;
}

export function loadPrefs(): SocialPrefs {
  const fallback: SocialPrefs = { sections: { ...DEFAULT_SECTIONS }, advanced: false };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<SocialPrefs>;
    return {
      sections: { ...DEFAULT_SECTIONS, ...(saved.sections ?? {}) },
      advanced: saved.advanced ?? false,
    };
  } catch {
    // Preferência é conveniência: um valor corrompido não pode derrubar o modo.
    return fallback;
  }
}

interface SliderSpec {
  key: keyof Adjustments;
  label: string;
  min: number;
  max: number;
}

/** Teto da foto de trabalho. Acima disso a memória e o custo de cada etapa
 * crescem sem nada em troca: nenhum formato de post pede mais que isto. */
const MAX_WORK_DIMENSION = 4500;
/** O filtro do seletor no computador. `image/*` sozinho esconde HEIC em boa
 * parte dos sistemas, porque o navegador monta a lista a partir dos tipos que o
 * sistema tem registrados — e HEIC costuma não estar lá. Daí os tipos e as
 * extensões virem escritos à mão, em maiúscula também: a câmera do iPhone
 * nomeia os arquivos como IMG_0001.HEIC e há diálogo que compara sem ignorar
 * caixa. */
const FILE_ACCEPT = [
  'image/*',
  'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
  '.heic', '.heif', '.HEIC', '.HEIF',
  '.jpg', '.jpeg', '.png', '.webp',
].join(',');

/** No celular a história é outra: o seletor do Android é um aplicativo
 * separado, escolhido por intenção, e **extensão não significa nada pra ele** —
 * só tipo MIME. Uma lista com extensões que o sistema não sabe traduzir acaba
 * estreitando o que a galeria mostra, e o HEIC some justamente onde ele é o
 * formato padrão da câmera.
 *
 * Por isso, em tela de toque, o seletor abre sem filtro nenhum: é o que faz a
 * galeria mostrar tudo. O arquivo continua sendo validado depois, na leitura —
 * o filtro sempre foi conveniência, nunca a checagem de verdade. */
function isTouchPicker(): boolean {
  try {
    return globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}
/** A prévia desenha na densidade da tela (até 2×), senão ela parece menos
 * nítida que o arquivo exportado — e a comparação fica injusta. */
const MAX_PREVIEW_DPR = 2;
const PREVIEW_CSS_WIDTH = 900;
/** Teto de pixels da prévia: com zoom alto, o canvas acompanha o tamanho na
 * tela (pra não borrar), mas não além disto — a cor é feita pixel a pixel. */
const MAX_PREVIEW_PIXELS = 12_000_000;
/** Zoom da vista, relativo ao post ajustado à tela (1 = ajustado). */
const VIEW_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
const MIN_VIEW_ZOOM = 0.5;
const MAX_VIEW_ZOOM = 8;

const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
/** Teto de pixels do raster de exportação: acima disso o canvas estoura em navegador modesto. */
const MAX_EXPORT_PIXELS = 40_000_000;

/** Conta em uma frase o que a melhoria automática mexeu — e diz quando não
 * mexeu em quase nada, que também é informação. */
function descreverAuto(auto: ReturnType<typeof melhorarAutomaticamente>): string {
  const feito: string[] = [];
  if (auto.adjust.shadows > 0) feito.push('abriu as sombras');
  if (auto.adjust.highlights > 0) feito.push('segurou as luzes altas');
  if (auto.adjust.contrast >= 108) feito.push('abriu a faixa tonal');
  if (auto.adjust.brightness >= 106) feito.push('clareou');
  else if (auto.adjust.brightness <= 94) feito.push('escureceu');
  if (auto.diagnostico.dominante === 'quente') feito.push('tirou a dominante amarelada');
  if (auto.diagnostico.dominante === 'fria') feito.push('tirou a dominante azulada');
  if (auto.denoise > 0) feito.push('limpou o grão');
  feito.push('devolveu a nitidez que a redução come');

  const lista = feito.length > 1
    ? `${feito.slice(0, -1).join(', ')} e ${feito[feito.length - 1]}`
    : feito[0];
  return `Pronto: ${lista}.`;
}

/** Desenha a imagem no tamanho pedido e devolve os pixels. */
function pixelsEm(imagem: CanvasImageSource, w: number, h: number): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imagem, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(blob);
  });
}

/** Maior lado de uma foto usada como camada: guardada dentro do projeto,
 * então vai reduzida — 1600 px cobre um post inteiro com folga. */
const MAX_LAYER_PHOTO = 1600;

/** Lê, converte (HEIC) e reduz uma foto pra virar camada. Mantém PNG quando o
 * arquivo pode ter transparência (recorte, logo); o resto vai em JPEG. */
async function preparePhotoLayer(file: File): Promise<{ src: string; aspect: number }> {
  const heic = isHeicFile(file);
  const blob: Blob = heic ? await heicToJpeg(file) : file;
  const img = await loadImageElement(await readAsDataUrl(blob));
  const src0 = sourceOf(img);
  const k = Math.min(1, MAX_LAYER_PHOTO / Math.max(src0.width, src0.height));
  const canvas = stepDownscale(src0, src0.width * k, src0.height * k);
  const png = !heic && /png|webp|gif/.test(file.type);
  return {
    src: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', png ? undefined : 0.88),
    aspect: src0.width / src0.height,
  };
}

/** Foto de iPhone. O `type` vem vazio em vários sistemas (o navegador não
 * conhece o formato), então a extensão também conta. */
export function isHeicFile(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence') return true;
  return /\.hei[cf]$/i.test(file.name);
}

/** Converte HEIC em JPEG. O decodificador (libheif em WebAssembly) é pesado e
 * nenhum navegador fora do Safari abre HEIC sozinho, então ele entra por import
 * dinâmico: só baixa quando alguém realmente solta uma foto de iPhone. */
async function heicToJpeg(file: File): Promise<Blob> {
  const { heicTo } = await import('heic-to');
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
}

@Component({
  selector: 'app-social-mode',
  standalone: true,
  imports: [IlIconComponent, IlNumComponent, SocialOverlaysPanelComponent, SocialTemplateGalleryComponent, SocialCaptionPanelComponent],
  host: { class: 'il-studio il-basic sm' },
  template: `
    <input #fileInput type="file" [attr.accept]="accept" hidden (change)="onFileInput($event)" />
    <input #photosInput type="file" [attr.accept]="accept" multiple hidden (change)="onPhotosInput($event, photosPerSlide)" />

    <div class="il-controlbar">
      <div class="il-cb-group">
        <button type="button" class="il-ib" [disabled]="!canUndo()" data-tip="Desfazer  Ctrl+Z" aria-label="Desfazer" (click)="undo()"><il-icon name="undo" /></button>
        <button type="button" class="il-ib" [disabled]="!canRedo()" data-tip="Refazer  Ctrl+Shift+Z" aria-label="Refazer" (click)="redo()"><il-icon name="redo" /></button>
      </div>
      <span class="il-cb-kind sm-kind" [title]="fileName()">{{ image() ? fileName() : (store.templateId() ? 'Modelo Viih Mimos' : 'Redes sociais') }}</span>
      <div class="il-cb-group">
        <span class="il-cb-label">Formato</span>
        <select class="il-select" [value]="format().id" (change)="setFormatId($any($event.target).value)" aria-label="Formato do post">
          @for (f of formats; track f.id) { <option [value]="f.id">{{ f.label }} — {{ f.hint }}</option> }
        </select>
      </div>
      @if (image() && store.photoVisible()) {
        <div class="il-cb-group">
          <il-num label="Escala" title="Tamanho da foto dentro do quadro (a roda do mouse também muda)" unit="%" [value]="scale() * 100" [step]="5" [min]="20" [max]="600" [decimals]="0" (valueChange)="setScalePct($event.value)" />
          <div class="il-seg">
            <button type="button" [class.il-on]="fit() === 'cover'" data-tip="Preencher o quadro" aria-label="Preencher" (click)="setFit('cover')"><il-icon name="cover" /></button>
            <button type="button" [class.il-on]="fit() === 'contain'" data-tip="Caber a foto inteira" aria-label="Caber" (click)="setFit('contain')"><il-icon name="contain" /></button>
          </div>
          <button type="button" class="il-ib" data-tip="Reenquadrar" aria-label="Reenquadrar" (click)="resetFraming()"><il-icon name="reframe" /></button>
          <button type="button" class="il-btn" data-tip="Mede a foto e acerta luz, cor, grão e nitidez" (click)="melhorarAuto()"><il-icon name="sparkle" [size]="14" /> Automático</button>
          <button
            type="button" class="il-btn" [class.il-on]="comparing()"
            data-tip="Segure pra ver a original (ou a tecla C)"
            (pointerdown)="startCompare($event)" (pointerup)="stopCompare()" (pointerleave)="stopCompare()" (pointercancel)="stopCompare()"
          ><il-icon name="compare" [size]="14" /> Antes</button>
        </div>
      } @else if (store.slot()) {
        <button type="button" class="il-btn" (click)="pick(fileInput)"><il-icon name="photo-add" [size]="14" /> Pôr foto</button>
      }
      @if (selectedPhoto(); as ph) {
        <div class="il-cb-group">
          <il-num label="Escala da foto" title="Aproxima (mais de 100%) ou afasta (menos de 100%) a foto dentro da caixa dela (a roda do mouse em cima da foto também muda). Arraste a foto pra escolher o pedaço que aparece." unit="%" [value]="(ph.zoom ?? 1) * 100" [step]="5" [min]="photoZoomMin * 100" [max]="photoZoomMax * 100" [decimals]="0" (valueChange)="setPhotoZoom($event.value / 100)" />
          <button type="button" class="il-ib" data-tip="Reenquadrar a foto" aria-label="Reenquadrar a foto" [disabled]="(ph.zoom ?? 1) === 1 && !ph.panX && !ph.panY" (click)="resetPhotoFraming()"><il-icon name="reframe" /></button>
        </div>
      }
      @if (hasPhotoSpots()) {
        <button type="button" class="il-btn" [class.il-primary]="emptySpots() > 0" data-tip="Escolha várias de uma vez: cada foto vai num espaço, e o carrossel cresce pra caber (até 10 posts)" (click)="pickPhotos(true)">
          <il-icon name="photo-add" [size]="14" /> {{ emptySpots() > 0 ? 'Pôr fotos (' + emptySpots() + ' ' + (emptySpots() === 1 ? 'espaço vazio' : 'espaços vazios') + ')' : 'Mais fotos' }}
        </button>
      }
      @if (store.hasContent()) {
        <span class="sm-spacer"></span>
        <button type="button" class="il-btn" data-tip="A IA escreve a legenda olhando o post" (click)="tab.set('exportar')"><il-icon name="sparkle" [size]="14" /> Legenda</button>
        <span class="il-cb-label">{{ exportW() }} × {{ exportH() }} px{{ store.slides() > 1 ? ' × ' + store.slides() : '' }}</span>
        <button type="button" class="il-btn il-primary" (click)="exportImage()"><il-icon name="download" [size]="13" /> Baixar {{ store.slides() > 1 ? 'carrossel' : (type() === 'png' ? 'PNG' : 'JPEG') }}</button>
      } @else {
        <span class="il-cb-hint">Abra uma foto ou comece por um modelo Viih Mimos.</span>
      }
    </div>

    <nav class="il-tools-col" aria-label="Ferramentas">
      <div class="il-tb-group">
        <button type="button" class="il-tool il-on" aria-label="Enquadrar" data-tip="Enquadrar" data-help="Arraste a foto no quadro; a roda dá zoom"><il-icon name="hand" [size]="18" /></button>
        <button
          type="button" class="il-tool" [class.il-on]="comparing()" [disabled]="!image()" aria-label="Comparar com a original"
          data-tip="Antes / depois  C" data-help="Segure pra ver a foto original"
          (pointerdown)="startCompare($event)" (pointerup)="stopCompare()" (pointerleave)="stopCompare()" (pointercancel)="stopCompare()"
        ><il-icon name="compare" [size]="18" /></button>
      </div>
      <div class="il-tb-group">
        <button type="button" class="il-tool" aria-label="Abrir foto" data-tip="Abrir foto" data-help="JPEG, PNG, WebP e HEIC do iPhone" (click)="pick(fileInput)"><il-icon name="folder" [size]="18" /></button>
        <button type="button" class="il-tool" aria-label="Adicionar fotos" data-tip="Adicionar fotos" data-help="Várias fotos como camadas, cada uma no seu tamanho" (click)="pickPhotos(store.slides() > 1)"><il-icon name="photo-add" [size]="18" /></button>
        <button type="button" class="il-tool" [class.il-on]="tab() === 'modelos'" aria-label="Modelos Viih Mimos" data-tip="Modelos Viih Mimos" data-help="Story, feed e carrossel na identidade da marca" (click)="tab.set('modelos')"><il-icon name="templates" [size]="18" /></button>
        <button type="button" class="il-tool" [disabled]="!image()" aria-label="Filtros" data-tip="Filtros prontos" (click)="tab.set('filtros')"><il-icon name="filter" [size]="18" /></button>
        <button type="button" class="il-tool" [disabled]="!image()" aria-label="Cor e luz" data-tip="Cor e luz" (click)="tab.set('ajustes')"><il-icon name="sun" [size]="18" /></button>
      </div>
    </nav>

    @if (store.hasContent()) {
     <div class="sm-stage-wrap" [class.sm-with-rulers]="rulers()">
      @if (rulers()) {
        <span class="sm-ruler-corner" aria-hidden="true">px</span>
        <canvas #rulerTop class="sm-ruler sm-ruler-top" title="Arraste pra baixo pra criar uma guia horizontal"
          (pointerdown)="onRulerDown($event, 'y')" (pointermove)="onGuideMove($event)" (pointerup)="onGuideUp($event)" (pointercancel)="onGuideUp($event)"></canvas>
        <canvas #rulerLeft class="sm-ruler sm-ruler-left" title="Arraste pra direita pra criar uma guia vertical"
          (pointerdown)="onRulerDown($event, 'x')" (pointermove)="onGuideMove($event)" (pointerup)="onGuideUp($event)" (pointercancel)="onGuideUp($event)"></canvas>
      }
      <div
        #stage
        class="il-stage sm-stage"
        (scroll)="scrollTick.update((v) => v + 1)"
        [class.sm-zoomed]="viewZoom() > 1"
        [class.il-drag-over]="dragOver()"
        (wheel)="onWheel($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave()"
        (drop)="onDrop($event)"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (dblclick)="onDoubleClick($event)"
      >
        <canvas
          #preview class="sm-canvas il-paper" [class.sm-measured]="canvasCssW() !== null"
          [style.aspect-ratio]="store.frameRatio()" [style.width.px]="canvasCssW()"
        ></canvas>
        @if (inlineEdit(); as ed) {
          <textarea
            #inlineInput class="sm-inline-edit" aria-label="Editar texto" spellcheck="true"
            [style.left.px]="ed.left" [style.top.px]="ed.top" [style.min-width.px]="ed.width" [style.min-height.px]="ed.height"
            [style.font-size.px]="ed.fontSize" [style.font-family]="ed.font" [style.font-weight]="ed.weight" [style.color]="ed.color"
            [style.text-align]="ed.align" [value]="ed.text" [attr.rows]="ed.rows"
            (input)="onInlineInput($event)" (blur)="endInlineEdit()" (keydown)="onInlineKey($event)"
            (pointerdown)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()"
          ></textarea>
        }
        @if (comparing()) { <span class="sm-badge">Foto original</span> }
      </div>
     </div>
    } @else {
      <div class="il-stage" [class.il-drag-over]="dragOver()" (dragover)="onDragOver($event)" (dragleave)="onDragLeave()" (drop)="onDrop($event)">
        <button type="button" class="il-empty" (click)="pick(fileInput)">
          <il-icon name="photo-add" [size]="34" />
          <strong>Solte uma foto aqui</strong>
          <span>Escolha o formato do post, aplique um filtro pronto e ajuste as cores na mão. JPEG, PNG, WebP e HEIC do iPhone.</span>
          @if (converting()) { <span>Convertendo HEIC…</span> }
          @if (error()) { <span class="il-error">{{ error() }}</span> }
        </button>
        <div class="sm-start-row">
          <button type="button" class="il-btn" (click)="tab.set('modelos')"><il-icon name="templates" [size]="14" /> Começar por um modelo Viih Mimos</button>
          <button type="button" class="il-btn" (click)="pickPhotos(true)"><il-icon name="photo-add" [size]="14" /> Carrossel com várias fotos</button>
        </div>
      </div>
    }

    <aside class="il-dock">
      <div class="il-tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" class="il-tab" [class.il-on]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
        }
      </div>
      <div class="il-tab-body">
        @switch (tab()) {
          @case ('modelos') {
            <sm-template-gallery (applied)="onTemplateApplied($event)" />
          }
          @case ('filtros') {
            @for (g of groups; track g.name) {
              <section class="il-sec">
                <div class="il-sec-head il-sec-static">{{ g.name }}</div>
                <div class="il-sec-body">
                  <div class="sm-presets" role="list">
                    @for (p of g.presets; track p.id) {
                      <button
                        type="button"
                        class="sm-preset"
                        [class.il-on]="preset() === p.id"
                        [class.sm-edited]="preset() === p.id && presetEdited()"
                        (click)="applyPreset(p)"
                        [title]="preset() === p.id && presetEdited() ? p.label + ' (com ajustes seus — clique pra voltar ao original)' : p.label"
                      >
                        @if (image()) {
                          <canvas #presetCanvas class="sm-preset-chip" [attr.data-preset]="p.id"></canvas>
                        } @else {
                          <span class="sm-preset-chip sm-chip-demo" [style.filter]="chipFilter(p)"></span>
                        }
                        <span class="sm-preset-label">{{ p.label }}</span>
                      </button>
                    }
                  </div>
                </div>
              </section>
            }
            <p class="il-note sm-pad">{{ presets.length }} filtros. A miniatura mostra a sua foto; depois de aplicar, dá pra continuar ajustando em "Cor e luz".</p>
          }
          @case ('ajustes') {
            <section class="il-sec">
              <div class="il-sec-head il-sec-static">Cor e luz <small>{{ dirty() ? 'ajustado' : 'neutro' }}</small></div>
              <div class="il-sec-body">
                <button type="button" class="il-btn il-primary il-wide" [disabled]="!image()" (click)="melhorarAuto()"><il-icon name="sparkle" [size]="13" /> Melhorar automaticamente</button>
                @if (autoResumo()) { <p class="il-note">{{ autoResumo() }} Ctrl+Z desfaz; segure C pra comparar.</p> }
                @for (s of basicSliders; track s.key) {
                  <label class="il-range sm-r">
                    <span>{{ s.label }}</span>
                    <input type="range" [min]="s.min" [max]="s.max" step="1" [value]="adjust()[s.key]" (input)="onSlider(s.key, $event)" (change)="commit()" />
                    <button type="button" class="sm-reset" (click)="resetOne(s.key, $event)" title="Voltar ao padrão">{{ display(s.key) }}</button>
                  </label>
                }
                <button type="button" class="il-link sm-more" (click)="toggleAdvanced()">
                  <il-icon name="chevron" [size]="12" [class.sm-up]="advanced()" /> Ajustes avançados
                  @if (!advanced() && advancedTouched()) { <span class="sm-dot" title="Há ajustes avançados em uso"></span> }
                </button>
                @if (advanced()) {
                  @for (s of advancedSliders; track s.key) {
                    <label class="il-range sm-r">
                      <span>{{ s.label }}</span>
                      <input type="range" [min]="s.min" [max]="s.max" step="1" [value]="adjust()[s.key]" (input)="onSlider(s.key, $event)" (change)="commit()" />
                      <button type="button" class="sm-reset" (click)="resetOne(s.key, $event)" title="Voltar ao padrão">{{ display(s.key) }}</button>
                    </label>
                  }
                }
                <button type="button" class="il-btn il-wide" (click)="resetAdjust()"><il-icon name="undo" [size]="13" /> Zerar ajustes</button>
              </div>
            </section>
            <section class="il-sec">
              <div class="il-sec-head il-sec-static">Detalhe</div>
              <div class="il-sec-body">
                <label class="il-range sm-r">
                  <span>Ruído</span>
                  <input type="range" min="0" max="100" step="1" [value]="denoise()" (input)="onDenoise($event)" (change)="commit()" />
                  <button type="button" class="sm-reset" (click)="resetDenoise($event)" title="Desligar">{{ denoise() }}</button>
                </label>
                <p class="il-note">{{ denoising() ? 'Limpando o ruído…' : 'Tira o granulado sem borrar as bordas. Fica de fora dos filtros e do "zerar".' }}</p>
                <label class="il-range sm-r">
                  <span>Nitidez</span>
                  <input type="range" min="0" max="100" step="1" [value]="sharpen()" (input)="onSharpen($event)" (change)="commit()" />
                  <button type="button" class="sm-reset" (click)="resetSharpen($event)" title="Desligar">{{ sharpen() }}</button>
                </label>
                <p class="il-note">Devolve o micro-contraste que a redução de tamanho come — 30 a 40 costuma bastar.</p>
              </div>
            </section>
            @if (upscale.disponivel() && upscale.luz()) {
              <section class="il-sec">
                <div class="il-sec-head il-sec-static"><il-icon name="sparkle" [size]="13" /> Luz com IA</div>
                <div class="il-sec-body">
                  <div class="il-seg sm-seg-full">
                    @for (d of direcoes; track d.id) {
                      <button type="button" [class.il-on]="direcaoLuz() === d.id" [disabled]="iluminando()" (click)="direcaoLuz.set(d.id)">{{ d.rotulo }}</button>
                    }
                  </div>
                  <button type="button" class="il-btn il-wide" [disabled]="!image() || iluminando()" (click)="iluminarComIa()">
                    <il-icon name="sun" [size]="13" /> {{ iluminando() ? 'Criando a luz…' : (luzIa() ? 'Refazer a luz com IA' : 'Iluminar com IA') }}
                  </button>
                  @if (luzIa()) {
                    <label class="il-range sm-r">
                      <span>Intensidade</span>
                      <input type="range" min="0" max="100" step="1" [value]="luzForca()" (input)="onLuzForca($event)" (change)="commit()" />
                      <button type="button" class="sm-reset" (click)="removerLuzIa($event)" title="Remover a luz da IA">{{ luzForca() }}</button>
                    </label>
                  }
                  <p class="il-note">
                    @if (iluminando()) {
                      A IA está desenhando a luz; leva de trinta segundos a um minuto e meio.
                    } @else if (luzErro()) {
                      <span class="il-warn">{{ luzErro() }}</span>
                    } @else if (luzIa()) {
                      A luz é da IA; os pixels são os seus. Mexer na intensidade não chama o serviço de novo.
                    } @else {
                      A IA gera uma versão iluminada e o editor aproveita só a luz dela: produto, texto e cores continuam os da sua foto. Cada geração tem custo.
                    }
                  </p>
                </div>
              </section>
            }
          }
          @case ('foto') {
            <section class="il-sec">
              <div class="il-sec-body il-sec-body-top">
                <div class="il-row">
                  <button type="button" class="il-btn il-grow" (click)="pick(fileInput)"><il-icon name="folder" [size]="13" /> {{ image() ? 'Trocar foto' : 'Abrir foto' }}</button>
                  @if (image()) { <button type="button" class="il-btn il-danger" data-tip="Remover a foto" (click)="removeImage()"><il-icon name="trash" [size]="13" /></button> }
                </div>
                <button type="button" class="il-link sm-link" (click)="pick(fileInput, true)">Não achou o arquivo na lista? Abra sem filtro de tipo</button>
                @if (image()) {
                  <p class="il-note">Origem: {{ photoSize().width }} × {{ photoSize().height }} px.</p>
                }
              </div>
            </section>
            <section class="il-sec">
              <div class="il-sec-head il-sec-static">Formato</div>
              <div class="il-sec-body">
                <div class="sm-formats">
                  @for (f of formats; track f.id) {
                    <button type="button" class="sm-format" [class.il-on]="format().id === f.id" (click)="setFormat(f)" [title]="f.hint">
                      <span class="sm-format-box" [style.aspect-ratio]="f.ratio"></span>
                      <span class="sm-format-label">{{ f.label }}</span>
                    </button>
                  }
                </div>
                @if (showsBackground()) {
                  <div class="il-row">
                    <button type="button" class="il-btn il-grow" [class.il-on]="bgMode() === 'cor'" (click)="setBgMode('cor')">Fundo cor</button>
                    <button type="button" class="il-btn il-grow" [class.il-on]="bgMode() === 'desfoque'" (click)="setBgMode('desfoque')">Fundo borrado</button>
                    @if (bgMode() === 'cor') { <input type="color" class="il-color-input" [value]="bgColor()" (input)="onBgColor($event)" aria-label="Cor do fundo" /> }
                  </div>
                } @else if (image()) {
                  <p class="il-note">A foto cobre {{ store.slot() ? 'o espaço dela' : 'o quadro inteiro' }} — não há fundo à mostra. Use "Caber" ou diminua a escala pra escolher um.</p>
                }
              </div>
            </section>
            @if (store.templateId() || !image()) {
              <section class="il-sec">
                <div class="il-sec-head il-sec-static">{{ store.templateId() ? 'Fundo do modelo' : 'Fundo' }}</div>
                <div class="il-sec-body">
                  <div class="sm-swatches" role="group" aria-label="Cor de fundo">
                    @for (c of brandColors; track c.id) {
                      <button type="button" class="sm-swatch" [class.il-on]="bgColor().toLowerCase() === c.hex.toLowerCase()" [style.background]="c.hex" [title]="c.label" [attr.aria-label]="'Fundo ' + c.label" (click)="setTemplateBg(c.hex)"></button>
                    }
                    <input type="color" class="il-color-input" [value]="bgColor()" (input)="onBgColor($event)" aria-label="Outra cor de fundo" />
                  </div>
                  <div class="il-seg sm-seg-full">
                    <button type="button" [class.il-on]="!store.bgPattern()" (click)="setPattern('')">Liso</button>
                    @for (pt of patterns; track pt.id) {
                      <button type="button" [class.il-on]="store.bgPattern() === pt.id" (click)="setPattern(pt.id)">{{ pt.label }}</button>
                    }
                  </div>
                  @if (store.templateId()) {
                    <button type="button" class="il-btn il-wide" (click)="removeTemplate()"><il-icon name="trash" [size]="13" /> Tirar o modelo</button>
                  }
                  @if (store.slot()) {
                    <p class="il-note">{{ image() ? 'Arraste a foto dentro do espaço pra reenquadrar; a roda do mouse muda a escala.' : 'Clique no espaço tracejado do palco (ou em "Pôr foto") pra escolher a foto.' }}</p>
                  }
                </div>
              </section>
            }
            @if (image() && upscale.disponivel()) {
              <section class="il-sec">
                <div class="il-sec-head il-sec-static"><il-icon name="wand" [size]="13" /> Recortar com IA</div>
                <div class="il-sec-body">
                  <button type="button" class="il-btn il-wide" [disabled]="recortando()" (click)="recortarComIa()">
                    <il-icon name="wand" [size]="13" /> {{ recortando() ? 'Recortando…' : 'Remover o fundo com IA' }}
                  </button>
                  <p class="il-note">
                    @if (recorteErro()) { <span class="il-warn">{{ recorteErro() }}</span> }
                    @else { Tira o fundo mesmo com cabelo, pelo ou cenário. Depois escolha a cor nova em Formato → Fundo cor. }
                  </p>
                </div>
              </section>
            }
            @if (image() && upscale.disponivel()) {
              <section class="il-sec">
                <div class="il-sec-head il-sec-static"><il-icon name="sparkle" [size]="13" /> Ampliar com IA</div>
                <div class="il-sec-body">
                  <button type="button" class="il-btn il-wide" [disabled]="ampliando() || !ampliacaoUtil()" (click)="ampliarComIa()">
                    <il-icon name="image" [size]="13" /> {{ ampliando() ? 'Ampliando…' : 'Ampliar 2× com IA' }}
                  </button>
                  <p class="il-note">
                    @if (ampliando()) {
                      @if (tentativa() > 1) { A GPU do serviço estava cheia — tentando de novo com a foto menor ({{ tentativa() }}ª tentativa). }
                      @else { A foto foi pro serviço de ampliação; costuma levar alguns segundos. }
                    } @else if (upscaleErro()) {
                      <span class="il-warn">{{ upscaleErro() }}</span>
                    } @else if (ampliacaoUtil()) {
                      A foto é pequena pro tamanho da exportação: ampliar acrescenta detalhe de verdade. Vai pra um serviço externo e cada ampliação tem custo.
                    } @else {
                      A foto já tem pixel de sobra pra este formato. O botão liga sozinho quando o tamanho pedido passar do que ela tem.
                    }
                  </p>
                </div>
              </section>
            }
          }
          @case ('texto') {
            <sm-overlays-panel (addPhotos)="pickPhotos($event)" />
          }
          @case ('exportar') {
            <sm-caption-panel [preview]="captionPreview" />
            <section class="il-sec">
              <div class="il-sec-body il-sec-body-top">
                <div class="il-seg sm-seg-full">
                  <button type="button" [class.il-on]="type() === 'jpeg'" (click)="setType('jpeg')">JPEG</button>
                  <button type="button" [class.il-on]="type() === 'png'" (click)="setType('png')">PNG</button>
                </div>
                @if (type() === 'jpeg') {
                  <label class="il-range"><span>Qualidade</span><input type="range" min="50" max="100" step="1" [value]="quality()" (input)="onQuality($event)" /><b>{{ quality() }}%</b></label>
                }
                <label class="il-field"><span>Largura de saída (px)</span><input type="number" min="200" max="4000" step="10" [value]="exportW()" (input)="onExportW($event)" /></label>
                <il-num label="Carrossel" title="Posts lado a lado (1 = post comum)" unit="posts" [value]="store.slides()" [min]="1" [max]="slidesMax" [decimals]="0" (valueChange)="setSlides($event.value)" />
                @if (store.slides() > 1) {
                  <p class="il-note">A foto se espalha por {{ store.slides() }} posts em sequência — ao deslizar no Instagram vira um panorama. Sai um ZIP com os {{ store.slides() }} arquivos.</p>
                }
                <p class="il-note">Altura {{ exportH() }} px, pela proporção do formato.</p>
                @if (upscaling(); as falta) {
                  <p class="il-note il-warn">A foto tem pixel pra {{ falta }} px de largura neste corte — acima disso o arquivo sai interpolado, maior mas não mais definido.</p>
                }
                <button type="button" class="il-btn il-primary il-wide" [disabled]="!store.hasContent()" (click)="exportImage()"><il-icon name="download" [size]="13" /> {{ store.slides() > 1 ? 'Baixar carrossel (' + store.slides() + ' posts)' : 'Baixar ' + exportW() + ' × ' + exportH() }}</button>
                @if (status()) { <p class="il-note">{{ status() }}</p> }
              </div>
            </section>
            <section class="il-sec">
              <div class="il-sec-head il-sec-static">Lote</div>
              <div class="il-sec-body">
                <input #batchInput type="file" accept="image/*,.heic,.heif" multiple hidden (change)="runBatch($event)" />
                <button type="button" class="il-btn il-wide" [disabled]="!!batching()" (click)="batchInput.click()"><il-icon name="photo-add" [size]="13" /> {{ batching() || 'Aplicar em várias fotos…' }}</button>
                <p class="il-note">Mesmo formato, filtro, ajustes e textos em cada foto escolhida, enquadrada no centro. Sai um ZIP.</p>
                @if (desktop.enabled) {
                  <button type="button" class="il-btn il-wide" [class.il-on]="!!watching()" (click)="toggleWatch()"><il-icon name="folder" [size]="13" /> {{ watching() ? 'Parar de monitorar' : 'Monitorar uma pasta…' }}</button>
                  @if (watching(); as w) {
                    <p class="il-note">Cada foto que chegar em <strong>{{ w.pasta }}</strong> sai com este look na subpasta "prontas". Mudou o look? As próximas já saem com ele.</p>
                  } @else {
                    <p class="il-note">Pra fotos que chegam aos poucos (celular sincronizado, cartão da câmera): o programa vigia a pasta e aplica o lote sozinho.</p>
                  }
                  @if (watchStatus()) { <p class="il-note">{{ watchStatus() }}</p> }
                }
              </div>
            </section>
            <div class="il-sec-head il-sec-static">Enviar para outro modo</div>
            <div class="il-export-list">
              @for (t of bridge.targetsFrom('social'); track t.id) {
                <button type="button" class="il-export" [disabled]="!store.hasContent()" (click)="sendTo(t.id)"><il-icon name="export" [size]="20" /><span><strong>{{ t.label }}</strong><small>{{ t.help }}</small></span></button>
              }
            </div>
          }
        }
      </div>
    </aside>

    <footer class="il-status">
      @if (store.hasContent()) {
        <div class="il-status-zoom">
          <button type="button" class="il-ib il-ib-sm" data-tip="Afastar  Ctrl+−" aria-label="Afastar" (click)="zoomStep(-1)">−</button>
          <il-num label="" title="Zoom da vista (100% = post inteiro na tela)" unit="%" [value]="viewZoom() * 100" [step]="25" [min]="minViewZoom * 100" [max]="maxViewZoom * 100" [decimals]="0" (valueChange)="setViewZoom($event.value / 100)" />
          <button type="button" class="il-ib il-ib-sm" data-tip="Aproximar  Ctrl+=" aria-label="Aproximar" (click)="zoomStep(1)">+</button>
          <button type="button" class="il-ib il-ib-sm" data-tip="Ajustar à tela  Ctrl+0" aria-label="Ajustar à tela" (click)="setViewZoom(1)"><il-icon name="fit" [size]="13" /></button>
        </div>
        <button type="button" class="il-ib il-ib-sm il-txt" [class.il-on]="rulers()" data-tip="Réguas (arraste delas pra criar guias)" (click)="toggleRulers()">Réguas</button>
        <button type="button" class="il-ib il-ib-sm il-txt" [class.il-on]="grid().on" data-tip="Grade pra organizar (as camadas grudam nela)" (click)="setGrid({ on: !grid().on })">Grade</button>
        @if (grid().on) {
          <span class="sm-grid-cfg">
            <il-num label="" title="Colunas em cada post" unit="col" [value]="grid().cols" [min]="1" [max]="24" [decimals]="0" (valueChange)="setGrid({ cols: $event.value })" />
            <il-num label="" title="Linhas" unit="lin" [value]="grid().rows" [min]="1" [max]="24" [decimals]="0" (valueChange)="setGrid({ rows: $event.value })" />
            <button type="button" class="il-ib il-ib-sm il-txt" [class.il-on]="grid().snap" data-tip="Grudar na grade" (click)="setGrid({ snap: !grid().snap })">Ímã</button>
          </span>
        }
        @if (store.userGuides().length) {
          <button type="button" class="il-ib il-ib-sm il-txt" data-tip="Apagar as guias das réguas" (click)="clearGuides()">Limpar guias</button>
        }
        @if (format().id === 'story') {
          <button type="button" class="il-ib il-ib-sm il-txt" [class.il-on]="safeArea()" data-tip="Faixas que o Instagram cobre no story" (click)="safeArea.set(!safeArea())">Área segura</button>
        }
        <span class="il-status-info">{{ fileName() || (store.templateId() ? 'Modelo Viih Mimos' : '') }}</span>
        <span>{{ format().label }} · {{ exportW() }} × {{ exportH() }} px{{ image() ? ' · escala ' + (scale() * 100).toFixed(0) + '%' : '' }}</span>
      }
      <span class="il-status-msg">{{ status() || (image() ? 'Arraste a foto pra reenquadrar · roda muda a escala da foto · Ctrl+roda dá zoom na vista · C compara' : (store.templateId() ? 'Dois cliques num texto editam · Ctrl+roda dá zoom · solte uma foto no espaço do modelo' : 'Solte, cole ou abra uma foto')) }}</span>
    </footer>
  `,
  styles: [`
    .sm-kind { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
    .sm-spacer { flex: 1; }
    .sm-stage { touch-action: none; cursor: grab; }
    .sm-stage:active { cursor: grabbing; }
    .sm-canvas { display: block; flex: none; margin: auto; }
    /* antes de medir o palco, o post só cabe nele */
    .sm-canvas:not(.sm-measured) { max-width: 100%; max-height: 100%; }
    .sm-badge {
      position: absolute; top: 14px; left: 50%; transform: translateX(-50%); padding: 3px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; color: #fff; background: rgba(0, 0, 0, 0.65); pointer-events: none;
    }
    .sm-pad { margin: 10px; }
    .sm-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .sm-preset { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 3px; border: 1px solid transparent; border-radius: 5px; background: none; color: var(--text); }
    .sm-preset:hover { background: var(--il-hover); }
    .sm-preset.il-on { border-color: var(--il-blue); background: var(--il-active); }
    .sm-preset.sm-edited .sm-preset-label::after { content: ' •'; color: var(--il-blue); }
    .sm-preset-chip { width: 100%; aspect-ratio: 1; border-radius: 4px; display: block; background: var(--il-line); }
    .sm-chip-demo { background: linear-gradient(135deg, #f6c177 0%, #e07a5f 45%, #3d5a80 100%); }
    .sm-preset-label { font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .sm-formats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .sm-format { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 64px; padding: 6px 4px; border: 1px solid var(--il-line); border-radius: 5px; background: var(--il-field); color: var(--text); }
    .sm-format:hover { border-color: var(--il-line-strong); }
    .sm-format.il-on { border-color: var(--il-blue); background: var(--il-active); }
    .sm-format-box { max-width: 36px; max-height: 32px; width: 100%; border: 1.5px solid currentColor; border-radius: 2px; opacity: 0.7; }
    .sm-format-label { font-size: 10px; color: var(--text-muted); }
    .sm-r { grid-template-columns: 72px 1fr 40px; }
    .sm-reset { padding: 0; border: none; background: none; color: var(--text); font-weight: 600; font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
    .sm-reset:hover { color: var(--il-blue); }
    .sm-more { margin: 2px 0; }
    .sm-up { transform: rotate(180deg); }
    .sm-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--il-blue); }
    .sm-link { margin: 0; justify-content: flex-start; }
    .sm-seg-full { display: flex; }
    .sm-seg-full button { flex: 1; width: auto; font-size: 11px; }
    /* seis abas na largura do painel: menos respiro pra caberem todas */
    .il-tab { padding: 0 4px; min-width: 0; }
    .sm-stage-wrap { grid-area: canvas; display: grid; grid-template: 'stage' minmax(0, 1fr) / minmax(0, 1fr); min-width: 0; min-height: 0; }
    .sm-stage-wrap.sm-with-rulers { grid-template: 'corner top' 20px 'left stage' minmax(0, 1fr) / 20px minmax(0, 1fr); }
    .sm-stage-wrap > .il-stage { grid-area: stage; }
    .sm-ruler { display: block; width: 100%; height: 100%; background: var(--il-chrome); color: var(--text-muted); touch-action: none; }
    .sm-ruler-top { grid-area: top; cursor: row-resize; border-bottom: 1px solid var(--il-line); }
    .sm-ruler-left { grid-area: left; cursor: col-resize; border-right: 1px solid var(--il-line); }
    .sm-ruler-corner {
      grid-area: corner; display: flex; align-items: center; justify-content: center; font-size: 8px; color: var(--text-muted);
      background: var(--il-chrome); border-right: 1px solid var(--il-line); border-bottom: 1px solid var(--il-line);
    }
    .sm-grid-cfg { display: inline-flex; align-items: center; gap: 2px; }
    .sm-grid-cfg .il-num { height: 20px; }
    .sm-grid-cfg .il-num input { width: 26px; font-size: 11px; }
    @media (max-width: 900px) {
      .sm-stage-wrap { order: 3; height: 56dvh; }
    }
    .sm-inline-edit {
      position: absolute; z-index: 5; box-sizing: border-box; padding: 2px 6px; line-height: 1.15; resize: none; overflow: hidden;
      field-sizing: content; max-width: 90%; background: rgba(255, 255, 255, 0.94); border: 2px solid var(--il-blue);
      border-radius: 6px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); outline: none; white-space: pre;
    }
    .sm-start-row { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
    .sm-swatches { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
    .sm-swatch { width: 24px; height: 24px; padding: 0; border: 1px solid var(--il-line-strong); border-radius: 50%; cursor: pointer; }
    .sm-swatch.il-on { outline: 2px solid var(--il-blue); outline-offset: 1px; }
  `],
})
export class SocialModeComponent {
  private readonly previewRef = viewChild<ElementRef<HTMLCanvasElement>>('preview');
  private readonly fileInputRef = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly photosInputRef = viewChild<ElementRef<HTMLInputElement>>('photosInput');
  private readonly stageRef = viewChild<ElementRef<HTMLDivElement>>('stage');
  private readonly rulerTopRef = viewChild<ElementRef<HTMLCanvasElement>>('rulerTop');
  private readonly rulerLeftRef = viewChild<ElementRef<HTMLCanvasElement>>('rulerLeft');
  /** Muda a cada rolagem do palco: as réguas acompanham. */
  readonly scrollTick = signal(0);
  /** Guia (das réguas) sendo arrastada: índice na lista do store. */
  private guideDrag: { pointer: number; index: number } | null = null;
  /** Zoom da vista: só a tela, o post não muda. 1 = post inteiro na tela. */
  readonly viewZoom = signal(1);
  readonly minViewZoom = MIN_VIEW_ZOOM;
  readonly maxViewZoom = MAX_VIEW_ZOOM;
  /** Área útil do palco, em px de tela (sem o respiro). */
  private readonly stageSize = signal<{ w: number; h: number } | null>(null);
  /** Largura do post na tela; `null` enquanto o palco não foi medido. */
  readonly canvasCssW = computed(() => {
    const size = this.stageSize();
    if (!size || size.w <= 0 || size.h <= 0) return null;
    const fit = Math.min(size.w, size.h * this.store.frameRatio());
    return Math.max(40, Math.round(fit * this.viewZoom()));
  });
  /** Arraste da vista (com zoom): posição de partida da rolagem. */
  private pan: { id: number; x: number; y: number; left: number; top: number; moved: boolean; slotClick: boolean } | null = null;
  private readonly inlineInputRef = viewChild<ElementRef<HTMLTextAreaElement>>('inlineInput');
  /** Texto sendo editado direto no palco, posicionado em cima dele. */
  readonly inlineEdit = signal<{
    id: string; text: string; left: number; top: number; width: number; height: number; rows: number;
    fontSize: number; font: string; weight: number; color: string; align: string;
  } | null>(null);

  private readonly presetRefs = viewChildren<ElementRef<HTMLCanvasElement>>('presetCanvas');

  readonly formats = SOCIAL_FORMATS;
  readonly tabs: { id: TabId; label: string }[] = [
    { id: 'modelos', label: 'Modelos' },
    { id: 'filtros', label: 'Filtros' },
    { id: 'ajustes', label: 'Cor e luz' },
    { id: 'foto', label: 'Foto' },
    { id: 'texto', label: 'Camadas' },
    { id: 'exportar', label: 'Exportar' },
  ];
  readonly store = inject(SocialStore);
  /** Sem nada aberto, a primeira aba é a dos modelos: é por onde se começa
   * quando não há foto. */
  readonly tab = signal<TabId>(this.store.hasContent() ? 'filtros' : 'modelos');
  readonly brandColors = BRAND_COLORS;
  readonly patterns = BRAND_PATTERNS;
  readonly presets = FILTER_PRESETS;
  readonly groups = FILTER_GROUPS;
  /** Os quatro que resolvem a maior parte das fotos. */
  readonly basicSliders: SliderSpec[] = [
    { key: 'brightness', label: 'Brilho', min: 50, max: 150 },
    { key: 'contrast', label: 'Contraste', min: 50, max: 160 },
    { key: 'saturation', label: 'Saturação', min: 0, max: 200 },
    { key: 'temperature', label: 'Temperatura', min: -100, max: 100 },
    { key: 'shadows', label: 'Sombras', min: 0, max: 100 },
    { key: 'highlights', label: 'Luzes', min: 0, max: 100 },
  ];

  /** Os finos, atrás do botão de avançados. */
  readonly advancedSliders: SliderSpec[] = [
    { key: 'hue', label: 'Matiz', min: -30, max: 30 },
    { key: 'fade', label: 'Desbotado', min: 0, max: 100 },
    { key: 'vignette', label: 'Vinheta', min: 0, max: 100 },
    { key: 'sepia', label: 'Tom sépia', min: 0, max: 100 },
    { key: 'grayscale', label: 'Dessaturar', min: 0, max: 100 },
    { key: 'blur', label: 'Desfoque', min: 0, max: 100 },
  ];

  /** O estado mora no store porque o componente morre ao trocar de modo e a
   * page precisa dele pra salvar o projeto. Os apelidos abaixo existem só pra
   * o template não repetir `store.` em toda linha. */
  readonly image = this.store.image;
  readonly fileName = this.store.fileName;
  readonly format = this.store.format;
  readonly fit = this.store.fit;
  readonly scale = this.store.scale;
  readonly offsetX = this.store.offsetX;
  readonly offsetY = this.store.offsetY;
  readonly bgMode = this.store.bgMode;
  readonly bgColor = this.store.bgColor;
  readonly adjust = this.store.adjust;
  readonly preset = this.store.preset;
  readonly type = this.store.type;
  readonly quality = this.store.quality;
  readonly exportW = this.store.exportW;
  readonly exportH = this.store.exportH;

  readonly denoise = this.store.denoise;
  /** Foto já limpa, do jeito que o resto do desenho consome. `null` enquanto a
   * força for zero (ou enquanto a primeira limpeza não terminou). */
  private readonly cleaned = signal<HTMLCanvasElement | null>(null);
  /** Foto já no tamanho que a saída pede, antes de cor e de limpeza. */
  private readonly prescaled = signal<Source | null>(null);
  /** Foto com a luz da IA já aplicada. */
  private readonly iluminado = signal<Source | null>(null);
  readonly sharpen = this.store.sharpen;
  readonly denoising = signal(false);

  readonly comparing = signal(false);
  /** Alguém está arrastando alguma coisa agora. */
  private readonly interacting = signal(false);
  readonly canUndo = this.store.canUndo;
  readonly canRedo = this.store.canRedo;

  readonly upscale = inject(ImageUpscaleService);
  readonly ampliando = signal(false);
  /** Em qual tentativa está, quando a GPU do serviço obriga a encolher. */
  readonly tentativa = signal(1);
  readonly upscaleErro = signal('');
  readonly recortando = signal(false);
  readonly recorteErro = signal('');
  /** A foto atual veio do recorte: o fundo aparece mesmo com ela cobrindo o quadro. */
  readonly recortada = signal(false);
  readonly luzIa = this.store.luzIa;
  readonly luzForca = this.store.luzForca;
  readonly iluminando = signal(false);
  readonly luzErro = signal('');
  readonly direcaoLuz = signal('esquerda');
  readonly direcoes = [
    { id: 'esquerda', rotulo: 'Esquerda' },
    { id: 'direita', rotulo: 'Direita' },
    { id: 'cima', rotulo: 'Cima' },
    { id: 'baixo', rotulo: 'Baixo' },
  ];
  /** O que a melhoria automática fez da última vez, em uma frase. */
  readonly autoResumo = signal('');

  readonly error = signal('');
  readonly status = signal('');
  readonly dragOver = signal(false);
  readonly converting = signal(false);

  readonly dirty = computed(() => {
    const a = this.adjust();
    return (Object.keys(NEUTRAL) as (keyof Adjustments)[]).some((k) => a[k] !== NEUTRAL[k]);
  });
  private readonly activePreset = computed(() => FILTER_PRESETS.find((p) => p.id === this.preset()) ?? FILTER_PRESETS[0]);

  /** O filtro escolhido descreve o que está na tela? Mexer num controle de cor
   * depois de aplicar um preset deixava o botão marcado como se nada tivesse
   * mudado — a interface dizia "Cinema" pra uma imagem que já não era. */
  readonly presetEdited = computed(() => {
    const target = { ...NEUTRAL, ...this.activePreset().values };
    const current = this.adjust();
    return (Object.keys(NEUTRAL) as (keyof Adjustments)[]).some((k) => current[k] !== target[k]);
  });

  /** Ampliar só acrescenta quando a foto não cobre o que a exportação pede.
   * Numa foto de 4000 px pra um post de 1080 não há o que ganhar — e o modelo
   * ainda recusaria o tamanho. */
  readonly ampliacaoUtil = computed(() => this.upscaling() > 0);

  /** Tamanho da foto de trabalho, em pixels. */
  readonly photoSize = computed(() => {
    const photo = this.image();
    return photo ? sourceOf(photo) : { image: null as unknown as CanvasImageSource, width: 1, height: 1 };
  });

  /** Largura máxima que a foto sustenta neste corte, ou 0 quando a exportação
   * cabe dentro dela. Pedir mais não é erro — mas é bom o usuário saber que
   * está ampliando, não ganhando definição. */
  readonly upscaling = computed(() => {
    const photo = this.image();
    if (!photo) return 0;
    const source = this.photoSize();
    const out = this.store.photoW();
    const r = frameRect(
      source.width, source.height, out, this.store.photoH(),
      this.fit(), this.scale(), this.offsetX(), this.offsetY(),
    );
    if (r.w <= source.width * 1.02) return 0;
    return Math.round((out * source.width) / r.w);
  });

  /** Há algum controle avançado fora do padrão? Sem isso, esconder os seis
   * atrás do botão esconderia junto o motivo de a foto estar daquele jeito. */
  readonly advancedTouched = computed(() => {
    const a = this.adjust();
    return this.advancedSliders.some((s) => a[s.key] !== NEUTRAL[s.key]);
  });

  readonly presetSummary = computed(() =>
    this.presetEdited() ? `${this.activePreset().label} · editado` : this.activePreset().label);

  /** Sobra fundo à mostra no enquadramento atual? Em "Preencher" com a escala
   * cheia a foto cobre tudo e os controles de fundo não mudariam nada — mas
   * diminuir a escala ou arrastar a foto pra fora expõe as bordas, então a
   * conta é a mesma do desenho, não um "é modo Caber?". */
  readonly showsBackground = computed(() => {
    const img = this.image();
    if (!img) return false;
    if (this.recortada()) return true;
    const box = 1000;
    return !coversFrame(
      this.photoSize().width, this.photoSize().height, box, Math.round((box * this.store.photoH()) / this.store.photoW()),
      this.fit(), this.scale(), this.offsetX(), this.offsetY(),
    );
  });

  private readonly prefs = loadPrefs();
  private readonly open = signal<Record<SectionId, boolean>>(this.prefs.sections);
  /** Os seis controles finos ficam atrás de um botão: quatro resolvem quase tudo. */
  readonly advanced = signal(this.prefs.advanced);

  private drag: { id: number; x: number; y: number; dx: number; dy: number; moved: boolean } | null = null;
  /** Arraste de uma foto que está num espaço de foto: reenquadra a foto
   * dentro da caixa, em vez de tirar a caixa do lugar. */
  private photoPan: { pointer: number; id: string; x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
  /** Arraste de texto/figurinha: posição inicial em fração do quadro. */
  private overlayDrag: {
    pointer: number; id: string; x: number; y: number; moved: boolean; again: boolean;
    /** Posição de cada camada selecionada no começo do arraste. */
    starts: Map<string, { x: number; y: number }>;
    /** Caixa da seleção no começo do arraste, pras guias magnéticas. */
    box: FracBox | null;
    additive: boolean;
  } | null = null;
  /** Caixa de seleção sendo desenhada (em px do canvas da prévia). */
  private marquee: {
    pointer: number; x0: number; y0: number; additive: boolean; slotClick: boolean; moved: boolean; base: string[];
  } | null = null;
  readonly marqueeRect = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  /** Arraste da alça do canto: tamanho proporcional à distância do centro. */
  private resize: { pointer: number; id: string; cx: number; cy: number; dist: number; size: number; moved: boolean } | null = null;
  /** Mostra as faixas que a interface do Instagram cobre no story. */
  readonly safeArea = signal(true);
  /** Grade da prévia (colunas por post e linhas), guardada neste aparelho. */
  readonly grid = signal(loadGrid());
  /** Réguas em volta do post, em px do arquivo final. */
  readonly rulers = signal(loadRulers());
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private boxes: OverlayBox[] = [];
  private readonly fontTick = signal(0);
  private readonly fonts = inject(FontLibrary);
  readonly slidesMax = 10;
  batching = signal('');
  /** Dedos (ou ponteiros) em cima do palco agora. Dois viram pinça. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { mode: 'foto' | 'vista'; distance: number; scale: number; zoom: number; mid: { x: number; y: number } } | null = null;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;
  private sharpenTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Recorte intermediário reaproveitado pelas miniaturas. */
  private readonly baseCanvas = document.createElement('canvas');
  private frame: number | null = null;
  private worker: Worker | null = null;
  private denoiseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Identifica a última limpeza pedida, pra descartar resposta atrasada. */
  private denoiseJob = 0;

  constructor() {
    // Réguas: redesenhadas quando o post muda de tamanho ou de lugar na tela.
    effect(() => {
      const top = this.rulerTopRef()?.nativeElement;
      const left = this.rulerLeftRef()?.nativeElement;
      this.canvasCssW(); this.viewZoom(); this.scrollTick(); this.stageSize();
      const slides = this.store.slides(), w = this.exportW(), h = this.exportH();
      if (!top || !left) return;
      requestAnimationFrame(() => this.drawRulers(top, left, slides, w, h));
    });
    // O palco é medido pra o post caber nele (zoom 1) e crescer a partir daí.
    effect((onCleanup) => {
      const stage = this.stageRef()?.nativeElement;
      if (!stage) return;
      const measure = () => {
        const cs = getComputedStyle(stage);
        const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const cur = untracked(this.stageSize);
        if (!cur || Math.abs(cur.w - w) > 0.5 || Math.abs(cur.h - h) > 0.5) this.stageSize.set({ w, h });
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(stage);
      onCleanup(() => ro.disconnect());
    });
    // Fontes dos textos: carregadas antes de desenhar, e a prévia refeita.
    effect(() => {
      const overlays = this.store.overlays();
      void ensureOverlayFonts(overlays, this.fonts).then(() => this.fontTick.update((v) => v + 1));
      void ensureOverlayAssets(overlays).then(() => this.fontTick.update((v) => v + 1));
    });
    // Padrão de fundo do modelo: mesmo esquema das fontes.
    effect(() => {
      const pattern = this.store.bgPattern();
      if (pattern) void ensureBrandAssets([pattern]).then(() => this.fontTick.update((v) => v + 1));
    });
    // Foto mandada por outro modo ("Enviar para…").
    effect(() => {
      const file = this.store.pendingImport();
      if (!file) return;
      this.store.pendingImport.set(null);
      untracked(() => void this.loadFile(file));
    });
    // Redesenha a prévia sempre que qualquer entrada muda — um efeito só, já que
    // todo o estado do render mora em signals.
    effect(() => {
      const canvas = this.previewRef()?.nativeElement;
      const compare = this.comparing();
      const img = this.image();
      // Comparando, o que aparece é a foto como ela entrou: mesmo enquadramento
      // e mesmo formato, sem ajuste de cor e sem a redução de ruído.
      const visible = this.store.photoVisible();
      const source = !visible ? null : compare ? (img ? sourceOf(img) : null) : this.currentSource();
      const amount = this.sharpen();
      // Modelo sem foto ainda: desenha o fundo e as camadas, com o aviso no
      // espaço da foto.
      if (!canvas || (!source && !this.store.hasContent())) return;
      this.fontTick();
      const dpr = Math.min(MAX_PREVIEW_DPR, globalThis.devicePixelRatio || 1);
      // Enquanto a mão está num controle a prévia desenha menor: a conta de cor
      // agora é por pixel, e resposta imediata vale mais que nitidez num quadro
      // que vai ser substituído em seguida. Ao parar, volta ao tamanho cheio.
      // Com zoom, o canvas acompanha o tamanho na tela pra não borrar.
      const cssW = Math.max(PREVIEW_CSS_WIDTH, this.canvasCssW() ?? 0);
      const ratio = this.store.frameRatio();
      const full = Math.min(cssW * dpr, Math.sqrt(MAX_PREVIEW_PIXELS * ratio));
      const w = Math.round(full * (this.interacting() ? 0.55 : 1));
      canvas.width = w;
      canvas.height = Math.round(w / this.store.frameRatio());
      paintFrame(canvas, source, { ...this.frameOptions(compare ? { ...NEUTRAL } : this.adjust()), placeholder: true });
      const overlays = this.store.overlays();
      const selection = this.store.selection();
      const ctx2 = canvas.getContext('2d')!;
      this.boxes = compare ? [] : drawOverlays(ctx2, canvas.width, canvas.height, overlays, this.fonts, selection);
      const cw = canvas.width, ch = canvas.height;
      const frac: FracBox[] = this.boxes.map((b) => ({ id: b.id, cx: b.cx / cw, cy: b.cy / ch, w: b.w / cw, h: b.h / ch, rotation: b.rotation, locked: b.locked }));
      untracked(() => this.store.overlayBoxes.set(frac));
      this.drawSlideGuides(ctx2, cw, ch);
      if (this.safeArea() && this.format().id === 'story' && !compare) this.drawSafeArea(ctx2, cw, ch);
      const grid = this.grid();
      if (grid.on && !compare) this.drawGrid(ctx2, cw, ch, grid.cols, grid.rows);
      if (!compare) this.drawUserGuides(ctx2, cw, ch, this.store.userGuides());
      this.drawAlignGuides(ctx2, cw, ch, this.store.guides());
      if (!compare) this.drawSelectionChrome(ctx2, selection, this.marqueeRect());
      // A nitidez custa uns 50 ms e não pode engasgar quem arrasta um controle:
      // a imagem aparece na hora e ganha o acabamento quando a mão para.
      if (this.sharpenTimer !== null) clearTimeout(this.sharpenTimer);
      if (amount > 0 && !compare) {
        this.sharpenTimer = setTimeout(() => this.applySharpen(canvas), 160);
      }
    });

    // Recurso que depende de chave não deve virar botão sem antes saber se está
    // ligado. A pergunta é refeita ao entrar no modo, porque a chave pode ter
    // sido cadastrada em Configurações há dois cliques.
    void this.upscale.verificar(true);

    // A foto é reduzida UMA vez, no tamanho que a exportação precisa, e é
    // dessa redução que saem prévia, miniaturas e arquivo final. Antes cada
    // desenho reduzia a foto inteira de novo, num passo só — o jeito mais
    // rápido de serrilhar textura fina.
    effect(() => {
      const photo = this.image();
      const needed = this.neededWidth();
      if (!photo) {
        this.prescaled.set(null);
        return;
      }
      const source = sourceOf(photo);
      // Perto o bastante do tamanho da foto: reduzir seria perder à toa.
      if (needed >= source.width * 0.9) {
        this.prescaled.set(source);
        return;
      }
      // Diferença pequena não paga uma redução nova: aproximar aos poucos com a
      // roda do mouse geraria uma cadeia delas.
      const current = untracked(this.prescaled);
      if (current && current.width >= needed && current.width <= needed * 1.3) return;
      const canvas = stepDownscale(source, needed, (needed * source.height) / source.width);
      this.prescaled.set({ image: canvas, width: canvas.width, height: canvas.height });
    });

    // A luz da IA entra sobre a foto já reduzida e limpa, antes de cor e
    // acabamento: é iluminação, e cor se decide sobre a foto iluminada. O
    // resultado fica guardado, então mexer na intensidade não refaz a conta
    // toda nem chama o serviço de novo.
    effect(() => {
      const limpa = this.cleaned();
      const base: Source | null = limpa
        ? { image: limpa, width: limpa.width, height: limpa.height }
        : this.prescaled();
      const mapaUrl = this.luzIa();
      const forca = this.luzForca();
      if (!base || !mapaUrl || forca <= 0) {
        this.iluminado.set(null);
        return;
      }
      this.schedule(() => void this.aplicarLuzDaIa(base, mapaUrl, forca));
    });

    // A limpeza é cara, então espera a mão sair do controle antes de começar —
    // e roda sobre a foto já reduzida, que é onde o ruído ainda importa.
    effect(() => {
      const source = this.prescaled();
      const strength = this.denoise();
      if (this.denoiseTimer !== null) clearTimeout(this.denoiseTimer);
      if (!source || strength <= 0) {
        this.denoiseJob++;
        this.denoising.set(false);
        this.cleaned.set(null);
        return;
      }
      this.denoising.set(true);
      this.denoiseTimer = setTimeout(() => void this.runDenoise(source, strength), 250);
    });

    // As miniaturas dos filtros mostram a própria foto, no enquadramento atual.
    // Elas não dependem dos ajustes de cor: cada uma desenha os *seus* valores,
    // então mexer num controle não obriga a redesenhar as 34.
    effect(() => {
      const refs = this.presetRefs();
      const source = this.currentSource();
      // As miniaturas mostram a foto, não o modelo em volta dela.
      const slot = this.store.slot();
      const ratio = slot ? (slot.w * this.store.frameRatio()) / slot.h : this.store.frameRatio();
      const frame = { ...this.frameOptions(NEUTRAL), slot: null, bgPattern: '', ratio };
      if (!refs.length || !source) return;
      this.schedule(() => this.paintThumbs(refs, source, frame));
    });
  }

  /** Roda a limpeza no worker e guarda o resultado. Um pedido novo invalida o
   * anterior: quem arrasta o controle gera vários, e só o último interessa. */
  private async runDenoise(photo: Source, strength: number): Promise<void> {
    const job = ++this.denoiseJob;
    const w = photo.width;
    const h = photo.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      this.denoising.set(false);
      return;
    }
    ctx.drawImage(photo.image, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    try {
      const pixels = await this.denoiseInWorker(imageData, strength);
      if (job !== this.denoiseJob) return;
      ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
      this.cleaned.set(canvas);
    } catch {
      // Sem worker (navegador antigo, bloqueio de módulo) o modo segue vivo com
      // a foto original: é melhor perder a limpeza do que travar o editor.
      if (job === this.denoiseJob) this.cleaned.set(null);
    } finally {
      if (job === this.denoiseJob) this.denoising.set(false);
    }
  }

  private denoiseInWorker(data: ImageData, strength: number): Promise<Uint8ClampedArray<ArrayBuffer>> {
    this.worker ??= new Worker(new URL('./denoise.worker', import.meta.url), { type: 'module' });
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const onMessage = ({ data: result }: MessageEvent<{ buffer: ArrayBuffer }>) => {
        cleanup();
        resolve(new Uint8ClampedArray(result.buffer) as Uint8ClampedArray<ArrayBuffer>);
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || 'Falha ao reduzir o ruído.'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      const buffer = data.data.buffer as ArrayBuffer;
      worker.postMessage({ buffer, width: data.width, height: data.height, strength }, [buffer]);
    });
  }

  /** A foto que o desenho usa: a limpa quando há redução de ruído ligada e
   * pronta, senão a original. */
  private currentSource(): Source | null {
    const comLuz = this.iluminado();
    if (comLuz) return comLuz;
    const clean = this.cleaned();
    if (clean) return { image: clean, width: clean.width, height: clean.height };
    const pre = this.prescaled();
    if (pre) return pre;
    const photo = this.image();
    return photo ? sourceOf(photo) : null;
  }

  /** Quantos pixels de foto a exportação vai realmente usar. Sai da mesma conta
   * do desenho: o retângulo em que a foto cai, medido no canvas de saída. Uma
   * folga de 15% evita refazer a redução a cada arrastão. */
  private neededWidth(): number {
    const photo = this.image();
    if (!photo) return 0;
    const source = sourceOf(photo);
    // Deslocamento de propósito zerado: arrastar a foto não muda quantos pixels
    // dela são usados, e ler esses sinais aqui refaria a redução a cada
    // movimento do ponteiro.
    const r = frameRect(
      source.width, source.height, this.store.photoW(), this.store.photoH(),
      this.fit(), this.scale(), 0, 0,
    );
    const needed = Math.ceil((r.w * 1.15) / 200) * 200;
    return Math.max(200, Math.min(source.width, needed));
  }

  /** Aplica a nitidez no canvas já montado — é a última etapa, depois de a
   * imagem estar no tamanho final, porque nitidez é um efeito de pixel. */
  private applySharpen(canvas: HTMLCanvasElement): void {
    const amount = this.sharpen();
    if (amount <= 0) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    sharpenRgba(data.data, canvas.width, canvas.height, amount);
    ctx.putImageData(data, 0, 0);
  }

  /** Junta o enquadramento atual com um conjunto de ajustes. */
  private frameOptions(adjust: Adjustments): FrameOptions {
    return {
      adjust,
      fit: this.fit(),
      scale: this.scale(),
      dx: this.offsetX(),
      dy: this.offsetY(),
      bgMode: this.bgMode(),
      bgColor: this.bgColor(),
      bgPattern: this.store.bgPattern(),
      slot: this.store.slot(),
    };
  }

  /** Agrupa redesenhos num quadro só: arrastar a foto dispara o efeito a cada
   * movimento do ponteiro, e são dezenas de miniaturas. */
  private schedule(work: () => void): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      work();
    });
  }

  private paintThumbs(
    refs: readonly ElementRef<HTMLCanvasElement>[],
    photo: Source,
    frame: FrameOptions & { ratio: number },
  ): void {
    // O recorte sem cor nenhuma é desenhado uma vez; cada miniatura só repinta
    // esse recorte com os seus ajustes, que é barato mesmo com a lista cheia.
    const baseW = 160;
    const base = this.baseCanvas;
    base.width = baseW;
    base.height = Math.max(1, Math.round(baseW / frame.ratio));
    paintFrame(base, photo, frame);
    const source: Source = { image: base, width: base.width, height: base.height };

    const thumbW = 104;
    for (const ref of refs) {
      const canvas = ref.nativeElement;
      const id = canvas.dataset['preset'];
      const values = FILTER_PRESETS.find((p) => p.id === id)?.values;
      if (!values) continue;
      canvas.width = thumbW;
      canvas.height = Math.max(1, Math.round(thumbW / frame.ratio));
      // O recorte já cobre o quadro inteiro, então a miniatura só precisa de cor.
      paintFrame(canvas, source, {
        adjust: { ...NEUTRAL, ...values },
        fit: 'cover', scale: 1, dx: 0, dy: 0,
        bgMode: 'cor', bgColor: frame.bgColor,
      });
    }
  }

  /** Mede a foto e escreve os ajustes. É um passo de histórico como qualquer
   * outro: Ctrl+Z desfaz, e "Antes" compara com o original. */
  melhorarAuto(): void {
    const photo = this.image();
    if (!photo) return;

    const dados = this.amostraParaAnalise(photo);
    if (!dados) return;

    // Quanto a foto encolhe até o tamanho do post: é o que define a nitidez a
    // devolver, porque é a redução que come o micro-contraste.
    const source = sourceOf(photo);
    const r = frameRect(
      source.width, source.height, this.store.photoW(), this.store.photoH(),
      this.fit(), this.scale(), 0, 0,
    );
    const reducao = r.w > 0 ? source.width / r.w : 1;

    const auto = melhorarAutomaticamente(dados.pixels, dados.width, dados.height, reducao);
    this.adjust.set(auto.adjust);
    this.preset.set('original');
    this.denoise.set(auto.denoise);
    this.sharpen.set(auto.sharpen);
    this.autoResumo.set(descreverAuto(auto));
    this.commit();
  }

  /** Pixels para medir. Foto grande é analisada por um recorte do meio em
   * resolução nativa, e não reduzida: reduzir faria a média do grão e o ruído
   * medido sairia menor do que é. */
  private amostraParaAnalise(photo: PhotoSource): { pixels: Uint8ClampedArray; width: number; height: number } | null {
    const source = sourceOf(photo);
    const maxLado = 2000;
    const w = Math.min(source.width, maxLado);
    const h = Math.min(source.height, maxLado);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(
      source.image,
      Math.round((source.width - w) / 2), Math.round((source.height - h) / 2), w, h,
      0, 0, w, h,
    );
    const data = ctx.getImageData(0, 0, w, h);
    return { pixels: data.data, width: w, height: h };
  }

  /** Desenha a foto multiplicada pelo mapa de luz. Aqui a luz da IA entra na
   * imagem — e é só isto que entra dela. */
  private async aplicarLuzDaIa(base: Source, mapaUrl: string, forca: number): Promise<void> {
    try {
      const mapa = await loadImageElement(mapaUrl);
      const mw = mapa.naturalWidth;
      const mh = mapa.naturalHeight;
      const bruto = pixelsEm(mapa, mw, mh);
      if (!bruto) return;

      const razao = new Float32Array(mw * mh);
      for (let i = 0; i < razao.length; i++) razao[i] = bruto[i * 4] / 128;

      const canvas = document.createElement('canvas');
      canvas.width = base.width;
      canvas.height = base.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(base.image, 0, 0);
      const dados = ctx.getImageData(0, 0, base.width, base.height);
      aplicarRazaoDeLuz(dados.data, base.width, base.height, razao, mw, mh, forca);
      ctx.putImageData(dados, 0, 0);

      this.iluminado.set({ image: canvas, width: canvas.width, height: canvas.height });
    } catch {
      // Mapa ilegível não pode derrubar a prévia: segue sem a luz da IA.
      this.iluminado.set(null);
    }
  }

  /** Pede a luz à IA e guarda só o mapa de razão — a foto continua a sua.
   *
   * A imagem enviada é pequena de propósito: como só a luz borrada é
   * aproveitada, mandar grande custaria mais pelo mesmo resultado. */
  async iluminarComIa(): Promise<void> {
    const photo = this.image();
    if (!photo || this.iluminando()) return;
    this.iluminando.set(true);
    this.luzErro.set('');
    try {
      const source = sourceOf(photo);
      const enviado = fitWithinPixels(source.width, source.height, 700_000);
      const pequena = stepDownscale(source, enviado.width, enviado.height);
      const resposta = await this.upscale.reiluminar(
        pequena.toDataURL('image/jpeg', 0.92), this.direcaoLuz());

      const iluminada = await loadImageElement(resposta);
      const mapa = this.extrairLuz(source, iluminada);
      if (!mapa) throw new Error('Não consegui ler a luz que voltou.');

      this.luzIa.set(mapa);
      this.commit();
    } catch (e) {
      this.luzErro.set(e instanceof Error ? e.message : 'Não consegui criar a luz agora.');
    } finally {
      this.iluminando.set(false);
    }
  }

  /** Compara as duas imagens no MESMO tamanho pequeno e guarda a razão entre
   * as luminâncias como um PNG cinza — 128 é "não mexe". É neste tamanho que o
   * produto redesenhado pela IA deixa de existir e só a luz sobrevive. */
  private extrairLuz(source: Source, iluminada: HTMLImageElement): string | null {
    const { largura, altura } = tamanhoDaRazao(source.width, source.height);
    const original = pixelsEm(source.image, largura, altura);
    const daIa = pixelsEm(iluminada, largura, altura);
    if (!original || !daIa) return null;

    const razao = razaoDeLuz(original, daIa, largura, altura);

    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const saida = ctx.createImageData(largura, altura);
    for (let i = 0; i < razao.length; i++) {
      // 128 = razão 1. A escala cobre de 0 a 2, que é mais do que os limites
      // que a própria razão já impõe.
      const v = Math.max(0, Math.min(255, Math.round(razao[i] * 128)));
      saida.data[i * 4] = v;
      saida.data[i * 4 + 1] = v;
      saida.data[i * 4 + 2] = v;
      saida.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(saida, 0, 0);
    return canvas.toDataURL('image/png');
  }

  onLuzForca(event: Event): void {
    this.touch();
    this.luzForca.set(Number((event.target as HTMLInputElement).value));
  }

  removerLuzIa(event: Event): void {
    event.preventDefault();
    this.luzIa.set('');
    this.luzErro.set('');
    this.commit();
  }

  /** Manda a foto de trabalho pro serviço de ampliação e troca pela que voltar.
   * O enquadramento e os ajustes ficam: mudou a resolução, não a foto. */
  async ampliarComIa(): Promise<void> {
    const photo = this.image();
    if (!photo || this.ampliando() || !this.ampliacaoUtil()) return;
    this.ampliando.set(true);
    this.tentativa.set(1);
    this.upscaleErro.set('');
    try {
      // O modelo roda numa GPU e recusa foto acima de ~2 megapixels. Reduzir
      // aqui é melhor que descobrir isso depois do upload — e não custa
      // resolução, porque só chega aqui foto que precisa de MAIS pixel.
      const source = sourceOf(photo);
      const ampliada = await this.upscale.ampliarEncolhendo(
        (maxPixels) => {
          const cabe = fitWithinPixels(source.width, source.height, maxPixels);
          return stepDownscale(source, cabe.width, cabe.height).toDataURL('image/jpeg', 0.95);
        },
        this.upscale.maxPixelsEntrada(),
        2,
        (tentativa) => this.tentativa.set(tentativa),
      );
      const img = await loadImageElement(ampliada);
      this.store.replacePhoto(img, ampliada, 'image/png');
    } catch (e) {
      this.upscaleErro.set(e instanceof Error ? e.message : 'Não consegui ampliar a foto agora.');
    } finally {
      this.ampliando.set(false);
    }
  }

  /** Troca a foto pelo recorte da IA e põe um fundo de cor por trás. */
  async recortarComIa(): Promise<void> {
    const photo = this.image();
    if (!photo || this.recortando()) return;
    this.recortando.set(true);
    this.recorteErro.set('');
    try {
      const recorte = await aiCutout(this.upscale, photo);
      const url = recorte.toDataURL('image/png');
      this.store.replacePhoto(await loadImageElement(url), url, 'image/png');
      this.recortada.set(true);
      if (this.bgMode() !== 'cor') this.setBgMode('cor');
    } catch (e) {
      this.recorteErro.set(e instanceof Error ? e.message : 'Não consegui remover o fundo agora.');
    } finally {
      this.recortando.set(false);
    }
  }

  // --- desfazer e comparar ----------------------------------------------------

  /** Avisa que há interação em curso; ao parar, a prévia volta ao tamanho cheio. */
  private touch(): void {
    this.interacting.set(true);
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.interacting.set(false), 180);
  }

  /** Fecha um passo do histórico. O template chama isto ao soltar um controle. */
  commit(): void { this.store.commit(); }

  undo(): void { this.store.undo(); }

  redo(): void { this.store.redo(); }

  startCompare(event?: Event): void {
    event?.preventDefault();
    if (this.image()) this.comparing.set(true);
  }

  stopCompare(): void { this.comparing.set(false); }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    // Não sequestra atalho de quem está digitando num campo de texto.
    if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') return;
    if (target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;

    const key = event.key.toLowerCase();
    // Ctrl + / − / 0: zoom da vista (no lugar do zoom da página inteira).
    if ((event.ctrlKey || event.metaKey) && this.store.hasContent()) {
      if (key === '=' || key === '+' || event.code === 'NumpadAdd') { event.preventDefault(); this.zoomStep(1); return; }
      if (key === '-' || event.code === 'NumpadSubtract') { event.preventDefault(); this.zoomStep(-1); return; }
      if (key === '0' || event.code === 'Numpad0') { event.preventDefault(); this.setViewZoom(1); return; }
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    // A tecla solta só vale fora de campo: digitar a largura de exportação não
    // pode piscar a comparação.
    const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
    const selOverlay = this.store.selectedOverlay();
    const mod = event.ctrlKey || event.metaKey;
    if (!typing && mod && key === 'a' && this.store.hasContent()) {
      event.preventDefault();
      this.store.selectAll();
      this.tab.set('texto');
      return;
    }
    if (!typing && mod && key === 'd' && selOverlay) {
      event.preventDefault();
      this.store.duplicateSelected();
      return;
    }
    if (!typing && key === 'escape' && selOverlay) {
      this.store.select(null);
      return;
    }
    const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (selOverlay && !typing && arrows[key]) {
      // Seta move 1 px do arquivo final; com Shift, 10. Vale pra todas as
      // selecionadas.
      event.preventDefault();
      const [ax, ay] = arrows[key];
      const step = event.shiftKey ? 10 : 1;
      this.store.moveSelectedBy((ax * step) / this.store.frameW(), (ay * step) / this.exportH());
      if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
      this.nudgeTimer = setTimeout(() => this.commit(), 400);
      return;
    }
    if (selOverlay && !typing && (key === 'delete' || key === 'backspace')) {
      event.preventDefault();
      this.store.removeSelected();
      return;
    }
    if (key === 'c' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat) {
      this.startCompare();
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === 'c') this.stopCompare();
  }

  /** A janela perder o foco com a tecla apertada deixaria a comparação ligada. */
  @HostListener('window:blur')
  onBlur(): void { this.stopCompare(); }

  isOpen(id: SectionId): boolean { return this.open()[id]; }

  toggle(id: SectionId): void {
    this.open.update((o) => ({ ...o, [id]: !o[id] }));
    this.prefs.sections = this.open();
    this.savePrefs();
  }

  toggleAdvanced(): void {
    this.advanced.update((v) => !v);
    this.prefs.advanced = this.advanced();
    this.savePrefs();
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch { /* prefs são só conveniência */ }
  }

  // --- foto -----------------------------------------------------------------

  readonly accept = FILE_ACCEPT;

  /** Abre o seletor. Com `all`, sem filtro nenhum: diálogo que insiste em
   * esconder HEIC deixa de ter o que esconder, e a validação de tipo continua
   * acontecendo depois, na leitura do arquivo. */
  pick(input: HTMLInputElement, all = false): void {
    if (all || isTouchPicker()) input.removeAttribute('accept');
    else input.setAttribute('accept', FILE_ACCEPT);
    input.click();
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.loadFile(file);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(): void { this.dragOver.set(false); }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    // Várias fotos de uma vez viram camadas (no carrossel, uma por post);
    // uma só continua sendo a foto do post.
    // Num modelo com espaços de foto, qualquer foto vai pros espaços.
    if (files.length > 1 || (files[0] && this.hasPhotoSpots())) void this.addPhotoFiles(files, !this.store.hasContent() || this.store.slides() > 1);
    else if (files[0]) void this.loadFile(files[0]);
  }

  /** Arquivos escolhidos no botão "Adicionar fotos". */
  onPhotosInput(event: Event, perSlide: boolean): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.addPhotoFiles(files, perSlide);
  }

  pickPhotos(perSlide: boolean, startSpot?: string): void {
    this.photosPerSlide = perSlide;
    this.photosStartSpot = startSpot;
    this.photosInputRef()?.nativeElement.click();
  }
  photosPerSlide = false;
  /** Espaço de foto clicado no palco: as fotos escolhidas começam por ele. */
  private photosStartSpot: string | undefined;

  readonly photoZoomMax = PHOTO_ZOOM_MAX;
  readonly photoZoomMin = PHOTO_ZOOM_MIN;
  /** A camada de foto selecionada (sozinha), pra escala dela na barra. */
  readonly selectedPhoto = computed(() => {
    if (this.store.selection().length !== 1) return null;
    const o = this.store.overlays().find((x) => x.id === this.store.selectedOverlay());
    return o?.kind === 'foto' ? o : null;
  });

  setPhotoZoom(zoom: number, commit = true): void {
    const ph = this.selectedPhoto();
    if (!ph) return;
    this.store.patchOverlay(ph.id, { zoom: clamp(zoom, PHOTO_ZOOM_MIN, PHOTO_ZOOM_MAX) });
    if (commit) this.commit();
  }

  resetPhotoFraming(): void {
    const ph = this.selectedPhoto();
    if (!ph) return;
    this.store.patchOverlay(ph.id, { zoom: 1, panX: 0, panY: 0 });
    this.commit();
  }

  /** O post tem espaços de foto (modelo de entregas)? */
  readonly hasPhotoSpots = computed(() => this.store.overlays().some(isPlaceholder));
  private readonly emptySpotIds = computed(() => new Set(emptyPlaceholders(this.store.overlays(), this.store.slides()).map((p) => p.id)));
  readonly emptySpots = computed(() => emptyPlaceholders(this.store.overlays(), this.store.slides()).length);

  /** Fotos como camadas, cada uma no seu tamanho. Com `perSlide`, uma em cada
   * post do carrossel (e o carrossel cresce pra caber, até 10); sem, todas no
   * post da camada selecionada, levemente em cascata. */
  async addPhotoFiles(files: File[], perSlide: boolean): Promise<void> {
    const list = files.filter((f) => f.type.startsWith('image/') || isHeicFile(f));
    if (!list.length) return;
    this.status.set(`Preparando ${list.length} foto(s)…`);
    const prepared: { src: string; aspect: number }[] = [];
    for (const f of list) {
      try {
        prepared.push(await preparePhotoLayer(f));
      } catch {
        // foto que não abre fica de fora; as outras seguem
      }
    }
    if (!prepared.length) {
      this.status.set('Não consegui abrir essas fotos.');
      return;
    }
    const slidesMax = this.slidesMax;
    // Modelo com espaços de foto: cada foto entra num espaço, recortada pro
    // tamanho dele; sobrando foto, o carrossel ganha posts iguais ao último.
    if (this.hasPhotoSpots()) {
      const start = this.photosStartSpot;
      this.photosStartSpot = undefined;
      await preloadPhotos(prepared.map((p) => p.src));
      const { placed, added } = this.store.fillPhotoSlots(prepared, slidesMax, start);
      this.store.select(null);
      const left = prepared.length - placed;
      this.status.set(!placed
        ? 'Não há espaço vazio a partir daí, e o carrossel já está no máximo (10 posts).'
        : `${placed} foto(s) nos espaços${added ? `; o carrossel ganhou ${added} post(s)` : ''}.`
          + (left > 0 ? ` ${left} ficaram de fora: o carrossel chegou a ${slidesMax} posts.` : ' Clique numa foto pra ajustar; troque os nomes com duplo clique.'));
      return;
    }
    if (perSlide && prepared.length > this.store.slides()) {
      this.store.slides.set(Math.min(slidesMax, prepared.length));
    }
    const n = this.store.slides();
    const W = this.exportW(), H = this.exportH();
    const base = Math.min(W * n, H);
    const sel = this.store.overlays().find((o) => o.id === this.store.selectedOverlay());
    const [s0] = slideRange(sel?.x ?? 0.0001, n);
    const startSlide = Math.round(s0 * n);
    const layers: PhotoOverlay[] = prepared.slice(0, perSlide ? slidesMax : prepared.length).map((p, i) => {
      const slide = perSlide ? i % n : startSlide;
      // Cabe em 80% da largura do post e 80% (carrossel) ou 60% da altura.
      const maxW = W * (perSlide ? 0.84 : 0.6), maxH = H * (perSlide ? 0.8 : 0.6);
      const hPx = Math.min(maxH, maxW / p.aspect);
      const cascade = perSlide ? 0 : i * 0.04;
      return {
        id: uuid(), kind: 'foto', src: p.src, aspect: p.aspect,
        x: (slide + 0.5) / n + cascade / n, y: 0.5 + cascade, size: hPx / base, rotation: 0,
        radius: 0, border: '', borderWidth: 0,
      };
    });
    await ensureOverlayAssets(layers);
    this.store.addOverlays(layers);
    this.tab.set('texto');
    this.status.set(perSlide && layers.length > 1
      ? `${layers.length} fotos, uma em cada post. Arraste pra ajustar; a alça do canto muda o tamanho.`
      : `${layers.length} foto(s) adicionada(s). Arraste pra posicionar; a alça do canto muda o tamanho.`);
  }

  private async loadFile(file: File): Promise<void> {
    this.recortada.set(false);
    const heic = isHeicFile(file);
    if (!heic && !file.type.startsWith('image/')) {
      this.error.set('Esse arquivo não é uma imagem.');
      return;
    }
    try {
      this.error.set('');
      let source: Blob = file;
      if (heic) {
        // O decodificador leva alguns segundos na primeira foto: avisa antes.
        this.converting.set(true);
        this.status.set('Convertendo HEIC…');
        try {
          source = await heicToJpeg(file);
        } finally {
          this.converting.set(false);
          this.status.set('');
        }
      }
      const original = await readAsDataUrl(source);
      const raw = await loadImageElement(original);
      // A foto entra inteira: a redução pro projeto salvo acontece ao salvar, e
      // a redução pro tamanho do post acontece uma vez, mais adiante. Só o
      // absurdo é cortado aqui.
      const natural = sourceOf(raw);
      const photo: PhotoSource = Math.max(natural.width, natural.height) > MAX_WORK_DIMENSION
        ? stepDownscale(
            natural,
            natural.width * (MAX_WORK_DIMENSION / Math.max(natural.width, natural.height)),
            natural.height * (MAX_WORK_DIMENSION / Math.max(natural.width, natural.height)),
          )
        : raw;
      const mime = heic ? 'image/jpeg' : (file.type || 'image/jpeg');
      this.store.setImage(photo, original, heic ? file.name.replace(/\.hei[cf]$/i, '.jpg') : file.name, mime);
      // O aviso "ponha a foto" do modelo já cumpriu o papel.
      this.status.set(this.store.photoVisible() ? '' : 'Este modelo não tem espaço pra foto. Escolha um modelo com foto, ou tire o modelo na aba Foto.');
    } catch (e) {
      this.converting.set(false);
      this.status.set('');
      this.error.set(heic
        ? 'Não consegui converter esse HEIC. Exporte a foto como JPEG e tente de novo.'
        : (e instanceof Error ? e.message : 'Falha ao abrir a imagem.'));
    }
  }

  removeImage(): void {
    // Num modelo, tirar a foto devolve o espaço vazio; o modelo fica.
    if (this.store.templateId()) this.store.removePhoto();
    else this.store.clear();
    this.status.set('');
  }

  /** Modelo aplicado pela galeria: leva o usuário a onde ele vai mexer em
   * seguida — a foto, se o modelo pede uma e ainda não há, ou os textos. */
  onTemplateApplied(t: GalleryEntry): void {
    this.recortada.set(false);
    this.status.set(t.photos
      ? `Modelo "${t.label}" aplicado. Clique em "Pôr fotos" e escolha várias de uma vez — ou clique num espaço tracejado.`
      : t.photo && !this.image()
      ? `Modelo "${t.label}" aplicado. Clique no espaço tracejado pra pôr a foto.`
      : `Modelo "${t.label}" aplicado. Clique num texto pra trocar. Ctrl+Z desfaz.`);
  }

  /** Volta a um post comum: sem espaço de foto, sem padrão e sem as camadas
   * do modelo. Ctrl+Z traz tudo de volta. */
  removeTemplate(): void {
    this.store.templateId.set('');
    this.store.slot.set(null);
    this.store.bgPattern.set('');
    this.store.overlays.set([]);
    this.store.select(null);
    this.store.resetFraming();
    this.commit();
    this.status.set('Modelo retirado. Ctrl+Z traz de volta.');
  }

  setTemplateBg(hex: string): void {
    this.bgMode.set('cor');
    this.bgColor.set(hex);
    this.commit();
  }

  setPattern(id: string): void {
    this.store.bgPattern.set(id);
    this.commit();
  }

  /** O ponto (em px da prévia) cai no espaço da foto do modelo? */
  private inSlot(pt: { x: number; y: number }): boolean {
    const slot = this.store.slot();
    const canvas = this.previewRef()?.nativeElement;
    if (!slot || !canvas) return false;
    const x = pt.x / canvas.width, y = pt.y / canvas.height;
    return x >= slot.x && x <= slot.x + slot.w && y >= slot.y && y <= slot.y + slot.h;
  }

  setFit(fit: FitMode): void {
    this.fit.set(fit);
    this.store.resetFraming();
    this.commit();
  }

  resetFraming(): void {
    this.store.resetFraming();
    this.commit();
  }

  zoomBy(factor: number): void {
    this.scale.update((s) => clamp(s * factor, MIN_SCALE, MAX_SCALE));
    this.commit();
  }

  onWheel(event: WheelEvent): void {
    // Ctrl+roda (e a pinça do trackpad, que chega assim) é zoom da vista.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const factor = Math.abs(event.deltaY) >= 40
        ? (event.deltaY < 0 ? 1.2 : 1 / 1.2)
        : Math.exp(-event.deltaY * 0.01);
      this.setViewZoom(this.viewZoom() * factor, { x: event.clientX, y: event.clientY });
      return;
    }
    const sel = this.store.selectedOverlay();
    const pt = sel ? this.canvasPoint(event) : null;
    if (sel && pt && hitOverlay(this.boxes, pt.x, pt.y) === sel) {
      event.preventDefault();
      const o = this.store.overlays().find((x) => x.id === sel)!;
      if (o.kind === 'foto' && o.slotId) {
        // Foto num espaço: a roda aproxima a foto; a caixa fica.
        this.store.patchOverlay(sel, { zoom: clamp((o.zoom ?? 1) * (event.deltaY < 0 ? 1.08 : 1 / 1.08), PHOTO_ZOOM_MIN, PHOTO_ZOOM_MAX) });
        if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(() => this.commit(), 300);
        return;
      }
      // Forma pode passar do lado menor (uma faixa, um cartão); texto e
      // figurinha não precisam.
      const max = o.kind === 'forma' || o.kind === 'foto' ? 2 : 0.8;
      this.store.patchOverlay(sel, { size: clamp(o.size * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 0.02, max) });
      if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
      this.wheelTimer = setTimeout(() => this.commit(), 300);
      return;
    }
    if (!this.image()) return;
    event.preventDefault();
    this.touch();
    // Uma rolagem contínua é um passo só: o histórico fecha quando ela para.
    this.scale.update((s) => clamp(s * (event.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_SCALE, MAX_SCALE));
    if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.commit(), 300);
  }

  /** Ponto do evento em px do canvas da prévia. */
  private canvasPoint(event: { clientX: number; clientY: number }): { x: number; y: number; box: DOMRect } | null {
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * canvas.width, y: ((event.clientY - box.top) / box.height) * canvas.height, box };
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.store.hasContent()) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // Segundo dedo: vira pinça, seja lá o que o primeiro estava fazendo.
    if (this.pointers.size === 2) {
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    const pt = this.canvasPoint(event);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    // Alça do canto da camada selecionada: redimensiona.
    const handle = pt ? this.handleAt(event) : null;
    if (handle) {
      const o = this.store.overlays().find((x) => x.id === handle.id)!;
      this.resize = { pointer: event.pointerId, id: o.id, cx: handle.cx, cy: handle.cy, dist: Math.max(1, Math.hypot(event.clientX - handle.cx, event.clientY - handle.cy)), size: o.size, moved: false };
      return;
    }
    const hit = pt ? hitOverlay(this.boxes, pt.x, pt.y) : null;
    // Guia das réguas: arrastar move; soltar na régua apaga.
    const guide = hit ? null : this.guideAt(event);
    if (guide !== null) {
      this.guideDrag = { pointer: event.pointerId, index: guide };
      return;
    }
    const onPhoto = !!pt && this.onPhoto(pt);
    // Fora da foto e de qualquer camada (ou com Shift, mesmo em cima da
    // foto): arrastar desenha uma caixa que seleciona tudo que ela toca. Com
    // zoom, sem Shift, arrastar move a vista. Um clique no espaço vazio da
    // foto do modelo abre o seletor.
    if (!hit && (!onPhoto || additive)) {
      const slotClick = !!pt && !this.image() && this.inSlot(pt) && !additive;
      const stage = this.stageRef()?.nativeElement;
      if (this.viewZoom() > 1 && !additive && stage) {
        this.store.select(null);
        this.pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false, slotClick };
        return;
      }
      if (!additive) this.store.select(null);
      if (pt) this.marquee = { pointer: event.pointerId, x0: pt.x, y0: pt.y, additive, slotClick, moved: false, base: [...this.store.selection()] };
      return;
    }
    if (hit) {
      const again = this.store.selectedOverlay() === hit && this.store.selection().length === 1;
      if (additive) this.store.select(hit, true);
      // Clicar numa das selecionadas mantém o grupo (pra arrastar junto).
      else if (!this.store.isSelected(hit)) this.store.select(hit);
      this.tab.set('texto');
      if (!this.store.isSelected(hit)) return;
      const hitLayer = this.store.overlays().find((o) => o.id === hit);
      if (hitLayer?.kind === 'foto' && hitLayer.slotId && !additive && this.store.selection().length === 1) {
        this.photoPan = { pointer: event.pointerId, id: hit, x: event.clientX, y: event.clientY, panX: hitLayer.panX ?? 0, panY: hitLayer.panY ?? 0, moved: false };
        return;
      }
      const ids = this.store.selection();
      const starts = new Map(this.store.overlays().filter((o) => ids.includes(o.id)).map((o) => [o.id, { x: o.x, y: o.y }]));
      const boxes = this.store.overlayBoxes().filter((b) => ids.includes(b.id));
      const box = boxes.length ? (boxes.length === 1 ? boxes[0] : groupBox(boxes, this.store.frameRatio())) : null;
      this.overlayDrag = { pointer: event.pointerId, id: hit, x: event.clientX, y: event.clientY, starts, moved: false, again: again && !additive, box, additive };
      return;
    }
    this.store.select(null);
    this.drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      dx: this.offsetX(), dy: this.offsetY(), moved: false,
    };
  }

  onPointerMove(event: PointerEvent): void {
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (this.guideDrag?.pointer === event.pointerId) {
      this.onGuideMove(event);
      return;
    }
    const pan = this.pan;
    if (pan && pan.id === event.pointerId) {
      const stage = this.stageRef()?.nativeElement;
      const dx = event.clientX - pan.x, dy = event.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
      if (stage && pan.moved) {
        stage.scrollLeft = pan.left - dx;
        stage.scrollTop = pan.top - dy;
      }
      return;
    }
    const pp = this.photoPan;
    if (pp && pp.pointer === event.pointerId) {
      if (!pp.moved && Math.hypot(event.clientX - pp.x, event.clientY - pp.y) < 3) return;
      pp.moved = true;
      const o = this.store.overlays().find((x) => x.id === pp.id);
      const fb = this.store.overlayBoxes().find((b) => b.id === pp.id);
      const rect = this.previewRef()?.nativeElement.getBoundingClientRect();
      if (o?.kind !== 'foto' || !fb || !rect) return;
      const d = photoPanDelta(o, fb.w * rect.width, fb.h * rect.height, event.clientX - pp.x, event.clientY - pp.y);
      this.store.patchOverlay(pp.id, { panX: clamp(pp.panX + d.panX, -1, 1), panY: clamp(pp.panY + d.panY, -1, 1) });
      return;
    }
    const od = this.overlayDrag;
    if (od && od.pointer === event.pointerId) {
      const pt = this.canvasPoint(event);
      if (!pt) return;
      // Um tremido do dedo não é arraste: senão o "toque de novo pra editar"
      // nunca dispararia no celular.
      if (!od.moved && Math.hypot(event.clientX - od.x, event.clientY - od.y) < 3) return;
      od.moved = true;
      let dx = (event.clientX - od.x) / pt.box.width;
      let dy = (event.clientY - od.y) / pt.box.height;
      // Guias magnéticas (Alt solta): a seleção gruda no centro e nas margens
      // do post, nas bordas e centros das outras camadas, na grade e nas
      // guias das réguas.
      let guides: ReturnType<typeof snapBox>['guides'] = [];
      if (od.box && !event.altKey) {
        const moving = { ...od.box, cx: od.box.cx + dx, cy: od.box.cy + dy };
        const others = this.store.overlayBoxes().filter((b) => !od.starts.has(b.id));
        const snap = snapBox(moving, others, this.store.slides(), this.format().ratio, 7 / pt.box.width, 7 / pt.box.height, this.snapTargets());
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides;
      }
      this.store.guides.set(guides);
      this.store.overlays.update((l) => l.map((o) => {
        const st = od.starts.get(o.id);
        return st ? ({ ...o, x: clamp(st.x + dx, 0, 1), y: clamp(st.y + dy, 0, 1) } as Overlay) : o;
      }));
      return;
    }
    const mq = this.marquee;
    if (mq && mq.pointer === event.pointerId) {
      const pt = this.canvasPoint(event);
      if (!pt) return;
      if (!mq.moved && Math.hypot(pt.x - mq.x0, pt.y - mq.y0) < 6) return;
      mq.moved = true;
      const rect = { x: Math.min(mq.x0, pt.x), y: Math.min(mq.y0, pt.y), w: Math.abs(pt.x - mq.x0), h: Math.abs(pt.y - mq.y0) };
      this.marqueeRect.set(rect);
      const inside = this.boxes.filter((b) => !b.locked
        && b.cx + b.w / 2 >= rect.x && b.cx - b.w / 2 <= rect.x + rect.w
        && b.cy + b.h / 2 >= rect.y && b.cy - b.h / 2 <= rect.y + rect.h).map((b) => b.id);
      this.store.selection.set(mq.additive ? [...new Set([...mq.base, ...inside])] : inside);
      return;
    }
    const rz = this.resize;
    if (rz && rz.pointer === event.pointerId) {
      rz.moved = true;
      const o = this.store.overlays().find((x) => x.id === rz.id);
      const dist = Math.hypot(event.clientX - rz.cx, event.clientY - rz.cy);
      const max = o?.kind === 'forma' || o?.kind === 'foto' ? 2 : 0.8;
      this.store.patchOverlay(rz.id, { size: clamp((rz.size * dist) / rz.dist, 0.01, max) });
      return;
    }
    const pinch = this.pinch;
    if (pinch && this.pointers.size === 2) {
      const distance = this.pointerDistance();
      if (pinch.distance <= 0 || distance <= 0) return;
      if (pinch.mode === 'foto') {
        this.touch();
        this.scale.set(clamp((pinch.scale * distance) / pinch.distance, MIN_SCALE, MAX_SCALE));
        return;
      }
      // Pinça fora da foto: zoom da vista, e o meio dos dedos arrasta a vista.
      const mid = this.pointerMid();
      const stage = this.stageRef()?.nativeElement;
      if (stage) {
        stage.scrollLeft -= mid.x - pinch.mid.x;
        stage.scrollTop -= mid.y - pinch.mid.y;
      }
      pinch.mid = mid;
      this.setViewZoom((pinch.zoom * distance) / pinch.distance, mid);
      return;
    }

    const d = this.drag;
    if (!d || d.id !== event.pointerId) return;
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    d.moved = true;
    this.touch();
    // O deslocamento é guardado em fração do quadro pra sobreviver ao zoom da
    // tela — do espaço da foto, quando o modelo tem um.
    const slot = this.store.slot();
    const sw = slot?.w ?? 1, sh = slot?.h ?? 1;
    this.offsetX.set(clamp(d.dx + (event.clientX - d.x) / (box.width * sw), -1, 1));
    this.offsetY.set(clamp(d.dy + (event.clientY - d.y) / (box.height * sh), -1, 1));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.guideDrag?.pointer === event.pointerId) {
      this.onGuideUp(event);
      return;
    }
    if (this.pan?.id === event.pointerId) {
      const { moved, slotClick } = this.pan;
      this.pan = null;
      this.pointers.delete(event.pointerId);
      const input = this.fileInputRef()?.nativeElement;
      if (!moved && slotClick && input) this.pick(input);
      return;
    }
    if (this.marquee?.pointer === event.pointerId) {
      const { moved, slotClick } = this.marquee;
      this.marquee = null;
      this.marqueeRect.set(null);
      this.pointers.delete(event.pointerId);
      const input = this.fileInputRef()?.nativeElement;
      if (!moved && slotClick && input) this.pick(input);
      if (moved && this.store.selection().length) this.tab.set('texto');
      return;
    }
    if (this.resize?.pointer === event.pointerId) {
      const moved = this.resize.moved;
      this.resize = null;
      this.pointers.delete(event.pointerId);
      if (moved) this.commit();
      return;
    }
    if (this.photoPan?.pointer === event.pointerId) {
      this.pointers.delete(event.pointerId);
      const moved = this.photoPan.moved;
      this.photoPan = null;
      if (moved) this.commit();
      return;
    }
    if (this.overlayDrag?.pointer === event.pointerId) {
      this.pointers.delete(event.pointerId);
      this.store.guides.set([]);
      const { moved, again, id, additive } = this.overlayDrag;
      this.overlayDrag = null;
      if (moved) this.commit();
      // Clique num espaço de foto vazio abre o seletor, começando por ele.
      else if (!additive && this.emptySpotIds().has(id)) this.pickPhotos(true, id);
      // Clique (sem arrastar) numa camada de um grupo selecionado fica só com
      // ela; arrastar é que move o grupo todo.
      else if (!additive && this.store.selection().length > 1) this.store.select(id);
      // Tocar de novo num texto já selecionado, sem arrastar, abre a edição —
      // é o que faz o celular (onde duplo clique não é gesto natural) editar.
      else if (again) this.startInlineEdit(id);
      return;
    }
    this.pointers.delete(event.pointerId);
    if (this.pinch && this.pointers.size < 2) {
      const mode = this.pinch.mode;
      this.pinch = null;
      if (mode === 'foto') this.commit();
      // O dedo que sobrou não vira arraste no meio do gesto: ele recomeça só
      // no próximo toque.
      this.drag = null;
      return;
    }
    if (this.drag?.id !== event.pointerId) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) this.commit();
  }

  onDoubleClick(event: MouseEvent): void {
    const pt = this.canvasPoint(event);
    const hit = pt ? hitOverlay(this.boxes, pt.x, pt.y) : null;
    if (hit) this.startInlineEdit(hit);
  }

  /** Abre a caixa de edição em cima do texto, no tamanho e na fonte dele. */
  startInlineEdit(id: string): void {
    const o = this.store.overlays().find((x) => x.id === id);
    const box = this.boxes.find((b) => b.id === id);
    const canvas = this.previewRef()?.nativeElement;
    const stage = canvas?.parentElement;
    if (!o || o.kind !== 'texto' || !box || !canvas || !stage) return;
    const cr = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const k = cr.width / canvas.width;
    const base = Math.min(canvas.width, canvas.height);
    const fam = this.fonts.family(o.fontId);
    this.store.select(id);
    this.inlineEdit.set({
      id, text: o.text,
      left: cr.left - sr.left + stage.scrollLeft + (box.cx - box.w / 2) * k,
      top: cr.top - sr.top + stage.scrollTop + (box.cy - box.h / 2) * k,
      width: box.w * k, height: box.h * k, rows: o.text.split('\n').length,
      fontSize: Math.max(12, o.size * base * k), font: `"${fam.name}", system-ui, sans-serif`, weight: o.bold ? 700 : 400,
      color: o.color.toLowerCase() === '#ffffff' ? '#4D4D4D' : o.color, align: o.align === 'left' ? 'left' : 'center',
    });
    setTimeout(() => {
      const el = this.inlineInputRef()?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  onInlineInput(event: Event): void {
    const ed = this.inlineEdit();
    if (!ed) return;
    const text = (event.target as HTMLTextAreaElement).value;
    this.store.patchOverlay(ed.id, { text });
    this.inlineEdit.set({ ...ed, text, rows: text.split('\n').length });
  }

  onInlineKey(event: KeyboardEvent): void {
    // Enter quebra linha (títulos têm duas); Esc ou Ctrl+Enter terminam.
    event.stopPropagation();
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      (event.target as HTMLTextAreaElement).blur();
    }
  }

  endInlineEdit(): void {
    if (!this.inlineEdit()) return;
    this.inlineEdit.set(null);
    this.commit();
  }

  /** Começa a pinça. Com os dedos em cima da foto, ela muda a escala da foto
   * (como antes); fora dela — ou sem foto —, dá zoom na vista. */
  private startPinch(): void {
    // O que o primeiro dedo fazia termina aqui, pra nada escapar junto.
    if (this.overlayDrag) {
      if (this.overlayDrag.moved) this.commit();
      this.overlayDrag = null;
    }
    if (this.photoPan) {
      if (this.photoPan.moved) this.commit();
      this.photoPan = null;
    }
    this.drag = null;
    this.pan = null;
    this.marquee = null;
    this.marqueeRect.set(null);
    this.resize = null;
    const mid = this.pointerMid();
    const pt = this.canvasPoint({ clientX: mid.x, clientY: mid.y });
    const mode = pt && this.onPhoto(pt) ? 'foto' : 'vista';
    this.pinch = { mode, distance: this.pointerDistance(), scale: this.scale(), zoom: this.viewZoom(), mid };
  }

  private pointerMid(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return a ?? { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** O ponto (em px da prévia) cai em cima da foto que dá pra arrastar? */
  private onPhoto(pt: { x: number; y: number }): boolean {
    if (!this.image() || !this.store.photoVisible()) return false;
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) return false;
    if (pt.x < 0 || pt.y < 0 || pt.x > canvas.width || pt.y > canvas.height) return false;
    return this.store.slot() ? this.inSlot(pt) : true;
  }

  // --- zoom da vista ---------------------------------------------------------

  /** Muda o zoom da vista mantendo parado o ponto sob o cursor (ou o centro). */
  setViewZoom(z: number, anchor?: { x: number; y: number }): void {
    const next = clamp(Number.isFinite(z) ? z : 1, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    const prev = this.viewZoom();
    if (Math.abs(next - prev) < 1e-4) return;
    const stage = this.stageRef()?.nativeElement;
    const canvas = this.previewRef()?.nativeElement;
    if (!stage || !canvas) {
      this.viewZoom.set(next);
      return;
    }
    const sr = stage.getBoundingClientRect();
    const at = anchor ?? { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
    const before = canvas.getBoundingClientRect();
    const fx = (at.x - before.left) / before.width;
    const fy = (at.y - before.top) / before.height;
    this.viewZoom.set(next);
    // O tamanho novo só existe depois que o Angular aplicar a largura: espera
    // o quadro seguinte pra acertar a rolagem.
    requestAnimationFrame(() => {
      const after = canvas.getBoundingClientRect();
      stage.scrollLeft += after.left + fx * after.width - at.x;
      stage.scrollTop += after.top + fy * after.height - at.y;
    });
  }

  zoomStep(dir: 1 | -1): void {
    const z = this.viewZoom();
    const next = dir > 0
      ? VIEW_ZOOM_STEPS.find((s) => s > z + 1e-3)
      : [...VIEW_ZOOM_STEPS].reverse().find((s) => s < z - 1e-3);
    this.setViewZoom(next ?? z);
  }

  /** Distância entre os dois dedos, base da pinça. */
  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // --- formato --------------------------------------------------------------

  setFormat(f: SocialFormat): void {
    this.format.set(f);
    this.exportW.set(f.width);
    this.store.resetFraming();
    this.commit();
  }

  setFormatId(id: string): void {
    const f = this.formats.find((x) => x.id === id);
    if (f) this.setFormat(f);
  }

  /** Escala digitada ou arrastada na barra de controle. */
  setScalePct(pct: number): void {
    const next = clamp(pct / 100, MIN_SCALE, MAX_SCALE);
    if (this.scale() > 0) this.zoomBy(next / this.scale());
  }

  setBgMode(mode: BgMode): void {
    this.bgMode.set(mode);
    this.commit();
  }

  onBgColor(event: Event): void {
    this.bgColor.set((event.target as HTMLInputElement).value);
    this.commit();
  }

  // --- cor ------------------------------------------------------------------

  applyPreset(p: FilterPreset): void {
    this.preset.set(p.id);
    this.adjust.set({ ...NEUTRAL, ...p.values });
    this.commit();
  }

  chipFilter(p: FilterPreset): string {
    return filterString({ ...NEUTRAL, ...p.values }, 0);
  }

  onSlider(key: keyof Adjustments, event: Event): void {
    this.touch();
    const value = Number((event.target as HTMLInputElement).value);
    this.adjust.update((a) => ({ ...a, [key]: value }));
  }

  resetOne(key: keyof Adjustments, event: Event): void {
    event.preventDefault();
    this.adjust.update((a) => ({ ...a, [key]: NEUTRAL[key] }));
    this.commit();
  }

  onSharpen(event: Event): void {
    this.touch();
    this.sharpen.set(Number((event.target as HTMLInputElement).value));
  }

  resetSharpen(event: Event): void {
    event.preventDefault();
    this.sharpen.set(0);
    this.commit();
  }

  onDenoise(event: Event): void {
    this.touch();
    this.denoise.set(Number((event.target as HTMLInputElement).value));
  }

  resetDenoise(event: Event): void {
    event.preventDefault();
    this.denoise.set(0);
    this.commit();
  }

  resetAdjust(): void {
    this.adjust.set({ ...NEUTRAL });
    this.preset.set('original');
    this.autoResumo.set('');
    this.commit();
  }

  display(key: keyof Adjustments): string {
    const v = this.adjust()[key];
    if (key === 'brightness' || key === 'contrast' || key === 'saturation') return `${v}%`;
    if (key === 'hue') return `${v}°`;
    return `${v}`;
  }

  // --- exportação -----------------------------------------------------------

  setType(t: 'jpeg' | 'png'): void { this.type.set(t); }

  onQuality(event: Event): void { this.quality.set(Number((event.target as HTMLInputElement).value)); }

  onExportW(event: Event): void {
    const v = Math.round(Number((event.target as HTMLInputElement).value));
    if (Number.isFinite(v) && v >= 200) this.exportW.set(Math.min(4000, v));
  }

  readonly bridge = inject(ModeBridge);

  /** A imagem final (formato, filtro, ajustes, nitidez, textos), no tamanho
   * de saída — no carrossel, a faixa inteira com todos os posts. */
  private renderFinal(source = this.currentSource(), framing?: Partial<FrameOptions>): HTMLCanvasElement | null {
    if (!source && !this.store.hasContent()) return null;
    if (!this.store.photoVisible()) source = null;
    let w = this.store.frameW();
    let h = this.exportH();
    if (w * h > MAX_EXPORT_PIXELS) {
      const factor = Math.sqrt(MAX_EXPORT_PIXELS / (w * h));
      w = Math.round(w * factor);
      h = Math.round(h * factor);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    paintFrame(canvas, source, { ...this.frameOptions(this.adjust()), ...framing });
    this.applySharpen(canvas);
    drawOverlays(canvas.getContext('2d')!, w, h, this.store.overlays(), this.fonts, null);
    return canvas;
  }

  /** Linhas tracejadas entre os posts do carrossel (só na prévia). */
  setGrid(patch: Partial<GridPrefs>): void {
    this.grid.update((g) => ({ ...g, ...patch }));
    saveLocal(GRID_KEY, this.grid());
  }

  toggleRulers(): void {
    this.rulers.update((v) => !v);
    saveLocal(RULERS_KEY, this.rulers());
  }

  /** Réguas em px do arquivo final. No carrossel a contagem recomeça em
   * cada post, que é como ele vai ser visto. */
  private drawRulers(top: HTMLCanvasElement, left: HTMLCanvasElement, slides: number, postW: number, postH: number): void {
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) return;
    const cr = canvas.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const paint = (rc: HTMLCanvasElement, horizontal: boolean) => {
      const rr = rc.getBoundingClientRect();
      rc.width = Math.max(1, Math.round(rr.width * dpr));
      rc.height = Math.max(1, Math.round(rr.height * dpr));
      const ctx = rc.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rr.width, rr.height);
      const styles = getComputedStyle(rc);
      const ink = styles.color || '#888';
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1;
      ctx.font = '9px system-ui, sans-serif';
      const lengthPx = horizontal ? cr.width : cr.height;
      const totalUnits = horizontal ? postW * slides : postH;
      const pxPerUnit = lengthPx / totalUnits;
      const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
      const step = steps.find((st) => st * pxPerUnit >= 48) ?? 1000;
      const minor = step / 5;
      const origin = horizontal ? cr.left - rr.left : cr.top - rr.top;
      const len = horizontal ? rr.width : rr.height;
      const thick = horizontal ? rr.height : rr.width;
      ctx.beginPath();
      const firstUnit = Math.floor(-origin / pxPerUnit / minor) * minor;
      for (let u = firstUnit; u <= totalUnits + minor; u += minor) {
        const p = origin + u * pxPerUnit;
        if (p < -2 || p > len + 2) continue;
        const inRange = u >= 0 && u <= totalUnits;
        const local = horizontal ? ((u % postW) + postW) % postW : u;
        const major = Math.abs(local % step) < 1e-6 || (horizontal && Math.abs(local) < 1e-6);
        const tick = !inRange ? 3 : major ? thick * 0.55 : thick * 0.25;
        const q = Math.round(p) + 0.5;
        if (horizontal) { ctx.moveTo(q, thick); ctx.lineTo(q, thick - tick); }
        else { ctx.moveTo(thick, q); ctx.lineTo(thick - tick, q); }
        // Perto do fim de um post o rótulo encavalaria com o "0" do seguinte.
        const crowded = horizontal && slides > 1 && local > postW - step * 0.7 && u < totalUnits;
        if (major && inRange && !crowded) {
          // No fim da faixa mostra a largura do post, não um zero.
          const label = String(Math.round(horizontal && u === totalUnits ? postW : local));
          if (horizontal) ctx.fillText(label, q + 2, 9);
          else {
            ctx.save();
            ctx.translate(9, q - 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }
      ctx.stroke();
      // Divisa entre os posts do carrossel.
      if (horizontal && slides > 1) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#2d7ff9';
        ctx.beginPath();
        for (let i = 1; i < slides; i++) {
          const q = Math.round(origin + i * postW * pxPerUnit) + 0.5;
          ctx.moveTo(q, 0);
          ctx.lineTo(q, thick);
        }
        ctx.stroke();
      }
    };
    paint(top, true);
    paint(left, false);
  }

  /** Fração do quadro sob o ponteiro, num eixo. */
  private fracAt(event: { clientX: number; clientY: number }, axis: 'x' | 'y'): number | null {
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return axis === 'x' ? (event.clientX - r.left) / r.width : (event.clientY - r.top) / r.height;
  }

  /** Puxar da régua cria uma guia, que segue o ponteiro até ser solta. */
  onRulerDown(event: PointerEvent, axis: 'x' | 'y'): void {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    const pos = this.fracAt(event, axis) ?? 0;
    this.store.userGuides.update((l) => [...l, { axis, pos }]);
    this.guideDrag = { pointer: event.pointerId, index: this.store.userGuides().length - 1 };
  }

  onGuideMove(event: PointerEvent): void {
    const gd = this.guideDrag;
    if (!gd || gd.pointer !== event.pointerId) return;
    const g = this.store.userGuides()[gd.index];
    if (!g) return;
    let pos = this.fracAt(event, g.axis) ?? g.pos;
    // A guia gruda no centro do post e nas margens, pra ser fácil acertar.
    if (!event.altKey) {
      const canvas = this.previewRef()?.nativeElement;
      const r = canvas?.getBoundingClientRect();
      const tol = r ? 6 / (g.axis === 'x' ? r.width : r.height) : 0;
      const n = this.store.slides();
      const cands = g.axis === 'x' ? Array.from({ length: n }, (_, i) => (i + 0.5) / n) : [0.5];
      for (const c of cands) if (Math.abs(c - pos) <= tol) pos = c;
    }
    this.store.userGuides.update((l) => l.map((x, i) => (i === gd.index ? { ...x, pos } : x)));
  }

  /** Soltar fora do post (de volta na régua) apaga a guia. */
  onGuideUp(event: PointerEvent): void {
    const gd = this.guideDrag;
    if (!gd || gd.pointer !== event.pointerId) return;
    this.guideDrag = null;
    this.pointers.delete(event.pointerId);
    const g = this.store.userGuides()[gd.index];
    if (g && (g.pos < 0 || g.pos > 1)) this.store.userGuides.update((l) => l.filter((_, i) => i !== gd.index));
  }

  clearGuides(): void {
    this.store.userGuides.set([]);
  }

  /** Guia das réguas sob o ponteiro (4 px de tolerância). */
  private guideAt(event: { clientX: number; clientY: number }): number | null {
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas || !this.rulers()) return null;
    const r = canvas.getBoundingClientRect();
    const guides = this.store.userGuides();
    for (let i = guides.length - 1; i >= 0; i--) {
      const g = guides[i];
      const d = g.axis === 'x' ? Math.abs(event.clientX - (r.left + g.pos * r.width)) : Math.abs(event.clientY - (r.top + g.pos * r.height));
      if (d <= 4) return i;
    }
    return null;
  }

  /** Linhas extras em que as camadas grudam: a grade (se ligada) e as guias
   * puxadas das réguas. */
  private snapTargets(): { xs: number[]; ys: number[] } {
    const xs: number[] = [], ys: number[] = [];
    const g = this.grid();
    if (g.on && g.snap) {
      const lines = gridLines(this.store.slides(), this.format().ratio, g.cols, g.rows);
      xs.push(...lines.xs);
      ys.push(...lines.ys);
    }
    for (const guide of this.store.userGuides()) (guide.axis === 'x' ? xs : ys).push(guide.pos);
    return { xs, ys };
  }

  private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, cols: number, rows: number): void {
    const { xs, ys } = gridLines(this.store.slides(), this.format().ratio, cols, rows);
    ctx.save();
    ctx.strokeStyle = 'rgba(45, 127, 249, 0.28)';
    ctx.lineWidth = Math.max(1, w / 1400);
    ctx.beginPath();
    for (const x of xs) { const px = Math.round(x * w) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
    for (const y of ys) { const py = Math.round(y * h) + 0.5; ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke();
    ctx.restore();
  }

  /** Guias das réguas: linhas ciano, na prévia só. */
  private drawUserGuides(ctx: CanvasRenderingContext2D, w: number, h: number, guides: Guide[]): void {
    if (!guides.length) return;
    ctx.save();
    ctx.strokeStyle = '#00b3d6';
    ctx.lineWidth = Math.max(1, w / 1000);
    ctx.beginPath();
    for (const g of guides) {
      if (g.axis === 'x') { const x = Math.round(g.pos * w) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      else { const y = Math.round(g.pos * h) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Alça de redimensionar na camada principal e a caixa de seleção. */
  private drawSelectionChrome(ctx: CanvasRenderingContext2D, selection: string[], marquee: { x: number; y: number; w: number; h: number } | null): void {
    const k = this.cssScale();
    if (selection.length > 1) {
      const boxes = this.boxes.filter((b) => selection.includes(b.id));
      if (boxes.length > 1) {
        const l = Math.min(...boxes.map((b) => b.cx - b.w / 2)), r = Math.max(...boxes.map((b) => b.cx + b.w / 2));
        const t = Math.min(...boxes.map((b) => b.cy - b.h / 2)), bo = Math.max(...boxes.map((b) => b.cy + b.h / 2));
        ctx.save();
        ctx.strokeStyle = 'rgba(45, 127, 249, 0.7)';
        ctx.lineWidth = Math.max(1, 1 / k);
        ctx.strokeRect(l, t, r - l, bo - t);
        ctx.restore();
      }
    }
    const handle = this.handlePoint();
    if (handle) {
      const size = 9 / k;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2d7ff9';
      ctx.lineWidth = Math.max(1.5, 1.5 / k);
      ctx.fillRect(handle.x - size / 2, handle.y - size / 2, size, size);
      ctx.strokeRect(handle.x - size / 2, handle.y - size / 2, size, size);
      ctx.restore();
    }
    if (marquee) {
      ctx.save();
      ctx.fillStyle = 'rgba(45, 127, 249, 0.1)';
      ctx.strokeStyle = 'rgba(45, 127, 249, 0.9)';
      ctx.lineWidth = Math.max(1, 1 / k);
      ctx.fillRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.restore();
    }
  }

  /** Px de tela por px do canvas da prévia. */
  private cssScale(): number {
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas || !canvas.width) return 1;
    return (this.canvasCssW() ?? canvas.getBoundingClientRect().width) / canvas.width || 1;
  }

  /** Canto de baixo à direita da camada principal (girado com ela), em px do
   * canvas. Só quando há uma camada só selecionada, e destravada. */
  private handlePoint(): { x: number; y: number; id: string } | null {
    const sel = this.store.selection();
    if (sel.length !== 1) return null;
    const b = this.boxes.find((x) => x.id === sel[0]);
    if (!b || b.locked) return null;
    const a = (b.rotation * Math.PI) / 180;
    const hx = b.w / 2, hy = b.h / 2;
    return { id: b.id, x: b.cx + hx * Math.cos(a) - hy * Math.sin(a), y: b.cy + hx * Math.sin(a) + hy * Math.cos(a) };
  }

  /** A alça está sob o ponteiro? Devolve o centro da camada em px de tela,
   * que é a referência do redimensionamento. */
  private handleAt(event: { clientX: number; clientY: number }): { id: string; cx: number; cy: number } | null {
    const hp = this.handlePoint();
    const canvas = this.previewRef()?.nativeElement;
    if (!hp || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const k = r.width / canvas.width;
    const hx = r.left + hp.x * k, hy = r.top + hp.y * k;
    if (Math.hypot(event.clientX - hx, event.clientY - hy) > 12) return null;
    const b = this.boxes.find((x) => x.id === hp.id)!;
    return { id: hp.id, cx: r.left + b.cx * k, cy: r.top + b.cy * k };
  }

  /** Linhas das guias magnéticas, enquanto uma camada gruda nelas. */
  private drawAlignGuides(ctx: CanvasRenderingContext2D, w: number, h: number, guides: { axis: 'x' | 'y'; pos: number }[]): void {
    if (!guides.length) return;
    ctx.save();
    ctx.strokeStyle = '#ff2d95';
    ctx.lineWidth = Math.max(1, w / 1000);
    for (const g of guides) {
      ctx.beginPath();
      if (g.axis === 'x') {
        const x = Math.round(g.pos * w) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      } else {
        const y = Math.round(g.pos * h) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Story: o topo (foto e nome do perfil) e o rodapé (campo de resposta)
   * ficam cobertos pela interface do Instagram. Só na prévia. */
  private drawSafeArea(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const top = h * (250 / 1920);
    const bottom = h * (340 / 1920);
    ctx.save();
    ctx.fillStyle = 'rgba(40, 40, 60, 0.12)';
    ctx.fillRect(0, 0, w, top);
    ctx.fillRect(0, h - bottom, w, bottom);
    ctx.strokeStyle = 'rgba(40, 40, 60, 0.45)';
    ctx.lineWidth = Math.max(1, w / 900);
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(w, top);
    ctx.moveTo(0, h - bottom);
    ctx.lineTo(w, h - bottom);
    ctx.stroke();
    ctx.restore();
  }

  private drawSlideGuides(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const n = this.store.slides();
    if (n < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, w / 900);
    ctx.setLineDash([8, 6]);
    for (let i = 1; i < n; i++) {
      const x = Math.round((w * i) / n) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.restore();
  }

  setSlides(n: number): void {
    this.store.slides.set(Math.round(clamp(n, 1, this.slidesMax)));
    this.commit();
  }

  /** Fontes e arquivos da marca prontos antes de desenhar pra valer: o
   * arquivo não pode sair sem o laço porque ele ainda estava a caminho. */
  private async assetsReady(): Promise<void> {
    const overlays = this.store.overlays();
    const pattern = this.store.bgPattern();
    await Promise.all([
      ensureOverlayFonts(overlays, this.fonts),
      ensureOverlayAssets(overlays),
      ensureBrandAssets(pattern ? [pattern] : []),
    ]);
  }

  /** O post como vai sair, reduzido e em JPEG — é o que a IA da legenda vê.
   * No carrossel vai a faixa inteira, pra ela ler a sequência. */
  readonly captionPreview = async (): Promise<string | null> => {
    await this.assetsReady();
    const full = this.renderFinal();
    if (!full) return null;
    const max = this.store.slides() > 1 ? 2000 : 1080;
    const k = Math.min(1, max / full.width);
    const canvas = k < 1 ? stepDownscale({ image: full, width: full.width, height: full.height }, full.width * k, full.height * k) : full;
    return canvas.toDataURL('image/jpeg', 0.82);
  };

  /** Nome base dos arquivos: o da foto, ou o do modelo. */
  private baseName(): string {
    return (this.fileName() || this.store.templateId().replace(/^vm-/, 'viih-mimos-') || 'post').replace(/\.[^.]+$/, '');
  }

  async sendTo(target: BridgeTarget): Promise<void> {
    await this.assetsReady();
    const canvas = this.renderFinal();
    if (!canvas) return;
    const base = this.baseName();
    this.bridge.send(target, { canvas, name: `${base}-${this.format().id}` });
  }

  private encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
    const png = this.type() === 'png';
    return new Promise((resolve) => canvas.toBlob(resolve, png ? 'image/png' : 'image/jpeg', png ? undefined : this.quality() / 100));
  }

  /** Corta a faixa do carrossel em posts do mesmo tamanho. */
  private slices(canvas: HTMLCanvasElement): HTMLCanvasElement[] {
    const n = this.store.slides();
    if (n < 2) return [canvas];
    const sw = Math.round(canvas.width / n);
    return Array.from({ length: n }, (_, i) => {
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = canvas.height;
      c.getContext('2d')!.drawImage(canvas, i * sw, 0, sw, canvas.height, 0, 0, sw, canvas.height);
      return c;
    });
  }

  async exportImage(): Promise<void> {
    await this.assetsReady();
    const canvas = this.renderFinal();
    if (!canvas) return;
    const ext = this.type() === 'png' ? 'png' : 'jpg';
    const base = this.baseName();
    const parts = this.slices(canvas);
    if (parts.length === 1) {
      const blob = await this.encode(canvas);
      if (!blob) {
        this.status.set('Não consegui gerar o arquivo — tente uma largura menor.');
        return;
      }
      downloadBlob(blob, `${base}-${this.format().id}.${ext}`);
      this.status.set(`Exportado em ${canvas.width} × ${canvas.height} px.`);
      return;
    }
    const files: ZipEntry[] = [];
    for (const [i, part] of parts.entries()) {
      const blob = await this.encode(part);
      if (blob) files.push({ name: `${base}-${String(i + 1).padStart(2, '0')}.${ext}`, content: new Uint8Array(await blob.arrayBuffer()) });
    }
    downloadBlob(zipStore(files), `${base}-carrossel.zip`);
    this.status.set(`Carrossel com ${files.length} posts de ${parts[0].width} × ${parts[0].height} px.`);
  }

  /** Lote: o mesmo look (formato, filtro, ajustes, textos) em várias fotos,
   * cada uma enquadrada do zero. Sai um ZIP. */
  async runBatch(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/') || isHeicFile(f));
    input.value = '';
    if (!files.length) return;
    await this.assetsReady();
    const out: ZipEntry[] = [];
    const names = new Set<string>();
    for (const [i, file] of files.entries()) {
      this.batching.set(`Processando ${i + 1} de ${files.length}…`);
      try {
        out.push(...await this.batchOne(file, `foto-${i + 1}`, names));
      } catch {
        // foto que não abre fica de fora; o resto do lote segue
      }
    }
    this.batching.set('');
    if (!out.length) {
      this.status.set('Nenhuma foto do lote pôde ser processada.');
      return;
    }
    downloadBlob(zipStore(out), `lote-${this.format().id}.zip`);
    this.status.set(`Lote pronto: ${out.length} arquivo(s).`);
  }

  /** Uma foto do lote: enquadrada do zero, com o look atual; um arquivo por slide. */
  private async batchOne(file: File, fallback: string, names: Set<string>): Promise<ZipEntry[]> {
    const ext = this.type() === 'png' ? 'png' : 'jpg';
    const blob0: Blob = isHeicFile(file) ? await heicToJpeg(file) : file;
    const img = await loadImageElement(await readAsDataUrl(blob0));
    const src = sourceOf(img);
    const r = frameRect(src.width, src.height, this.store.photoW(), this.store.photoH(), this.fit(), 1, 0, 0);
    const source = r.w < src.width * 0.9
      ? sourceOf(stepDownscale(src, Math.ceil(r.w), Math.ceil((r.w * src.height) / src.width)))
      : src;
    const canvas = this.renderFinal(source, { scale: 1, dx: 0, dy: 0 });
    if (!canvas) return [];
    const base = file.name.replace(/\.[^.]+$/, '') || fallback;
    const out: ZipEntry[] = [];
    for (const [k, part] of this.slices(canvas).entries()) {
      const blob = await this.encode(part);
      if (!blob) continue;
      let name = this.store.slides() > 1 ? `${base}-${k + 1}.${ext}` : `${base}.${ext}`;
      while (names.has(name)) name = name.replace(/(\.\w+)$/, '-b$1');
      names.add(name);
      out.push({ name, content: new Uint8Array(await blob.arrayBuffer()) });
    }
    return out;
  }

  // ---------- pasta monitorada (programa desktop) ----------

  readonly desktop = inject(DesktopService);
  readonly watching = signal<{ pasta: string; saida: string } | null>(null);
  readonly watchStatus = signal('');
  private watchQueue: string[] = [];
  private watchBusy = false;
  private watchDone = 0;
  private watchSub?: Subscription;
  private readonly watchNames = new Set<string>();
  private readonly stopOnDestroy = inject(DestroyRef).onDestroy(() => {
    if (this.watching()) void this.desktop.stopWatching().catch(() => undefined);
    this.watchSub?.unsubscribe();
  });

  async toggleWatch(): Promise<void> {
    if (this.watching()) {
      this.watching.set(null);
      this.watchSub?.unsubscribe();
      this.watchQueue = [];
      await this.desktop.stopWatching().catch(() => undefined);
      this.watchStatus.set('');
      return;
    }
    try {
      const chosen = await this.desktop.chooseFolder();
      if (!chosen) return;
      const w = await this.desktop.watchFolder(chosen.caminho);
      this.watching.set({ pasta: w.caminho, saida: w.saida });
      this.watchDone = 0;
      this.watchNames.clear();
      this.watchSub?.unsubscribe();
      this.watchSub = this.desktop.events.subscribe((e) => {
        if (e.tipo === 'pasta-foto') this.enqueueWatched(e.caminho);
      });
      this.watchStatus.set(w.pendentes.length ? `${w.pendentes.length} foto(s) já na pasta — processando…` : 'Esperando fotos…');
      for (const p of w.pendentes) this.enqueueWatched(p);
    } catch {
      this.watchStatus.set('Não consegui monitorar essa pasta.');
    }
  }

  private enqueueWatched(caminho: string): void {
    if (this.watchQueue.includes(caminho)) return;
    this.watchQueue.push(caminho);
    void this.drainWatched();
  }

  private async drainWatched(): Promise<void> {
    if (this.watchBusy) return;
    this.watchBusy = true;
    try {
      while (this.watchQueue.length && this.watching()) {
        const caminho = this.watchQueue.shift()!;
        const name = caminho.split(/[\\/]/).pop() ?? 'foto';
        try {
          const blob = await this.desktop.readFromFolder(caminho);
          const file = new File([blob], name, { type: imageTypeOf(name) });
          for (const e of await this.batchOne(file, 'foto', this.watchNames)) {
            await this.desktop.writeToFolder(e.name, bytesToBase64(e.content as Uint8Array));
          }
          this.watchDone++;
          this.watchStatus.set(`${this.watchDone} pronta(s) — a última: ${name}`);
        } catch {
          this.watchStatus.set(`Não consegui processar ${name}; sigo com as próximas.`);
        }
      }
    } finally {
      this.watchBusy = false;
    }
  }
}

function imageTypeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}
