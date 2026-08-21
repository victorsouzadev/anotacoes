import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { Polygon, pngBlobWithDpi, polygonsToPathData, traceCutPaths } from './contour';

interface ImportedImage {
  id: string;
  name: string;
  url: string;
  img: HTMLImageElement;
  /** Largura física da arte (sem a margem) em mm. */
  widthMm: number;
}

const MAX_MARGIN_MM = 20;
const DEFAULT_WIDTH_MM = 100;
const EXPORT_DPI = 300;
const SWATCHES = ['#ffffff', '#000000', '#6d5ef8', '#ff6b6b', '#ffd93d', '#4ecdc4'];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Gera a imagem com contorno tipo "sticker": dilata a silhueta (canal alpha)
 * na cor escolhida e desenha a imagem original por cima. Em imagens sem
 * transparência o contorno vira uma moldura ao redor do retângulo. */
function buildOutline(img: HTMLImageElement, marginPx: number, color: string): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const m = Math.max(0, Math.round(marginPx));
  const out = document.createElement('canvas');
  out.width = w + m * 2;
  out.height = h + m * 2;
  const ctx = out.getContext('2d')!;

  if (m > 0) {
    const sil = document.createElement('canvas');
    sil.width = w;
    sil.height = h;
    const sctx = sil.getContext('2d')!;
    sctx.drawImage(img, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = color;
    sctx.fillRect(0, 0, w, h);
    // reforça o alpha das bordas suavizadas pra silhueta não ficar translúcida
    sctx.globalCompositeOperation = 'source-over';
    sctx.drawImage(sil, 0, 0);
    sctx.drawImage(sil, 0, 0);

    const angleSteps = 16;
    const radialStep = Math.max(1, Math.floor(m / 14));
    for (let r = m; r > 0; r -= radialStep) {
      for (let a = 0; a < angleSteps; a++) {
        const t = (a / angleSteps) * Math.PI * 2;
        ctx.drawImage(sil, m + Math.cos(t) * r, m + Math.sin(t) * r);
      }
    }
    ctx.drawImage(sil, m, m);
  }

  ctx.drawImage(img, m, m);
  return out;
}

@Component({
  selector: 'app-image-editor-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="page">
      <header class="top-bar">
        <div class="brand">
          <a class="hub-link" routerLink="/" title="Voltar ao início"><app-icon name="grid" [size]="16" /></a>
          <h1><span class="brand-mark"><app-icon name="image" [size]="14" /></span> Editor de Imagens</h1>
        </div>
        <div class="top-bar-actions">
          <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()"><app-icon [name]="themeIconName()" [size]="16" /></button>
          <span class="user-email">{{ auth.user()?.email }}</span>
          <button class="logout" (click)="auth.logout()"><app-icon name="logout" [size]="14" /> Sair</button>
        </div>
      </header>

      <main class="content">
        <div class="preview-wrap">
          @if (selected(); as sel) {
            <div class="preview-stage">
              <canvas #previewCanvas></canvas>
            </div>
            <div class="preview-meta">
              <span class="file-name">{{ sel.name }}</span>
              <span class="file-dims">
                arte {{ formatMm(sel.widthMm) }} × {{ formatMm(artHeightMm(sel)) }} ·
                com margem {{ formatMm(sel.widthMm + 2 * marginMm()) }} × {{ formatMm(artHeightMm(sel) + 2 * marginMm()) }}
              </span>
            </div>
            <p class="cut-hint">A linha tracejada vermelha é a linha de corte que sai no SVG.</p>
          } @else {
            <div
              class="drop-zone"
              [class.drag-over]="dragOver()"
              (click)="fileInput.click()"
              (dragover)="onDragOver($event)"
              (dragleave)="dragOver.set(false)"
              (drop)="onDrop($event)"
            >
              <app-icon name="image" [size]="34" />
              <p><strong>Importe imagens</strong> pra gerar o contorno e a linha de corte</p>
              <p class="hint">Clique ou arraste arquivos aqui. PNGs com fundo transparente ficam com contorno na forma do desenho; imagens opacas ganham uma moldura.</p>
            </div>
          }
        </div>

        <aside class="panel">
          <section class="panel-section">
            <h2>Imagens</h2>
            <button class="btn primary full" (click)="fileInput.click()"><app-icon name="plus" [size]="14" /> Importar imagens</button>
            <input #fileInput type="file" accept="image/*" multiple hidden (change)="onFilesSelected($event)" />
            @if (images().length) {
              <ul class="image-list">
                @for (item of images(); track item.id) {
                  <li [class.active]="item.id === selectedId()">
                    <button class="thumb-btn" (click)="select(item.id)">
                      <img [src]="item.url" [alt]="item.name" />
                      <span class="thumb-name">{{ item.name }}</span>
                    </button>
                    <button class="remove-btn" title="Remover" (click)="remove(item.id)"><app-icon name="x" [size]="12" /></button>
                  </li>
                }
              </ul>
            }
          </section>

          @if (selected(); as sel) {
            <section class="panel-section">
              <h2>Tamanho real</h2>
              <label class="field">
                <span class="field-label">Largura da arte (cm)</span>
                <input
                  class="num-input"
                  type="number"
                  min="1"
                  max="100"
                  step="0.1"
                  [value]="(sel.widthMm / 10).toFixed(1)"
                  (change)="onWidthCmChange($event)"
                />
              </label>
              <p class="field-note">Altura acompanha a proporção: {{ formatMm(artHeightMm(sel)) }}. Impressão sai a {{ dpi }} DPI.</p>
            </section>
          }

          <section class="panel-section">
            <h2>Contorno e corte</h2>
            <label class="field">
              <span class="field-label">Margem <strong>{{ marginMm().toFixed(1) }} mm</strong></span>
              <input
                type="range"
                min="0"
                [max]="maxMarginMm"
                step="0.5"
                [value]="marginMm()"
                (input)="onMarginInput($event)"
              />
            </label>
            <div class="margin-nudge">
              <button class="btn" (click)="nudgeMargin(-0.5)" [disabled]="marginMm() <= 0">−0,5</button>
              <button class="btn" (click)="nudgeMargin(0.5)" [disabled]="marginMm() >= maxMarginMm">+0,5</button>
            </div>
            <label class="field">
              <span class="field-label">Suavização da linha de corte <strong>{{ smoothing() }}</strong></span>
              <input type="range" min="0" max="10" step="1" [value]="smoothing()" (input)="onSmoothingInput($event)" />
            </label>
            <label class="check-field">
              <input type="checkbox" [checked]="fillHoles()" (change)="onFillHolesChange($event)" />
              <span>Preencher furos internos (corta só o contorno externo)</span>
            </label>
            <label class="field">
              <span class="field-label">Cor do contorno</span>
              <div class="color-row">
                <input type="color" [value]="color()" (input)="onColorInput($event)" />
                @for (sw of swatches; track sw) {
                  <button
                    class="swatch"
                    [class.active]="sw === color()"
                    [style.background]="sw"
                    [title]="sw"
                    (click)="setColor(sw)"
                  ></button>
                }
              </div>
            </label>
          </section>

          <section class="panel-section">
            <h2>Exportar</h2>
            <button class="btn primary full" [disabled]="!selected()" (click)="exportPrintPng()">
              <app-icon name="download" [size]="14" /> PNG {{ dpi }} DPI (imprimir)
            </button>
            <button class="btn primary full" [disabled]="!selected()" (click)="exportCutSvg()">
              <app-icon name="download" [size]="14" /> SVG linha de corte (ScanNCut)
            </button>
            <button class="btn full" [disabled]="!selected()" (click)="exportFullSvg()">
              <app-icon name="download" [size]="14" /> SVG arte + corte
            </button>
            <p class="field-note">Importe o SVG no CanvasWorkspace (ou direto no pendrive nos modelos SDX) — as medidas já vão em mm.</p>
          </section>
        </aside>
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    .top-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 28px; background: var(--surface); border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .hub-link {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      color: var(--text-muted); text-decoration: none;
    }
    .hub-link:hover { border-color: var(--accent); color: var(--accent); }
    .top-bar h1 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
    .brand-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 8px; background: var(--accent); color: #fff; flex-shrink: 0;
    }
    .top-bar-actions { display: flex; align-items: center; gap: 14px; }
    .theme-toggle {
      border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius-sm);
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
      color: var(--text-muted); flex-shrink: 0;
    }
    .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .user-email { font-size: 12px; color: var(--text-muted); }
    .logout { display: flex; align-items: center; gap: 5px; border: none; background: none; color: var(--text-muted); font-size: 12px; font-weight: 600; }
    .logout:hover { color: var(--danger); }

    .content {
      max-width: 1180px; margin: 0 auto; padding: 32px 28px 64px;
      display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start;
    }

    .preview-wrap {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm); padding: 16px;
    }
    .preview-stage {
      display: flex; align-items: center; justify-content: center;
      min-height: 420px; border-radius: var(--radius); padding: 16px;
      background:
        repeating-conic-gradient(rgba(128, 128, 128, 0.16) 0% 25%, transparent 0% 50%)
        0 0 / 22px 22px;
    }
    .preview-stage canvas { max-width: 100%; max-height: 60dvh; }
    .preview-meta {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 12px 4px 0; font-size: 12px; color: var(--text-muted);
    }
    .file-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-dims { flex-shrink: 0; }
    .cut-hint { margin: 6px 4px 0; font-size: 11px; color: var(--text-muted); }

    .drop-zone {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      min-height: 420px; border: 2px dashed var(--border); border-radius: var(--radius);
      color: var(--text-muted); text-align: center; padding: 24px; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .drop-zone:hover, .drop-zone.drag-over { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-dark); }
    .drop-zone p { margin: 0; font-size: 14px; }
    .drop-zone .hint { font-size: 12px; max-width: 380px; line-height: 1.5; }

    .panel { display: flex; flex-direction: column; gap: 16px; }
    .panel-section {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm); padding: 16px; display: flex; flex-direction: column; gap: 10px;
    }
    .panel-section h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }

    .btn {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius-sm);
      padding: 8px 12px; font-size: 13px; font-weight: 600; color: inherit; cursor: pointer;
    }
    .btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn.primary:hover:not(:disabled) { background: var(--accent-dark); color: #fff; }
    .btn.full { width: 100%; }

    .image-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
    .image-list li {
      display: flex; align-items: center; gap: 6px;
      border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 6px;
    }
    .image-list li.active { border-color: var(--accent); background: var(--accent-soft); }
    .thumb-btn {
      display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
      border: none; background: none; padding: 2px; text-align: left; cursor: pointer; color: inherit;
    }
    .thumb-btn img {
      width: 36px; height: 36px; object-fit: contain; border-radius: 6px; flex-shrink: 0;
      background:
        repeating-conic-gradient(rgba(128, 128, 128, 0.16) 0% 25%, transparent 0% 50%)
        0 0 / 12px 12px;
    }
    .thumb-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .remove-btn {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border: none; background: none; border-radius: 6px;
      color: var(--text-muted); cursor: pointer; flex-shrink: 0;
    }
    .remove-btn:hover { color: var(--danger); background: var(--bg); }

    .field { display: flex; flex-direction: column; gap: 6px; }
    .field-label { font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between; }
    .field-label strong { color: var(--text); }
    .field input[type='range'] { width: 100%; accent-color: var(--accent); }
    .field-note { margin: 0; font-size: 11px; color: var(--text-muted); line-height: 1.5; }
    .num-input {
      border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius-sm);
      padding: 7px 10px; font-size: 13px; color: inherit; width: 100%;
    }
    .num-input:focus { outline: none; border-color: var(--accent); }
    .margin-nudge { display: flex; gap: 6px; }
    .margin-nudge .btn { flex: 1; padding: 5px 0; }
    .check-field { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--text-muted); cursor: pointer; }
    .check-field input { accent-color: var(--accent); margin-top: 1px; }

    .color-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .color-row input[type='color'] {
      width: 34px; height: 28px; padding: 2px; border: 1px solid var(--border);
      border-radius: var(--radius-sm); background: var(--bg); cursor: pointer;
    }
    .swatch {
      width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border);
      cursor: pointer; padding: 0; flex-shrink: 0;
    }
    .swatch.active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }

    @media (max-width: 900px) {
      .top-bar { padding: 12px 16px; }
      .user-email { display: none; }
      .content { grid-template-columns: 1fr; padding: 20px 16px 48px; }
      .preview-stage, .drop-zone { min-height: 300px; }
    }
  `],
})
export class ImageEditorPageComponent implements AfterViewInit, OnDestroy {
  @ViewChild('previewCanvas') previewCanvas?: ElementRef<HTMLCanvasElement>;

  readonly maxMarginMm = MAX_MARGIN_MM;
  readonly dpi = EXPORT_DPI;
  readonly swatches = SWATCHES;

  images = signal<ImportedImage[]>([]);
  selectedId = signal<string | null>(null);
  marginMm = signal(3);
  smoothing = signal(4);
  fillHoles = signal(true);
  color = signal('#ffffff');
  dragOver = signal(false);

  selected = computed(() => this.images().find((i) => i.id === this.selectedId()) ?? null);

  private renderQueued = false;

  constructor(public auth: AuthService, public theme: ThemeService) {}

  ngAfterViewInit(): void {
    this.scheduleRender();
  }

  ngOnDestroy(): void {
    for (const item of this.images()) URL.revokeObjectURL(item.url);
  }

  artHeightMm(item: ImportedImage): number {
    return (item.widthMm * item.img.naturalHeight) / item.img.naturalWidth;
  }

  formatMm(mm: number): string {
    return mm >= 100 ? `${(mm / 10).toFixed(1)} cm` : `${mm.toFixed(1)} mm`;
  }

  private pxPerMm(item: ImportedImage): number {
    return item.img.naturalWidth / item.widthMm;
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (event.dataTransfer?.files) this.addFiles(Array.from(event.dataTransfer.files));
  }

  private addFiles(files: File[]): void {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const item: ImportedImage = { id: uid(), name: file.name, url, img, widthMm: DEFAULT_WIDTH_MM };
        this.images.update((list) => [...list, item]);
        if (!this.selectedId()) this.selectedId.set(item.id);
        this.scheduleRender();
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    }
  }

  select(id: string): void {
    this.selectedId.set(id);
    this.scheduleRender();
  }

  remove(id: string): void {
    const item = this.images().find((i) => i.id === id);
    if (item) URL.revokeObjectURL(item.url);
    this.images.update((list) => list.filter((i) => i.id !== id));
    if (this.selectedId() === id) {
      this.selectedId.set(this.images()[0]?.id ?? null);
    }
    this.scheduleRender();
  }

  onWidthCmChange(event: Event): void {
    const cm = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(cm) || cm <= 0) return;
    const widthMm = Math.min(1000, Math.max(10, cm * 10));
    const id = this.selectedId();
    this.images.update((list) => list.map((i) => (i.id === id ? { ...i, widthMm } : i)));
    this.scheduleRender();
  }

  onMarginInput(event: Event): void {
    this.marginMm.set(Number((event.target as HTMLInputElement).value));
    this.scheduleRender();
  }

  nudgeMargin(delta: number): void {
    this.marginMm.update((m) => Math.min(MAX_MARGIN_MM, Math.max(0, Math.round((m + delta) * 2) / 2)));
    this.scheduleRender();
  }

  onSmoothingInput(event: Event): void {
    this.smoothing.set(Number((event.target as HTMLInputElement).value));
    this.scheduleRender();
  }

  onFillHolesChange(event: Event): void {
    this.fillHoles.set((event.target as HTMLInputElement).checked);
    this.scheduleRender();
  }

  onColorInput(event: Event): void {
    this.color.set((event.target as HTMLInputElement).value);
    this.scheduleRender();
  }

  setColor(color: string): void {
    this.color.set(color);
    this.scheduleRender();
  }

  private buildFor(item: ImportedImage): HTMLCanvasElement {
    return buildOutline(item.img, this.marginMm() * this.pxPerMm(item), this.color());
  }

  private traceFor(item: ImportedImage, outline: HTMLCanvasElement): Polygon[] {
    const ppm = this.pxPerMm(item);
    const s = this.smoothing();
    return traceCutPaths(outline, {
      fillHoles: this.fillHoles(),
      simplifyEpsilon: s > 0 ? ppm * s * 0.05 : ppm * 0.02,
      chaikinIterations: s >= 5 ? 2 : s >= 1 ? 1 : 0,
      minArea: Math.max(16, ppm * ppm), // descarta pedaços menores que ~1 mm²
    });
  }

  /** Agrupa mudanças rápidas (arrastar o slider) num único redesenho por frame. */
  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderPreview();
    });
  }

  private renderPreview(): void {
    const sel = this.selected();
    const canvas = this.previewCanvas?.nativeElement;
    if (!sel || !canvas) return;
    const result = this.buildFor(sel);
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(result, 0, 0);

    const paths = this.traceFor(sel, result);
    ctx.strokeStyle = '#e5383b';
    ctx.lineWidth = Math.max(1.5, result.width / 500);
    ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3]);
    for (const poly of paths) {
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  /** PNG pra imprimir: redimensionado pro tamanho físico a 300 DPI, com o DPI
   * gravado no arquivo (chunk pHYs) pra impressão sair na medida certa. */
  exportPrintPng(): void {
    const sel = this.selected();
    if (!sel) return;
    const result = this.buildFor(sel);
    const totalWMm = sel.widthMm + 2 * this.marginMm();
    const targetW = Math.round((totalWMm / 25.4) * EXPORT_DPI);
    const targetH = Math.round((targetW * result.height) / result.width);
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(result, 0, 0, targetW, targetH);
    out.toBlob(async (blob) => {
      if (!blob) return;
      const withDpi = await pngBlobWithDpi(blob, EXPORT_DPI);
      this.downloadBlob(withDpi, this.baseName(sel) + '-impressao.png');
    }, 'image/png');
  }

  /** SVG só com a linha de corte, em mm — pro CanvasWorkspace / ScanNCut. */
  exportCutSvg(): void {
    const sel = this.selected();
    if (!sel) return;
    const result = this.buildFor(sel);
    const paths = this.traceFor(sel, result);
    const svg = this.svgDocument(sel, result, paths, null);
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), this.baseName(sel) + '-corte.svg');
  }

  /** SVG com a arte embutida + linha de corte por cima, em camadas. */
  exportFullSvg(): void {
    const sel = this.selected();
    if (!sel) return;
    const result = this.buildFor(sel);
    const paths = this.traceFor(sel, result);
    const svg = this.svgDocument(sel, result, paths, result.toDataURL('image/png'));
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), this.baseName(sel) + '-arte-corte.svg');
  }

  private svgDocument(item: ImportedImage, outline: HTMLCanvasElement, paths: Polygon[], imageHref: string | null): string {
    const ppm = this.pxPerMm(item);
    const wMm = outline.width / ppm;
    const hMm = outline.height / ppm;
    const d = polygonsToPathData(paths);
    const strokePx = ppm * 0.2; // 0,2 mm
    const image = imageHref
      ? `\n  <image x="0" y="0" width="${outline.width}" height="${outline.height}" href="${imageHref}" />`
      : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm.toFixed(2)}mm" height="${hMm.toFixed(2)}mm" ` +
      `viewBox="0 0 ${outline.width} ${outline.height}">${image}\n` +
      `  <path d="${d}" fill="none" stroke="#ff0000" stroke-width="${strokePx.toFixed(2)}" />\n` +
      `</svg>\n`;
  }

  private baseName(item: ImportedImage): string {
    return item.name.replace(/\.[^.]+$/, '');
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  themeIconName(): IconName {
    switch (this.theme.pref()) {
      case 'dark': return 'moon';
      case 'light': return 'sun';
      default: return 'monitor';
    }
  }

  themeLabel(): string {
    switch (this.theme.pref()) {
      case 'dark': return 'Tema: escuro (clique para claro)';
      case 'light': return 'Tema: claro (clique para automático)';
      default: return 'Tema: automático (clique para escuro)';
    }
  }
}
