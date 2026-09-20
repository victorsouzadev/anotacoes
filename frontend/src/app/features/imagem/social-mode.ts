/** Modo "Redes Sociais" do Editor de Imagens: uma foto, um formato de post e
 * ajustes de cor. Tudo roda num canvas só — o mesmo caminho desenha a prévia e
 * a exportação, então o que aparece na tela é o que sai no arquivo.
 *
 * Todo seletor usa o prefixo `sm-` pra combinar com o resto da página. */

import {
  Component, ElementRef, computed, effect, inject, signal, viewChild, viewChildren,
} from '@angular/core';
import { IconComponent } from '../../shared/icon';
import {
  Adjustments, BgMode, FILTER_GROUPS, FILTER_PRESETS, FilterPreset, FitMode, NEUTRAL,
  SOCIAL_FORMATS, SocialFormat, filterString,
} from './social-model';
import { FrameOptions, Source, paintFrame, sourceOf } from './social-render';
import { SocialStore, normalizeSocialPhoto } from './social-store';
import { downloadBlob, loadImageElement } from './svg-template';

type SectionId = 'foto' | 'formato' | 'filtros' | 'cor' | 'exportar';

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
          <div class="sm-zoom-bar" title="Use a roda do mouse pra aproximar">
            <button (click)="zoomBy(1 / 1.15)" aria-label="Menos zoom">−</button>
            <button class="sm-zoom-level" (click)="resetFraming()" title="Reenquadrar">{{ (scale() * 100).toFixed(0) }}%</button>
            <button (click)="zoomBy(1.15)" aria-label="Mais zoom">+</button>
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
            <p class="sm-note">Origem: {{ image()!.naturalWidth }} × {{ image()!.naturalHeight }} px.</p>
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
          <p class="sm-note">O fundo só aparece quando a foto não cobre o quadro inteiro.</p>
        </div>
      </section>

      <section class="sm-section" [class.sm-open]="isOpen('filtros')">
        <button class="sm-section-head" (click)="toggle('filtros')">
          <span class="sm-section-title"><app-icon name="sticky" [size]="13" /> Filtros prontos</span>
          <span class="sm-section-summary">{{ presetLabel() }}</span>
          <app-icon class="sm-chevron" name="chevron" [size]="14" />
        </button>
        <div class="sm-section-body">
          @for (g of groups; track g.name) {
            <div class="sm-group">
              <span class="sm-group-name">{{ g.name }}</span>
              <div class="sm-presets">
                @for (p of g.presets; track p.id) {
                  <button class="sm-preset" [class.sm-active]="preset() === p.id" (click)="applyPreset(p)" [title]="p.label">
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
            <input type="range" min="0" max="100" step="1" [value]="denoise()" (input)="onDenoise($event)" />
          </label>
          <p class="sm-note">
            @if (denoising()) {
              Limpando o ruído…
            } @else {
              Tira o granulado da foto (sombra, foto noturna) sem borrar as bordas. Não é um
              filtro: fica de fora dos presets e do "zerar ajustes".
            }
          </p>
          <div class="sm-divider"></div>
          @for (s of sliders; track s.key) {
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
              />
            </label>
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
    .sm-zoom-bar { margin-left: auto; display: flex; align-items: center; gap: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
    .sm-zoom-bar button { border: none; background: none; color: var(--text-muted); font-size: 13px; font-weight: 700; padding: 4px 9px; }
    .sm-zoom-bar button:hover { color: var(--accent); }
    .sm-zoom-level { font-size: 11px; min-width: 46px; }

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
    .sm-presets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
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

    .sm-divider { height: 1px; background: var(--border); margin: 2px 0; }
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
  readonly sliders: { key: keyof Adjustments; label: string; min: number; max: number }[] = [
    { key: 'brightness', label: 'Brilho', min: 50, max: 150 },
    { key: 'contrast', label: 'Contraste', min: 50, max: 160 },
    { key: 'saturation', label: 'Saturação', min: 0, max: 200 },
    { key: 'temperature', label: 'Temperatura', min: -100, max: 100 },
    { key: 'hue', label: 'Matiz', min: -30, max: 30 },
    { key: 'fade', label: 'Desbotado', min: 0, max: 100 },
    { key: 'vignette', label: 'Vinheta', min: 0, max: 100 },
    { key: 'sepia', label: 'Sépia', min: 0, max: 100 },
    { key: 'grayscale', label: 'Preto e branco', min: 0, max: 100 },
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
  readonly denoising = signal(false);

  readonly error = signal('');
  readonly status = signal('');
  readonly dragOver = signal(false);
  readonly converting = signal(false);

  readonly dirty = computed(() => {
    const a = this.adjust();
    return (Object.keys(NEUTRAL) as (keyof Adjustments)[]).some((k) => a[k] !== NEUTRAL[k]);
  });
  readonly presetLabel = computed(() => FILTER_PRESETS.find((p) => p.id === this.preset())?.label ?? 'Original');

  private readonly open = signal<Record<SectionId, boolean>>({
    foto: true, formato: true, filtros: true, cor: false, exportar: false,
  });

  private drag: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
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
      const source = this.currentSource();
      if (!canvas || !source) return;
      const w = 900;
      canvas.width = w;
      canvas.height = Math.round(w / this.format().ratio);
      paintFrame(canvas, source, this.frameOptions(this.adjust()));
    });

    // A limpeza é cara e roda sobre a foto inteira, então espera a mão sair do
    // controle antes de começar — e refaz do zero quando a foto muda.
    effect(() => {
      const img = this.image();
      const strength = this.denoise();
      if (this.denoiseTimer !== null) clearTimeout(this.denoiseTimer);
      if (!img || strength <= 0) {
        this.denoiseJob++;
        this.denoising.set(false);
        this.cleaned.set(null);
        return;
      }
      this.denoising.set(true);
      this.denoiseTimer = setTimeout(() => void this.runDenoise(img, strength), 250);
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
  private async runDenoise(img: HTMLImageElement, strength: number): Promise<void> {
    const job = ++this.denoiseJob;
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      this.denoising.set(false);
      return;
    }
    ctx.drawImage(img, 0, 0);
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
    const img = this.image();
    return img ? sourceOf(img) : null;
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

  isOpen(id: SectionId): boolean { return this.open()[id]; }

  toggle(id: SectionId): void {
    this.open.update((o) => ({ ...o, [id]: !o[id] }));
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
      // Reduz antes de guardar: a foto vai embutida no projeto salvo.
      const raw = await loadImageElement(original);
      const src = normalizeSocialPhoto(raw, original, heic ? 'image/jpeg' : file.type);
      const img = src === original ? raw : await loadImageElement(src);
      this.store.setImage(img, src, heic ? file.name.replace(/\.hei[cf]$/i, '.jpg') : file.name);
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
    this.resetFraming();
  }

  resetFraming(): void {
    this.store.resetFraming();
  }

  zoomBy(factor: number): void {
    this.scale.update((s) => clamp(s * factor, MIN_SCALE, MAX_SCALE));
  }

  onWheel(event: WheelEvent): void {
    if (!this.image()) return;
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.image()) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: this.offsetX(), dy: this.offsetY() };
  }

  onPointerMove(event: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== event.pointerId) return;
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    // O deslocamento é guardado em fração do quadro pra sobreviver ao zoom da tela.
    this.offsetX.set(clamp(d.dx + (event.clientX - d.x) / box.width, -1, 1));
    this.offsetY.set(clamp(d.dy + (event.clientY - d.y) / box.height, -1, 1));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.drag?.id === event.pointerId) this.drag = null;
  }

  // --- formato --------------------------------------------------------------

  setFormat(f: SocialFormat): void {
    this.format.set(f);
    this.exportW.set(f.width);
    this.resetFraming();
  }

  setBgMode(mode: BgMode): void { this.bgMode.set(mode); }

  onBgColor(event: Event): void { this.bgColor.set((event.target as HTMLInputElement).value); }

  // --- cor ------------------------------------------------------------------

  applyPreset(p: FilterPreset): void {
    this.preset.set(p.id);
    this.adjust.set({ ...NEUTRAL, ...p.values });
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
  }

  onDenoise(event: Event): void {
    this.denoise.set(Number((event.target as HTMLInputElement).value));
  }

  resetDenoise(event: Event): void {
    event.preventDefault();
    this.denoise.set(0);
  }

  resetAdjust(): void {
    this.adjust.set({ ...NEUTRAL });
    this.preset.set('original');
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
