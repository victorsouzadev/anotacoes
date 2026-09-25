/** Modo "Redes Sociais" do Editor de Imagens: uma foto, um formato de post e
 * ajustes de cor. Tudo roda num canvas só — o mesmo caminho desenha a prévia e
 * a exportação, então o que aparece na tela é o que sai no arquivo.
 *
 * A interface é a área de trabalho comum do editor (classes `il-`); o que é
 * só deste modo usa o prefixo `sm-`. */

import {
  Component, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild,
  viewChildren,
} from '@angular/core';
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
import { OverlayBox, drawOverlays, ensureOverlayFonts, hitOverlay } from './social-overlays';
import { SocialOverlaysPanelComponent } from './social-overlays-panel';
import { FontLibrary } from './fonts';
import { ZipEntry, zipStore } from './zip';

type SectionId = 'foto' | 'formato' | 'filtros' | 'cor' | 'exportar';

export const PREFS_KEY = 'imagem-social-prefs';

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
  imports: [IlIconComponent, IlNumComponent, SocialOverlaysPanelComponent],
  host: { class: 'il-studio il-basic sm' },
  template: `
    <input #fileInput type="file" [attr.accept]="accept" hidden (change)="onFileInput($event)" />

    <div class="il-controlbar">
      <div class="il-cb-group">
        <button type="button" class="il-ib" [disabled]="!canUndo()" data-tip="Desfazer  Ctrl+Z" aria-label="Desfazer" (click)="undo()"><il-icon name="undo" /></button>
        <button type="button" class="il-ib" [disabled]="!canRedo()" data-tip="Refazer  Ctrl+Shift+Z" aria-label="Refazer" (click)="redo()"><il-icon name="redo" /></button>
      </div>
      <span class="il-cb-kind sm-kind" [title]="fileName()">{{ image() ? fileName() : 'Redes sociais' }}</span>
      <div class="il-cb-group">
        <span class="il-cb-label">Formato</span>
        <select class="il-select" [value]="format().id" (change)="setFormatId($any($event.target).value)" aria-label="Formato do post">
          @for (f of formats; track f.id) { <option [value]="f.id">{{ f.label }} — {{ f.hint }}</option> }
        </select>
      </div>
      @if (image()) {
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
        <span class="sm-spacer"></span>
        <span class="il-cb-label">{{ exportW() }} × {{ exportH() }} px</span>
        <button type="button" class="il-btn il-primary" (click)="exportImage()"><il-icon name="download" [size]="13" /> Baixar {{ type() === 'png' ? 'PNG' : 'JPEG' }}</button>
      } @else {
        <span class="il-cb-hint">Abra uma foto pra escolher o formato, aplicar um filtro e ajustar as cores.</span>
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
        <button type="button" class="il-tool" [disabled]="!image()" aria-label="Filtros" data-tip="Filtros prontos" (click)="tab.set('filtros')"><il-icon name="filter" [size]="18" /></button>
        <button type="button" class="il-tool" [disabled]="!image()" aria-label="Cor e luz" data-tip="Cor e luz" (click)="tab.set('ajustes')"><il-icon name="sun" [size]="18" /></button>
      </div>
    </nav>

    @if (image()) {
      <div
        class="il-stage sm-stage"
        [class.il-drag-over]="dragOver()"
        (wheel)="onWheel($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave()"
        (drop)="onDrop($event)"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
      >
        <canvas #preview class="sm-canvas il-paper" [style.aspect-ratio]="store.frameRatio()"></canvas>
        @if (comparing()) { <span class="sm-badge">Foto original</span> }
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
            @if (upscale.disponivel()) {
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
                } @else {
                  <p class="il-note">A foto cobre o quadro inteiro — não há fundo à mostra. Use "Caber" ou diminua a escala pra escolher um.</p>
                }
              </div>
            </section>
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
            <sm-overlays-panel />
          }
          @case ('exportar') {
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
                <button type="button" class="il-btn il-primary il-wide" [disabled]="!image()" (click)="exportImage()"><il-icon name="download" [size]="13" /> {{ store.slides() > 1 ? 'Baixar carrossel (' + store.slides() + ' posts)' : 'Baixar ' + exportW() + ' × ' + exportH() }}</button>
                @if (status()) { <p class="il-note">{{ status() }}</p> }
              </div>
            </section>
            <section class="il-sec">
              <div class="il-sec-head il-sec-static">Lote</div>
              <div class="il-sec-body">
                <input #batchInput type="file" accept="image/*,.heic,.heif" multiple hidden (change)="runBatch($event)" />
                <button type="button" class="il-btn il-wide" [disabled]="!!batching()" (click)="batchInput.click()"><il-icon name="photo-add" [size]="13" /> {{ batching() || 'Aplicar em várias fotos…' }}</button>
                <p class="il-note">Mesmo formato, filtro, ajustes e textos em cada foto escolhida, enquadrada no centro. Sai um ZIP.</p>
              </div>
            </section>
            <div class="il-sec-head il-sec-static">Enviar para outro modo</div>
            <div class="il-export-list">
              @for (t of bridge.targetsFrom('social'); track t.id) {
                <button type="button" class="il-export" [disabled]="!image()" (click)="sendTo(t.id)"><il-icon name="export" [size]="20" /><span><strong>{{ t.label }}</strong><small>{{ t.help }}</small></span></button>
              }
            </div>
          }
        }
      </div>
    </aside>

    <footer class="il-status">
      @if (image()) {
        <span class="il-status-info">{{ fileName() }}</span>
        <span>{{ format().label }} · {{ exportW() }} × {{ exportH() }} px · escala {{ (scale() * 100).toFixed(0) }}%</span>
      }
      <span class="il-status-msg">{{ status() || (image() ? 'Arraste a foto pra reenquadrar · roda do mouse muda a escala · segure C pra comparar' : 'Solte, cole ou abra uma foto') }}</span>
    </footer>
  `,
  styles: [`
    .sm-kind { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
    .sm-spacer { flex: 1; }
    .sm-stage { touch-action: none; cursor: grab; }
    .sm-stage:active { cursor: grabbing; }
    .sm-canvas { display: block; margin: auto; max-width: 100%; max-height: 100%; }
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
  `],
})
export class SocialModeComponent {
  private readonly previewRef = viewChild<ElementRef<HTMLCanvasElement>>('preview');

  private readonly presetRefs = viewChildren<ElementRef<HTMLCanvasElement>>('presetCanvas');

  readonly formats = SOCIAL_FORMATS;
  readonly tabs: { id: 'filtros' | 'ajustes' | 'foto' | 'texto' | 'exportar'; label: string }[] = [
    { id: 'filtros', label: 'Filtros' },
    { id: 'ajustes', label: 'Cor e luz' },
    { id: 'foto', label: 'Foto' },
    { id: 'texto', label: 'Texto' },
    { id: 'exportar', label: 'Exportar' },
  ];
  readonly tab = signal<'filtros' | 'ajustes' | 'foto' | 'texto' | 'exportar'>('filtros');
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
  readonly store = inject(SocialStore);
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
    const out = this.store.frameW();
    const r = frameRect(
      source.width, source.height, out, this.exportH(),
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
      this.photoSize().width, this.photoSize().height, box, Math.round(box / this.store.frameRatio()),
      this.fit(), this.scale(), this.offsetX(), this.offsetY(),
    );
  });

  private readonly prefs = loadPrefs();
  private readonly open = signal<Record<SectionId, boolean>>(this.prefs.sections);
  /** Os seis controles finos ficam atrás de um botão: quatro resolvem quase tudo. */
  readonly advanced = signal(this.prefs.advanced);

  private drag: { id: number; x: number; y: number; dx: number; dy: number; moved: boolean } | null = null;
  /** Arraste de texto/figurinha: posição inicial em fração do quadro. */
  private overlayDrag: { pointer: number; id: string; x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
  private boxes: OverlayBox[] = [];
  private readonly fontTick = signal(0);
  private readonly fonts = inject(FontLibrary);
  readonly slidesMax = 10;
  batching = signal('');
  /** Dedos (ou ponteiros) em cima do palco agora. Dois viram pinça. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; scale: number } | null = null;
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
    // Fontes dos textos: carregadas antes de desenhar, e a prévia refeita.
    effect(() => {
      const overlays = this.store.overlays();
      void ensureOverlayFonts(overlays, this.fonts).then(() => this.fontTick.update((v) => v + 1));
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
      const source = compare ? (img ? sourceOf(img) : null) : this.currentSource();
      const amount = this.sharpen();
      if (!canvas || !source) return;
      const dpr = Math.min(MAX_PREVIEW_DPR, globalThis.devicePixelRatio || 1);
      // Enquanto a mão está num controle a prévia desenha menor: a conta de cor
      // agora é por pixel, e resposta imediata vale mais que nitidez num quadro
      // que vai ser substituído em seguida. Ao parar, volta ao tamanho cheio.
      const w = Math.round(PREVIEW_CSS_WIDTH * dpr * (this.interacting() ? 0.55 : 1));
      canvas.width = w;
      canvas.height = Math.round(w / this.store.frameRatio());
      paintFrame(canvas, source, this.frameOptions(compare ? { ...NEUTRAL } : this.adjust()));
      this.fontTick();
      const overlays = this.store.overlays();
      const selectedOverlay = this.store.selectedOverlay();
      const ctx2 = canvas.getContext('2d')!;
      this.boxes = compare ? [] : drawOverlays(ctx2, canvas.width, canvas.height, overlays, this.fonts, selectedOverlay);
      this.drawSlideGuides(ctx2, canvas.width, canvas.height);
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
      const frame = { ...this.frameOptions(NEUTRAL), ratio: this.store.frameRatio() };
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
      source.width, source.height, this.store.frameW(), this.exportH(),
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
      source.width, source.height, this.store.frameW(), this.exportH(),
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
    if (selOverlay && !typing && (key === 'delete' || key === 'backspace')) {
      event.preventDefault();
      this.store.removeOverlay(selOverlay);
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
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.loadFile(file);
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
    } catch (e) {
      this.converting.set(false);
      this.status.set('');
      this.error.set(heic
        ? 'Não consegui converter esse HEIC. Exporte a foto como JPEG e tente de novo.'
        : (e instanceof Error ? e.message : 'Falha ao abrir a imagem.'));
    }
  }

  removeImage(): void {
    this.store.clear();
    this.status.set('');
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
    const sel = this.store.selectedOverlay();
    const pt = sel ? this.canvasPoint(event) : null;
    if (sel && pt && hitOverlay(this.boxes, pt.x, pt.y) === sel) {
      event.preventDefault();
      const o = this.store.overlays().find((x) => x.id === sel)!;
      this.store.patchOverlay(sel, { size: clamp(o.size * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 0.02, 0.8) });
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
    if (!this.image()) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    const pt = this.canvasPoint(event);
    const hit = pt ? hitOverlay(this.boxes, pt.x, pt.y) : null;
    if (hit) {
      const o = this.store.overlays().find((x) => x.id === hit)!;
      this.store.selectedOverlay.set(hit);
      this.tab.set('texto');
      this.overlayDrag = { pointer: event.pointerId, id: hit, x: event.clientX, y: event.clientY, ox: o.x, oy: o.y, moved: false };
      return;
    }
    if (this.store.selectedOverlay()) this.store.selectedOverlay.set(null);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.pinch = { distance: this.pointerDistance(), scale: this.scale() };
      // Dois dedos na tela é pinça, não arraste: o arraste em curso termina
      // aqui pra foto não escapar junto com a ampliação.
      this.drag = null;
      return;
    }
    this.drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      dx: this.offsetX(), dy: this.offsetY(), moved: false,
    };
  }

  onPointerMove(event: PointerEvent): void {
    const od = this.overlayDrag;
    if (od && od.pointer === event.pointerId) {
      const pt = this.canvasPoint(event);
      if (!pt) return;
      od.moved = true;
      this.store.patchOverlay(od.id, {
        x: clamp(od.ox + (event.clientX - od.x) / pt.box.width, 0, 1),
        y: clamp(od.oy + (event.clientY - od.y) / pt.box.height, 0, 1),
      });
      return;
    }
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinch = this.pinch;
    if (pinch && this.pointers.size === 2) {
      const distance = this.pointerDistance();
      if (pinch.distance > 0 && distance > 0) {
        this.touch();
        this.scale.set(clamp((pinch.scale * distance) / pinch.distance, MIN_SCALE, MAX_SCALE));
      }
      return;
    }

    const d = this.drag;
    if (!d || d.id !== event.pointerId) return;
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    d.moved = true;
    this.touch();
    // O deslocamento é guardado em fração do quadro pra sobreviver ao zoom da tela.
    this.offsetX.set(clamp(d.dx + (event.clientX - d.x) / box.width, -1, 1));
    this.offsetY.set(clamp(d.dy + (event.clientY - d.y) / box.height, -1, 1));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.overlayDrag?.pointer === event.pointerId) {
      const moved = this.overlayDrag.moved;
      this.overlayDrag = null;
      if (moved) this.commit();
      return;
    }
    this.pointers.delete(event.pointerId);
    if (this.pinch && this.pointers.size < 2) {
      this.pinch = null;
      this.commit();
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
    if (!source) return null;
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

  sendTo(target: BridgeTarget): void {
    const canvas = this.renderFinal();
    if (!canvas) return;
    const base = (this.fileName() || 'post').replace(/\.[^.]+$/, '');
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
    const canvas = this.renderFinal();
    if (!canvas) return;
    const ext = this.type() === 'png' ? 'png' : 'jpg';
    const base = (this.fileName() || 'post').replace(/\.[^.]+$/, '');
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
    const ext = this.type() === 'png' ? 'png' : 'jpg';
    const out: ZipEntry[] = [];
    const names = new Set<string>();
    for (const [i, file] of files.entries()) {
      this.batching.set(`Processando ${i + 1} de ${files.length}…`);
      try {
        const blob0: Blob = isHeicFile(file) ? await heicToJpeg(file) : file;
        const img = await loadImageElement(await readAsDataUrl(blob0));
        const src = sourceOf(img);
        const r = frameRect(src.width, src.height, this.store.frameW(), this.exportH(), this.fit(), 1, 0, 0);
        const source = r.w < src.width * 0.9
          ? sourceOf(stepDownscale(src, Math.ceil(r.w), Math.ceil((r.w * src.height) / src.width)))
          : src;
        const canvas = this.renderFinal(source, { scale: 1, dx: 0, dy: 0 });
        if (!canvas) continue;
        const base = file.name.replace(/\.[^.]+$/, '') || `foto-${i + 1}`;
        for (const [k, part] of this.slices(canvas).entries()) {
          const blob = await this.encode(part);
          if (!blob) continue;
          let name = this.store.slides() > 1 ? `${base}-${k + 1}.${ext}` : `${base}.${ext}`;
          while (names.has(name)) name = name.replace(/(\.\w+)$/, '-b$1');
          names.add(name);
          out.push({ name, content: new Uint8Array(await blob.arrayBuffer()) });
        }
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
}
