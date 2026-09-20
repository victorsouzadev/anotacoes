/** Modo "Redes Sociais" do Editor de Imagens: uma foto, um formato de post e
 * ajustes de cor. Tudo roda num canvas só — o mesmo caminho desenha a prévia e
 * a exportação, então o que aparece na tela é o que sai no arquivo.
 *
 * Todo seletor usa o prefixo `sm-` pra combinar com o resto da página. */

import {
  Component, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild,
  viewChildren,
} from '@angular/core';
import { IconComponent } from '../../shared/icon';
import {
  Adjustments, BgMode, FILTER_GROUPS, FILTER_PRESETS, FilterPreset, FitMode, NEUTRAL,
  SOCIAL_FORMATS, SocialFormat, coversFrame, filterString, frameRect,
} from './social-model';
import { FrameOptions, PhotoSource, Source, paintFrame, sourceOf, stepDownscale } from './social-render';
import { sharpenRgba } from './sharpen';
import { SocialStore } from './social-store';
import { downloadBlob, loadImageElement } from './svg-template';

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
/** A prévia desenha na densidade da tela (até 2×), senão ela parece menos
 * nítida que o arquivo exportado — e a comparação fica injusta. */
const MAX_PREVIEW_DPR = 2;
const PREVIEW_CSS_WIDTH = 900;

const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
/** Teto de pixels do raster de exportação: acima disso o canvas estoura em navegador modesto. */
const MAX_EXPORT_PIXELS = 40_000_000;

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
  imports: [IconComponent],
  template: `
    <div class="sm-preview-wrap">
      <div class="sm-tabs">
        <span class="sm-tab-label">
          @if (image()) { {{ fileName() }} · {{ exportW() }} × {{ exportH() }} px } @else { Redes sociais }
        </span>
        @if (image()) {
          <div class="sm-bar">
            <button (click)="undo()" [disabled]="!canUndo()" title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
              <app-icon name="undo" [size]="14" />
            </button>
            <button (click)="redo()" [disabled]="!canRedo()" title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
              <app-icon name="redo" [size]="14" />
            </button>
            <button
              class="sm-compare"
              [class.sm-active]="comparing()"
              title="Segure pra ver a foto original (ou segure a tecla C)"
              (pointerdown)="startCompare($event)"
              (pointerup)="stopCompare()"
              (pointerleave)="stopCompare()"
              (pointercancel)="stopCompare()"
            >
              <app-icon name="eye" [size]="14" /> Antes
            </button>
          </div>
          <div class="sm-zoom-bar" title="Tamanho da foto dentro do quadro — a roda do mouse também muda">
            <span class="sm-zoom-name">Escala da foto</span>
            <button (click)="zoomBy(1 / 1.15)" aria-label="Diminuir a foto no quadro">−</button>
            <button class="sm-zoom-level" (click)="resetFraming()" title="Voltar ao enquadramento original">{{ (scale() * 100).toFixed(0) }}%</button>
            <button (click)="zoomBy(1.15)" aria-label="Aumentar a foto no quadro">+</button>
          </div>
        }
      </div>

      @if (image()) {
        <div
          class="sm-stage"
          [class.sm-drag-over]="dragOver()"
          (wheel)="onWheel($event)"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave()"
          (drop)="onDrop($event)"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp($event)"
          (pointercancel)="onPointerUp($event)"
        >
          <canvas #preview class="sm-canvas" [style.aspect-ratio]="format().ratio"></canvas>
          @if (comparing()) { <span class="sm-badge">Foto original</span> }
        </div>
        <p class="sm-hint">Arraste a foto pra reenquadrar. A prévia já mostra o resultado final.</p>
      } @else {
        <div
          class="sm-drop-zone"
          [class.sm-drag-over]="dragOver()"
          (click)="fileInput.click()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave()"
          (drop)="onDrop($event)"
        >
          <app-icon name="image" [size]="34" />
          <p><strong>Solte uma foto aqui</strong></p>
          <p class="sm-sub">Escolha o formato do post, aplique um filtro pronto e ajuste as cores na mão.</p>
          <p class="sm-sub">JPEG, PNG, WebP e HEIC do iPhone.</p>
          @if (converting()) { <p class="sm-sub">Convertendo HEIC…</p> }
          @if (error()) { <p class="sm-error">{{ error() }}</p> }
        </div>
      }
    </div>

    <aside class="sm-panel">
      <input #fileInput type="file" accept="image/*,.heic,.heif" hidden (change)="onFileInput($event)" />

      <section class="sm-section" [class.sm-open]="isOpen('foto')">
        <button class="sm-section-head" (click)="toggle('foto')">
          <span class="sm-section-title"><app-icon name="image" [size]="13" /> Foto</span>
          <span class="sm-section-summary">{{ fileName() || 'nenhuma' }}</span>
          <app-icon class="sm-chevron" name="chevron" [size]="14" />
        </button>
        <div class="sm-section-body">
          <div class="sm-row">
            <button class="sm-btn" (click)="fileInput.click()"><app-icon name="folder" [size]="13" /> Trocar foto</button>
            @if (image()) {
              <button class="sm-btn sm-danger" (click)="removeImage()"><app-icon name="delete" [size]="13" /> Remover</button>
            }
          </div>
          @if (image()) {
            <div class="sm-row">
              <button class="sm-btn" [class.sm-active]="fit() === 'cover'" (click)="setFit('cover')">Preencher</button>
              <button class="sm-btn" [class.sm-active]="fit() === 'contain'" (click)="setFit('contain')">Caber</button>
              <button class="sm-btn" (click)="resetFraming()">Reenquadrar</button>
            </div>
            <p class="sm-note">Origem: {{ photoSize().width }} × {{ photoSize().height }} px.</p>
          }
        </div>
      </section>

      <section class="sm-section" [class.sm-open]="isOpen('formato')">
        <button class="sm-section-head" (click)="toggle('formato')">
          <span class="sm-section-title"><app-icon name="rect" [size]="13" /> Formato</span>
          <span class="sm-section-summary">{{ format().label }}</span>
          <app-icon class="sm-chevron" name="chevron" [size]="14" />
        </button>
        <div class="sm-section-body">
          <div class="sm-formats">
            @for (f of formats; track f.id) {
              <button class="sm-format" [class.sm-active]="format().id === f.id" (click)="setFormat(f)" [title]="f.hint">
                <span class="sm-format-box" [style.aspect-ratio]="f.ratio"></span>
                <span class="sm-format-label">{{ f.label }}</span>
              </button>
            }
          </div>
          @if (showsBackground()) {
            <div class="sm-row">
              <button class="sm-btn" [class.sm-active]="bgMode() === 'cor'" (click)="setBgMode('cor')">Fundo cor</button>
              <button class="sm-btn" [class.sm-active]="bgMode() === 'desfoque'" (click)="setBgMode('desfoque')">Fundo borrado</button>
            </div>
            @if (bgMode() === 'cor') {
              <label class="sm-field sm-inline">
                <span>Cor do fundo</span>
                <input type="color" [value]="bgColor()" (input)="onBgColor($event)" />
              </label>
            }
          } @else {
            <p class="sm-note">A foto cobre o quadro inteiro — não há fundo à mostra. Use "Caber"
              ou diminua a escala da foto pra escolher um.</p>
          }
        </div>
      </section>

      <section class="sm-section" [class.sm-open]="isOpen('filtros')">
        <button class="sm-section-head" (click)="toggle('filtros')">
          <span class="sm-section-title"><app-icon name="sticky" [size]="13" /> Filtros prontos</span>
          <span class="sm-section-summary">{{ presetSummary() }}</span>
          <app-icon class="sm-chevron" name="chevron" [size]="14" />
        </button>
        <div class="sm-section-body">
          @for (g of groups; track g.name) {
            <div class="sm-group">
              <span class="sm-group-name">{{ g.name }}</span>
              <div class="sm-presets" role="list">
                @for (p of g.presets; track p.id) {
                  <button
                    class="sm-preset"
                    [class.sm-active]="preset() === p.id"
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
          }
          <p class="sm-note">
            {{ presets.length }} filtros. A miniatura mostra a sua foto — depois de aplicar, dá pra
            continuar ajustando tudo na seção de cor.
          </p>
        </div>
      </section>

      <section class="sm-section" [class.sm-open]="isOpen('cor')">
        <button class="sm-section-head" (click)="toggle('cor')">
          <span class="sm-section-title"><app-icon name="pen" [size]="13" /> Cor e luz</span>
          <span class="sm-section-summary">{{ dirty() ? 'ajustado' : 'neutro' }}</span>
          <app-icon class="sm-chevron" name="chevron" [size]="14" />
        </button>
        <div class="sm-section-body">
          <label class="sm-slider">
            <span class="sm-slider-head">
              <span>Redução de ruído</span>
              <button class="sm-reset" (click)="resetDenoise($event)" title="Desligar">{{ denoise() }}</button>
            </span>
            <input type="range" min="0" max="100" step="1" [value]="denoise()" (input)="onDenoise($event)" (change)="commit()" />
          </label>
          <p class="sm-note">
            @if (denoising()) {
              Limpando o ruído…
            } @else {
              Tira o granulado da foto (sombra, foto noturna) sem borrar as bordas. Não é um
              filtro: fica de fora dos presets e do "zerar ajustes".
            }
          </p>
          <label class="sm-slider">
            <span class="sm-slider-head">
              <span>Nitidez</span>
              <button class="sm-reset" (click)="resetSharpen($event)" title="Desligar">{{ sharpen() }}</button>
            </span>
            <input
              type="range" min="0" max="100" step="1"
              [value]="sharpen()" (input)="onSharpen($event)" (change)="commit()"
            />
          </label>
          <p class="sm-note">
            Devolve o micro-contraste que a redução de tamanho come. Vai por último, sobre a
            imagem no tamanho final — 30 a 40 costuma bastar.
          </p>

          <div class="sm-divider"></div>
          @for (s of basicSliders; track s.key) {
            <label class="sm-slider">
              <span class="sm-slider-head">
                <span>{{ s.label }}</span>
                <button class="sm-reset" (click)="resetOne(s.key, $event)" title="Voltar ao padrão">{{ display(s.key) }}</button>
              </span>
              <input
                type="range"
                [min]="s.min" [max]="s.max" step="1"
                [value]="adjust()[s.key]"
                (input)="onSlider(s.key, $event)"
                (change)="commit()"
              />
            </label>
          }

          <button class="sm-more" (click)="toggleAdvanced()">
            <app-icon class="sm-chevron" [class.sm-chevron-up]="advanced()" name="chevron" [size]="13" />
            Ajustes avançados
            @if (!advanced() && advancedTouched()) { <span class="sm-dot" title="Há ajustes avançados em uso"></span> }
          </button>
          @if (advanced()) {
            @for (s of advancedSliders; track s.key) {
              <label class="sm-slider">
                <span class="sm-slider-head">
                  <span>{{ s.label }}</span>
                  <button class="sm-reset" (click)="resetOne(s.key, $event)" title="Voltar ao padrão">{{ display(s.key) }}</button>
                </span>
                <input
                  type="range"
                  [min]="s.min" [max]="s.max" step="1"
                  [value]="adjust()[s.key]"
                  (input)="onSlider(s.key, $event)"
                  (change)="commit()"
                />
              </label>
            }
          }

          <button class="sm-btn sm-wide" (click)="resetAdjust()"><app-icon name="undo" [size]="13" /> Zerar ajustes</button>
        </div>
      </section>

      <section class="sm-section" [class.sm-open]="isOpen('exportar')">
        <button class="sm-section-head" (click)="toggle('exportar')">
          <span class="sm-section-title"><app-icon name="download" [size]="13" /> Exportar</span>
          <span class="sm-section-summary">{{ exportW() }}×{{ exportH() }}</span>
          <app-icon class="sm-chevron" name="chevron" [size]="14" />
        </button>
        <div class="sm-section-body">
          <div class="sm-row">
            <button class="sm-btn" [class.sm-active]="type() === 'jpeg'" (click)="setType('jpeg')">JPEG</button>
            <button class="sm-btn" [class.sm-active]="type() === 'png'" (click)="setType('png')">PNG</button>
          </div>
          @if (type() === 'jpeg') {
            <label class="sm-slider">
              <span class="sm-slider-head"><span>Qualidade</span><span>{{ quality() }}%</span></span>
              <input type="range" min="50" max="100" step="1" [value]="quality()" (input)="onQuality($event)" />
            </label>
          }
          <label class="sm-field">
            <span>Largura de saída (px)</span>
            <input type="number" min="200" max="4000" step="10" [value]="exportW()" (input)="onExportW($event)" />
          </label>
          @if (upscaling(); as falta) {
            <p class="sm-note sm-warn">
              A foto tem pixel pra {{ falta }} px de largura neste corte — acima disso o arquivo
              sai interpolado, maior mas não mais definido.
            </p>
          }
          <button class="sm-btn sm-wide sm-primary" [disabled]="!image()" (click)="exportImage()">
            <app-icon name="download" [size]="13" /> Baixar {{ exportW() }} × {{ exportH() }}
          </button>
          @if (status()) { <p class="sm-note">{{ status() }}</p> }
        </div>
      </section>
    </aside>
  `,
  styles: [`
    /* O host some da grade: os dois filhos é que são as colunas da página. */
    app-social-mode { display: contents; }

    /* A prévia acompanha a rolagem: a lista de filtros e os dez controles de cor
       são mais altos que a tela, e editar sem ver a foto não serve pra nada. */
    .sm-preview-wrap {
      display: flex; flex-direction: column; gap: 10px; min-width: 0;
      position: sticky; top: 16px;
      max-height: calc(100dvh - 32px);
    }
    .sm-tabs { display: flex; align-items: center; gap: 8px; }
    .sm-tab-label { font-size: 12px; font-weight: 600; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sm-bar { margin-left: auto; display: flex; align-items: center; gap: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
    .sm-bar button {
      display: inline-flex; align-items: center; gap: 4px;
      border: none; background: none; color: var(--text-muted);
      font-size: 11px; font-weight: 700; padding: 5px 8px;
    }
    .sm-bar button:hover:not(:disabled) { color: var(--accent); }
    .sm-bar button:disabled { opacity: 0.35; }
    .sm-compare { touch-action: none; user-select: none; }
    .sm-compare.sm-active { color: var(--accent); }
    .sm-badge {
      position: absolute; top: 12px; left: 12px;
      padding: 3px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 700;
      color: #fff; background: rgba(0, 0, 0, 0.6);
      pointer-events: none;
    }
    .sm-zoom-bar { margin-left: 6px; display: flex; align-items: center; gap: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
    .sm-zoom-bar button { border: none; background: none; color: var(--text-muted); font-size: 13px; font-weight: 700; padding: 4px 9px; }
    .sm-zoom-bar button:hover { color: var(--accent); }
    .sm-zoom-level { font-size: 11px; min-width: 46px; }
    .sm-zoom-name { font-size: 10px; font-weight: 700; color: var(--text-muted); padding-left: 8px; }

    .sm-stage {
      flex: 1;
      min-height: 220px;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
      touch-action: none;
      cursor: grab;
      overflow: hidden;
    }
    .sm-stage { position: relative; }
    .sm-stage.sm-drag-over { border-color: var(--accent); background: var(--accent-soft); }
    .sm-canvas { display: block; max-width: 100%; max-height: 100%; border-radius: 4px; object-fit: contain; }

    .sm-hint { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.4; }
    .sm-error { color: var(--danger); font-size: 12px; }

    .sm-drop-zone {
      flex: 1;
      min-height: 320px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
      padding: 32px;
      text-align: center;
      color: var(--text-muted);
      background: var(--surface);
      border: 2px dashed var(--border);
      border-radius: var(--radius);
      cursor: pointer;
    }
    .sm-drop-zone:hover, .sm-drop-zone.sm-drag-over { border-color: var(--accent); background: var(--accent-soft); }
    .sm-drop-zone p { margin: 0; font-size: 13px; }
    .sm-drop-zone .sm-sub { font-size: 12px; max-width: 380px; line-height: 1.45; }

    .sm-panel { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .sm-section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .sm-section-head {
      width: 100%;
      display: flex; align-items: center; gap: 8px;
      padding: 11px 13px;
      border: none; background: none; color: inherit; text-align: left;
    }
    .sm-section-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
    .sm-section-summary { margin-left: auto; font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
    .sm-chevron { color: var(--text-muted); transition: transform 0.15s; flex-shrink: 0; }
    .sm-section.sm-open .sm-chevron { transform: rotate(180deg); }
    .sm-section-body { display: none; flex-direction: column; gap: 10px; padding: 0 13px 13px; }
    .sm-section.sm-open .sm-section-body { display: flex; }

    .sm-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .sm-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      padding: 7px 10px;
      font-size: 12px; font-weight: 600;
      color: var(--text-muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .sm-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .sm-btn:disabled { opacity: 0.5; }
    .sm-btn.sm-wide { width: 100%; }
    .sm-btn.sm-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .sm-btn.sm-primary { color: #fff; background: var(--accent); border-color: var(--accent); }
    .sm-btn.sm-primary:hover:not(:disabled) { color: #fff; filter: brightness(1.08); }
    .sm-btn.sm-danger:hover { border-color: var(--danger); color: var(--danger); }

    .sm-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .sm-field.sm-inline { flex-direction: row; align-items: center; justify-content: space-between; }
    .sm-field input { padding: 7px 9px; font-size: 13px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .sm-field input[type="color"] { padding: 2px; width: 46px; height: 30px; }
    .sm-note { margin: 0; font-size: 11px; line-height: 1.45; color: var(--text-muted); }
    .sm-warn { color: var(--danger); }

    .sm-formats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .sm-format {
      display: flex; flex-direction: column; align-items: center; gap: 5px;
      padding: 8px 4px;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    .sm-format:hover { border-color: var(--accent); }
    .sm-format.sm-active { border-color: var(--accent); background: var(--accent-soft); }
    .sm-format-box { width: 100%; max-width: 30px; max-height: 30px; border: 1.5px solid currentColor; border-radius: 3px; color: var(--text-muted); }
    .sm-format.sm-active .sm-format-box { color: var(--accent); }
    .sm-format-label { font-size: 10px; font-weight: 600; color: var(--text-muted); text-align: center; }
    .sm-format.sm-active .sm-format-label { color: var(--accent); }

    .sm-group { display: flex; flex-direction: column; gap: 6px; }
    .sm-group-name { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
    /* Uma fileira por família, rolando na horizontal: a grade empilhada fazia
       34 filtros virarem uma página inteira de rolagem. */
    .sm-presets {
      display: flex; gap: 6px;
      overflow-x: auto; scroll-snap-type: x proximity;
      padding-bottom: 4px;
      scrollbar-width: thin;
    }
    .sm-presets > * { flex: 0 0 76px; scroll-snap-align: start; }
    .sm-preset {
      display: flex; flex-direction: column; align-items: center; gap: 5px;
      padding: 6px 3px;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    .sm-preset:hover { border-color: var(--accent); }
    .sm-preset.sm-active { border-color: var(--accent); background: var(--accent-soft); }
    /* Miniatura do filtro: a própria foto, no enquadramento atual. Sem foto,
       cai num degradê que recebe o mesmo tratamento de cor. */
    .sm-preset-chip { display: block; width: 100%; height: auto; max-height: 56px; border-radius: 4px; object-fit: cover; }
    .sm-chip-demo {
      height: 28px;
      background: linear-gradient(135deg, #f7b733 0%, #e96443 38%, #7b4397 72%, #1f6f8b 100%);
    }
    .sm-preset-label { font-size: 10px; font-weight: 600; color: var(--text-muted); text-align: center; }
    .sm-preset.sm-active .sm-preset-label { color: var(--accent); }
    /* Filtro aplicado e depois mexido à mão: continua sendo o ponto de partida,
       mas o tracejado avisa que o que está na tela já não é ele. */
    .sm-preset.sm-edited { border-style: dashed; }
    .sm-preset.sm-edited .sm-preset-label::after { content: " ·"; }

    .sm-divider { height: 1px; background: var(--border); margin: 2px 0; }
    .sm-more {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 0;
      border: none; background: none;
      font-size: 12px; font-weight: 600; color: var(--text-muted);
    }
    .sm-more:hover { color: var(--accent); }
    .sm-more .sm-chevron { transition: transform 0.15s; }
    .sm-more .sm-chevron-up { transform: rotate(180deg); }
    .sm-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    .sm-slider { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .sm-slider-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .sm-slider input[type="range"] { width: 100%; accent-color: var(--accent); }
    .sm-reset { border: none; background: none; color: var(--text-muted); font-size: 11px; font-weight: 700; padding: 0 2px; }
    .sm-reset:hover { color: var(--accent); }

    /* No celular as colunas viram uma só: a prévia gruda no topo e encolhe pra
       sobrar tela pros controles logo abaixo. */
    @media (max-width: 900px) {
      .sm-preview-wrap {
        position: sticky; top: 0; z-index: 5;
        max-height: none;
        padding-bottom: 8px;
        background: var(--bg);
      }
      .sm-stage { min-height: 0; padding: 8px; }
      .sm-canvas { max-height: clamp(160px, 34dvh, 320px); }
      .sm-hint { display: none; }
    }
  `],
})
export class SocialModeComponent {
  private readonly previewRef = viewChild<ElementRef<HTMLCanvasElement>>('preview');

  private readonly presetRefs = viewChildren<ElementRef<HTMLCanvasElement>>('presetCanvas');

  readonly formats = SOCIAL_FORMATS;
  readonly presets = FILTER_PRESETS;
  readonly groups = FILTER_GROUPS;
  /** Os quatro que resolvem a maior parte das fotos. */
  readonly basicSliders: SliderSpec[] = [
    { key: 'brightness', label: 'Brilho', min: 50, max: 150 },
    { key: 'contrast', label: 'Contraste', min: 50, max: 160 },
    { key: 'saturation', label: 'Saturação', min: 0, max: 200 },
    { key: 'temperature', label: 'Temperatura', min: -100, max: 100 },
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
  readonly sharpen = this.store.sharpen;
  readonly denoising = signal(false);

  readonly comparing = signal(false);
  readonly canUndo = this.store.canUndo;
  readonly canRedo = this.store.canRedo;

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
    const out = this.exportW();
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
    const box = 1000;
    return !coversFrame(
      this.photoSize().width, this.photoSize().height, box, Math.round(box / this.format().ratio),
      this.fit(), this.scale(), this.offsetX(), this.offsetY(),
    );
  });

  private readonly prefs = loadPrefs();
  private readonly open = signal<Record<SectionId, boolean>>(this.prefs.sections);
  /** Os seis controles finos ficam atrás de um botão: quatro resolvem quase tudo. */
  readonly advanced = signal(this.prefs.advanced);

  private drag: { id: number; x: number; y: number; dx: number; dy: number; moved: boolean } | null = null;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;
  private sharpenTimer: ReturnType<typeof setTimeout> | null = null;
  /** Recorte intermediário reaproveitado pelas miniaturas. */
  private readonly baseCanvas = document.createElement('canvas');
  private frame: number | null = null;
  private worker: Worker | null = null;
  private denoiseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Identifica a última limpeza pedida, pra descartar resposta atrasada. */
  private denoiseJob = 0;

  constructor() {
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
      const w = Math.round(PREVIEW_CSS_WIDTH * dpr);
      canvas.width = w;
      canvas.height = Math.round(w / this.format().ratio);
      paintFrame(canvas, source, this.frameOptions(compare ? { ...NEUTRAL } : this.adjust()));
      // A nitidez custa uns 50 ms e não pode engasgar quem arrasta um controle:
      // a imagem aparece na hora e ganha o acabamento quando a mão para.
      if (this.sharpenTimer !== null) clearTimeout(this.sharpenTimer);
      if (amount > 0 && !compare) {
        this.sharpenTimer = setTimeout(() => this.applySharpen(canvas), 160);
      }
    });

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
      const frame = { ...this.frameOptions(NEUTRAL), ratio: this.format().ratio };
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
      source.width, source.height, this.exportW(), this.exportH(),
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

  // --- desfazer e comparar ----------------------------------------------------

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
    if (!this.image()) return;
    event.preventDefault();
    // Uma rolagem contínua é um passo só: o histórico fecha quando ela para.
    this.scale.update((s) => clamp(s * (event.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_SCALE, MAX_SCALE));
    if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.commit(), 300);
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.image()) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      dx: this.offsetX(), dy: this.offsetY(), moved: false,
    };
  }

  onPointerMove(event: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== event.pointerId) return;
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    d.moved = true;
    // O deslocamento é guardado em fração do quadro pra sobreviver ao zoom da tela.
    this.offsetX.set(clamp(d.dx + (event.clientX - d.x) / box.width, -1, 1));
    this.offsetY.set(clamp(d.dy + (event.clientY - d.y) / box.height, -1, 1));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.drag?.id !== event.pointerId) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) this.commit();
  }

  // --- formato --------------------------------------------------------------

  setFormat(f: SocialFormat): void {
    this.format.set(f);
    this.exportW.set(f.width);
    this.store.resetFraming();
    this.commit();
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
    const value = Number((event.target as HTMLInputElement).value);
    this.adjust.update((a) => ({ ...a, [key]: value }));
  }

  resetOne(key: keyof Adjustments, event: Event): void {
    event.preventDefault();
    this.adjust.update((a) => ({ ...a, [key]: NEUTRAL[key] }));
    this.commit();
  }

  onSharpen(event: Event): void {
    this.sharpen.set(Number((event.target as HTMLInputElement).value));
  }

  resetSharpen(event: Event): void {
    event.preventDefault();
    this.sharpen.set(0);
    this.commit();
  }

  onDenoise(event: Event): void {
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

  exportImage(): void {
    const source = this.currentSource();
    if (!source) return;
    let w = this.exportW();
    let h = this.exportH();
    if (w * h > MAX_EXPORT_PIXELS) {
      const factor = Math.sqrt(MAX_EXPORT_PIXELS / (w * h));
      w = Math.round(w * factor);
      h = Math.round(h * factor);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    paintFrame(canvas, source, this.frameOptions(this.adjust()));
    this.applySharpen(canvas);
    const png = this.type() === 'png';
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          this.status.set('Não consegui gerar o arquivo — tente uma largura menor.');
          return;
        }
        const base = (this.fileName() || 'post').replace(/\.[^.]+$/, '');
        downloadBlob(blob, `${base}-${this.format().id}.${png ? 'png' : 'jpg'}`);
        this.status.set(`Exportado em ${w} × ${h} px.`);
      },
      png ? 'image/png' : 'image/jpeg',
      png ? undefined : this.quality() / 100,
    );
  }
}
