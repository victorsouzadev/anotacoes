/** Modo "Molde SVG" do Editor de Imagens: o usuário sobe um .svg com buracos,
 * arrasta fotos pra dentro deles e ajusta o enquadramento. Cada foto é uma
 * camada — o mesmo buraco aceita várias, com ordem e opacidade próprias. */

import { Component, ElementRef, HostListener, ViewEncapsulation, effect, signal, viewChild } from '@angular/core';
import { IconComponent } from '../../shared/icon';
import { pngBlobWithDpi } from './contour';
import { jpegToPdf } from './sheet';
import { NEW_PHOTO_DEFAULTS, TemplateStore } from './template-store';
import {
  ParsedTemplate,
  PhotoLayer,
  TemplateError,
  downloadBlob,
  loadImageElement,
  renderPhotos,
  renderSlotHits,
  serializeForExport,
} from './svg-template';

const EXPORT_DPI = 300;
/** Teto de área do raster de exportação (~60 MP): acima disso o canvas estoura em navegador modesto. */
const MAX_EXPORT_PIXELS = 60_000_000;
/** As fotos vão embutidas no projeto salvo (teto de 9 MB no backend) e podem ser
 * várias por molde — 2000 px já cobre impressão a 300 DPI em ~17 cm. */
const MAX_PHOTO_DIMENSION = 2000;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const MIN_PHOTO_SCALE = 0.2;
const MAX_PHOTO_SCALE = 8;

type SectionId = 'molde' | 'encaixes' | 'fotos' | 'ajuste' | 'exportar';

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  baseDx: number;
  baseDy: number;
  photoId: string;
  moved: boolean;
  slotId: string;
  cycle: boolean;
}

function hasFiles(data: DataTransfer | null): boolean {
  return Array.from(data?.types ?? []).includes('Files');
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsText(file);
  });
}

function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/** Reduz e reencoda a foto: JPEG quando não há transparência, PNG quando há —
 * a mesma regra do editor de notas, aqui pra caber no projeto salvo. */
function normalizePhoto(img: HTMLImageElement, original: string, mime: string): { src: string; w: number; h: number } {
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;
  const factor = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(natW, natH));
  const w = Math.max(1, Math.round(natW * factor));
  const h = Math.max(1, Math.round(natH * factor));
  if (factor === 1 && mime === 'image/jpeg') return { src: original, w, h };
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const src = hasAlpha(ctx, w, h) ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
  return { src, w, h };
}

@Component({
  selector: 'app-template-mode',
  standalone: true,
  imports: [IconComponent],
  // Sem encapsulamento porque o SVG do molde entra por appendChild e não recebe
  // o atributo de escopo do Angular. Por isso todo seletor daqui usa o prefixo `tm-`.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="tm-preview-wrap">
      <div class="tm-tabs">
        <span class="tm-tab-label">
          @if (store.hasTemplate()) {
            {{ store.slots().length }} encaixe(s) · {{ store.photos().length }} foto(s)
          } @else {
            Molde SVG
          }
        </span>
        @if (store.hasTemplate()) {
          <div class="tm-zoom-bar" title="Ctrl + roda do mouse também dá zoom">
            <button (click)="zoomBy(1 / 1.25)" aria-label="Menos zoom">−</button>
            <button class="tm-zoom-level" (click)="resetZoom()" title="Ajustar à tela">{{ (zoom() * 100).toFixed(0) }}%</button>
            <button (click)="zoomBy(1.25)" aria-label="Mais zoom">+</button>
          </div>
        }
      </div>

      @if (store.hasTemplate()) {
        <div
          #stage
          class="tm-stage"
          [class.tm-drag-over]="dragOver()"
          [class.tm-marking]="marking()"
          (wheel)="onWheel($event)"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp($event)"
          (pointercancel)="onPointerUp($event)"
        >
          <div #svgHost class="tm-svg-host"></div>
        </div>
        <div class="tm-meta">
          <span class="tm-file-name">{{ store.fileName() || 'molde.svg' }}</span>
          <span>impressão {{ store.widthMm().toFixed(1) }} × {{ store.heightMm().toFixed(1) }} mm</span>
        </div>
        <p class="tm-hint">
          @if (marking()) {
            Clique numa forma do molde pra transformá-la em encaixe. Segure Alt pra pegar o grupo inteiro.
          } @else if (hint()) {
            {{ hint() }}
          } @else {
            Arraste uma foto pra cima de um encaixe. Solte outra no mesmo lugar pra empilhar.
          }
        </p>
      } @else {
        <div
          class="tm-drop-zone"
          [class.tm-drag-over]="dragOver()"
          (click)="svgInput.click()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
        >
          <app-icon name="image" [size]="34" />
          <p><strong>Solte um molde .svg aqui</strong></p>
          <p class="tm-sub">
            Encaixes com <code>id</code> começando em "foto" (ou rótulo do Inkscape) são
            detectados sozinhos — nos outros é só clicar na forma depois.
          </p>
          @if (store.error()) { <p class="tm-error">{{ store.error() }}</p> }
        </div>
      }
    </div>

    <aside class="tm-panel">
      <input #svgInput type="file" accept=".svg,image/svg+xml" hidden (change)="onSvgInput($event)" />
      <input #photoInput type="file" accept="image/*" multiple hidden (change)="onPhotoInput($event)" />

      <section class="tm-section" [class.tm-open]="isOpen('molde')">
        <button class="tm-section-head" (click)="toggle('molde')">
          <span class="tm-section-title"><app-icon name="image" [size]="13" /> Molde</span>
          <span class="tm-section-summary">{{ store.fileName() || 'nenhum' }}</span>
          <app-icon class="tm-chevron" name="chevron" [size]="14" />
        </button>
        <div class="tm-section-body">
          <div class="tm-row">
            <button class="tm-btn" (click)="svgInput.click()"><app-icon name="folder" [size]="13" /> Trocar molde</button>
            @if (store.hasTemplate()) {
              <button class="tm-btn tm-danger" (click)="removeTemplate()"><app-icon name="delete" [size]="13" /> Remover</button>
            }
          </div>
          @if (store.hasTemplate()) {
            <label class="tm-field">
              <span>Largura de impressão (mm)</span>
              <input type="number" min="10" max="2000" step="1" [value]="store.widthMm()" (input)="onWidthMm($event)" />
            </label>
            <p class="tm-note">Altura: {{ store.heightMm().toFixed(1) }} mm (segue a proporção do molde).</p>
          }
        </div>
      </section>

      @if (store.hasTemplate()) {
        <section class="tm-section" [class.tm-open]="isOpen('encaixes')">
          <button class="tm-section-head" (click)="toggle('encaixes')">
            <span class="tm-section-title"><app-icon name="rect" [size]="13" /> Encaixes</span>
            <span class="tm-section-summary">{{ store.slots().length }}</span>
            <app-icon class="tm-chevron" name="chevron" [size]="14" />
          </button>
          <div class="tm-section-body">
            <button class="tm-btn tm-wide" [class.tm-active]="marking()" (click)="toggleMarking()">
              <app-icon name="plus" [size]="13" /> {{ marking() ? 'Clique numa forma…' : 'Marcar encaixe' }}
            </button>
            @if (!store.slots().length) {
              <p class="tm-note">
                Nenhum encaixe detectado. Use "Marcar encaixe" e clique na forma que deve receber a
                foto — ou nomeie a forma como <code>foto1</code> no Inkscape/Illustrator.
              </p>
            }
            @for (slot of store.slots(); track slot.id) {
              <div class="tm-item" [class.tm-item-active]="activeSlot() === slot.id">
                <input class="tm-item-name" [value]="slot.label" (input)="onSlotRename(slot.id, $event)" />
                <span class="tm-count">{{ store.photosOfSlot(slot.id).length }}</span>
                <button class="tm-icon-btn" title="Adicionar foto" (click)="pickPhotoFor(slot.id)"><app-icon name="plus" [size]="13" /></button>
                <button class="tm-icon-btn tm-danger" title="Remover encaixe" (click)="store.removeSlot(slot.id)"><app-icon name="delete" [size]="13" /></button>
              </div>
            }
          </div>
        </section>

        <section class="tm-section" [class.tm-open]="isOpen('fotos')">
          <button class="tm-section-head" (click)="toggle('fotos')">
            <span class="tm-section-title"><app-icon name="duplicate" [size]="13" /> Fotos</span>
            <span class="tm-section-summary">{{ store.photos().length }}</span>
            <app-icon class="tm-chevron" name="chevron" [size]="14" />
          </button>
          <div class="tm-section-body">
            @if (!store.photos().length) {
              <p class="tm-note">Arraste fotos pra cima dos encaixes. A última solta fica na frente.</p>
            }
            @for (photo of store.stack(); track photo.id) {
              <div class="tm-layer" [class.tm-item-active]="store.selectedPhotoId() === photo.id" (click)="selectPhoto(photo)">
                <img class="tm-thumb" [src]="photo.src" alt="" />
                <div class="tm-layer-info">
                  <span class="tm-layer-name">{{ photo.name }}</span>
                  <span class="tm-layer-sub">{{ slotLabel(photo.slotId) }} · {{ (photo.opacity * 100).toFixed(0) }}%</span>
                </div>
                <div class="tm-layer-actions">
                  <button class="tm-icon-btn" title="Trazer pra frente" (click)="reorder($event, photo.id, 'frente')">↑</button>
                  <button class="tm-icon-btn" title="Enviar pra trás" (click)="reorder($event, photo.id, 'tras')">↓</button>
                  <button
                    class="tm-icon-btn tm-depth"
                    [class.tm-active]="photo.depth === 'atras'"
                    [title]="photo.depth === 'atras' ? 'Está atrás do molde' : 'Está na frente do molde'"
                    (click)="toggleDepth($event, photo)"
                  >{{ photo.depth === 'atras' ? 'atrás' : 'frente' }}</button>
                  <button class="tm-icon-btn tm-danger" title="Remover foto" (click)="removePhoto($event, photo.id)"><app-icon name="delete" [size]="13" /></button>
                </div>
              </div>
            }
          </div>
        </section>

        @if (store.selectedPhoto(); as photo) {
          <section class="tm-section" [class.tm-open]="isOpen('ajuste')">
            <button class="tm-section-head" (click)="toggle('ajuste')">
              <span class="tm-section-title"><app-icon name="select" [size]="13" /> Ajuste</span>
              <span class="tm-section-summary">{{ photo.name }}</span>
              <app-icon class="tm-chevron" name="chevron" [size]="14" />
            </button>
            <div class="tm-section-body">
              <label class="tm-slider">
                <span>Opacidade <strong>{{ (photo.opacity * 100).toFixed(0) }}%</strong></span>
                <input type="range" min="0" max="100" step="1" [value]="photo.opacity * 100" (input)="onOpacity(photo.id, $event)" />
              </label>
              <label class="tm-slider">
                <span>Zoom <strong>{{ (photo.scale * 100).toFixed(0) }}%</strong></span>
                <input type="range" min="20" max="800" step="1" [value]="photo.scale * 100" (input)="onScale(photo.id, $event)" />
              </label>
              <label class="tm-slider">
                <span>Girar <strong>{{ photo.rotation.toFixed(0) }}°</strong></span>
                <input type="range" min="-180" max="180" step="1" [value]="photo.rotation" (input)="onRotation(photo.id, $event)" />
              </label>
              <div class="tm-row">
                <button class="tm-btn" (click)="rotateBy(photo, -90)">−90°</button>
                <button class="tm-btn" (click)="rotateBy(photo, 90)">+90°</button>
                <button class="tm-btn" [class.tm-active]="photo.flipX" (click)="store.patchPhoto(photo.id, { flipX: !photo.flipX })">Espelhar</button>
              </div>
              <div class="tm-row">
                <button class="tm-btn" [class.tm-active]="photo.fit === 'cover'" (click)="store.patchPhoto(photo.id, { fit: 'cover' })">Preencher</button>
                <button class="tm-btn" [class.tm-active]="photo.fit === 'contain'" (click)="store.patchPhoto(photo.id, { fit: 'contain' })">Caber</button>
                <button class="tm-btn" (click)="store.reframe(photo.id)">Reenquadrar</button>
              </div>
              <p class="tm-note">Arraste a foto direto no palco pra mover; roda do mouse sobre ela dá zoom.</p>
            </div>
          </section>
        }

        <section class="tm-section" [class.tm-open]="isOpen('exportar')">
          <button class="tm-section-head" (click)="toggle('exportar')">
            <span class="tm-section-title"><app-icon name="download" [size]="13" /> Exportar</span>
            <span class="tm-section-summary">{{ store.widthMm().toFixed(0) }} mm</span>
            <app-icon class="tm-chevron" name="chevron" [size]="14" />
          </button>
          <div class="tm-section-body">
            <button class="tm-btn tm-wide" [disabled]="busy()" (click)="exportPng()"><app-icon name="download" [size]="13" /> PNG {{ dpi }} DPI</button>
            <button class="tm-btn tm-wide" [disabled]="busy()" (click)="exportSvg()"><app-icon name="download" [size]="13" /> SVG (fotos embutidas)</button>
            <button class="tm-btn tm-wide" [disabled]="busy()" (click)="exportPdf()"><app-icon name="download" [size]="13" /> PDF pra impressão</button>
            <p class="tm-note">
              O PNG e o PDF são rasterizados pelo navegador: se o molde usar uma fonte instalada
              no seu computador, o SVG é o único que preserva o texto como texto.
            </p>
            @if (exportStatus()) { <p class="tm-note">{{ exportStatus() }}</p> }
          </div>
        </section>
      }
    </aside>
  `,
  styles: [`
    /* O host precisa sumir da grade: os dois filhos é que são as colunas da página. */
    app-template-mode { display: contents; }

    .tm-preview-wrap { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .tm-tabs { display: flex; align-items: center; gap: 8px; }
    .tm-tab-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .tm-zoom-bar { margin-left: auto; display: flex; align-items: center; gap: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
    .tm-zoom-bar button { border: none; background: none; color: var(--text-muted); font-size: 13px; font-weight: 700; padding: 4px 9px; }
    .tm-zoom-bar button:hover { color: var(--accent); }
    .tm-zoom-level { font-size: 11px; min-width: 46px; }

    .tm-stage {
      flex: 1;
      min-height: 320px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      padding: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
      touch-action: none;
    }
    .tm-stage.tm-drag-over { border-color: var(--accent); background: var(--accent-soft); }
    .tm-stage.tm-marking { cursor: crosshair; }
    .tm-svg-host { flex: none; line-height: 0; }
    .tm-svg-host svg { display: block; width: 100%; height: 100%; }

    /* O SVG do molde entra por appendChild: estes seletores precisam ser globais. */
    .tm-hit, .tm-hit * { pointer-events: all; }
    .tm-hit { cursor: grab; }
    .tm-hit-empty * { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 6 4; }
    .tm-hit-selected * { stroke: var(--accent); stroke-width: 2; stroke-dasharray: 4 3; }

    .tm-meta { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--text-muted); }
    .tm-file-name { font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tm-hint { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.4; }
    .tm-error { color: var(--danger); font-size: 12px; }

    .tm-drop-zone {
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
    .tm-drop-zone:hover, .tm-drop-zone.tm-drag-over { border-color: var(--accent); background: var(--accent-soft); }
    .tm-drop-zone p { margin: 0; font-size: 13px; }
    .tm-drop-zone .tm-sub { font-size: 12px; max-width: 380px; line-height: 1.45; }
    .tm-drop-zone code, .tm-note code { font-size: 11px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; }

    .tm-panel { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .tm-section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .tm-section-head {
      width: 100%;
      display: flex; align-items: center; gap: 8px;
      padding: 11px 13px;
      border: none; background: none; color: inherit; text-align: left;
    }
    .tm-section-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
    .tm-section-summary { margin-left: auto; font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
    .tm-chevron { color: var(--text-muted); transition: transform 0.15s; flex-shrink: 0; }
    .tm-section.tm-open .tm-chevron { transform: rotate(180deg); }
    .tm-section-body { display: none; flex-direction: column; gap: 9px; padding: 0 13px 13px; }
    .tm-section.tm-open .tm-section-body { display: flex; }

    .tm-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .tm-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      padding: 7px 10px;
      font-size: 12px; font-weight: 600;
      color: var(--text-muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .tm-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .tm-btn:disabled { opacity: 0.5; }
    .tm-btn.tm-wide { width: 100%; }
    .tm-btn.tm-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .tm-btn.tm-danger:hover { border-color: var(--danger); color: var(--danger); }

    .tm-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .tm-field input { padding: 7px 9px; font-size: 13px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .tm-note { margin: 0; font-size: 11px; line-height: 1.45; color: var(--text-muted); }

    .tm-item, .tm-layer {
      display: flex; align-items: center; gap: 6px;
      padding: 6px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg);
    }
    .tm-item-active { border-color: var(--accent); background: var(--accent-soft); }
    .tm-item-name { flex: 1; min-width: 0; padding: 4px 6px; font-size: 12px; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; }
    .tm-count { font-size: 11px; font-weight: 700; color: var(--text-muted); min-width: 16px; text-align: center; }
    .tm-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; flex-shrink: 0;
      font-size: 12px; font-weight: 700;
      color: var(--text-muted); background: var(--surface);
      border: 1px solid var(--border); border-radius: 6px;
    }
    .tm-icon-btn:hover { border-color: var(--accent); color: var(--accent); }
    .tm-icon-btn.tm-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .tm-icon-btn.tm-danger:hover { border-color: var(--danger); color: var(--danger); }
    .tm-icon-btn.tm-depth { width: auto; padding: 0 6px; font-size: 10px; font-weight: 600; }

    .tm-layer { cursor: pointer; }
    .tm-thumb { width: 34px; height: 34px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); flex-shrink: 0; }
    .tm-layer-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .tm-layer-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tm-layer-sub { font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tm-layer-actions { display: flex; gap: 3px; flex-shrink: 0; }

    .tm-slider { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-muted); }
    .tm-slider strong { color: var(--text); }
    .tm-slider input { width: 100%; accent-color: var(--accent); }

    @media (max-width: 900px) {
      .tm-stage, .tm-drop-zone { min-height: 240px; }
      .tm-layer-actions { gap: 2px; }
    }
  `],
})
export class TemplateModeComponent {
  readonly dpi = EXPORT_DPI;

  svgHost = viewChild<ElementRef<HTMLDivElement>>('svgHost');
  stage = viewChild<ElementRef<HTMLDivElement>>('stage');
  photoInput = viewChild<ElementRef<HTMLInputElement>>('photoInput');

  zoom = signal(1);
  dragOver = signal(false);
  marking = signal(false);
  activeSlot = signal<string | null>(null);
  hint = signal('');
  busy = signal(false);
  exportStatus = signal('');
  open = signal<Record<string, boolean>>({ molde: true, encaixes: true, fotos: true, ajuste: true, exportar: false });

  private mounted: ParsedTemplate | null = null;
  private drag: DragState | null = null;
  private pendingSlotForPicker: string | null = null;

  constructor(public store: TemplateStore) {
    effect(() => {
      const host = this.svgHost()?.nativeElement;
      const parsed = this.store.parsed();
      if (!host || !parsed) {
        this.mounted = null;
        return;
      }
      if (this.mounted !== parsed) {
        host.replaceChildren(document.adoptNode(parsed.root));
        this.mounted = parsed;
        this.applyZoom();
        if (this.store.slots().length) {
          this.store.refreshRects(parsed.root);
        } else if (!this.store.detectSlots(parsed.root)) {
          this.hint.set('Nenhum encaixe detectado — use "Marcar encaixe" e clique na forma que recebe a foto.');
          this.marking.set(true);
        } else {
          this.hint.set('');
        }
      }
      // Repinta a cada mudança de encaixe, camada ou seleção.
      renderPhotos(parsed.root, this.store.slots(), this.store.photos(), parsed.idPrefix);
      renderSlotHits(parsed.root, this.store.slots(), {
        selectedSlot: this.store.selectedPhoto()?.slotId ?? this.activeSlot(),
        emptySlots: this.store.emptySlotIds(),
      });
    });
  }

  // ---------- painel ----------

  isOpen(id: SectionId): boolean {
    return this.open()[id] ?? false;
  }

  toggle(id: SectionId): void {
    this.open.update((state) => ({ ...state, [id]: !state[id] }));
  }

  slotLabel(slotId: string): string {
    return this.store.slotOf(slotId)?.label ?? 'encaixe removido';
  }

  // ---------- molde ----------

  onSvgInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.loadTemplateFile(file);
    input.value = '';
  }

  private async loadTemplateFile(file: File): Promise<void> {
    try {
      const text = await readAsText(file);
      this.store.loadSvgText(text, file.name);
      this.store.error.set('');
      this.mounted = null;
      this.zoom.set(1);
      this.marking.set(false);
      this.hint.set('');
    } catch (err) {
      const message = err instanceof TemplateError ? err.message : 'Não consegui abrir esse arquivo.';
      this.store.error.set(message);
      // Com um molde já na tela a área de soltar some, e com ela o aviso de erro.
      this.hint.set(message);
    }
  }

  removeTemplate(): void {
    this.store.clear();
    this.mounted = null;
    this.marking.set(false);
    this.hint.set('');
  }

  onWidthMm(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value) && value > 0) this.store.widthMm.set(clamp(value, 10, 2000));
  }

  // ---------- encaixes ----------

  toggleMarking(): void {
    this.marking.update((v) => !v);
  }

  onSlotRename(slotId: string, event: Event): void {
    this.store.renameSlot(slotId, (event.target as HTMLInputElement).value);
  }

  pickPhotoFor(slotId: string): void {
    this.pendingSlotForPicker = slotId;
    this.photoInput()?.nativeElement.click();
  }

  onPhotoInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const slotId = this.pendingSlotForPicker ?? this.targetSlotId();
    this.pendingSlotForPicker = null;
    input.value = '';
    if (!slotId) {
      this.hint.set('Marque um encaixe antes de escolher a foto.');
      return;
    }
    void this.addPhotos(files, slotId);
  }

  // ---------- camadas ----------

  selectPhoto(photo: PhotoLayer): void {
    this.store.selectedPhotoId.set(photo.id);
    this.activeSlot.set(photo.slotId);
  }

  reorder(event: Event, photoId: string, to: 'frente' | 'tras'): void {
    event.stopPropagation();
    this.store.reorder(photoId, to);
  }

  toggleDepth(event: Event, photo: PhotoLayer): void {
    event.stopPropagation();
    this.store.patchPhoto(photo.id, { depth: photo.depth === 'atras' ? 'frente' : 'atras' });
  }

  removePhoto(event: Event, photoId: string): void {
    event.stopPropagation();
    this.store.removePhoto(photoId);
  }

  onOpacity(photoId: string, event: Event): void {
    this.store.patchPhoto(photoId, { opacity: clamp(Number((event.target as HTMLInputElement).value) / 100, 0, 1) });
  }

  onScale(photoId: string, event: Event): void {
    this.store.patchPhoto(photoId, { scale: clamp(Number((event.target as HTMLInputElement).value) / 100, MIN_PHOTO_SCALE, MAX_PHOTO_SCALE) });
  }

  onRotation(photoId: string, event: Event): void {
    this.store.patchPhoto(photoId, { rotation: Number((event.target as HTMLInputElement).value) });
  }

  rotateBy(photo: PhotoLayer, delta: number): void {
    let next = (photo.rotation + delta) % 360;
    if (next > 180) next -= 360;
    if (next < -180) next += 360;
    this.store.patchPhoto(photo.id, { rotation: next });
  }

  // ---------- palco ----------

  onPointerDown(event: PointerEvent): void {
    const hit = (event.target as Element).closest('[data-slot-id]');

    if (this.marking()) {
      this.markShapeAt(event);
      return;
    }
    if (!hit) return;
    const slotId = hit.getAttribute('data-slot-id')!;
    const stack = this.store.photosOfSlot(slotId);
    const current = this.store.selectedPhoto();
    const alreadyHere = current?.slotId === slotId;
    if (!alreadyHere) {
      this.store.selectedPhotoId.set(stack[0]?.id ?? null);
    }
    this.activeSlot.set(slotId);

    const photo = this.store.selectedPhoto();
    if (!photo || photo.slotId !== slotId) return;
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseDx: photo.dx,
      baseDy: photo.dy,
      photoId: photo.id,
      moved: false,
      slotId,
      // Clicar de novo no mesmo encaixe (sem arrastar) desce pra camada de baixo.
      cycle: alreadyHere && stack.length > 1,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dxPx = event.clientX - drag.startX;
    const dyPx = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dxPx, dyPx) < 3) return;
    drag.moved = true;
    const k = this.viewBoxPerPixel();
    this.store.patchPhoto(drag.photoId, { dx: drag.baseDx + dxPx * k, dy: drag.baseDy + dyPx * k });
  }

  onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved || !drag.cycle) return;
    const stack = this.store.photosOfSlot(drag.slotId);
    const index = stack.findIndex((p) => p.id === drag.photoId);
    const next = stack[(index + 1) % stack.length];
    if (next) this.store.selectedPhotoId.set(next.id);
  }

  onWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
      return;
    }
    const hit = (event.target as Element).closest('[data-slot-id]');
    const photo = this.store.selectedPhoto();
    if (!hit || !photo || photo.slotId !== hit.getAttribute('data-slot-id')) return;
    event.preventDefault();
    this.store.patchPhoto(photo.id, {
      scale: clamp(photo.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08), MIN_PHOTO_SCALE, MAX_PHOTO_SCALE),
    });
  }

  /** Transforma a forma clicada num encaixe (Alt sobe pro grupo que a contém). */
  private markShapeAt(event: PointerEvent): void {
    const root = this.store.parsed()?.root;
    if (!root) return;
    // O overlay dos encaixes fica por cima; some por um instante pra achar a forma real.
    const hits = root.querySelector(`g[data-editor="hits"]`) as SVGGElement | null;
    const previous = hits?.getAttribute('style') ?? null;
    hits?.setAttribute('style', 'display:none');
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (hits) {
      if (previous === null) hits.removeAttribute('style');
      else hits.setAttribute('style', previous);
    }
    if (!target || !root.contains(target)) return;
    const shape = event.altKey ? (target.closest('g') ?? target) : target;
    const slot = this.store.addSlotFromElement(shape, root);
    if (!slot) {
      this.hint.set('Essa parte do molde não serve de encaixe — tente outra forma.');
      return;
    }
    this.marking.set(false);
    this.activeSlot.set(slot.id);
    this.hint.set(`"${slot.label}" virou encaixe. Arraste uma foto pra dentro dele.`);
  }

  // ---------- arrastar-e-soltar ----------

  onDragOver(event: DragEvent): void {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    // dragleave também dispara ao passar por filhos; só desliga ao sair do elemento.
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    this.dragOver.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    const svg = files.find((f) => f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg'));
    if (svg) {
      void this.loadTemplateFile(svg);
      return;
    }
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) {
      this.hint.set('Solte um .svg (molde) ou arquivos de imagem (JPG, PNG, WebP).');
      return;
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-slot-id]');
    const slotId = hit?.getAttribute('data-slot-id') ?? this.targetSlotId();
    if (!slotId) {
      this.hint.set('Marque um encaixe antes de soltar a foto.');
      return;
    }
    void this.addPhotos(images, slotId);
  }

  /** Sem isso, soltar a foto fora do palco faria o navegador abrir o arquivo. */
  @HostListener('document:dragover', ['$event'])
  @HostListener('document:drop', ['$event'])
  onDocumentDrag(event: DragEvent): void {
    if (hasFiles(event.dataTransfer)) event.preventDefault();
  }

  @HostListener('document:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, [contenteditable]')) return;
    if (!this.store.hasTemplate()) return;
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (!files.length) return;
    const slotId = this.targetSlotId();
    if (!slotId) return;
    event.preventDefault();
    void this.addPhotos(files, slotId);
  }

  /** Encaixe que recebe a próxima foto: o ativo, senão o primeiro vazio, senão o primeiro. */
  private targetSlotId(): string | null {
    const active = this.activeSlot();
    if (active && this.store.slotOf(active)) return active;
    const empty = this.store.slots().find((s) => this.store.emptySlotIds().has(s.id));
    return empty?.id ?? this.store.slots()[0]?.id ?? null;
  }

  private async addPhotos(files: File[], slotId: string): Promise<void> {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const original = await readAsDataUrl(file);
        const img = await loadImageElement(original);
        const { src, w, h } = normalizePhoto(img, original, file.type);
        this.store.addPhoto(slotId, { name: file.name, src, naturalW: w, naturalH: h, ...NEW_PHOTO_DEFAULTS });
        this.activeSlot.set(slotId);
        this.hint.set('');
      } catch {
        this.hint.set(`Não consegui abrir "${file.name}".`);
      }
    }
  }

  // ---------- zoom ----------

  zoomBy(factor: number): void {
    this.zoom.update((z) => clamp(z * factor, MIN_ZOOM, MAX_ZOOM));
    this.applyZoom();
  }

  resetZoom(): void {
    this.zoom.set(1);
    this.applyZoom();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.applyZoom();
  }

  /** Zoom 1 = molde ajustado ao palco; acima disso o palco rola sozinho. */
  private applyZoom(): void {
    const host = this.svgHost()?.nativeElement;
    const stage = this.stage()?.nativeElement;
    const viewBox = this.store.parsed()?.viewBox;
    if (!host || !stage || !viewBox || !(viewBox.w > 0)) return;
    const availW = Math.max(40, stage.clientWidth - 32);
    const availH = Math.max(40, stage.clientHeight - 32);
    const ratio = viewBox.h / viewBox.w;
    const fit = Math.min(availW, availH / ratio);
    const width = fit * this.zoom();
    host.style.width = `${width}px`;
    host.style.height = `${width * ratio}px`;
  }

  private viewBoxPerPixel(): number {
    const host = this.svgHost()?.nativeElement;
    const viewBox = this.store.parsed()?.viewBox;
    if (!host || !viewBox || !host.clientWidth) return 1;
    return viewBox.w / host.clientWidth;
  }

  // ---------- exportação ----------

  private baseName(): string {
    const name = this.store.fileName().replace(/\.svg$/i, '').trim();
    return name || 'molde';
  }

  exportSvg(): void {
    const parsed = this.store.parsed();
    if (!parsed) return;
    const svg = serializeForExport(parsed.root, this.store.widthMm(), this.store.heightMm());
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${this.baseName()}.svg`);
    this.exportStatus.set('SVG salvo.');
  }

  async exportPng(): Promise<void> {
    await this.withRaster(false, async (canvas) => {
      const blob = await canvasToBlob(canvas, 'image/png');
      downloadBlob(await pngBlobWithDpi(blob, EXPORT_DPI), `${this.baseName()}.png`);
      this.exportStatus.set(`PNG ${canvas.width}×${canvas.height} px salvo.`);
    });
  }

  async exportPdf(): Promise<void> {
    await this.withRaster(true, async (canvas) => {
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const pdf = jpegToPdf(jpeg, this.store.widthMm(), this.store.heightMm(), canvas.width, canvas.height);
      downloadBlob(pdf, `${this.baseName()}.pdf`);
      this.exportStatus.set('PDF salvo.');
    });
  }

  private async withRaster(opaque: boolean, use: (canvas: HTMLCanvasElement) => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.exportStatus.set('Gerando…');
    try {
      const canvas = await this.rasterize(opaque);
      if (!canvas) return;
      await use(canvas);
    } catch {
      this.exportStatus.set('Falha ao exportar. Se o molde tiver imagens muito grandes, reduza a largura de impressão.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Rasteriza o SVG exportável no tamanho físico a 300 DPI. */
  private async rasterize(opaque: boolean): Promise<HTMLCanvasElement | null> {
    const parsed = this.store.parsed();
    if (!parsed) return null;
    const wMm = this.store.widthMm();
    const hMm = this.store.heightMm();
    const svg = serializeForExport(parsed.root, wMm, hMm);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = await loadImageElement(url);
      let width = Math.max(1, Math.round((wMm / 25.4) * EXPORT_DPI));
      let height = Math.max(1, Math.round((hMm / 25.4) * EXPORT_DPI));
      const shrink = Math.sqrt(MAX_EXPORT_PIXELS / (width * height));
      if (shrink < 1) {
        width = Math.max(1, Math.round(width * shrink));
        height = Math.max(1, Math.round(height * shrink));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      if (opaque) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem.'))), type, quality);
  });
}
