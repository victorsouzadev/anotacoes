/** Modo "Redes Sociais" do Editor de Imagens: uma foto, um formato de post e
 * ajustes de cor. Tudo roda num canvas só — o mesmo caminho desenha a prévia e
 * a exportação, então o que aparece na tela é o que sai no arquivo.
 *
 * Todo seletor usa o prefixo `sm-` pra combinar com o resto da página. */

import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { IconComponent } from '../../shared/icon';
import {
  Adjustments, BgMode, FILTER_PRESETS, FilterPreset, FitMode, NEUTRAL, SOCIAL_FORMATS, SocialFormat,
  filterString, frameRect,
} from './social-model';
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
