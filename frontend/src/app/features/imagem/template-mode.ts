/** Modo "Molde SVG" do Editor de Imagens: o usuário sobe um .svg com buracos,
 * arrasta fotos pra dentro deles e ajusta o enquadramento. Cada foto é uma
 * camada — o mesmo buraco aceita várias, com ordem e opacidade próprias. */

import { Component, ElementRef, HostListener, ViewEncapsulation, effect, signal, viewChild } from '@angular/core';
import { IlIconComponent } from './illustration-icons';
import { IlNumComponent } from './illustration-num';
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

type TabId = 'molde' | 'fotos' | 'exportar';

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
  imports: [IlIconComponent, IlNumComponent],
  // Sem encapsulamento porque o SVG do molde entra por appendChild e não recebe
  // o atributo de escopo do Angular. Por isso todo seletor daqui usa o prefixo `tm-`.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'il-studio il-basic tm' },
  template: `
    <input #svgInput type="file" accept=".svg,image/svg+xml" hidden (change)="onSvgInput($event)" />
    <input #photoInput type="file" accept="image/*" multiple hidden (change)="onPhotoInput($event)" />

    <div class="il-controlbar">
      @if (store.selectedPhoto(); as photo) {
        <span class="il-cb-kind tm-kind" [title]="photo.name">Foto · {{ photo.name }}</span>
        <div class="il-cb-group">
          <il-num label="Opac." title="Opacidade" unit="%" [value]="photo.opacity * 100" [min]="0" [max]="100" [decimals]="0" (valueChange)="onOpacity(photo.id, ev($event.value))" />
          <il-num label="Zoom" title="Tamanho da foto no encaixe" unit="%" [value]="photo.scale * 100" [step]="5" [min]="20" [max]="800" [decimals]="0" (valueChange)="onScale(photo.id, ev($event.value))" />
          <il-num label="⟳" title="Giro" unit="°" [value]="photo.rotation" [min]="-180" [max]="180" [decimals]="0" (valueChange)="onRotation(photo.id, ev($event.value))" />
        </div>
        <div class="il-cb-group">
          <button type="button" class="il-ib" data-tip="Girar −90°" aria-label="Girar −90°" (click)="rotateBy(photo, -90)"><il-icon name="rotate-left" /></button>
          <button type="button" class="il-ib" data-tip="Girar +90°" aria-label="Girar +90°" (click)="rotateBy(photo, 90)"><il-icon name="rotate-right" /></button>
          <button type="button" class="il-ib" [class.il-on]="photo.flipX" data-tip="Espelhar" aria-label="Espelhar" (click)="store.patchPhoto(photo.id, { flipX: !photo.flipX })"><il-icon name="flip-h" /></button>
        </div>
        <div class="il-cb-group">
          <div class="il-seg">
            <button type="button" [class.il-on]="photo.fit === 'cover'" data-tip="Preencher o encaixe" aria-label="Preencher" (click)="store.patchPhoto(photo.id, { fit: 'cover' })"><il-icon name="cover" /></button>
            <button type="button" [class.il-on]="photo.fit === 'contain'" data-tip="Caber inteira" aria-label="Caber" (click)="store.patchPhoto(photo.id, { fit: 'contain' })"><il-icon name="contain" /></button>
          </div>
          <button type="button" class="il-ib" data-tip="Reenquadrar" aria-label="Reenquadrar" (click)="store.reframe(photo.id)"><il-icon name="reframe" /></button>
          <button type="button" class="il-ib" [class.il-on]="photo.depth === 'atras'" [attr.data-tip]="photo.depth === 'atras' ? 'Atrás do molde (clique pra trazer)' : 'Na frente do molde (clique pra mandar atrás)'" aria-label="Frente ou atrás do molde" (click)="toggleDepth($event, photo)"><il-icon [name]="photo.depth === 'atras' ? 'back' : 'front'" /></button>
          <button type="button" class="il-ib il-danger" data-tip="Remover foto" aria-label="Remover foto" (click)="removePhoto($event, photo.id)"><il-icon name="trash" /></button>
        </div>
      } @else if (store.hasTemplate()) {
        <span class="il-cb-kind">Molde</span>
        <div class="il-cb-group">
          <il-num label="L" title="Largura de impressão" unit="mm" [value]="store.widthMm()" [min]="10" [max]="2000" [decimals]="1" (valueChange)="setWidth($event.value)" />
          <span class="il-cb-label">A {{ store.heightMm().toFixed(1).replace('.', ',') }} mm</span>
        </div>
        <span class="il-cb-hint">{{ marking() ? 'Clique numa forma do molde pra virar encaixe (Alt pega o grupo)' : 'Clique num encaixe pra selecionar a foto; arraste pra enquadrar' }}</span>
      } @else {
        <span class="il-cb-kind">Molde SVG</span>
        <span class="il-cb-hint">Abra um molde .svg (moldura, colagem, gabarito) pra encaixar fotos nos buracos dele.</span>
      }
    </div>

    <nav class="il-tools-col" aria-label="Ferramentas">
      <div class="il-tb-group">
        <button type="button" class="il-tool" [class.il-on]="!marking()" aria-label="Mover foto" data-tip="Mover foto  V" data-help="Clique no encaixe e arraste pra enquadrar" (click)="marking.set(false)"><il-icon name="select" [size]="18" /></button>
        <button type="button" class="il-tool" [class.il-on]="marking()" [disabled]="!store.hasTemplate()" aria-label="Marcar encaixe" data-tip="Marcar encaixe  M" data-help="Clique numa forma do molde pra ela receber foto" (click)="toggleMarking()"><il-icon name="slot" [size]="18" /></button>
      </div>
      <div class="il-tb-group">
        <button type="button" class="il-tool" aria-label="Abrir molde" data-tip="Abrir molde (.svg)" (click)="svgInput.click()"><il-icon name="folder" [size]="18" /></button>
        <button type="button" class="il-tool" [disabled]="!store.slots().length" aria-label="Adicionar foto" data-tip="Adicionar foto" data-help="Vai pro encaixe ativo (ou o primeiro vazio)" (click)="pickPhoto()"><il-icon name="photo-add" [size]="18" /></button>
      </div>
    </nav>

    <div
      #stage
      class="il-stage tm-stage"
      [class.il-drag-over]="dragOver()"
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
      @if (store.hasTemplate()) {
        <div #svgHost class="tm-svg-host il-paper"></div>
      } @else {
        <button type="button" class="il-empty" (click)="svgInput.click()">
          <il-icon name="slot" [size]="34" />
          <strong>Solte um molde .svg aqui</strong>
          <span>Encaixes com <code>id</code> começando em "foto" (ou rótulo do Inkscape) são detectados sozinhos — nos outros é só marcar a forma depois.</span>
          @if (store.error()) { <span class="il-error">{{ store.error() }}</span> }
        </button>
      }
    </div>

    <aside class="il-dock">
      <div class="il-tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" class="il-tab" [class.il-on]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
        }
      </div>
      <div class="il-tab-body">
        @switch (tab()) {
          @case ('molde') {
            <section class="il-sec">
              <div class="il-sec-body il-sec-body-top">
                <div class="il-row">
                  <button type="button" class="il-btn il-grow" (click)="svgInput.click()"><il-icon name="folder" [size]="13" /> {{ store.hasTemplate() ? 'Trocar molde' : 'Abrir molde' }}</button>
                  @if (store.hasTemplate()) {
                    <button type="button" class="il-btn il-danger" (click)="removeTemplate()" data-tip="Remover o molde"><il-icon name="trash" [size]="13" /></button>
                  }
                </div>
                @if (store.hasTemplate()) {
                  <span class="il-item-sub">{{ store.fileName() || 'molde.svg' }}</span>
                  <il-num label="Largura" unit="mm" [value]="store.widthMm()" [min]="10" [max]="2000" (valueChange)="setWidth($event.value)" />
                  <p class="il-note">Altura {{ store.heightMm().toFixed(1).replace('.', ',') }} mm — segue a proporção do molde.</p>
                }
              </div>
            </section>
            @if (store.hasTemplate()) {
              <section class="il-sec">
                <div class="il-sec-head il-sec-static">Encaixes <small>{{ store.slots().length }}</small></div>
                <div class="il-sec-body">
                  <button type="button" class="il-btn il-wide" [class.il-on]="marking()" (click)="toggleMarking()"><il-icon name="slot" [size]="13" /> {{ marking() ? 'Clique numa forma…' : 'Marcar encaixe' }}</button>
                  @if (!store.slots().length) {
                    <p class="il-note">Nenhum encaixe detectado. Use "Marcar encaixe" e clique na forma que recebe a foto — ou nomeie a forma como <code>foto1</code> no Inkscape.</p>
                  }
                </div>
                @for (slot of store.slots(); track slot.id) {
                  <div class="il-item" [class.il-on]="activeSlot() === slot.id">
                    <input class="il-item-input" [value]="slot.label" aria-label="Nome do encaixe" (input)="onSlotRename(slot.id, $event)" (focus)="activeSlot.set(slot.id)" />
                    <span class="il-badge" title="Fotos neste encaixe">{{ store.photosOfSlot(slot.id).length }}</span>
                    <button type="button" class="il-ib il-ib-sm" data-tip="Adicionar foto" aria-label="Adicionar foto" (click)="pickPhotoFor(slot.id)"><il-icon name="photo-add" [size]="14" /></button>
                    <button type="button" class="il-ib il-ib-sm il-danger" data-tip="Remover encaixe" aria-label="Remover encaixe" (click)="store.removeSlot(slot.id)"><il-icon name="trash" [size]="13" /></button>
                  </div>
                }
              </section>
            }
          }
          @case ('fotos') {
            @if (!store.photos().length) {
              <p class="il-note tm-pad">Arraste fotos pra cima dos encaixes (ou cole com Ctrl+V). A última solta fica na frente.</p>
            }
            @for (photo of store.stack(); track photo.id) {
              <div class="il-item" [class.il-on]="store.selectedPhotoId() === photo.id">
                <button type="button" class="il-item-main" (click)="selectPhoto(photo)">
                  <img class="il-item-thumb" [src]="photo.src" alt="" />
                  <span class="il-item-text">
                    <span class="il-item-name">{{ photo.name }}</span>
                    <span class="il-item-sub">{{ slotLabel(photo.slotId) }} · {{ (photo.opacity * 100).toFixed(0) }}% · {{ photo.depth === 'atras' ? 'atrás' : 'frente' }}</span>
                  </span>
                </button>
                <button type="button" class="il-ib il-ib-sm" data-tip="Trazer pra frente" aria-label="Trazer pra frente" (click)="reorder($event, photo.id, 'frente')"><il-icon name="forward" [size]="13" /></button>
                <button type="button" class="il-ib il-ib-sm" data-tip="Enviar pra trás" aria-label="Enviar pra trás" (click)="reorder($event, photo.id, 'tras')"><il-icon name="backward" [size]="13" /></button>
                <button type="button" class="il-ib il-ib-sm il-danger" data-tip="Remover foto" aria-label="Remover foto" (click)="removePhoto($event, photo.id)"><il-icon name="trash" [size]="13" /></button>
              </div>
            }
            @if (store.selectedPhoto(); as photo) {
              <section class="il-sec">
                <div class="il-sec-head il-sec-static">Ajuste da foto</div>
                <div class="il-sec-body">
                  <label class="il-range"><span>Opacidade</span><input type="range" min="0" max="100" step="1" [value]="photo.opacity * 100" (input)="onOpacity(photo.id, $event)" /><b>{{ (photo.opacity * 100).toFixed(0) }}%</b></label>
                  <label class="il-range"><span>Zoom</span><input type="range" min="20" max="800" step="1" [value]="photo.scale * 100" (input)="onScale(photo.id, $event)" /><b>{{ (photo.scale * 100).toFixed(0) }}%</b></label>
                  <label class="il-range"><span>Giro</span><input type="range" min="-180" max="180" step="1" [value]="photo.rotation" (input)="onRotation(photo.id, $event)" /><b>{{ photo.rotation.toFixed(0) }}°</b></label>
                  <div class="il-row">
                    <button type="button" class="il-btn il-grow" [class.il-on]="photo.fit === 'cover'" (click)="store.patchPhoto(photo.id, { fit: 'cover' })">Preencher</button>
                    <button type="button" class="il-btn il-grow" [class.il-on]="photo.fit === 'contain'" (click)="store.patchPhoto(photo.id, { fit: 'contain' })">Caber</button>
                    <button type="button" class="il-btn il-grow" (click)="store.reframe(photo.id)">Reenquadrar</button>
                  </div>
                  <p class="il-note">Arraste a foto no palco pra mover; a roda do mouse sobre ela dá zoom. Clicar de novo no encaixe desce pra camada de baixo.</p>
                </div>
              </section>
            }
          }
          @case ('exportar') {
            <div class="il-export-list">
              <button type="button" class="il-export" [disabled]="busy() || !store.hasTemplate()" (click)="exportPng()"><il-icon name="image" [size]="20" /><span><strong>PNG {{ dpi }} DPI</strong><small>No tamanho físico, com as fotos</small></span></button>
              <button type="button" class="il-export" [disabled]="busy() || !store.hasTemplate()" (click)="exportSvg()"><il-icon name="export" [size]="20" /><span><strong>SVG</strong><small>Fotos embutidas, em mm — editável no Inkscape/Illustrator</small></span></button>
              <button type="button" class="il-export" [disabled]="busy() || !store.hasTemplate()" (click)="exportPdf()"><il-icon name="artboard" [size]="20" /><span><strong>PDF</strong><small>Página no tamanho do molde, pra imprimir</small></span></button>
            </div>
            <p class="il-note tm-pad">O PNG e o PDF são rasterizados pelo navegador: se o molde usar uma fonte instalada no seu computador, só o SVG preserva o texto como texto.</p>
            @if (exportStatus()) { <p class="il-note tm-pad">{{ exportStatus() }}</p> }
          }
        }
      </div>
    </aside>

    <footer class="il-status">
      <div class="il-status-zoom">
        <button type="button" class="il-ib il-ib-sm" data-tip="Afastar" aria-label="Afastar" (click)="zoomBy(1 / 1.25)">−</button>
        <il-num label="" title="Zoom (100% = cabe na tela)" unit="%" [value]="zoom() * 100" [step]="10" [min]="MIN_ZOOM * 100" [max]="MAX_ZOOM * 100" [decimals]="0" (valueChange)="setZoomPct($event.value)" />
        <button type="button" class="il-ib il-ib-sm" data-tip="Aproximar" aria-label="Aproximar" (click)="zoomBy(1.25)">+</button>
        <button type="button" class="il-ib il-ib-sm" data-tip="Ajustar à janela" aria-label="Ajustar à janela" (click)="resetZoom()"><il-icon name="fit" [size]="13" /></button>
      </div>
      @if (store.hasTemplate()) {
        <span class="il-status-info">{{ store.fileName() || 'molde.svg' }}</span>
        <span>{{ store.slots().length }} encaixe(s) · {{ store.photos().length }} foto(s) · {{ store.widthMm().toFixed(1).replace('.', ',') }} × {{ store.heightMm().toFixed(1).replace('.', ',') }} mm</span>
      }
      <span class="il-status-msg">{{ statusHint() }}</span>
    </footer>
  `,
  styles: [`
    .tm-kind { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
    .tm-svg-host { flex: none; margin: auto; line-height: 0; background: #fff; }
    .tm-svg-host svg { display: block; width: 100%; height: 100%; }
    .tm-stage { touch-action: none; }
    .tm-stage.tm-marking { cursor: crosshair; }
    .tm-pad { margin: 10px; }
    .tm code, .tm-pad code { font-size: 10.5px; padding: 0 3px; border: 1px solid var(--il-line); border-radius: 3px; }

    /* O SVG do molde entra por appendChild: estes seletores precisam ser globais. */
    .tm-hit, .tm-hit * { pointer-events: all; }
    .tm-hit { cursor: grab; }
    .tm-hit-empty * { stroke: #2d7ff9; stroke-width: 1.5; stroke-dasharray: 6 4; }
    .tm-hit-selected * { stroke: #2d7ff9; stroke-width: 2; stroke-dasharray: 4 3; }
  `],
})
export class TemplateModeComponent {
  readonly dpi = EXPORT_DPI;
  readonly MIN_ZOOM = MIN_ZOOM;
  readonly MAX_ZOOM = MAX_ZOOM;
  readonly tabs: { id: TabId; label: string }[] = [
    { id: 'molde', label: 'Molde' },
    { id: 'fotos', label: 'Fotos' },
    { id: 'exportar', label: 'Exportar' },
  ];
  tab = signal<TabId>('molde');

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

  /** Os campos numéricos da barra falam número; os handlers leem o valor de
   * um evento de input. */
  ev(value: number): Event {
    return { target: { value: String(value) } } as unknown as Event;
  }

  setWidth(mm: number): void {
    if (Number.isFinite(mm) && mm > 0) this.store.widthMm.set(clamp(mm, 10, 2000));
  }

  setZoomPct(pct: number): void {
    this.zoom.set(clamp(pct / 100, MIN_ZOOM, MAX_ZOOM));
    this.applyZoom();
  }

  /** Foto pelo botão da barra: vai pro encaixe ativo (ou o primeiro vazio). */
  pickPhoto(): void {
    this.pendingSlotForPicker = null;
    this.photoInput()?.nativeElement.click();
  }

  statusHint(): string {
    if (this.marking()) return 'Clique numa forma do molde pra transformá-la em encaixe. Alt pega o grupo inteiro.';
    if (this.hint()) return this.hint();
    if (!this.store.hasTemplate()) return 'Solte um .svg no palco ou use "Abrir molde".';
    return 'Arraste uma foto pra cima de um encaixe · solte outra no mesmo lugar pra empilhar · Ctrl+roda dá zoom';
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    const el = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.altKey || el?.closest?.('input, textarea, select, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (key === 'v' || key === 'escape') this.marking.set(false);
    else if (key === 'm' && this.store.hasTemplate()) this.marking.set(true);
    else if ((key === 'delete' || key === 'backspace') && this.store.selectedPhoto()) {
      event.preventDefault();
      this.store.removePhoto(this.store.selectedPhoto()!.id);
    }
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
