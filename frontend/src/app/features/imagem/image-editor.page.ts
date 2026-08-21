import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { Polygon, pngBlobWithDpi, polygonsToPathData, traceCutPaths } from './contour';
import { CutShape, fillPolygon, shapeCanvasSize, shapePolygon } from './shapes';
import { PackInput, PlacedPiece, SheetOrientation, SheetSize, jpegToPdf, packShelves, sheetDimensionsMm } from './sheet';

interface ImportedImage {
  id: string;
  name: string;
  thumbUrl: string;
  /** Arte atual (pode ter o fundo removido). */
  source: HTMLCanvasElement;
  /** Cópia intocada pra "restaurar". */
  original: HTMLCanvasElement;
  /** Muda a cada edição do source, pra invalidar o cache da peça. */
  srcVersion: number;
  bgRemoved: boolean;
  widthMm: number;
  marginMm: number;
  gapMm: number;
  color: string;
  shape: CutShape;
  mirrored: boolean;
  copies: number;
}

interface Piece {
  canvas: HTMLCanvasElement;
  paths: Polygon[];
  ppm: number;
  artX: number;
  artY: number;
}

interface Prefs {
  widthMm: number;
  marginMm: number;
  gapMm: number;
  color: string;
  shape: CutShape;
  smoothing: number;
  fillHoles: boolean;
  sheetSize: SheetSize;
  orientation: SheetOrientation;
  spacingMm: number;
}

const MAX_MARGIN_MM = 20;
const MAX_GAP_MM = 10;
const EXPORT_DPI = 300;
const SHEET_MARGIN_MM = 10;
const SWATCHES = ['#ffffff', '#000000', '#6d5ef8', '#ff6b6b', '#ffd93d', '#4ecdc4'];
const PREFS_KEY = 'imagem-editor-prefs';
const DEFAULT_PREFS: Prefs = {
  widthMm: 100, marginMm: 3, gapMm: 0, color: '#ffffff', shape: 'silhueta',
  smoothing: 4, fillHoles: true, sheetSize: 'A4', orientation: 'retrato', spacingMm: 4,
};

const SHAPES: { id: CutShape; label: string }[] = [
  { id: 'silhueta', label: 'Silhueta' },
  { id: 'retangulo', label: 'Retângulo' },
  { id: 'arredondado', label: 'Arredondado' },
  { id: 'elipse', label: 'Elipse' },
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* prefs são só conveniência */ }
  return { ...DEFAULT_PREFS };
}

/** Silhueta da arte (canal alpha) preenchida numa cor sólida. */
function buildSilhouette(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const sil = document.createElement('canvas');
  sil.width = source.width;
  sil.height = source.height;
  const sctx = sil.getContext('2d')!;
  sctx.drawImage(source, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = color;
  sctx.fillRect(0, 0, sil.width, sil.height);
  // reforça o alpha das bordas suavizadas pra silhueta não ficar translúcida
  sctx.globalCompositeOperation = 'source-over';
  sctx.drawImage(sil, 0, 0);
  sctx.drawImage(sil, 0, 0);
  return sil;
}

/** Carimba a silhueta dilatada por um raio: a união dos deslocamentos da forma
 * cheia em todos os raios até `radius` cobre a dilatação inteira. */
function stampDilated(ctx: CanvasRenderingContext2D, sil: HTMLCanvasElement, offset: number, radius: number): void {
  const angleSteps = 16;
  const radialStep = Math.max(1, Math.floor(radius / 14));
  for (let r = radius; r > 0; r -= radialStep) {
    for (let a = 0; a < angleSteps; a++) {
      const t = (a / angleSteps) * Math.PI * 2;
      ctx.drawImage(sil, offset + Math.cos(t) * r, offset + Math.sin(t) * r);
    }
  }
  ctx.drawImage(sil, offset, offset);
}

/** Contorno tipo "sticker" seguindo a silhueta, com faixa branca opcional
 * (gapPx) entre a arte e o contorno colorido. */
function buildOutline(source: HTMLCanvasElement, marginPx: number, gapPx: number, color: string): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const m = Math.max(0, Math.round(marginPx));
  const g = Math.max(0, Math.round(gapPx));
  const total = m + g;
  const out = document.createElement('canvas');
  out.width = w + total * 2;
  out.height = h + total * 2;
  const ctx = out.getContext('2d')!;

  if (total > 0) {
    const sil = buildSilhouette(source, color);
    stampDilated(ctx, sil, total, total);
    if (g > 0) {
      const white = buildSilhouette(source, '#ffffff');
      stampDilated(ctx, white, total, g);
    }
  }

  ctx.drawImage(source, total, total);
  return out;
}

function flipHorizontal(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return out;
}

function makeThumb(source: HTMLCanvasElement): string {
  const size = 72;
  const scale = Math.min(size / source.width, size / source.height, 1);
  const thumb = document.createElement('canvas');
  thumb.width = Math.max(1, Math.round(source.width * scale));
  thumb.height = Math.max(1, Math.round(source.height * scale));
  thumb.getContext('2d')!.drawImage(source, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/png');
}

/** Remove o fundo por inundação (flood fill) a partir do pixel clicado:
 * apaga a região contígua de cor parecida (distância RGB ≤ tolerância). */
function floodRemoveBackground(source: HTMLCanvasElement, startX: number, startY: number, tolerance: number): boolean {
  const w = source.width;
  const h = source.height;
  if (startX < 0 || startY < 0 || startX >= w || startY >= h) return false;
  const ctx = source.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const start = (startY * w + startX) * 4;
  if (data[start + 3] === 0) return false;
  const r0 = data[start];
  const g0 = data[start + 1];
  const b0 = data[start + 2];
  const tol2 = tolerance * tolerance;

  const visited = new Uint8Array(w * h);
  const stack: number[] = [startY * w + startX];
  visited[stack[0]] = 1;
  while (stack.length) {
    const idx = stack.pop()!;
    const o = idx * 4;
    const dr = data[o] - r0;
    const dg = data[o + 1] - g0;
    const db = data[o + 2] - b0;
    if (dr * dr + dg * dg + db * db > tol2 || data[o + 3] === 0) continue;
    data[o + 3] = 0;
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0 && !visited[idx - 1]) { visited[idx - 1] = 1; stack.push(idx - 1); }
    if (x < w - 1 && !visited[idx + 1]) { visited[idx + 1] = 1; stack.push(idx + 1); }
    if (y > 0 && !visited[idx - w]) { visited[idx - w] = 1; stack.push(idx - w); }
    if (y < h - 1 && !visited[idx + w]) { visited[idx + w] = 1; stack.push(idx + w); }
  }
  ctx.putImageData(imageData, 0, 0);
  return true;
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
          <div class="tabs">
            <button [class.active]="view() === 'peca'" (click)="setView('peca')">Peça</button>
            <button [class.active]="view() === 'folha'" (click)="setView('folha')">
              Folha de montagem @if (totalCopies()) { ({{ totalCopies() }}) }
            </button>
          </div>

          @if (view() === 'peca') {
            @if (selected(); as sel) {
              <div class="preview-stage" [class.picking]="removingBg()">
                <canvas #previewCanvas (click)="onPreviewClick($event)"></canvas>
              </div>
              <div class="preview-meta">
                <span class="file-name">{{ sel.name }}</span>
                <span class="file-dims">
                  arte {{ formatMm(sel.widthMm) }} × {{ formatMm(artHeightMm(sel)) }} ·
                  peça {{ pieceSizeLabel(sel) }}
                </span>
              </div>
              @if (removingBg()) {
                <p class="cut-hint pick-hint">Clique na cor de fundo que quer remover. A região contígua àquela cor será apagada.</p>
              } @else {
                <p class="cut-hint">A linha tracejada vermelha é a linha de corte que sai no SVG.</p>
              }
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
                <p class="hint">Clique ou arraste arquivos aqui. PNGs com fundo transparente ficam com contorno na forma do desenho; pra fotos/JPGs use "Remover fundo".</p>
              </div>
            }
          } @else {
            <div class="preview-stage sheet-stage">
              <canvas #sheetCanvas></canvas>
            </div>
            <div class="preview-meta">
              <span>{{ sheetSize() }} {{ orientation() }} · {{ packInfo().placed }} peça(s) na folha</span>
              @if (packInfo().overflow > 0) {
                <span class="overflow-warn">{{ packInfo().overflow }} não couberam — reduza cópias/tamanho ou use A3</span>
              }
            </div>
            <p class="cut-hint">Imprima o PNG/PDF da folha e corte com o SVG da folha: as posições batem entre os dois.</p>
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
                      <img [src]="item.thumbUrl" [alt]="item.name" />
                      <span class="thumb-name">{{ item.name }}</span>
                      @if (item.copies > 1) { <span class="copies-badge">×{{ item.copies }}</span> }
                    </button>
                    <button class="remove-btn" title="Remover" (click)="remove(item.id)"><app-icon name="x" [size]="12" /></button>
                  </li>
                }
              </ul>
            }
          </section>

          @if (selected(); as sel) {
            <section class="panel-section">
              <h2>Tamanho e cópias</h2>
              <div class="field-row">
                <label class="field">
                  <span class="field-label">Largura (cm)</span>
                  <input class="num-input" type="number" min="1" max="100" step="0.1"
                    [value]="(sel.widthMm / 10).toFixed(1)" (change)="onWidthCmChange($event)" />
                </label>
                <label class="field">
                  <span class="field-label">Cópias na folha</span>
                  <input class="num-input" type="number" min="1" max="99" step="1"
                    [value]="sel.copies" (change)="onCopiesChange($event)" />
                </label>
              </div>
              <p class="field-note">Altura acompanha a proporção: {{ formatMm(artHeightMm(sel)) }}. Impressão sai a {{ dpi }} DPI.</p>
            </section>

            <section class="panel-section">
              <h2>Imagem</h2>
              <label class="check-field">
                <input type="checkbox" [checked]="sel.mirrored" (change)="onMirrorChange($event)" />
                <span>Espelhar horizontal (vinil termocolante)</span>
              </label>
              <button class="btn full" [class.primary]="removingBg()" (click)="toggleRemoveBg()">
                {{ removingBg() ? 'Clique no fundo da imagem…' : 'Remover fundo (clicar na cor)' }}
              </button>
              @if (removingBg()) {
                <label class="field">
                  <span class="field-label">Tolerância <strong>{{ tolerance() }}</strong></span>
                  <input type="range" min="5" max="120" step="5" [value]="tolerance()" (input)="onToleranceInput($event)" />
                </label>
              }
              @if (sel.bgRemoved) {
                <button class="btn full" (click)="restoreOriginal()">Restaurar imagem original</button>
              }
            </section>

            <section class="panel-section">
              <h2>Contorno e corte</h2>
              <div class="shape-row">
                @for (s of shapes; track s.id) {
                  <button class="shape-btn" [class.active]="sel.shape === s.id" (click)="setShape(s.id)">{{ s.label }}</button>
                }
              </div>
              <label class="field">
                <span class="field-label">Margem <strong>{{ sel.marginMm.toFixed(1) }} mm</strong></span>
                <input type="range" min="0" [max]="maxMarginMm" step="0.5" [value]="sel.marginMm" (input)="onMarginInput($event)" />
              </label>
              <div class="margin-nudge">
                <button class="btn" (click)="nudgeMargin(-0.5)" [disabled]="sel.marginMm <= 0">−0,5</button>
                <button class="btn" (click)="nudgeMargin(0.5)" [disabled]="sel.marginMm >= maxMarginMm">+0,5</button>
              </div>
              <label class="field">
                <span class="field-label">Espaço entre imagem e contorno <strong>{{ sel.gapMm.toFixed(1) }} mm</strong></span>
                <input type="range" min="0" [max]="maxGapMm" step="0.5" [value]="sel.gapMm" (input)="onGapInput($event)" />
              </label>
              @if (sel.shape === 'silhueta') {
                <label class="field">
                  <span class="field-label">Suavização da linha de corte <strong>{{ smoothing() }}</strong></span>
                  <input type="range" min="0" max="10" step="1" [value]="smoothing()" (input)="onSmoothingInput($event)" />
                </label>
                <label class="check-field">
                  <input type="checkbox" [checked]="fillHoles()" (change)="onFillHolesChange($event)" />
                  <span>Preencher furos internos (corta só o contorno externo)</span>
                </label>
              }
              <label class="field">
                <span class="field-label">Cor do contorno</span>
                <div class="color-row">
                  <input type="color" [value]="sel.color" (input)="onColorInput($event)" />
                  @for (sw of swatches; track sw) {
                    <button class="swatch" [class.active]="sw === sel.color" [style.background]="sw" [title]="sw" (click)="setColor(sw)"></button>
                  }
                </div>
              </label>
            </section>
          }

          <section class="panel-section">
            <h2>Folha</h2>
            <div class="field-row">
              <label class="field">
                <span class="field-label">Tamanho</span>
                <select class="num-input" [value]="sheetSize()" (change)="onSheetSizeChange($event)">
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">Orientação</span>
                <select class="num-input" [value]="orientation()" (change)="onOrientationChange($event)">
                  <option value="retrato">Retrato</option>
                  <option value="paisagem">Paisagem</option>
                </select>
              </label>
            </div>
            <label class="field">
              <span class="field-label">Espaço entre peças <strong>{{ spacingMm().toFixed(0) }} mm</strong></span>
              <input type="range" min="0" max="10" step="1" [value]="spacingMm()" (input)="onSpacingInput($event)" />
            </label>
            <button class="btn primary full" [disabled]="!images().length" (click)="exportSheetPng()">
              <app-icon name="download" [size]="14" /> PNG da folha ({{ dpi }} DPI)
            </button>
            <button class="btn primary full" [disabled]="!images().length" (click)="exportSheetPdf()">
              <app-icon name="download" [size]="14" /> PDF da folha (imprimir)
            </button>
            <button class="btn full" [disabled]="!images().length" (click)="exportSheetSvg()">
              <app-icon name="download" [size]="14" /> SVG de corte da folha
            </button>
          </section>

          <section class="panel-section">
            <h2>Exportar peça</h2>
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
    .tabs { display: flex; gap: 6px; margin-bottom: 12px; }
    .tabs button {
      border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius-sm);
      padding: 7px 14px; font-size: 13px; font-weight: 600; color: var(--text-muted); cursor: pointer;
    }
    .tabs button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
    .preview-stage {
      display: flex; align-items: center; justify-content: center;
      min-height: 420px; border-radius: var(--radius); padding: 16px;
      background:
        repeating-conic-gradient(rgba(128, 128, 128, 0.16) 0% 25%, transparent 0% 50%)
        0 0 / 22px 22px;
    }
    .preview-stage.picking canvas { cursor: crosshair; }
    .preview-stage canvas { max-width: 100%; max-height: 60dvh; }
    .sheet-stage { background: var(--bg); }
    .preview-meta {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 12px 4px 0; font-size: 12px; color: var(--text-muted);
    }
    .file-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-dims { flex-shrink: 0; }
    .overflow-warn { color: var(--danger); font-weight: 600; }
    .cut-hint { margin: 6px 4px 0; font-size: 11px; color: var(--text-muted); }
    .pick-hint { color: var(--accent-dark); font-weight: 600; }

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

    .image-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
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
    .copies-badge {
      font-size: 11px; font-weight: 700; color: var(--accent-dark);
      background: var(--accent-soft); border-radius: 999px; padding: 1px 7px; flex-shrink: 0;
    }
    .remove-btn {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border: none; background: none; border-radius: 6px;
      color: var(--text-muted); cursor: pointer; flex-shrink: 0;
    }
    .remove-btn:hover { color: var(--danger); background: var(--bg); }

    .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .field-row { display: flex; gap: 10px; }
    .field-row .field { flex: 1; }
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

    .shape-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .shape-btn {
      border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius-sm);
      padding: 6px 8px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer;
    }
    .shape-btn.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-dark); }

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
  @ViewChild('sheetCanvas') sheetCanvas?: ElementRef<HTMLCanvasElement>;

  readonly maxMarginMm = MAX_MARGIN_MM;
  readonly maxGapMm = MAX_GAP_MM;
  readonly dpi = EXPORT_DPI;
  readonly swatches = SWATCHES;
  readonly shapes = SHAPES;

  private prefs = loadPrefs();

  images = signal<ImportedImage[]>([]);
  selectedId = signal<string | null>(null);
  view = signal<'peca' | 'folha'>('peca');
  smoothing = signal(this.prefs.smoothing);
  fillHoles = signal(this.prefs.fillHoles);
  sheetSize = signal<SheetSize>(this.prefs.sheetSize);
  orientation = signal<SheetOrientation>(this.prefs.orientation);
  spacingMm = signal(this.prefs.spacingMm);
  removingBg = signal(false);
  tolerance = signal(40);
  dragOver = signal(false);
  packInfo = signal<{ placed: number; overflow: number }>({ placed: 0, overflow: 0 });

  selected = computed(() => this.images().find((i) => i.id === this.selectedId()) ?? null);
  totalCopies = computed(() => this.images().reduce((sum, i) => sum + i.copies, 0));

  private renderQueued = false;
  private pieceCache = new Map<string, { sig: string; piece: Piece }>();

  constructor(public auth: AuthService, public theme: ThemeService) {}

  ngAfterViewInit(): void {
    this.scheduleRender();
  }

  ngOnDestroy(): void {
    this.pieceCache.clear();
  }

  // ---------- helpers de exibição ----------

  artHeightMm(item: ImportedImage): number {
    return (item.widthMm * item.source.height) / item.source.width;
  }

  formatMm(mm: number): string {
    return mm >= 100 ? `${(mm / 10).toFixed(1)} cm` : `${mm.toFixed(1)} mm`;
  }

  pieceSizeLabel(item: ImportedImage): string {
    const piece = this.pieceFor(item);
    return `${this.formatMm(piece.canvas.width / piece.ppm)} × ${this.formatMm(piece.canvas.height / piece.ppm)}`;
  }

  private pxPerMm(item: ImportedImage): number {
    return item.source.width / item.widthMm;
  }

  // ---------- importação e lista ----------

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
        URL.revokeObjectURL(url);
        const source = document.createElement('canvas');
        source.width = img.naturalWidth;
        source.height = img.naturalHeight;
        source.getContext('2d')!.drawImage(img, 0, 0);
        const original = document.createElement('canvas');
        original.width = source.width;
        original.height = source.height;
        original.getContext('2d')!.drawImage(source, 0, 0);
        const item: ImportedImage = {
          id: uid(), name: file.name, thumbUrl: makeThumb(source),
          source, original, srcVersion: 0, bgRemoved: false,
          widthMm: this.prefs.widthMm, marginMm: this.prefs.marginMm, gapMm: this.prefs.gapMm,
          color: this.prefs.color, shape: this.prefs.shape, mirrored: false, copies: 1,
        };
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
    this.removingBg.set(false);
    this.scheduleRender();
  }

  remove(id: string): void {
    this.images.update((list) => list.filter((i) => i.id !== id));
    this.pieceCache.delete(id);
    if (this.selectedId() === id) {
      this.selectedId.set(this.images()[0]?.id ?? null);
    }
    this.scheduleRender();
  }

  // ---------- edição da imagem selecionada ----------

  private updateSelected(patch: Partial<ImportedImage>): void {
    const id = this.selectedId();
    if (!id) return;
    this.images.update((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    this.scheduleRender();
  }

  setView(view: 'peca' | 'folha'): void {
    this.view.set(view);
    this.removingBg.set(false);
    this.scheduleRender();
  }

  onWidthCmChange(event: Event): void {
    const cm = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(cm) || cm <= 0) return;
    const widthMm = Math.min(1000, Math.max(10, cm * 10));
    this.prefs.widthMm = widthMm;
    this.savePrefs();
    this.updateSelected({ widthMm });
  }

  onCopiesChange(event: Event): void {
    const copies = Math.min(99, Math.max(1, Math.round(Number((event.target as HTMLInputElement).value) || 1)));
    this.updateSelected({ copies });
  }

  onMirrorChange(event: Event): void {
    this.updateSelected({ mirrored: (event.target as HTMLInputElement).checked });
  }

  setShape(shape: CutShape): void {
    this.prefs.shape = shape;
    this.savePrefs();
    this.updateSelected({ shape });
  }

  onMarginInput(event: Event): void {
    const marginMm = Number((event.target as HTMLInputElement).value);
    this.prefs.marginMm = marginMm;
    this.savePrefs();
    this.updateSelected({ marginMm });
  }

  nudgeMargin(delta: number): void {
    const sel = this.selected();
    if (!sel) return;
    const marginMm = Math.min(MAX_MARGIN_MM, Math.max(0, Math.round((sel.marginMm + delta) * 2) / 2));
    this.prefs.marginMm = marginMm;
    this.savePrefs();
    this.updateSelected({ marginMm });
  }

  onGapInput(event: Event): void {
    const gapMm = Number((event.target as HTMLInputElement).value);
    this.prefs.gapMm = gapMm;
    this.savePrefs();
    this.updateSelected({ gapMm });
  }

  onColorInput(event: Event): void {
    this.setColor((event.target as HTMLInputElement).value);
  }

  setColor(color: string): void {
    this.prefs.color = color;
    this.savePrefs();
    this.updateSelected({ color });
  }

  onSmoothingInput(event: Event): void {
    this.smoothing.set(Number((event.target as HTMLInputElement).value));
    this.prefs.smoothing = this.smoothing();
    this.savePrefs();
    this.scheduleRender();
  }

  onFillHolesChange(event: Event): void {
    this.fillHoles.set((event.target as HTMLInputElement).checked);
    this.prefs.fillHoles = this.fillHoles();
    this.savePrefs();
    this.scheduleRender();
  }

  // ---------- remoção de fundo ----------

  toggleRemoveBg(): void {
    const next = !this.removingBg();
    if (next) this.view.set('peca');
    this.removingBg.set(next);
    this.scheduleRender();
  }

  onToleranceInput(event: Event): void {
    this.tolerance.set(Number((event.target as HTMLInputElement).value));
  }

  onPreviewClick(event: MouseEvent): void {
    if (!this.removingBg()) return;
    const sel = this.selected();
    const canvas = this.previewCanvas?.nativeElement;
    if (!sel || !canvas) return;
    const piece = this.pieceFor(sel);
    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;
    const px = event.offsetX * scaleX;
    const py = event.offsetY * scaleY;
    let imgX = Math.floor(px - piece.artX);
    const imgY = Math.floor(py - piece.artY);
    if (sel.mirrored) imgX = sel.source.width - 1 - imgX;
    const changed = floodRemoveBackground(sel.source, imgX, imgY, this.tolerance());
    if (changed) {
      this.updateSelected({ srcVersion: sel.srcVersion + 1, bgRemoved: true, thumbUrl: makeThumb(sel.source) });
    }
  }

  restoreOriginal(): void {
    const sel = this.selected();
    if (!sel) return;
    const ctx = sel.source.getContext('2d')!;
    ctx.clearRect(0, 0, sel.source.width, sel.source.height);
    ctx.drawImage(sel.original, 0, 0);
    this.updateSelected({ srcVersion: sel.srcVersion + 1, bgRemoved: false, thumbUrl: makeThumb(sel.source) });
  }

  // ---------- folha ----------

  onSheetSizeChange(event: Event): void {
    this.sheetSize.set((event.target as HTMLSelectElement).value as SheetSize);
    this.prefs.sheetSize = this.sheetSize();
    this.savePrefs();
    this.scheduleRender();
  }

  onOrientationChange(event: Event): void {
    this.orientation.set((event.target as HTMLSelectElement).value as SheetOrientation);
    this.prefs.orientation = this.orientation();
    this.savePrefs();
    this.scheduleRender();
  }

  onSpacingInput(event: Event): void {
    this.spacingMm.set(Number((event.target as HTMLInputElement).value));
    this.prefs.spacingMm = this.spacingMm();
    this.savePrefs();
    this.scheduleRender();
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch { /* prefs são só conveniência */ }
  }

  // ---------- geração da peça ----------

  private pieceFor(item: ImportedImage): Piece {
    const sig = JSON.stringify([
      item.widthMm, item.marginMm, item.gapMm, item.color, item.shape, item.mirrored,
      item.srcVersion, this.smoothing(), this.fillHoles(),
    ]);
    const cached = this.pieceCache.get(item.id);
    if (cached && cached.sig === sig) return cached.piece;
    const piece = this.buildPiece(item);
    this.pieceCache.set(item.id, { sig, piece });
    return piece;
  }

  private buildPiece(item: ImportedImage): Piece {
    const source = item.mirrored ? flipHorizontal(item.source) : item.source;
    const ppm = this.pxPerMm(item);
    const marginPx = Math.round(item.marginMm * ppm);
    const gapPx = Math.round(item.gapMm * ppm);
    const total = marginPx + gapPx;

    if (item.shape === 'silhueta') {
      const canvas = buildOutline(source, marginPx, gapPx, item.color);
      const s = this.smoothing();
      const paths = traceCutPaths(canvas, {
        fillHoles: this.fillHoles(),
        simplifyEpsilon: s > 0 ? ppm * s * 0.05 : ppm * 0.02,
        chaikinIterations: s >= 5 ? 2 : s >= 1 ? 1 : 0,
        minArea: Math.max(16, ppm * ppm), // descarta pedaços menores que ~1 mm²
      });
      return { canvas, paths, ppm, artX: total, artY: total };
    }

    const { W, H } = shapeCanvasSize(item.shape, source.width, source.height, total);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const cornerRadius = total + 2 * ppm;
    const outer = shapePolygon(item.shape, W, H, 0, cornerRadius);
    if (total > 0) {
      fillPolygon(ctx, outer, item.color);
      if (gapPx > 0) fillPolygon(ctx, shapePolygon(item.shape, W, H, marginPx, cornerRadius), '#ffffff');
    }
    const artX = (W - source.width) / 2;
    const artY = (H - source.height) / 2;
    ctx.drawImage(source, artX, artY);
    return { canvas, paths: [outer], ppm, artX, artY };
  }

  // ---------- render ----------

  /** Agrupa mudanças rápidas (arrastar o slider) num único redesenho por frame. */
  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (this.view() === 'peca') this.renderPreview();
      else this.renderSheet();
    });
  }

  private renderPreview(): void {
    const sel = this.selected();
    const canvas = this.previewCanvas?.nativeElement;
    if (!sel || !canvas) return;
    const piece = this.pieceFor(sel);
    canvas.width = piece.canvas.width;
    canvas.height = piece.canvas.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(piece.canvas, 0, 0);
    this.strokeCutPaths(ctx, piece.paths, Math.max(1.5, canvas.width / 500));
  }

  private strokeCutPaths(ctx: CanvasRenderingContext2D, paths: Polygon[], lineWidth: number): void {
    ctx.strokeStyle = '#e5383b';
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
    for (const poly of paths) {
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private packCurrent(): { placed: PlacedPiece[]; overflow: PackInput[]; wMm: number; hMm: number } {
    const { wMm, hMm } = sheetDimensionsMm(this.sheetSize(), this.orientation());
    const inputs: PackInput[] = [];
    for (const item of this.images()) {
      const piece = this.pieceFor(item);
      const pw = piece.canvas.width / piece.ppm;
      const ph = piece.canvas.height / piece.ppm;
      for (let c = 0; c < item.copies; c++) {
        inputs.push({ id: `${item.id}#${c}`, wMm: pw, hMm: ph });
      }
    }
    const { placed, overflow } = packShelves(inputs, wMm, hMm, SHEET_MARGIN_MM, this.spacingMm());
    return { placed, overflow, wMm, hMm };
  }

  private itemOf(placedId: string): ImportedImage | undefined {
    const id = placedId.split('#')[0];
    return this.images().find((i) => i.id === id);
  }

  private renderSheet(): void {
    const canvas = this.sheetCanvas?.nativeElement;
    if (!canvas) return;
    const { placed, overflow, wMm, hMm } = this.packCurrent();
    this.packInfo.set({ placed: placed.length, overflow: overflow.length });

    const scale = 3; // px por mm no preview
    canvas.width = Math.round(wMm * scale);
    canvas.height = Math.round(hMm * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#c9c9d4';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

    for (const p of placed) {
      const item = this.itemOf(p.id);
      if (!item) continue;
      const piece = this.pieceFor(item);
      const x = p.xMm * scale;
      const y = p.yMm * scale;
      const w = p.wMm * scale;
      const h = p.hMm * scale;
      ctx.drawImage(piece.canvas, x, y, w, h);
      const f = scale / piece.ppm; // px da peça → px do preview
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(f, f);
      this.strokeCutPaths(ctx, piece.paths, Math.max(1.2, 1.2 / f));
      ctx.restore();
    }
  }

  // ---------- exportação da peça ----------

  exportPrintPng(): void {
    const sel = this.selected();
    if (!sel) return;
    const piece = this.pieceFor(sel);
    const totalWMm = piece.canvas.width / piece.ppm;
    const targetW = Math.round((totalWMm / 25.4) * EXPORT_DPI);
    const targetH = Math.round((targetW * piece.canvas.height) / piece.canvas.width);
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(piece.canvas, 0, 0, targetW, targetH);
    out.toBlob(async (blob) => {
      if (!blob) return;
      const withDpi = await pngBlobWithDpi(blob, EXPORT_DPI);
      this.downloadBlob(withDpi, this.baseName(sel) + '-impressao.png');
    }, 'image/png');
  }

  exportCutSvg(): void {
    const sel = this.selected();
    if (!sel) return;
    const piece = this.pieceFor(sel);
    const svg = this.pieceSvg(piece, null);
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), this.baseName(sel) + '-corte.svg');
  }

  exportFullSvg(): void {
    const sel = this.selected();
    if (!sel) return;
    const piece = this.pieceFor(sel);
    const svg = this.pieceSvg(piece, piece.canvas.toDataURL('image/png'));
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), this.baseName(sel) + '-arte-corte.svg');
  }

  private pieceSvg(piece: Piece, imageHref: string | null): string {
    const wMm = piece.canvas.width / piece.ppm;
    const hMm = piece.canvas.height / piece.ppm;
    const d = polygonsToPathData(piece.paths);
    const strokePx = piece.ppm * 0.2; // 0,2 mm
    const image = imageHref
      ? `\n  <image x="0" y="0" width="${piece.canvas.width}" height="${piece.canvas.height}" href="${imageHref}" />`
      : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm.toFixed(2)}mm" height="${hMm.toFixed(2)}mm" ` +
      `viewBox="0 0 ${piece.canvas.width} ${piece.canvas.height}">${image}\n` +
      `  <path d="${d}" fill="none" stroke="#ff0000" stroke-width="${strokePx.toFixed(2)}" />\n` +
      `</svg>\n`;
  }

  // ---------- exportação da folha ----------

  private renderSheetHiRes(): { canvas: HTMLCanvasElement; wMm: number; hMm: number } | null {
    const { placed, wMm, hMm } = this.packCurrent();
    if (!placed.length) return null;
    const scale = EXPORT_DPI / 25.4; // px por mm
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(wMm * scale);
    canvas.height = Math.round(hMm * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    for (const p of placed) {
      const item = this.itemOf(p.id);
      if (!item) continue;
      const piece = this.pieceFor(item);
      ctx.drawImage(piece.canvas, p.xMm * scale, p.yMm * scale, p.wMm * scale, p.hMm * scale);
    }
    return { canvas, wMm, hMm };
  }

  exportSheetPng(): void {
    const sheet = this.renderSheetHiRes();
    if (!sheet) return;
    sheet.canvas.toBlob(async (blob) => {
      if (!blob) return;
      const withDpi = await pngBlobWithDpi(blob, EXPORT_DPI);
      this.downloadBlob(withDpi, `folha-${this.sheetSize()}.png`);
    }, 'image/png');
  }

  exportSheetPdf(): void {
    const sheet = this.renderSheetHiRes();
    if (!sheet) return;
    sheet.canvas.toBlob(async (blob) => {
      if (!blob) return;
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const pdf = jpegToPdf(jpeg, sheet.wMm, sheet.hMm, sheet.canvas.width, sheet.canvas.height);
      this.downloadBlob(pdf, `folha-${this.sheetSize()}.pdf`);
    }, 'image/jpeg', 0.92);
  }

  exportSheetSvg(): void {
    const { placed, wMm, hMm } = this.packCurrent();
    if (!placed.length) return;
    // viewBox em mm: os polígonos das peças (em px) são convertidos por ppm
    let paths = '';
    for (const p of placed) {
      const item = this.itemOf(p.id);
      if (!item) continue;
      const piece = this.pieceFor(item);
      const mmPolys = piece.paths.map((poly) =>
        poly.map(([x, y]) => [p.xMm + x / piece.ppm, p.yMm + y / piece.ppm] as [number, number]),
      );
      paths += `  <path d="${polygonsToPathData(mmPolys)}" fill="none" stroke="#ff0000" stroke-width="0.2" />\n`;
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}">\n` +
      paths +
      `</svg>\n`;
    this.downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `folha-${this.sheetSize()}-corte.svg`);
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
