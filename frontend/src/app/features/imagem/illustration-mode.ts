/** Modo "Ilustração" do Editor de Imagens: um editor vetorial pequeno, feito
 * pra arte de corte e impressão. O palco é um SVG de verdade (em mm), então o
 * que se vê é exatamente o que sai no arquivo. Este componente cuida do palco
 * e das ferramentas; o painel lateral é o `app-illustration-panel`. */

import {
  Component, ElementRef, HostListener, ViewEncapsulation, computed, effect, output, signal, viewChild,
} from '@angular/core';
import { IconComponent, IconName } from '../../shared/icon';
import { IllustrationPanelComponent } from './illustration-panel';
import { IllustrationStore, Tool } from './illustration-store';
import {
  Bounds, Layer, PathLayer, Point, VPath, applyMatrix, boundsCorners, dist, invertMatrix, layerMatrix,
  localStrokeWidth, matrixAttr, pathsToD, rgbToHex, unionBounds,
} from './illustration-model';
import { moveHandle, moveNode, nodeCount, nodeInfo } from './vector-ops';
import { buildSvg, rasterizeSvg } from './illustration-export';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;
/** Raio de atração das guias, em px de tela. */
const SNAP_PX = 6;
const HANDLE_PX = 5;

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

interface Frame {
  /** Cantos na prancheta: nw, ne, se, sw. */
  corners: Point[];
  center: Point;
  /** Caixa local (só com uma camada) e a matriz dela. */
  single: Layer | null;
}

interface RenderItem {
  id: string;
  layer: Layer;
  d: string;
  transform: string;
  strokeWidth: number;
}

type Drag =
  | { kind: 'move'; start: Point; base: Map<string, Layer>; bounds: Bounds | null; moved: boolean }
  | { kind: 'scale'; handle: HandleId; start: Point; base: Map<string, Layer>; frame: Frame }
  | { kind: 'rotate'; start: Point; base: Map<string, Layer>; center: Point }
  | { kind: 'marquee'; start: Point; additive: boolean }
  | { kind: 'node'; layerId: string; path: number; node: number; which: 'anchor' | 'in' | 'out'; base: VPath; smooth: boolean }
  | { kind: 'shape'; start: Point; id: string }
  | { kind: 'pen'; index: number };

interface PenAnchor {
  p: Point;
  hin: Point | null;
  hout: Point | null;
}

const TOOLS: { id: Tool; icon: IconName | null; label: string; key: string; glyph?: string }[] = [
  { id: 'selecionar', icon: 'select', label: 'Selecionar', key: 'V' },
  { id: 'nos', icon: null, glyph: '◇', label: 'Editar nós', key: 'A' },
  { id: 'caneta', icon: 'pen', label: 'Caneta Bézier', key: 'P' },
  { id: 'texto', icon: 'text', label: 'Texto', key: 'T' },
  { id: 'retangulo', icon: 'rect', label: 'Retângulo', key: 'R' },
  { id: 'elipse', icon: 'ellipse', label: 'Elipse', key: 'E' },
  { id: 'estrela', icon: null, glyph: '★', label: 'Estrela', key: 'S' },
  { id: 'poligono', icon: null, glyph: '⬡', label: 'Polígono', key: 'G' },
  { id: 'contagotas', icon: null, glyph: '⌖', label: 'Conta-gotas', key: 'I' },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function mid(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

@Component({
  selector: 'app-illustration-mode',
  standalone: true,
  imports: [IconComponent, IllustrationPanelComponent],
  // Sem encapsulamento pra o painel filho usar as mesmas classes; todo seletor
  // daqui leva o prefixo `il-`.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="il-preview-wrap">
      <div class="il-toolbar">
        <div class="il-tools" role="toolbar" aria-label="Ferramentas">
          @for (t of tools; track t.id) {
            <button
              [class.il-active]="store.tool() === t.id"
              [title]="t.label + ' (' + t.key + ')'"
              [attr.aria-label]="t.label"
              (click)="setTool(t.id)"
            >
              @if (t.icon) { <app-icon [name]="t.icon" [size]="15" /> } @else { <span class="il-glyph">{{ t.glyph }}</span> }
            </button>
          }
        </div>
        <div class="il-tools">
          <button [disabled]="!store.canUndo()" (click)="store.undo()" title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><app-icon name="undo" [size]="15" /></button>
          <button [disabled]="!store.canRedo()" (click)="store.redo()" title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><app-icon name="redo" [size]="15" /></button>
        </div>
        <div class="il-zoom" title="Ctrl + roda do mouse também dá zoom">
          <button (click)="zoomBy(1 / 1.25)" aria-label="Menos zoom">−</button>
          <button class="il-zoom-level" (click)="zoom.set(1)" title="Ajustar à tela">{{ (zoom() * 100).toFixed(0) }}%</button>
          <button (click)="zoomBy(1.25)" aria-label="Mais zoom">+</button>
        </div>
      </div>

      <div
        #stage
        class="il-stage"
        [class.il-drag-over]="dragOver()"
        [attr.data-tool]="store.tool()"
        (wheel)="onWheel($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="dragOver.set(false)"
        (drop)="onDrop($event)"
      >
        <svg
          #svg
          class="il-svg"
          [attr.width]="store.widthMm() * ppm()"
          [attr.height]="store.heightMm() * ppm()"
          [attr.viewBox]="'0 0 ' + store.widthMm() + ' ' + store.heightMm()"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp()"
          (pointercancel)="onPointerUp()"
          (dblclick)="onDoubleClick($event)"
        >
          <rect class="il-board" x="0" y="0" [attr.width]="store.widthMm()" [attr.height]="store.heightMm()" />
          @for (item of rendered(); track item.id) {
            @if (item.layer.kind === 'imagem') {
              <image
                [attr.href]="item.layer.src"
                [attr.x]="-item.layer.w / 2" [attr.y]="-item.layer.h / 2"
                [attr.width]="item.layer.w" [attr.height]="item.layer.h"
                preserveAspectRatio="none"
                [attr.transform]="item.transform"
                [attr.opacity]="item.layer.opacity"
                [attr.data-id]="item.id"
                [attr.pointer-events]="item.layer.locked ? 'none' : 'visible'"
              />
            } @else {
              <path
                [attr.d]="item.d"
                [attr.transform]="item.transform"
                fill-rule="evenodd"
                [attr.fill]="item.layer.fill ?? 'none'"
                [attr.stroke]="item.layer.stroke && item.layer.strokeWidth > 0 ? item.layer.stroke : null"
                [attr.stroke-width]="item.strokeWidth"
                stroke-linejoin="round"
                stroke-linecap="round"
                [attr.opacity]="item.layer.opacity"
                [attr.data-id]="item.id"
                [attr.pointer-events]="item.layer.locked ? 'none' : 'visible'"
              />
            }
          }

          <g class="il-overlay">
            @for (box of selectionBoxes(); track $index) {
              <polygon class="il-sel-box" [attr.points]="box" />
            }
            @if (frame(); as f) {
              <polygon class="il-sel-box" [attr.points]="framePoints(f)" />
              @if (store.tool() === 'selecionar') {
                <line class="il-sel-box" [attr.x1]="topMid(f)[0]" [attr.y1]="topMid(f)[1]" [attr.x2]="rotHandle(f)[0]" [attr.y2]="rotHandle(f)[1]" />
                <circle class="il-handle il-rot" [attr.cx]="rotHandle(f)[0]" [attr.cy]="rotHandle(f)[1]" [attr.r]="hs() * 1.1" data-handle="rot" />
                @for (h of frameHandles(f); track h.id) {
                  <rect class="il-handle" [attr.x]="h.p[0] - hs()" [attr.y]="h.p[1] - hs()" [attr.width]="hs() * 2" [attr.height]="hs() * 2" [attr.data-handle]="h.id" />
                }
              }
            }
            @for (g of guides(); track $index) {
              @if (g.x !== undefined) {
                <line class="il-guide" [attr.x1]="g.x" y1="-1000" [attr.x2]="g.x" y2="1000" />
              } @else {
                <line class="il-guide" x1="-1000" [attr.y1]="g.y" x2="1000" [attr.y2]="g.y" />
              }
            }
            @if (marquee(); as m) {
              <rect class="il-marquee" [attr.x]="m.minX" [attr.y]="m.minY" [attr.width]="m.maxX - m.minX" [attr.height]="m.maxY - m.minY" />
            }
            @if (nodeOverlay(); as no) {
              @for (h of no.handles; track $index) {
                <line class="il-handle-line" [attr.x1]="h.from[0]" [attr.y1]="h.from[1]" [attr.x2]="h.to[0]" [attr.y2]="h.to[1]" />
                <circle class="il-node-handle" [attr.cx]="h.to[0]" [attr.cy]="h.to[1]" [attr.r]="hs() * 0.8" [attr.data-nhandle]="h.key" />
              }
              @for (n of no.nodes; track n.key) {
                <rect
                  class="il-node" [class.il-node-sel]="n.selected"
                  [attr.x]="n.p[0] - hs() * 0.9" [attr.y]="n.p[1] - hs() * 0.9" [attr.width]="hs() * 1.8" [attr.height]="hs() * 1.8"
                  [attr.data-node]="n.key"
                />
              }
            }
            @if (penPreview(); as pp) {
              <path class="il-pen-path" [attr.d]="pp.d" />
              @for (a of pp.anchors; track $index) {
                <rect class="il-node" [attr.x]="a[0] - hs() * 0.9" [attr.y]="a[1] - hs() * 0.9" [attr.width]="hs() * 1.8" [attr.height]="hs() * 1.8" />
              }
            }
          </g>
        </svg>
      </div>
      <div class="il-meta">
        <span>Prancheta {{ store.widthMm() }} × {{ store.heightMm() }} mm</span>
        <span>{{ selectionLabel() }}</span>
      </div>
      <p class="il-hint">{{ hint() }}</p>
    </div>

    <app-illustration-panel #panel (sendToCut)="sendToCut.emit($event)" (sendToTemplate)="sendToTemplate.emit($event)" />
  `,
  styles: [`
    app-illustration-mode { display: contents; }
    .il-preview-wrap { display: flex; flex-direction: column; gap: 10px; min-width: 0; position: sticky; top: 16px; }
    .il-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .il-tools, .il-zoom { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
    .il-tools button, .il-zoom button {
      display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 6px;
      border: none; background: none; color: var(--text-muted); border-radius: 6px; font-size: 13px; font-weight: 700;
    }
    .il-tools button:hover:not(:disabled), .il-zoom button:hover { color: var(--accent); }
    .il-tools button:disabled { opacity: 0.4; }
    .il-tools button.il-active { background: var(--accent-soft); color: var(--accent); }
    .il-glyph { font-size: 15px; line-height: 1; }
    .il-zoom { margin-left: auto; }
    .il-zoom-level { font-size: 11px !important; min-width: 48px !important; }

    .il-stage {
      height: min(72vh, 780px); min-height: 320px; overflow: auto; display: flex; padding: 16px;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); touch-action: none;
      background-image: radial-gradient(var(--border) 1px, transparent 1px); background-size: 16px 16px;
    }
    .il-stage.il-drag-over { border-color: var(--accent); background-color: var(--accent-soft); }
    .il-stage[data-tool='caneta'], .il-stage[data-tool='retangulo'], .il-stage[data-tool='elipse'],
    .il-stage[data-tool='estrela'], .il-stage[data-tool='poligono'], .il-stage[data-tool='contagotas'] { cursor: crosshair; }
    .il-stage[data-tool='texto'] { cursor: text; }
    .il-svg { flex: none; margin: auto; display: block; overflow: visible; box-shadow: var(--shadow-sm); }
    .il-board { fill: #fff; }
    .il-overlay * { vector-effect: non-scaling-stroke; }
    .il-sel-box { fill: none; stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; pointer-events: none; }
    .il-handle { fill: #fff; stroke: var(--accent); stroke-width: 1.5; cursor: nwse-resize; }
    .il-handle.il-rot { cursor: grab; }
    .il-guide { stroke: #ff3d7f; stroke-width: 1; pointer-events: none; }
    .il-marquee { fill: color-mix(in srgb, var(--accent) 12%, transparent); stroke: var(--accent); stroke-width: 1; pointer-events: none; }
    .il-node { fill: #fff; stroke: var(--accent); stroke-width: 1.5; cursor: move; }
    .il-node.il-node-sel { fill: var(--accent); }
    .il-node-handle { fill: var(--accent); stroke: #fff; stroke-width: 1; cursor: move; }
    .il-handle-line { stroke: var(--accent); stroke-width: 1; pointer-events: none; }
    .il-pen-path { fill: none; stroke: var(--accent); stroke-width: 1.5; pointer-events: none; }
    .il-meta { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--text-muted); }
    .il-hint { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.4; min-height: 17px; }

    /* painel (compartilhado com app-illustration-panel) */
    .il-panel { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .il-section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .il-section-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 11px 13px; border: none; background: none; color: inherit; text-align: left; }
    .il-section-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
    .il-section-summary { margin-left: auto; font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
    .il-chevron { color: var(--text-muted); transition: transform 0.15s; flex-shrink: 0; }
    .il-section.il-open .il-chevron { transform: rotate(180deg); }
    .il-section-body { display: none; flex-direction: column; gap: 9px; padding: 0 13px 13px; }
    .il-section.il-open .il-section-body { display: flex; }
    .il-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .il-row > .il-field { flex: 1; min-width: 70px; }
    .il-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 10px;
      font-size: 12px; font-weight: 600; color: var(--text-muted); background: var(--bg);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    .il-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .il-btn:disabled { opacity: 0.45; }
    .il-btn.il-wide { width: 100%; }
    .il-btn.il-grow { flex: 1; }
    .il-btn.il-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .il-btn.il-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
    .il-btn.il-danger:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
    .il-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted); }
    .il-field input, .il-field select, .il-field textarea {
      padding: 6px 8px; font-size: 13px; color: var(--text); background: var(--bg);
      border: 1px solid var(--border); border-radius: var(--radius-sm); min-width: 0; font-family: inherit;
    }
    .il-field textarea { resize: vertical; min-height: 54px; }
    .il-slider { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-muted); }
    .il-slider strong { color: var(--text); }
    .il-slider input { width: 100%; accent-color: var(--accent); }
    .il-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
    .il-check input { accent-color: var(--accent); }
    .il-note { margin: 0; font-size: 11px; line-height: 1.45; color: var(--text-muted); }
    .il-error { margin: 0; font-size: 12px; color: var(--danger); }
    .il-icon-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex-shrink: 0;
      font-size: 12px; font-weight: 700; color: var(--text-muted); background: var(--surface);
      border: 1px solid var(--border); border-radius: 6px;
    }
    .il-icon-btn:hover { border-color: var(--accent); color: var(--accent); }
    .il-icon-btn.il-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .il-icon-btn.il-danger:hover { border-color: var(--danger); color: var(--danger); }

    @media (max-width: 900px) {
      .il-preview-wrap { position: static; }
      .il-stage { height: 56vh; padding: 8px; }
      .il-tools button { min-width: 36px; height: 36px; }
      .il-btn { padding: 10px 12px; font-size: 13px; }
      .il-field input, .il-field select, .il-field textarea { font-size: 16px; padding: 9px 10px; }
      .il-icon-btn { width: 34px; height: 34px; }
    }
  `],
})
export class IllustrationModeComponent {
  readonly tools = TOOLS;
  readonly sendToCut = output<{ canvas: HTMLCanvasElement; name: string; widthMm: number }>();
  readonly sendToTemplate = output<{ svg: string; name: string }>();

  stage = viewChild<ElementRef<HTMLDivElement>>('stage');
  svg = viewChild<ElementRef<SVGSVGElement>>('svg');
  panel = viewChild<IllustrationPanelComponent>('panel');

  zoom = signal(1);
  dragOver = signal(false);
  guides = signal<{ x?: number; y?: number }[]>([]);
  marquee = signal<Bounds | null>(null);
  pen = signal<PenAnchor[]>([]);
  penHover = signal<Point | null>(null);
  private stageSize = signal({ w: 600, h: 500 });
  private drag: Drag | null = null;
  private dCache = new WeakMap<Layer, { v: number; d: string }>();

  constructor(public store: IllustrationStore) {
    effect((onCleanup) => {
      const el = this.stage()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.stageSize.set({ w: el.clientWidth, h: el.clientHeight }));
      ro.observe(el);
      this.stageSize.set({ w: el.clientWidth, h: el.clientHeight });
      onCleanup(() => ro.disconnect());
    });
    // Imagem mandada pelo Print & Cut: abre direto na vetorização.
    effect(() => {
      const pending = this.store.pendingImport();
      const panel = this.panel();
      if (!pending || !panel) return;
      this.store.pendingImport.set(null);
      void panel.loadCanvas(pending.canvas, pending.name);
    });
  }

  /** Pixels de tela por mm. */
  ppm = computed(() => {
    const { w, h } = this.stageSize();
    const fit = Math.min((w - 34) / this.store.widthMm(), (h - 34) / this.store.heightMm());
    return Math.max(0.2, fit) * this.zoom();
  });

  /** Metade do lado da alça, em mm (fica do mesmo tamanho na tela). */
  hs = computed(() => HANDLE_PX / this.ppm());

  rendered = computed<RenderItem[]>(() => {
    const v = this.store.fonts.version();
    return this.store.layers().filter((l) => l.visible).map((l) => ({
      id: l.id,
      layer: l,
      d: l.kind === 'imagem' ? '' : this.dOf(l, v),
      transform: matrixAttr(layerMatrix(l)),
      strokeWidth: localStrokeWidth(l),
    }));
  });

  private dOf(l: Layer, v: number): string {
    const key = l.kind === 'texto' ? v : 0;
    const hit = this.dCache.get(l);
    if (hit && hit.v === key) return hit.d;
    const d = pathsToD(this.store.localPaths(l));
    this.dCache.set(l, { v: key, d });
    return d;
  }

  selectionBoxes = computed(() => {
    this.store.fonts.version();
    const sel = this.store.selection();
    if (sel.length < 2) return [];
    return sel.map((l) => boundsCorners(this.store.localBounds(l)).map((c) => applyMatrix(layerMatrix(l), c).join(',')).join(' '));
  });

  frame = computed<Frame | null>(() => {
    this.store.fonts.version();
    const sel = this.store.selection().filter((l) => !l.locked);
    if (!sel.length) return null;
    if (sel.length === 1) {
      const l = sel[0];
      const m = layerMatrix(l);
      const corners = boundsCorners(this.store.localBounds(l)).map((c) => applyMatrix(m, c));
      return { corners, center: mid(corners[0], corners[2]), single: l };
    }
    const b = sel.reduce<Bounds | null>((acc, l) => unionBounds(acc, this.store.worldBounds(l)), null)!;
    const corners = boundsCorners(b);
    return { corners, center: mid(corners[0], corners[2]), single: null };
  });

  frameHandles(f: Frame): { id: HandleId; p: Point }[] {
    const [nw, ne, se, sw] = f.corners;
    const all: { id: HandleId; p: Point }[] = [
      { id: 'nw', p: nw }, { id: 'ne', p: ne }, { id: 'se', p: se }, { id: 'sw', p: sw },
      { id: 'n', p: mid(nw, ne) }, { id: 'e', p: mid(ne, se) }, { id: 's', p: mid(se, sw) }, { id: 'w', p: mid(sw, nw) },
    ];
    // Com várias camadas giradas, esticar num eixo só não tem resposta certa.
    return f.single ? all : all.slice(0, 4);
  }

  framePoints(f: Frame): string {
    return f.corners.map((c) => c.join(',')).join(' ');
  }

  topMid(f: Frame): Point {
    return mid(f.corners[0], f.corners[1]);
  }

  rotHandle(f: Frame): Point {
    const top = this.topMid(f);
    const dx = top[0] - f.center[0], dy = top[1] - f.center[1];
    const len = Math.hypot(dx, dy) || 1;
    const off = 22 / this.ppm();
    return [top[0] + (dx / len) * off, top[1] + (dy / len) * off];
  }

  nodeOverlay = computed(() => {
    if (this.store.tool() !== 'nos') return null;
    const l = this.store.primary();
    if (!l || l.kind !== 'caminho') return null;
    const m = layerMatrix(l);
    const sel = this.store.nodeSel();
    const nodes: { key: string; p: Point; selected: boolean }[] = [];
    const handles: { key: string; from: Point; to: Point }[] = [];
    l.paths.forEach((path, pi) => {
      for (let ni = 0; ni < nodeCount(path); ni++) {
        const info = nodeInfo(path, ni);
        const p = applyMatrix(m, info.point);
        const selected = !!sel && sel.layerId === l.id && sel.path === pi && sel.node === ni;
        nodes.push({ key: `${pi}:${ni}`, p, selected });
        if (selected) {
          if (info.handleIn) handles.push({ key: `${pi}:${ni}:in`, from: p, to: applyMatrix(m, info.handleIn) });
          if (info.handleOut) handles.push({ key: `${pi}:${ni}:out`, from: p, to: applyMatrix(m, info.handleOut) });
        }
      }
    });
    return { nodes, handles };
  });

  penPreview = computed(() => {
    const anchors = this.pen();
    if (!anchors.length || this.store.tool() !== 'caneta') return null;
    const hover = this.penHover();
    const path = this.penPath(hover ? [...anchors, { p: hover, hin: null, hout: null }] : anchors, false);
    return { d: path ? pathsToD([path]) : '', anchors: anchors.map((a) => a.p) };
  });

  selectionLabel = computed(() => {
    const sel = this.store.selection();
    if (!sel.length) return `${this.store.layers().length} camada(s)`;
    if (sel.length === 1) return sel[0].name;
    return `${sel.length} selecionadas`;
  });

  hint = computed(() => {
    const status = this.store.status();
    if (status) return status;
    switch (this.store.tool()) {
      case 'nos': return this.store.primary()?.kind === 'caminho'
        ? 'Arraste os nós e as alças. Delete apaga o nó; Alt quebra a simetria das alças.'
        : 'Selecione um caminho (texto e forma: "Converter em caminho" no painel).';
      case 'caneta': return this.pen().length
        ? 'Clique pra reta, arraste pra curva. Clique no primeiro ponto pra fechar; Enter termina, Esc cancela.'
        : 'Clique pra começar o caminho — arrastar ao clicar cria uma curva.';
      case 'texto': return 'Clique na prancheta pra escrever.';
      case 'contagotas': return 'Clique numa cor da arte: vira a cor da seleção e dos próximos elementos.';
      case 'selecionar': return this.store.layers().length
        ? 'Arraste pra mover (Alt desliga as guias). Shift soma à seleção. Duplo clique num caminho edita os nós.'
        : 'Solte uma imagem aqui pra vetorizar, ou use as ferramentas pra desenhar.';
      default: return 'Arraste na prancheta pra desenhar a forma (Shift deixa proporcional).';
    }
  });

  // ---------- ferramentas ----------

  setTool(tool: Tool): void {
    if (this.store.tool() === 'caneta' && tool !== 'caneta') this.finishPen(false);
    this.store.tool.set(tool);
    this.store.nodeSel.set(null);
    this.store.status.set('');
  }

  zoomBy(f: number): void {
    this.zoom.update((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * f)));
  }

  onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  onDragOver(event: DragEvent): void {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = Array.from(event.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (file) void this.panel()?.loadFile(file);
  }

  @HostListener('document:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    if (isTyping(event.target)) return;
    const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void this.panel()?.loadFile(file);
  }

  // ---------- ponteiro ----------

  private toDoc(event: { clientX: number; clientY: number }): Point {
    const svg = this.svg()?.nativeElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return [0, 0];
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }

  private baseOf(ids: string[]): Map<string, Layer> {
    const set = new Set(ids);
    return new Map(this.store.layers().filter((l) => set.has(l.id)).map((l) => [l.id, l]));
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target as Element;
    const p = this.toDoc(event);
    const tool = this.store.tool();
    this.store.status.set('');
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

    if (tool === 'contagotas') {
      void this.pickColor(p);
      return;
    }
    if (tool === 'texto') {
      const t = this.store.newText(p[0], p[1]);
      this.store.addLayers([t]);
      this.store.tool.set('selecionar');
      this.store.focusText.update((v) => v + 1);
      return;
    }
    if (tool === 'caneta') {
      this.penDown(p);
      return;
    }
    if (tool === 'retangulo' || tool === 'elipse' || tool === 'estrela' || tool === 'poligono') {
      const s = this.store.newShape(tool, p[0], p[1], 0.01, 0.01);
      this.store.addLayers([s]);
      this.store.begin();
      this.drag = { kind: 'shape', start: p, id: s.id };
      return;
    }

    if (tool === 'nos') {
      const nh = target.closest('[data-nhandle]')?.getAttribute('data-nhandle');
      const nd = target.closest('[data-node]')?.getAttribute('data-node');
      const l = this.store.primary();
      if ((nh || nd) && l?.kind === 'caminho') {
        const [pi, ni, side] = (nh ?? nd)!.split(':');
        const path = l.paths[+pi];
        const info = nodeInfo(path, +ni);
        const smooth = !!info.handleIn && !!info.handleOut && Math.abs(
          Math.atan2(info.point[1] - info.handleIn[1], info.point[0] - info.handleIn[0]) -
          Math.atan2(info.handleOut[1] - info.point[1], info.handleOut[0] - info.point[0]),
        ) < 0.05;
        this.store.nodeSel.set({ layerId: l.id, path: +pi, node: +ni });
        this.store.begin();
        this.drag = { kind: 'node', layerId: l.id, path: +pi, node: +ni, which: nh ? (side as 'in' | 'out') : 'anchor', base: path, smooth };
        return;
      }
      const hitId = target.closest('[data-id]')?.getAttribute('data-id');
      this.store.select(hitId ?? null);
      this.store.nodeSel.set(null);
      return;
    }

    // selecionar
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as HandleId | null;
    const f = this.frame();
    if (handle && f) {
      const ids = this.store.selection().filter((l) => !l.locked).map((l) => l.id);
      this.store.begin();
      this.drag = handle === 'rot'
        ? { kind: 'rotate', start: p, base: this.baseOf(ids), center: f.center }
        : { kind: 'scale', handle, start: p, base: this.baseOf(ids), frame: f };
      return;
    }
    const hitId = target.closest('[data-id]')?.getAttribute('data-id');
    if (hitId) {
      const already = this.store.selectedIds().includes(hitId);
      if (event.shiftKey) this.store.select(hitId, true);
      else if (!already) this.store.select(hitId);
      const ids = this.store.selection().filter((l) => !l.locked).map((l) => l.id);
      this.store.begin();
      this.drag = { kind: 'move', start: p, base: this.baseOf(ids), bounds: this.store.selectionBounds(), moved: false };
      return;
    }
    if (!event.shiftKey) this.store.select(null);
    this.drag = { kind: 'marquee', start: p, additive: event.shiftKey };
  }

  onPointerMove(event: PointerEvent): void {
    const p = this.toDoc(event);
    if (this.store.tool() === 'caneta' && !this.drag) this.penHover.set(p);
    const drag = this.drag;
    if (!drag) return;
    switch (drag.kind) {
      case 'move': return this.dragMove(drag, p, event.altKey);
      case 'scale': return this.dragScale(drag, p, event.shiftKey);
      case 'rotate': return this.dragRotate(drag, p, event.shiftKey);
      case 'marquee': {
        const [x0, y0] = drag.start;
        this.marquee.set({ minX: Math.min(x0, p[0]), minY: Math.min(y0, p[1]), maxX: Math.max(x0, p[0]), maxY: Math.max(y0, p[1]) });
        return;
      }
      case 'node': return this.dragNode(drag, p, event.altKey);
      case 'shape': return this.dragShape(drag, p, event.shiftKey);
      case 'pen': {
        const anchors = [...this.pen()];
        const a = anchors[drag.index];
        const hout: Point = p;
        const hin: Point = [2 * a.p[0] - p[0], 2 * a.p[1] - p[1]];
        anchors[drag.index] = dist(p, a.p) * this.ppm() < 3 ? { ...a, hin: null, hout: null } : { ...a, hin, hout };
        this.pen.set(anchors);
        return;
      }
    }
  }

  onPointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    this.guides.set([]);
    if (!drag) return;
    if (drag.kind === 'marquee') {
      const m = this.marquee();
      this.marquee.set(null);
      if (m && (m.maxX - m.minX) * this.ppm() > 3) {
        const hits = this.store.layers().filter((l) => {
          if (!l.visible || l.locked) return false;
          const b = this.store.worldBounds(l);
          return b.minX < m.maxX && b.maxX > m.minX && b.minY < m.maxY && b.maxY > m.minY;
        });
        const ids = hits.map((l) => l.id);
        this.store.selectedIds.set(drag.additive ? [...new Set([...this.store.selectedIds(), ...ids])] : ids);
      }
      return;
    }
    if (drag.kind === 'shape') {
      const l = this.store.layer(drag.id);
      if (l && l.kind === 'forma' && Math.max(l.w, l.h) < 1) {
        this.store.patch(drag.id, { w: 30, h: 30 } as Partial<Layer>, false);
      }
      this.store.end();
      this.store.tool.set('selecionar');
      return;
    }
    if (drag.kind === 'pen') return;
    this.store.end();
  }

  onDoubleClick(event: MouseEvent): void {
    const tool = this.store.tool();
    if (tool === 'caneta') {
      this.finishPen(false);
      return;
    }
    if (tool !== 'selecionar') return;
    // Com o ponteiro capturado pelo SVG, o alvo do dblclick é o próprio SVG:
    // quem foi clicado é o que está debaixo do cursor.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const id = under?.closest('[data-id]')?.getAttribute('data-id');
    const l = id ? this.store.layer(id) : null;
    if (!l) return;
    this.store.select(l.id);
    if (l.kind === 'caminho') this.store.tool.set('nos');
    if (l.kind === 'texto') this.store.focusText.update((v) => v + 1);
  }

  // ---------- arrastos ----------

  private dragMove(drag: Extract<Drag, { kind: 'move' }>, p: Point, noSnap: boolean): void {
    let dx = p[0] - drag.start[0];
    let dy = p[1] - drag.start[1];
    if (!drag.moved && Math.hypot(dx, dy) * this.ppm() < 2) return;
    drag.moved = true;
    const guides: { x?: number; y?: number }[] = [];
    if (drag.bounds && !noSnap) {
      const b = drag.bounds;
      const tol = SNAP_PX / this.ppm();
      const xs = [0, this.store.widthMm() / 2, this.store.widthMm()];
      const ys = [0, this.store.heightMm() / 2, this.store.heightMm()];
      for (const l of this.store.layers()) {
        if (!l.visible || drag.base.has(l.id)) continue;
        const lb = this.store.worldBounds(l);
        xs.push(lb.minX, (lb.minX + lb.maxX) / 2, lb.maxX);
        ys.push(lb.minY, (lb.minY + lb.maxY) / 2, lb.maxY);
      }
      const snap = (vals: number[], cands: number[]): { d: number; at: number } | null => {
        let best: { d: number; at: number } | null = null;
        for (const v of vals) for (const c of cands) {
          const d = c - v;
          if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c };
        }
        return best;
      };
      const sx = snap([b.minX + dx, (b.minX + b.maxX) / 2 + dx, b.maxX + dx], xs);
      const sy = snap([b.minY + dy, (b.minY + b.maxY) / 2 + dy, b.maxY + dy], ys);
      if (sx) { dx += sx.d; guides.push({ x: sx.at }); }
      if (sy) { dy += sy.d; guides.push({ y: sy.at }); }
    }
    this.guides.set(guides);
    this.store.patchMany([...drag.base.keys()], (l) => {
      const b = drag.base.get(l.id)!;
      return { x: b.x + dx, y: b.y + dy };
    }, false);
  }

  private dragScale(drag: Extract<Drag, { kind: 'scale' }>, p: Point, free: boolean): void {
    const h = drag.handle;
    const hasX = h.includes('e') || h.includes('w');
    const hasY = h.includes('n') || h.includes('s');
    const corner = hasX && hasY;
    const f = drag.frame;
    if (f.single) {
      const base = drag.base.get(f.single.id);
      if (!base) return;
      const lb = this.store.localBounds(base);
      const hx = h.includes('e') ? lb.maxX : h.includes('w') ? lb.minX : (lb.minX + lb.maxX) / 2;
      const hy = h.includes('s') ? lb.maxY : h.includes('n') ? lb.minY : (lb.minY + lb.maxY) / 2;
      const ox = h.includes('e') ? lb.minX : h.includes('w') ? lb.maxX : (lb.minX + lb.maxX) / 2;
      const oy = h.includes('s') ? lb.minY : h.includes('n') ? lb.maxY : (lb.minY + lb.maxY) / 2;
      const m0 = layerMatrix(base);
      const u = applyMatrix(invertMatrix(m0), p);
      let fx = hasX ? (u[0] - ox) / (hx - ox || 1) : 1;
      let fy = hasY ? (u[1] - oy) / (hy - oy || 1) : 1;
      if (corner && !free) {
        const vx = hx - ox, vy = hy - oy;
        const k = ((u[0] - ox) * vx + (u[1] - oy) * vy) / (vx * vx + vy * vy || 1);
        fx = fy = k;
      }
      fx = Math.sign(fx || 1) * Math.max(0.01, Math.abs(fx));
      fy = Math.sign(fy || 1) * Math.max(0.01, Math.abs(fy));
      const next = { ...base, scaleX: base.scaleX * fx, scaleY: base.scaleY * fy, x: 0, y: 0 };
      const fixed = applyMatrix(m0, [ox, oy]);
      const moved = applyMatrix(layerMatrix(next), [ox, oy]);
      this.store.patch(base.id, { scaleX: next.scaleX, scaleY: next.scaleY, x: fixed[0] - moved[0], y: fixed[1] - moved[1] }, false);
      return;
    }
    // Várias: escala uniforme a partir do canto oposto da caixa.
    const idx = { nw: 0, ne: 1, se: 2, sw: 3 }[h as 'nw' | 'ne' | 'se' | 'sw'];
    const handlePt = f.corners[idx];
    const anchor = f.corners[(idx + 2) % 4];
    const vx = handlePt[0] - anchor[0], vy = handlePt[1] - anchor[1];
    const k = Math.max(0.01, ((p[0] - anchor[0]) * vx + (p[1] - anchor[1]) * vy) / (vx * vx + vy * vy || 1));
    this.store.patchMany([...drag.base.keys()], (l) => {
      const b = drag.base.get(l.id)!;
      return {
        x: anchor[0] + (b.x - anchor[0]) * k,
        y: anchor[1] + (b.y - anchor[1]) * k,
        scaleX: b.scaleX * k,
        scaleY: b.scaleY * k,
      };
    }, false);
  }

  private dragRotate(drag: Extract<Drag, { kind: 'rotate' }>, p: Point, snap: boolean): void {
    const [cx, cy] = drag.center;
    let da = Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(drag.start[1] - cy, drag.start[0] - cx);
    let deg = (da * 180) / Math.PI;
    if (snap) {
      deg = Math.round(deg / 15) * 15;
      da = (deg * Math.PI) / 180;
    }
    const cos = Math.cos(da), sin = Math.sin(da);
    this.store.patchMany([...drag.base.keys()], (l) => {
      const b = drag.base.get(l.id)!;
      const rx = b.x - cx, ry = b.y - cy;
      let rot = (b.rotation + deg) % 360;
      if (rot > 180) rot -= 360;
      if (rot < -180) rot += 360;
      return { x: cx + rx * cos - ry * sin, y: cy + rx * sin + ry * cos, rotation: Math.round(rot * 100) / 100 };
    }, false);
  }

  private dragNode(drag: Extract<Drag, { kind: 'node' }>, p: Point, alt: boolean): void {
    const l = this.store.layer(drag.layerId);
    if (!l || l.kind !== 'caminho') return;
    const local = applyMatrix(invertMatrix(layerMatrix(l)), p);
    const next = drag.which === 'anchor'
      ? moveNode(drag.base, drag.node, local)
      : moveHandle(drag.base, drag.node, drag.which, local, drag.smooth && !alt);
    this.store.setPath(drag.layerId, drag.path, next, false);
  }

  private dragShape(drag: Extract<Drag, { kind: 'shape' }>, p: Point, square: boolean): void {
    let w = Math.abs(p[0] - drag.start[0]);
    let h = Math.abs(p[1] - drag.start[1]);
    if (square) w = h = Math.max(w, h);
    const x = drag.start[0] + (Math.sign(p[0] - drag.start[0]) * w) / 2;
    const y = drag.start[1] + (Math.sign(p[1] - drag.start[1]) * h) / 2;
    this.store.patch(drag.id, { x, y, w: Math.max(0.01, w), h: Math.max(0.01, h) } as Partial<Layer>, false);
  }

  // ---------- caneta ----------

  private penDown(p: Point): void {
    const anchors = this.pen();
    if (anchors.length >= 2 && dist(p, anchors[0].p) * this.ppm() < 8) {
      this.finishPen(true);
      return;
    }
    this.pen.set([...anchors, { p, hin: null, hout: null }]);
    this.drag = { kind: 'pen', index: anchors.length };
  }

  private penPath(anchors: PenAnchor[], closed: boolean): VPath | null {
    if (anchors.length < 2) return null;
    const seg = (a: PenAnchor, b: PenAnchor) => (a.hout || b.hin
      ? { c1: a.hout ?? a.p, c2: b.hin ?? b.p, to: b.p }
      : { c1: null, c2: null, to: b.p });
    const segments = [];
    for (let i = 0; i < anchors.length - 1; i++) segments.push(seg(anchors[i], anchors[i + 1]));
    if (closed) segments.push(seg(anchors[anchors.length - 1], anchors[0]));
    return { start: anchors[0].p, segments, closed };
  }

  finishPen(closed: boolean): void {
    let anchors = this.pen();
    // O duplo clique que termina o traço também soltou dois pontos a mais.
    anchors = anchors.filter((a, i) => i === 0 || dist(a.p, anchors[i - 1].p) > 1e-3);
    this.pen.set([]);
    this.penHover.set(null);
    this.drag = null;
    const path = this.penPath(anchors, closed);
    if (!path) return;
    const layer: PathLayer = this.store.newPathLayer('Caminho', [path], {
      fill: closed ? this.store.currentFill() : null,
      stroke: '#222222',
      strokeWidth: 0.5,
    });
    this.store.addLayers([layer]);
  }

  // ---------- conta-gotas ----------

  private async pickColor(p: Point): Promise<void> {
    const W = this.store.widthMm(), H = this.store.heightMm();
    if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) return;
    try {
      const svg = await buildSvg(this.store, {});
      // 4 px/mm basta pra ler a cor; referência oculta também vale.
      const withRef = this.withHiddenReference(svg);
      const canvas = await rasterizeSvg(withRef, W, H, 25.4 * 4, '#ffffff', 8_000_000);
      const sx = canvas.width / W, sy = canvas.height / H;
      const px = canvas.getContext('2d')!.getImageData(Math.min(canvas.width - 1, Math.floor(p[0] * sx)), Math.min(canvas.height - 1, Math.floor(p[1] * sy)), 1, 1).data;
      const hex = rgbToHex(px[0], px[1], px[2]);
      this.store.currentFill.set(hex);
      const ids = this.store.selection().filter((l) => l.kind !== 'imagem').map((l) => l.id);
      if (ids.length) this.store.patchMany(ids, (l) => (l.fill ? { fill: hex } : { stroke: hex }));
      this.store.status.set(`Cor ${hex} — ${ids.length ? 'aplicada à seleção e ' : ''}guardada pros próximos elementos.`);
    } catch {
      this.store.status.set('Não consegui ler a cor.');
    }
  }

  /** O conta-gotas também lê a imagem de referência, mesmo oculta. */
  private withHiddenReference(svg: string): string {
    const refs = this.store.layers().filter((l) => l.kind === 'imagem' && !l.visible);
    if (!refs.length) return svg;
    const imgs = refs.map((l) => l.kind === 'imagem'
      ? `<image href="${l.src}" x="${-l.w / 2}" y="${-l.h / 2}" width="${l.w}" height="${l.h}" preserveAspectRatio="none" transform="${matrixAttr(layerMatrix(l))}" />`
      : '').join('');
    return svg.replace(/(<svg[^>]*>\n?)/, `$1${imgs}`);
  }

  // ---------- teclado ----------

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (isTyping(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const sel = this.store.selectedIds();

    if (ctrl && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (ctrl && key === 'y') { event.preventDefault(); this.store.redo(); return; }
    if (ctrl && key === 'd') { event.preventDefault(); this.store.duplicate(sel); return; }
    if (ctrl && key === 'a') { event.preventDefault(); this.store.selectAll(); return; }
    if (ctrl && key === 'g') {
      event.preventDefault();
      if (event.shiftKey) this.store.ungroup();
      else this.store.group();
      return;
    }
    if (ctrl) return;

    if (key === 'escape') {
      if (this.pen().length) this.finishPen(false);
      else if (this.store.nodeSel()) this.store.nodeSel.set(null);
      else this.store.select(null);
      return;
    }
    if (key === 'enter' && this.pen().length) { this.finishPen(false); return; }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      if (this.store.tool() === 'nos' && this.store.nodeSel()) this.panel()?.deleteNode();
      else this.store.remove(sel.filter((id) => !this.store.layer(id)?.locked));
      return;
    }
    if (key.startsWith('arrow') && sel.length) {
      event.preventDefault();
      const step = event.shiftKey ? 5 : 0.5;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      this.store.patchMany(sel, (l) => (l.locked ? null : { x: l.x + dx, y: l.y + dy }));
      return;
    }
    const tool = TOOLS.find((t) => t.key.toLowerCase() === key);
    if (tool) this.setTool(tool.id);
  }
}
