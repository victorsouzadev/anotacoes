/** Modo "Redes Sociais" do Editor de Imagens: uma foto, um formato de post e
 * ajustes de cor. Tudo roda num canvas só — o mesmo caminho desenha a prévia e
 * a exportação, então o que aparece na tela é o que sai no arquivo.
 *
 * Todo seletor usa o prefixo `sm-` pra combinar com o resto da página. */

import { Component, ElementRef, computed, effect, signal, viewChild } from '@angular/core';
import { IconComponent } from '../../shared/icon';
import { downloadBlob } from './svg-template';

/** Formato de saída: proporção e o lado maior em pixels na exportação. */
interface SocialFormat {
  id: string;
  label: string;
  hint: string;
  ratio: number;
  /** Largura de exportação em px; a altura sai da proporção. */
  width: number;
}

export const SOCIAL_FORMATS: SocialFormat[] = [
  { id: 'feed', label: 'Feed 1:1', hint: 'Post quadrado', ratio: 1, width: 1080 },
  { id: 'retrato', label: 'Retrato 4:5', hint: 'Feed vertical', ratio: 4 / 5, width: 1080 },
  { id: 'story', label: 'Story 9:16', hint: 'Stories e Reels', ratio: 9 / 16, width: 1080 },
  { id: 'paisagem', label: 'Paisagem 16:9', hint: 'YouTube e capas', ratio: 16 / 9, width: 1920 },
  { id: 'retrato23', label: 'Pinterest 2:3', hint: 'Pin vertical', ratio: 2 / 3, width: 1000 },
  { id: 'capa', label: 'Capa 3:1', hint: 'Banner largo', ratio: 3, width: 1500 },
];

/** Ajustes de cor. Os quatro primeiros viram um `filter` de canvas; os outros
 * são camadas desenhadas por cima. */
export interface Adjustments {
  /** % — 100 é neutro. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Graus de rotação de matiz, -30..30. */
  hue: number;
  /** -100 (frio/azulado) a 100 (quente/alaranjado). */
  temperature: number;
  /** 0..100 — quanto a imagem desbota pro branco (efeito "fade"). */
  fade: number;
  /** 0..100 — escurecimento das bordas. */
  vignette: number;
  /** 0..100 — sépia. */
  sepia: number;
  /** 0..100 — preto e branco. */
  grayscale: number;
  /** 0..100 — desfoque, em décimos de px do lado maior/1000. */
  blur: number;
}

export const NEUTRAL: Adjustments = {
  brightness: 100, contrast: 100, saturation: 100, hue: 0,
  temperature: 0, fade: 0, vignette: 0, sepia: 0, grayscale: 0, blur: 0,
};

interface FilterPreset {
  id: string;
  label: string;
  values: Partial<Adjustments>;
}

/** Filtros prontos: combinações de ajuste que o usuário pode aplicar num clique
 * e depois continuar mexendo à mão. */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'original', label: 'Original', values: {} },
  { id: 'vivido', label: 'Vívido', values: { saturation: 135, contrast: 112, brightness: 103 } },
  { id: 'suave', label: 'Suave', values: { saturation: 92, contrast: 94, brightness: 105, fade: 14 } },
  { id: 'quente', label: 'Quente', values: { temperature: 38, saturation: 110, brightness: 103 } },
  { id: 'frio', label: 'Frio', values: { temperature: -38, saturation: 104, contrast: 106 } },
  { id: 'vintage', label: 'Vintage', values: { sepia: 32, saturation: 82, contrast: 92, fade: 20, vignette: 26 } },
  { id: 'pb', label: 'Preto e branco', values: { grayscale: 100, contrast: 115 } },
  { id: 'cinema', label: 'Cinema', values: { contrast: 118, saturation: 88, temperature: -14, vignette: 34 } },
  { id: 'dourado', label: 'Dourado', values: { temperature: 55, sepia: 18, brightness: 104, saturation: 116 } },
  { id: 'clean', label: 'Clean', values: { brightness: 108, contrast: 96, saturation: 96, fade: 8 } },
];

type FitMode = 'cover' | 'contain';
type BgMode = 'cor' | 'desfoque';
type SectionId = 'foto' | 'formato' | 'filtros' | 'cor' | 'exportar';

const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
/** Teto de pixels do raster de exportação: acima disso o canvas estoura em navegador modesto. */
const MAX_EXPORT_PIXELS = 40_000_000;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Monta a string de `filter` do canvas a partir dos ajustes. O desfoque escala
 * com o tamanho do destino pra prévia e exportação ficarem iguais. */
export function filterString(a: Adjustments, sizePx: number): string {
  const parts = [
    `brightness(${a.brightness}%)`,
    `contrast(${a.contrast}%)`,
    `saturate(${a.saturation}%)`,
  ];
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.sepia) parts.push(`sepia(${a.sepia}%)`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.blur) parts.push(`blur(${(a.blur / 100) * sizePx * 0.03}px)`);
  return parts.join(' ');
}

/** Retângulo da foto dentro do quadro, para "preencher" ou "caber", já com o
 * zoom e o deslocamento do usuário aplicados. */
export function frameRect(
  imgW: number, imgH: number, boxW: number, boxH: number,
  fit: FitMode, scale: number, dx: number, dy: number,
): { x: number; y: number; w: number; h: number } {
  const base = fit === 'cover'
    ? Math.max(boxW / imgW, boxH / imgH)
    : Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * base * scale;
  const h = imgH * base * scale;
  return { x: (boxW - w) / 2 + dx * boxW, y: (boxH - h) / 2 + dy * boxH, w, h };
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
          @if (error()) { <p class="sm-error">{{ error() }}</p> }
        </div>
      }
    </div>

    <aside class="sm-panel">
      <input #fileInput type="file" accept="image/*" hidden (change)="onFileInput($event)" />

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
          <div class="sm-presets">
            @for (p of presets; track p.id) {
              <button class="sm-preset" [class.sm-active]="preset() === p.id" (click)="applyPreset(p)">
                <span class="sm-preset-chip" [style.filter]="chipFilter(p)"></span>
                <span class="sm-preset-label">{{ p.label }}</span>
              </button>
            }
          </div>
          <p class="sm-note">Depois de aplicar, dá pra continuar ajustando tudo na seção de cor.</p>
        </div>
      </section>

      <section class="sm-section" [class.sm-open]="isOpen('cor')">
        <button class="sm-section-head" (click)="toggle('cor')">
          <span class="sm-section-title"><app-icon name="pen" [size]="13" /> Cor e luz</span>
          <span class="sm-section-summary">{{ dirty() ? 'ajustado' : 'neutro' }}</span>
          <app-icon class="sm-chevron" name="chevron" [size]="14" />
        </button>
        <div class="sm-section-body">
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

    .sm-preview-wrap { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .sm-tabs { display: flex; align-items: center; gap: 8px; }
    .sm-tab-label { font-size: 12px; font-weight: 600; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sm-zoom-bar { margin-left: auto; display: flex; align-items: center; gap: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
    .sm-zoom-bar button { border: none; background: none; color: var(--text-muted); font-size: 13px; font-weight: 700; padding: 4px 9px; }
    .sm-zoom-bar button:hover { color: var(--accent); }
    .sm-zoom-level { font-size: 11px; min-width: 46px; }

    .sm-stage {
      flex: 1;
      min-height: 320px;
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
    .sm-canvas { display: block; max-width: 100%; max-height: 62dvh; border-radius: 4px; }

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

    .sm-presets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .sm-preset {
      display: flex; flex-direction: column; align-items: center; gap: 5px;
      padding: 6px 3px;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    .sm-preset:hover { border-color: var(--accent); }
    .sm-preset.sm-active { border-color: var(--accent); background: var(--accent-soft); }
    /* Amostra do filtro: um degradê fixo que recebe o mesmo tratamento de cor. */
    .sm-preset-chip {
      width: 100%; height: 28px; border-radius: 4px;
      background: linear-gradient(135deg, #f7b733 0%, #e96443 38%, #7b4397 72%, #1f6f8b 100%);
    }
    .sm-preset-label { font-size: 10px; font-weight: 600; color: var(--text-muted); text-align: center; }
    .sm-preset.sm-active .sm-preset-label { color: var(--accent); }

    .sm-slider { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .sm-slider-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .sm-slider input[type="range"] { width: 100%; accent-color: var(--accent); }
    .sm-reset { border: none; background: none; color: var(--text-muted); font-size: 11px; font-weight: 700; padding: 0 2px; }
    .sm-reset:hover { color: var(--accent); }

    @media (max-width: 860px) {
      .sm-canvas { max-height: 46dvh; }
    }
  `],
})
export class SocialModeComponent {
  private readonly previewRef = viewChild<ElementRef<HTMLCanvasElement>>('preview');

  readonly formats = SOCIAL_FORMATS;
  readonly presets = FILTER_PRESETS;
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

  readonly image = signal<HTMLImageElement | null>(null);
  readonly fileName = signal('');
  readonly error = signal('');
  readonly status = signal('');
  readonly dragOver = signal(false);

  readonly format = signal<SocialFormat>(SOCIAL_FORMATS[0]);
  readonly fit = signal<FitMode>('cover');
  readonly scale = signal(1);
  readonly offsetX = signal(0);
  readonly offsetY = signal(0);
  readonly bgMode = signal<BgMode>('desfoque');
  readonly bgColor = signal('#ffffff');

  readonly adjust = signal<Adjustments>({ ...NEUTRAL });
  readonly preset = signal('original');

  readonly type = signal<'jpeg' | 'png'>('jpeg');
  readonly quality = signal(92);
  readonly exportW = signal(SOCIAL_FORMATS[0].width);
  readonly exportH = computed(() => Math.round(this.exportW() / this.format().ratio));

  readonly dirty = computed(() => {
    const a = this.adjust();
    return (Object.keys(NEUTRAL) as (keyof Adjustments)[]).some((k) => a[k] !== NEUTRAL[k]);
  });
  readonly presetLabel = computed(() => FILTER_PRESETS.find((p) => p.id === this.preset())?.label ?? 'Original');

  private readonly open = signal<Record<SectionId, boolean>>({
    foto: true, formato: true, filtros: true, cor: false, exportar: false,
  });

  private drag: { id: number; x: number; y: number; dx: number; dy: number } | null = null;

  constructor() {
    // Redesenha a prévia sempre que qualquer entrada muda — um efeito só, já que
    // todo o estado do render mora em signals.
    effect(() => {
      const canvas = this.previewRef()?.nativeElement;
      const img = this.image();
      if (!canvas || !img) return;
      const ratio = this.format().ratio;
      const w = 900;
      canvas.width = w;
      canvas.height = Math.round(w / ratio);
      this.paint(canvas, img, this.adjust(), this.fit(), this.scale(), this.offsetX(), this.offsetY(), this.bgMode(), this.bgColor());
    });
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
    if (!file.type.startsWith('image/')) {
      this.error.set('Esse arquivo não é uma imagem.');
      return;
    }
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
        reader.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
        el.src = url;
      });
      this.error.set('');
      this.fileName.set(file.name);
      this.image.set(img);
      this.resetFraming();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Falha ao abrir a imagem.');
    }
  }

  removeImage(): void {
    this.image.set(null);
    this.fileName.set('');
    this.status.set('');
    this.resetFraming();
  }

  setFit(fit: FitMode): void {
    this.fit.set(fit);
    this.resetFraming();
  }

  resetFraming(): void {
    this.scale.set(1);
    this.offsetX.set(0);
    this.offsetY.set(0);
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
    const img = this.image();
    if (!img) return;
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
    this.paint(canvas, img, this.adjust(), this.fit(), this.scale(), this.offsetX(), this.offsetY(), this.bgMode(), this.bgColor());
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

  /** Desenha fundo, foto com os ajustes de cor e as camadas de acabamento
   * (temperatura, desbotado, vinheta). Usado pela prévia e pela exportação. */
  private paint(
    canvas: HTMLCanvasElement, img: HTMLImageElement, a: Adjustments,
    fit: FitMode, scale: number, dx: number, dy: number, bgMode: BgMode, bgColor: string,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const size = Math.max(w, h);
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);

    if (bgMode === 'desfoque') {
      // Fundo borrado: a própria foto cobrindo o quadro, bem desfocada.
      const cover = frameRect(iw, ih, w, h, 'cover', 1.18, 0, 0);
      ctx.filter = `blur(${size * 0.04}px) brightness(0.92) saturate(120%)`;
      ctx.drawImage(img, cover.x, cover.y, cover.w, cover.h);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);
    }

    const r = frameRect(iw, ih, w, h, fit, scale, dx, dy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.filter = filterString(a, size);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    ctx.restore();
    ctx.filter = 'none';

    if (a.temperature) {
      // Quente puxa pro laranja, frio pro azul. `overlay` mexe na cor sem lavar
      // as altas luzes, que é o que um ajuste de temperatura deve fazer.
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.min(0.45, Math.abs(a.temperature) / 100 * 0.45);
      ctx.fillStyle = a.temperature > 0 ? '#ff8a2b' : '#2b7dff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    if (a.fade) {
      ctx.globalAlpha = (a.fade / 100) * 0.4;
      ctx.fillStyle = '#f5f2ee';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    if (a.vignette) {
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${(a.vignette / 100) * 0.75})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
