/** Modo "Ilustração" do Editor de Imagens: um editor vetorial pra arte de
 * corte e impressão, com a área de trabalho no molde do Illustrator e do
 * Inkscape — ferramentas à esquerda, barra de controle em cima, réguas em mm,
 * prancheta sobre a área de rascunho, barra de status e painéis à direita.
 *
 * O palco é um SVG de verdade (em mm), então o que se vê é exatamente o que
 * sai no arquivo. Este componente é a casca e o palco; ferramentas, barra de
 * controle e painéis são componentes próprios. As classes compartilhadas
 * (botões, campos, dicas) moram aqui, sem encapsulamento, com prefixo `il-`. */

import {
  Component, ElementRef, HostListener, ViewEncapsulation, afterEveryRender, computed, effect, inject, output, signal, viewChild,
} from '@angular/core';
import { IlControlbarComponent } from './illustration-controlbar';
import { buildSvg, rasterizeSvg } from './illustration-export';
import { IlIconComponent } from './illustration-icons';
import { IlNumComponent } from './illustration-num';
import { IllustrationPanelComponent } from './illustration-panel';
import { IllustrationStore, Tool } from './illustration-store';
import { IllustrationTracer } from './illustration-tracer';
import { IlToolbarComponent, TOOL_GROUPS } from './illustration-toolbar';
import {
  Bounds, Layer, PathLayer, Point, VPath, applyMatrix, boundsCorners, dist, invertMatrix, layerMatrix,
  localStrokeWidth, matrixAttr, pathsToD, rgbToHex, unionBounds,
} from './illustration-model';
import { moveHandle, moveNode, nodeCount, nodeInfo } from './vector-ops';
import { clipDef, clipId, fillRef, paintDef, underlays } from './illustration-paint';

/** Pixels de tela por mm no zoom 100% (tamanho real, 96 DPI do CSS). */
const PX_PER_MM = 96 / 25.4;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const ZOOM_STEPS = [0.05, 0.1, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
/** Raio de atração das guias, em px de tela. */
const SNAP_PX = 6;
const HANDLE_PX = 4;
const RULER = 20;

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

interface Frame {
  /** Cantos na prancheta: nw, ne, se, sw. */
  corners: Point[];
  center: Point;
  single: Layer | null;
}

interface RenderItem {
  id: string;
  layer: Layer;
  d: string;
  transform: string;
  strokeWidth: number;
  fill: string;
  /** Contornos de efeito e sombra, atrás da camada. */
  under: { color: string; width: number; transform: string; opacity: number }[];
  /** `url(#…)` da máscara que recorta a camada. */
  clip: string | null;
}

const STAGE_IDS = 'ils-';

type Drag =
  | { kind: 'move'; start: Point; base: Map<string, Layer>; bounds: Bounds | null; moved: boolean }
  | { kind: 'scale'; handle: HandleId; start: Point; base: Map<string, Layer>; frame: Frame }
  | { kind: 'rotate'; start: Point; base: Map<string, Layer>; center: Point }
  | { kind: 'marquee'; start: Point; additive: boolean }
  | { kind: 'node'; layerId: string; path: number; node: number; which: 'anchor' | 'in' | 'out'; base: VPath; smooth: boolean }
  | { kind: 'shape'; start: Point; id: string }
  | { kind: 'pen'; index: number }
  | { kind: 'pan'; x: number; y: number; left: number; top: number };

interface PenAnchor {
  p: Point;
  hin: Point | null;
  hout: Point | null;
}

interface MenuItem {
  label: string;
  keys?: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
}

const SHORTCUTS: { title: string; items: [string, string][] }[] = [
  { title: 'Ferramentas', items: [
    ['V', 'Seleção'], ['A', 'Seleção direta (nós)'], ['P', 'Caneta'], ['T', 'Texto'], ['R · E · S · G', 'Retângulo · Elipse · Estrela · Polígono'],
    ['I', 'Conta-gotas'], ['H  ou  Espaço', 'Mão (segure pra rolar)'], ['Z', 'Zoom (Alt afasta)'],
  ] },
  { title: 'Vista', items: [
    ['Ctrl + roda', 'Zoom no cursor'], ['Ctrl+0', 'Ajustar à janela'], ['Ctrl+1', 'Tamanho real (100%)'], ['Ctrl+ =  /  Ctrl+ −', 'Aproximar / afastar'],
    ['Tab', 'Esconder / mostrar todos os painéis'], ['Shift+Tab', 'Esconder / mostrar o dock'],
  ] },
  { title: 'Editar', items: [
    ['Ctrl+Z  /  Ctrl+Shift+Z', 'Desfazer / refazer'], ['Ctrl+C · X · V', 'Copiar · recortar · colar'], ['Ctrl+Shift+V', 'Colar no lugar'],
    ['Ctrl+D', 'Duplicar'], ['Delete', 'Apagar (nó, na seleção direta)'], ['Setas  (Shift ×10)', 'Mover 0,5 mm'], ['Ctrl+A  /  Esc', 'Selecionar tudo / nada'],
  ] },
  { title: 'Objeto', items: [
    ['Ctrl+G  /  Ctrl+Shift+G', 'Agrupar / desagrupar'], ['Ctrl+]  /  Ctrl+[', 'Avançar / recuar'], ['Ctrl+Shift+]  /  [', 'Trazer pra frente / enviar pra trás'],
    ['Ctrl+2  /  Ctrl+3', 'Travar / ocultar'], ['Ctrl+Shift+O', 'Criar contornos (texto → curvas)'],
  ] },
  { title: 'Cor', items: [
    ['X', 'Alternar preenchimento / traço'], ['Shift+X', 'Trocar preenchimento e traço'], ['D', 'Cores padrão'], ['/', 'Sem cor'],
  ] },
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

function fmt(v: number, d = 1): string {
  return v.toFixed(d).replace('.', ',');
}

@Component({
  selector: 'app-illustration-mode',
  standalone: true,
  imports: [IlIconComponent, IlNumComponent, IlToolbarComponent, IlControlbarComponent, IllustrationPanelComponent],
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'il-studio il-illus',
    '[class.il-hide-dock]': 'hideDock()',
    '[class.il-hide-all]': 'hideAll()',
  },
  template: `
    <il-controlbar (nodeOp)="store.nodeOp($event)" />
    <il-toolbar (pick)="setTool($event)" />

    <div class="il-corner" title="Unidade: milímetros">mm</div>
    <canvas #rulerX class="il-ruler il-ruler-x" aria-hidden="true"></canvas>
    <canvas #rulerY class="il-ruler il-ruler-y" aria-hidden="true"></canvas>

    <div
      #canvas
      class="il-canvas"
      [class.il-drag-over]="dragOver()"
      [class.il-panning]="panMode()"
      [attr.data-tool]="store.tool()"
      (wheel)="onWheel($event)"
      (scroll)="scheduleRulers()"
      (dragover)="onDragOver($event)"
      (dragleave)="dragOver.set(false)"
      (drop)="onDrop($event)"
    >
      <svg
        #svg
        class="il-svg"
        [attr.width]="svgSize().w"
        [attr.height]="svgSize().h"
        [attr.viewBox]="viewBox()"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp()"
        (pointercancel)="onPointerUp()"
        (pointerover)="onHover($event)"
        (pointerleave)="hoverId.set(null); cursor.set(null)"
        (dblclick)="onDoubleClick($event)"
        (contextmenu)="onContextMenu($event)"
      >
        <text class="il-board-label" x="0" [attr.y]="-7 / ppm()" [attr.font-size]="11 / ppm()">Prancheta · {{ store.widthMm() }} × {{ store.heightMm() }} mm</text>
        <defs #defs></defs>
        <rect class="il-board" x="0" y="0" [attr.width]="store.widthMm()" [attr.height]="store.heightMm()" />
        @for (item of rendered(); track item.id) {
          <g [attr.clip-path]="item.clip">
          @for (u of item.under; track $index) {
            <path
              [attr.d]="item.d" [attr.transform]="u.transform" fill-rule="evenodd"
              [attr.fill]="u.color" [attr.stroke]="u.width > 0 ? u.color : null" [attr.stroke-width]="u.width"
              stroke-linejoin="round" stroke-linecap="round" [attr.opacity]="u.opacity"
              [attr.data-id]="item.id" [attr.pointer-events]="item.layer.locked ? 'none' : 'visible'"
            />
          }
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
              [attr.fill]="item.fill"
              [attr.stroke]="item.layer.stroke && item.layer.strokeWidth > 0 && !item.layer.mask ? item.layer.stroke : null"
              [attr.stroke-width]="item.strokeWidth"
              stroke-linejoin="round"
              stroke-linecap="round"
              [attr.opacity]="item.layer.opacity"
              [attr.data-id]="item.id"
              [attr.pointer-events]="item.layer.locked || item.layer.mask ? 'none' : 'visible'"
            />
          }
          </g>
        }
        <rect class="il-board-line" x="0" y="0" [attr.width]="store.widthMm()" [attr.height]="store.heightMm()" />

        <g class="il-overlay">
          @if (hover(); as h) {
            @if (h.layer.kind === 'imagem') {
              <polygon class="il-hover" [attr.points]="h.box" />
            } @else {
              <path class="il-hover" [attr.d]="h.d" [attr.transform]="h.transform" />
            }
          }
          @for (box of selectionBoxes(); track $index) {
            <polygon class="il-sel-box il-sel-each" [attr.points]="box" />
          }
          @if (frame(); as f) {
            <polygon class="il-sel-box" [attr.points]="framePoints(f)" />
            @if (store.tool() === 'selecionar') {
              <line class="il-sel-box" [attr.x1]="topMid(f)[0]" [attr.y1]="topMid(f)[1]" [attr.x2]="rotHandle(f)[0]" [attr.y2]="rotHandle(f)[1]" />
              <circle class="il-handle il-rot" [attr.cx]="rotHandle(f)[0]" [attr.cy]="rotHandle(f)[1]" [attr.r]="hs() * 1.3" data-handle="rot" />
              @for (h of frameHandles(f); track h.id) {
                <rect class="il-handle" [attr.data-cursor]="h.id" [attr.x]="h.p[0] - hs()" [attr.y]="h.p[1] - hs()" [attr.width]="hs() * 2" [attr.height]="hs() * 2" [attr.data-handle]="h.id" />
              }
            }
          }
          @for (g of guides(); track $index) {
            @if (g.x !== undefined) {
              <line class="il-guide" [attr.x1]="g.x" [attr.y1]="-padMm()" [attr.x2]="g.x" [attr.y2]="store.heightMm() + padMm()" />
            } @else {
              <line class="il-guide" [attr.x1]="-padMm()" [attr.y1]="g.y" [attr.x2]="store.widthMm() + padMm()" [attr.y2]="g.y" />
            }
          }
          @if (marquee(); as m) {
            <rect class="il-marquee" [attr.x]="m.minX" [attr.y]="m.minY" [attr.width]="m.maxX - m.minX" [attr.height]="m.maxY - m.minY" />
          }
          @if (nodeOverlay(); as no) {
            <path class="il-node-outline" [attr.d]="no.d" [attr.transform]="no.transform" />
            @for (h of no.handles; track $index) {
              <line class="il-handle-line" [attr.x1]="h.from[0]" [attr.y1]="h.from[1]" [attr.x2]="h.to[0]" [attr.y2]="h.to[1]" />
              <circle class="il-node-handle" [attr.cx]="h.to[0]" [attr.cy]="h.to[1]" [attr.r]="hs() * 0.9" [attr.data-nhandle]="h.key" />
            }
            @for (n of no.nodes; track n.key) {
              <rect
                class="il-node" [class.il-node-sel]="n.selected"
                [attr.x]="n.p[0] - hs()" [attr.y]="n.p[1] - hs()" [attr.width]="hs() * 2" [attr.height]="hs() * 2"
                [attr.data-node]="n.key"
              />
            }
          }
          @if (penPreview(); as pp) {
            <path class="il-pen-path" [attr.d]="pp.d" />
            @for (a of pp.anchors; track $index) {
              <rect class="il-node" [class.il-node-sel]="$first" [attr.x]="a[0] - hs()" [attr.y]="a[1] - hs()" [attr.width]="hs() * 2" [attr.height]="hs() * 2" />
            }
          }
        </g>
      </svg>
    </div>

    <app-illustration-panel (sendToCut)="sendToCut.emit($event)" (sendToTemplate)="sendToTemplate.emit($event)" (showShortcuts)="showHelp.set(true)" />

    <footer class="il-status">
      <div class="il-status-zoom">
        <button type="button" class="il-ib il-ib-sm" data-tip="Afastar  Ctrl+−" aria-label="Afastar" (click)="zoomStep(-1)">−</button>
        <il-num label="" title="Zoom" unit="%" [value]="zoom() * 100" [step]="5" [min]="MIN_ZOOM * 100" [max]="MAX_ZOOM * 100" [decimals]="0" (valueChange)="setZoomPercent($event.value)" />
        <button type="button" class="il-ib il-ib-sm" data-tip="Aproximar  Ctrl+=" aria-label="Aproximar" (click)="zoomStep(1)">+</button>
        <button type="button" class="il-ib il-ib-sm" data-tip="Ajustar à janela  Ctrl+0" aria-label="Ajustar à janela" (click)="fit()"><il-icon name="fit" [size]="13" /></button>
        <button type="button" class="il-ib il-ib-sm il-txt" data-tip="Tamanho real  Ctrl+1" aria-label="Tamanho real" (click)="zoomTo(1)">1:1</button>
      </div>
      <span class="il-status-pos">{{ cursorLabel() }}</span>
      <span class="il-status-msg">{{ hint() }}</span>
      <span class="il-status-info">{{ selectionLabel() }}</span>
      <button type="button" class="il-ib il-ib-sm" data-tip="Atalhos de teclado  F1" aria-label="Atalhos de teclado" (click)="showHelp.set(true)"><il-icon name="keyboard" [size]="14" /></button>
      <button type="button" class="il-ib il-ib-sm" [class.il-on]="!hideDock()" data-tip="Painéis  Shift+Tab" aria-label="Mostrar painéis" (click)="hideDock.set(!hideDock())"><il-icon name="panels" [size]="14" /></button>
    </footer>

    @if (menu(); as m) {
      <div class="il-menu" role="menu" [style.left.px]="m.x" [style.top.px]="m.y" (pointerdown)="$event.stopPropagation()" (contextmenu)="$event.preventDefault()">
        @for (group of m.groups; track $index) {
          @if (!$first) { <div class="il-menu-sep"></div> }
          @for (it of group; track it.label) {
            <button type="button" role="menuitem" class="il-menu-item" [class.il-danger]="it.danger" [disabled]="it.disabled" (click)="runMenu(it)">
              <span>{{ it.label }}</span>@if (it.keys) { <kbd>{{ it.keys }}</kbd> }
            </button>
          }
        }
      </div>
    }

    @if (showHelp()) {
      <div class="il-modal-back" (click)="showHelp.set(false)">
        <div class="il-modal" role="dialog" aria-label="Atalhos de teclado" (click)="$event.stopPropagation()">
          <header><strong>Atalhos de teclado</strong><button type="button" class="il-ib" aria-label="Fechar" (click)="showHelp.set(false)"><il-icon name="x" /></button></header>
          <div class="il-keys">
            @for (g of shortcuts; track g.title) {
              <section>
                <h4>{{ g.title }}</h4>
                @for (k of g.items; track k[0]) {
                  <div class="il-key-row"><kbd>{{ k[0] }}</kbd><span>{{ k[1] }}</span></div>
                }
              </section>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .il-illus {
      display: grid;
      grid-template-columns: 44px ${RULER}px minmax(0, 1fr) 304px;
      grid-template-rows: auto ${RULER}px minmax(0, 1fr) 26px;
      grid-template-areas: "control control control control" "tools corner rulerx dock" "tools rulery canvas dock" "status status status status";
    }
    .il-studio.il-hide-dock { grid-template-columns: 44px ${RULER}px minmax(0, 1fr) 0; }
    .il-studio.il-hide-dock app-illustration-panel { display: none; }
    .il-studio.il-hide-all { grid-template-columns: 0 ${RULER}px minmax(0, 1fr) 0; grid-template-rows: 0 ${RULER}px minmax(0, 1fr) 26px; }
    .il-studio.il-hide-all il-toolbar, .il-studio.il-hide-all il-controlbar, .il-studio.il-hide-all app-illustration-panel { display: none; }

    /* ---- réguas ---- */
    .il-corner { grid-area: corner; display: flex; align-items: center; justify-content: center; font-size: 9px; color: var(--text-muted); background: var(--il-chrome-2); border-right: 1px solid var(--il-line); border-bottom: 1px solid var(--il-line); }
    .il-ruler { display: block; width: 100%; height: 100%; background: var(--il-chrome-2); color: var(--text-muted); }
    .il-ruler-x { grid-area: rulerx; border-bottom: 1px solid var(--il-line); }
    .il-ruler-y { grid-area: rulery; border-right: 1px solid var(--il-line); }

    /* ---- palco ---- */
    .il-canvas { grid-area: canvas; overflow: scroll; background: var(--il-paste); touch-action: none; position: relative; overscroll-behavior: contain; }
    .il-canvas.il-drag-over { outline: 2px dashed var(--il-blue); outline-offset: -6px; }
    .il-canvas[data-tool='caneta'], .il-canvas[data-tool='retangulo'], .il-canvas[data-tool='elipse'],
    .il-canvas[data-tool='estrela'], .il-canvas[data-tool='poligono'] { cursor: crosshair; }
    .il-canvas[data-tool='texto'] { cursor: text; }
    .il-canvas[data-tool='contagotas'] { cursor: copy; }
    .il-canvas[data-tool='zoom'] { cursor: zoom-in; }
    .il-canvas[data-tool='mao'], .il-canvas.il-panning { cursor: grab; }
    .il-canvas.il-panning:active { cursor: grabbing; }
    .il-svg { display: block; }
    .il-board { fill: #fff; filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.18)); }
    .il-board-line { fill: none; stroke: rgba(0, 0, 0, 0.25); stroke-width: 1; vector-effect: non-scaling-stroke; pointer-events: none; }
    .il-board-label { fill: var(--text-muted); font-family: inherit; pointer-events: none; user-select: none; }
    .il-overlay * { vector-effect: non-scaling-stroke; }
    .il-hover { fill: none; stroke: var(--il-blue); stroke-width: 1.5; pointer-events: none; }
    .il-sel-box { fill: none; stroke: var(--il-blue); stroke-width: 1; pointer-events: none; }
    .il-sel-each { stroke-dasharray: 3 2; opacity: 0.7; }
    .il-handle { fill: #fff; stroke: var(--il-blue); stroke-width: 1; }
    .il-handle[data-cursor='nw'], .il-handle[data-cursor='se'] { cursor: nwse-resize; }
    .il-handle[data-cursor='ne'], .il-handle[data-cursor='sw'] { cursor: nesw-resize; }
    .il-handle[data-cursor='n'], .il-handle[data-cursor='s'] { cursor: ns-resize; }
    .il-handle[data-cursor='e'], .il-handle[data-cursor='w'] { cursor: ew-resize; }
    .il-handle.il-rot { cursor: grab; }
    .il-guide { stroke: #ff2f92; stroke-width: 1; pointer-events: none; }
    .il-marquee { fill: color-mix(in srgb, var(--il-blue) 10%, transparent); stroke: var(--il-blue); stroke-width: 1; stroke-dasharray: 4 3; pointer-events: none; }
    .il-node-outline { fill: none; stroke: var(--il-blue); stroke-width: 1; pointer-events: none; }
    .il-node { fill: #fff; stroke: var(--il-blue); stroke-width: 1; cursor: move; }
    .il-node.il-node-sel { fill: var(--il-blue); }
    .il-node-handle { fill: var(--il-blue); stroke: #fff; stroke-width: 1; cursor: move; }
    .il-handle-line { stroke: var(--il-blue); stroke-width: 1; pointer-events: none; }
    .il-pen-path { fill: none; stroke: var(--il-blue); stroke-width: 1.5; pointer-events: none; }

    /* ---- menu de contexto e atalhos ---- */
    .il-menu {
      position: fixed; z-index: 100; min-width: 230px; padding: 4px; background: var(--il-chrome);
      border: 1px solid var(--il-line-strong); border-radius: 6px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
    }
    .il-menu-item { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 5px 10px; border: none; border-radius: 3px; background: none; color: var(--text); text-align: left; }
    .il-menu-item:hover:not(:disabled) { background: var(--il-blue); color: #fff; }
    .il-menu-item:hover:not(:disabled) kbd { color: rgba(255, 255, 255, 0.8); }
    .il-menu-item:disabled { opacity: 0.4; }
    .il-menu-item.il-danger:hover:not(:disabled) { background: var(--danger); }
    .il-menu-item kbd, .il-key-row kbd { font: 10.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-muted); }
    .il-menu-sep { height: 1px; margin: 4px 6px; background: var(--il-line); }
    .il-modal-back { position: fixed; inset: 0; z-index: 110; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); padding: 16px; }
    .il-modal { width: min(760px, 100%); max-height: 86vh; overflow: auto; background: var(--il-chrome); border: 1px solid var(--il-line-strong); border-radius: 8px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); }
    .il-modal header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--il-line); }
    .il-keys { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 4px 24px; padding: 8px 16px 16px; }
    .il-keys h4 { margin: 10px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
    .il-key-row { display: grid; grid-template-columns: 150px 1fr; gap: 10px; padding: 3px 0; border-bottom: 1px solid var(--il-line); }
    .il-key-row kbd { color: var(--text); font-weight: 600; }

    /* ---- celular: uma coluna, régua some, dock embaixo ---- */
    @media (max-width: 900px) {
      .il-illus { display: flex; flex-direction: column; height: auto; overflow: visible; }
      .il-studio.il-hide-all il-toolbar, .il-studio.il-hide-all il-controlbar { display: flex; }
      .il-corner, .il-ruler { display: none; }
      .il-controlbar { order: 1; }
      il-toolbar { order: 2; flex-direction: row !important; overflow-x: auto !important; border-right: none !important; border-bottom: 1px solid var(--il-line); padding: 0 4px !important; }
      .il-tb-group { flex-direction: row !important; border-bottom: none !important; border-right: 1px solid var(--il-line); padding: 0 3px !important; }
      .il-paint { margin: 0 4px !important; flex-shrink: 0; }
      .il-canvas { order: 3; height: 58dvh; }
      .il-status { order: 4; flex-wrap: wrap; height: auto; padding: 4px 6px; }
      .il-status-msg, .il-status-info { display: none; }
      app-illustration-panel { order: 5; max-height: none; border-left: none; border-top: 1px solid var(--il-line); }
      .il-tab-body { overflow: visible !important; }
      .il-ib { min-width: 34px; height: 34px; }
      .il-num { height: 32px; }
      .il-num input { font-size: 16px; }
    }
  `],
})
export class IllustrationModeComponent {
  store = inject(IllustrationStore);
  private tracer = inject(IllustrationTracer);

  readonly shortcuts = SHORTCUTS;
  readonly MIN_ZOOM = MIN_ZOOM;
  readonly MAX_ZOOM = MAX_ZOOM;
  readonly sendToCut = output<{ canvas: HTMLCanvasElement; name: string; widthMm: number }>();
  readonly sendToTemplate = output<{ svg: string; name: string }>();

  private canvasEl = viewChild<ElementRef<HTMLDivElement>>('canvas');
  private svg = viewChild<ElementRef<SVGSVGElement>>('svg');
  private rulerX = viewChild<ElementRef<HTMLCanvasElement>>('rulerX');
  private rulerY = viewChild<ElementRef<HTMLCanvasElement>>('rulerY');

  zoom = signal(1);
  dragOver = signal(false);
  guides = signal<{ x?: number; y?: number }[]>([]);
  marquee = signal<Bounds | null>(null);
  pen = signal<PenAnchor[]>([]);
  penHover = signal<Point | null>(null);
  hoverId = signal<string | null>(null);
  cursor = signal<Point | null>(null);
  menu = signal<{ x: number; y: number; groups: MenuItem[][] } | null>(null);
  showHelp = signal(false);
  hideDock = signal(false);
  hideAll = signal(false);
  spaceHeld = signal(false);
  private viewport = signal({ w: 800, h: 600 });
  private dragging = signal(false);
  private drag: Drag | null = null;
  private pendingScroll: { left: number; top: number } | null = null;
  private fitted = false;
  private rulerFrame = 0;
  private pasteHandled = false;

  constructor() {
    effect((onCleanup) => {
      const el = this.canvasEl()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => {
        this.viewport.set({ w: el.clientWidth, h: el.clientHeight });
        if (!this.fitted && el.clientWidth > 0) {
          this.fitted = true;
          this.fit();
        }
        this.scheduleRulers();
      });
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });
    // Rolagem pedida pelo zoom: só dá pra aplicar depois que o SVG mudou de tamanho.
    afterEveryRender(() => {
      const el = this.canvasEl()?.nativeElement;
      if (el && this.pendingScroll) {
        el.scrollLeft = this.pendingScroll.left;
        el.scrollTop = this.pendingScroll.top;
        this.pendingScroll = null;
      }
      this.scheduleRulers();
    });
    effect(() => {
      const el = this.defsEl()?.nativeElement;
      const markup = this.stageDefs();
      if (el && el.innerHTML !== markup) el.innerHTML = markup;
    });
    // Imagem mandada pelo Print & Cut: abre direto na vetorização.
    effect(() => {
      const pending = this.store.pendingImport();
      if (!pending) return;
      this.store.pendingImport.set(null);
      void this.tracer.loadCanvas(pending.canvas, pending.name);
    });
  }

  // ---------- vista ----------

  /** Pixels de tela por mm. */
  ppm = computed(() => this.zoom() * PX_PER_MM);
  /** Área de rascunho em volta da prancheta, em px de tela (fixa no zoom). */
  private padPx = computed(() => Math.round(Math.max(this.viewport().w, this.viewport().h) * 0.8 + 40));
  padMm = computed(() => this.padPx() / this.ppm());
  svgSize = computed(() => ({
    w: Math.round(this.store.widthMm() * this.ppm() + this.padPx() * 2),
    h: Math.round(this.store.heightMm() * this.ppm() + this.padPx() * 2),
  }));
  viewBox = computed(() => {
    const p = this.padMm();
    const s = this.svgSize();
    return `${-p} ${-p} ${s.w / this.ppm()} ${s.h / this.ppm()}`;
  });

  panMode = computed(() => this.spaceHeld() || this.store.tool() === 'mao');

  fit(): void {
    const { w, h } = this.viewport();
    const z = Math.min((w - 64) / this.store.widthMm(), (h - 64) / this.store.heightMm()) / PX_PER_MM;
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)));
    const ppm = this.ppm();
    this.pendingScroll = {
      left: this.padPx() + (this.store.widthMm() * ppm) / 2 - w / 2,
      top: this.padPx() + (this.store.heightMm() * ppm) / 2 - h / 2,
    };
  }

  /** Zoom mantendo parado o ponto debaixo do cursor (ou o centro da vista). */
  zoomTo(z: number, client?: { x: number; y: number }): void {
    const el = this.canvasEl()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vx = client ? client.x - rect.left : el.clientWidth / 2;
    const vy = client ? client.y - rect.top : el.clientHeight / 2;
    const pad = this.padPx();
    const docX = (el.scrollLeft + vx - pad) / this.ppm();
    const docY = (el.scrollTop + vy - pad) / this.ppm();
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)));
    this.pendingScroll = { left: docX * this.ppm() + pad - vx, top: docY * this.ppm() + pad - vy };
  }

  zoomStep(dir: 1 | -1, client?: { x: number; y: number }): void {
    const z = this.zoom();
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.001) : [...ZOOM_STEPS].reverse().find((s) => s < z * 0.999);
    this.zoomTo(next ?? z, client);
  }

  setZoomPercent(p: number): void {
    this.zoomTo(p / 100);
  }

  onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    // Pinça do trackpad chega como roda com Ctrl e passo pequeno: zoom contínuo.
    const factor = Math.exp(-event.deltaY * (Math.abs(event.deltaY) < 20 ? 0.02 : 0.0025));
    this.zoomTo(this.zoom() * factor, { x: event.clientX, y: event.clientY });
  }

  // ---------- réguas ----------

  scheduleRulers(): void {
    if (this.rulerFrame || typeof requestAnimationFrame === 'undefined') return;
    this.rulerFrame = requestAnimationFrame(() => {
      this.rulerFrame = 0;
      this.drawRulers();
    });
  }

  private drawRulers(): void {
    const el = this.canvasEl()?.nativeElement;
    if (!el) return;
    const ppm = this.ppm();
    const pad = this.padPx();
    const cur = this.cursor();
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
    const major = steps.find((s) => s * ppm >= 56) ?? 2000;
    const minorDiv = [10, 5, 2].find((d) => (major / d) * ppm >= 5) ?? 1;
    const draw = (canvas: HTMLCanvasElement | undefined, horizontal: boolean) => {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const color = getComputedStyle(canvas).color;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.font = '9px -apple-system, "Segoe UI", Roboto, sans-serif';
      const length = horizontal ? cw : ch;
      const origin = pad - (horizontal ? el.scrollLeft : el.scrollTop);
      const minor = major / minorDiv;
      const first = Math.floor(-origin / ppm / minor) * minor;
      ctx.beginPath();
      for (let v = first; origin + v * ppm <= length; v += minor) {
        const px = Math.round(origin + v * ppm) + 0.5;
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const half = Math.abs(v / (major / 2) - Math.round(v / (major / 2))) < 1e-6;
        const size = isMajor ? RULER : half ? 8 : 4;
        const thick = horizontal ? ch : cw;
        if (horizontal) { ctx.moveTo(px, thick); ctx.lineTo(px, thick - size); }
        else { ctx.moveTo(thick, px); ctx.lineTo(thick - size, px); }
        if (isMajor) {
          const label = String(Math.round(v * 100) / 100).replace('.', ',');
          if (horizontal) ctx.fillText(label, px + 3, 9);
          else {
            ctx.save();
            ctx.translate(9, px - 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Onde o cursor está, como nas réguas do Illustrator.
      if (cur) {
        const px = Math.round(origin + (horizontal ? cur[0] : cur[1]) * ppm) + 0.5;
        ctx.strokeStyle = '#2d7ff9';
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(px, 0); ctx.lineTo(px, ch); }
        else { ctx.moveTo(0, px); ctx.lineTo(cw, px); }
        ctx.stroke();
      }
    };
    draw(this.rulerX()?.nativeElement, true);
    draw(this.rulerY()?.nativeElement, false);
  }

  // ---------- desenho ----------

  /** Metade do lado da alça, em mm (fica do mesmo tamanho na tela). */
  hs = computed(() => HANDLE_PX / this.ppm());

  rendered = computed<RenderItem[]>(() => {
    this.store.fonts.version();
    const layers = this.store.layers();
    const masks = new Set(layers.filter((l) => l.mask && l.visible).map((l) => l.id));
    return layers.filter((l) => l.visible).map((l) => {
      const m = layerMatrix(l);
      const scale = Math.sqrt(Math.abs(l.scaleX * l.scaleY)) || 1;
      return {
        id: l.id,
        layer: l,
        d: this.store.pathD(l),
        transform: matrixAttr(m),
        strokeWidth: localStrokeWidth(l),
        fill: fillRef(STAGE_IDS, l),
        under: underlays(l).map((u) => ({
          color: u.color,
          width: u.widthMm / scale,
          transform: matrixAttr([m[0], m[1], m[2], m[3], m[4] + u.dx, m[5] + u.dy]),
          opacity: u.opacity * l.opacity,
        })),
        clip: l.clipBy && masks.has(l.clipBy) ? `url(#${clipId(STAGE_IDS, l.clipBy)})` : null,
      };
    });
  });

  /** Degradês, padrões e máscaras do palco, como marcação SVG crua: o
   * sanitizador do Angular não passa gradiente por template, então a <defs>
   * é escrita direto no DOM. */
  private stageDefs = computed(() => {
    this.store.fonts.version();
    let out = '';
    for (const l of this.store.layers()) {
      if (!l.visible) continue;
      out += paintDef(STAGE_IDS, l, null);
      if (l.mask) out += clipDef(STAGE_IDS, l.id, pathsToD(this.store.worldPaths(l)));
    }
    return out;
  });
  private defsEl = viewChild<ElementRef<SVGDefsElement>>('defs');

  hover = computed(() => {
    const id = this.hoverId();
    if (!id || this.dragging() || (this.store.tool() !== 'selecionar' && this.store.tool() !== 'nos')) return null;
    if (this.store.selectedIds().includes(id)) return null;
    const layer = this.store.layer(id);
    if (!layer || !layer.visible || layer.locked) return null;
    const m = layerMatrix(layer);
    return {
      layer,
      d: this.store.pathD(layer),
      transform: matrixAttr(m),
      box: boundsCorners(this.store.localBounds(layer)).map((c) => applyMatrix(m, c).join(',')).join(' '),
    };
  });

  selectionBoxes = computed(() => {
    this.store.fonts.version();
    const sel = this.store.selection();
    if (sel.length < 2) return [];
    return sel.map((l) => boundsCorners(this.store.localBounds(l)).map((c) => applyMatrix(layerMatrix(l), c).join(',')).join(' '));
  });

  frame = computed<Frame | null>(() => {
    this.store.fonts.version();
    if (this.store.tool() === 'nos') return null;
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
    return { nodes, handles, d: this.store.pathD(l), transform: matrixAttr(m) };
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

  cursorLabel = computed(() => {
    const c = this.cursor();
    return c ? `X ${fmt(c[0])}  Y ${fmt(c[1])} mm` : '';
  });

  hint = computed(() => {
    const status = this.store.status();
    if (status) return status;
    switch (this.store.tool()) {
      case 'nos': return this.store.primary()?.kind === 'caminho'
        ? 'Arraste nós e alças · Delete apaga o nó · Alt quebra a simetria'
        : 'Clique num caminho (texto e forma: converta em caminho antes)';
      case 'caneta': return this.pen().length ? 'Clique no primeiro ponto pra fechar · Enter termina · Esc cancela' : 'Clique pra começar · arraste pra fazer curva';
      case 'texto': return 'Clique na prancheta pra escrever';
      case 'contagotas': return 'Clique numa cor: vai pra seleção e pros próximos objetos';
      case 'mao': return 'Arraste pra mover a vista';
      case 'zoom': return 'Clique aproxima · Alt+clique afasta';
      case 'selecionar': return this.store.layers().length
        ? 'Arraste pra mover (Alt desliga as guias) · Shift soma · duplo clique edita nós · botão direito abre o menu'
        : 'Solte ou cole uma imagem pra vetorizar, ou desenhe com as ferramentas';
      default: return 'Arraste pra desenhar · Shift deixa proporcional';
    }
  });

  // ---------- ferramentas ----------

  setTool(tool: Tool): void {
    if (this.store.tool() === 'caneta' && tool !== 'caneta') this.finishPen(false);
    this.store.tool.set(tool);
    this.store.nodeSel.set(null);
    this.store.status.set('');
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
    if (file) void this.tracer.loadFile(file);
  }

  @HostListener('document:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    if (isTyping(event.target)) return;
    const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    this.pasteHandled = true;
    event.preventDefault();
    if (file) void this.tracer.loadFile(file);
    else this.store.paste(false);
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

  onHover(event: PointerEvent): void {
    const id = (event.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null;
    if (id !== this.hoverId()) this.hoverId.set(id);
  }

  onPointerDown(event: PointerEvent): void {
    this.menu.set(null);
    const el = this.canvasEl()?.nativeElement;
    // Mão: botão do meio, Espaço segurado ou a ferramenta.
    if (el && (event.button === 1 || (event.button === 0 && this.panMode()))) {
      event.preventDefault();
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      this.drag = { kind: 'pan', x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
      this.dragging.set(true);
      return;
    }
    if (event.button !== 0) return;
    const target = event.target as Element;
    const p = this.toDoc(event);
    const tool = this.store.tool();
    this.store.status.set('');
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

    if (tool === 'zoom') {
      this.zoomStep(event.altKey ? -1 : 1, { x: event.clientX, y: event.clientY });
      return;
    }
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
      this.dragging.set(true);
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
        this.dragging.set(true);
        return;
      }
      const hitId = target.closest('[data-id]')?.getAttribute('data-id');
      this.store.select(hitId ?? null);
      this.store.nodeSel.set(null);
      return;
    }

    // seleção
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as HandleId | null;
    const f = this.frame();
    if (handle && f) {
      const ids = this.store.selection().filter((l) => !l.locked).map((l) => l.id);
      this.store.begin();
      this.drag = handle === 'rot'
        ? { kind: 'rotate', start: p, base: this.baseOf(ids), center: f.center }
        : { kind: 'scale', handle, start: p, base: this.baseOf(ids), frame: f };
      this.dragging.set(true);
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
      this.dragging.set(true);
      return;
    }
    if (!event.shiftKey) this.store.select(null);
    this.drag = { kind: 'marquee', start: p, additive: event.shiftKey };
    this.dragging.set(true);
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag?.kind === 'pan') {
      const el = this.canvasEl()?.nativeElement;
      if (el) {
        el.scrollLeft = drag.left - (event.clientX - drag.x);
        el.scrollTop = drag.top - (event.clientY - drag.y);
      }
      return;
    }
    const p = this.toDoc(event);
    this.cursor.set(p);
    this.scheduleRulers();
    if (this.store.tool() === 'caneta' && !drag) this.penHover.set(p);
    if (!drag) return;
    switch (drag.kind) {
      case 'move': return this.dragMove(drag, p, event.altKey || !this.store.snap());
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
        const hin: Point = [2 * a.p[0] - p[0], 2 * a.p[1] - p[1]];
        anchors[drag.index] = dist(p, a.p) * this.ppm() < 3 ? { ...a, hin: null, hout: null } : { ...a, hin, hout: p };
        this.pen.set(anchors);
        return;
      }
    }
  }

  onPointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    this.dragging.set(false);
    this.guides.set([]);
    if (!drag || drag.kind === 'pan' || drag.kind === 'pen') return;
    // A medida que o arrasto mostrava na barra de status não vale mais.
    if (drag.kind !== 'marquee') this.store.status.set('');
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
    this.store.status.set(`Δ ${fmt(dx)} × ${fmt(dy)} mm`);
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
      this.store.status.set(`${fmt((lb.maxX - lb.minX) * Math.abs(next.scaleX))} × ${fmt((lb.maxY - lb.minY) * Math.abs(next.scaleY))} mm`);
      return;
    }
    // Várias: escala uniforme a partir do canto oposto da caixa.
    const idx = { nw: 0, ne: 1, se: 2, sw: 3 }[h as 'nw' | 'ne' | 'se' | 'sw'];
    const handlePt = f.corners[idx];
    const anchor = f.corners[(idx + 2) % 4];
    const vx = handlePt[0] - anchor[0], vy = handlePt[1] - anchor[1];
    const k = Math.max(0.01, ((p[0] - anchor[0]) * vx + (p[1] - anchor[1]) * vy) / (vx * vx + vy * vy || 1));
    this.store.status.set(`${fmt(k * 100, 0)}%`);
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
    this.store.status.set(`${fmt(deg)}°`);
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
    this.store.status.set(`${fmt(w)} × ${fmt(h)} mm`);
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
      stroke: this.store.currentStroke() ?? '#000000',
      strokeWidth: this.store.currentStrokeWidth() || 0.35,
    });
    this.store.addLayers([layer]);
  }

  // ---------- conta-gotas ----------

  private async pickColor(p: Point): Promise<void> {
    const W = this.store.widthMm(), H = this.store.heightMm();
    if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) return;
    try {
      const svg = await buildSvg(this.store, {});
      const withRef = this.withHiddenReference(svg);
      // 4 px/mm basta pra ler a cor; a referência oculta também vale.
      const canvas = await rasterizeSvg(withRef, W, H, 25.4 * 4, '#ffffff', 8_000_000);
      const sx = canvas.width / W, sy = canvas.height / H;
      const px = canvas.getContext('2d')!.getImageData(Math.min(canvas.width - 1, Math.floor(p[0] * sx)), Math.min(canvas.height - 1, Math.floor(p[1] * sy)), 1, 1).data;
      const hex = rgbToHex(px[0], px[1], px[2]);
      this.store.setPaint(this.store.paintTarget(), hex);
      this.store.status.set(`Cor ${hex} aplicada ao ${this.store.paintTarget() === 'fill' ? 'preenchimento' : 'traço'}.`);
    } catch {
      this.store.status.set('Não consegui ler a cor.');
    }
  }

  private withHiddenReference(svg: string): string {
    const refs = this.store.layers().filter((l) => l.kind === 'imagem' && !l.visible);
    if (!refs.length) return svg;
    const imgs = refs.map((l) => l.kind === 'imagem'
      ? `<image href="${l.src}" x="${-l.w / 2}" y="${-l.h / 2}" width="${l.w}" height="${l.h}" preserveAspectRatio="none" transform="${matrixAttr(layerMatrix(l))}" />`
      : '').join('');
    return svg.replace(/(<svg[^>]*>\n?)/, `$1${imgs}`);
  }

  // ---------- menu de contexto ----------

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const id = (event.target as Element).closest('[data-id]')?.getAttribute('data-id');
    if (id && !this.store.selectedIds().includes(id)) this.store.select(id);
    const s = this.store;
    const sel = s.selection();
    const has = sel.length > 0;
    const vec = sel.filter((l) => l.kind !== 'imagem').length;
    const ids = () => s.selectedIds();
    const groups: MenuItem[][] = [
      [
        { label: 'Desfazer', keys: 'Ctrl+Z', run: () => s.undo(), disabled: !s.canUndo() },
        { label: 'Refazer', keys: 'Ctrl+Shift+Z', run: () => s.redo(), disabled: !s.canRedo() },
      ],
      [
        { label: 'Recortar', keys: 'Ctrl+X', run: () => s.cut(), disabled: !has },
        { label: 'Copiar', keys: 'Ctrl+C', run: () => s.copy(), disabled: !has },
        { label: 'Colar', keys: 'Ctrl+V', run: () => s.paste(false), disabled: !s.hasClipboard() },
        { label: 'Colar no lugar', keys: 'Ctrl+Shift+V', run: () => s.paste(true), disabled: !s.hasClipboard() },
        { label: 'Duplicar', keys: 'Ctrl+D', run: () => s.duplicate(ids()), disabled: !has },
      ],
    ];
    if (has) {
      groups.push(
        [
          { label: 'Agrupar', keys: 'Ctrl+G', run: () => s.group(), disabled: sel.length < 2 },
          { label: 'Desagrupar', keys: 'Ctrl+Shift+G', run: () => s.ungroup(), disabled: !sel.some((l) => l.groupId) },
        ],
        [
          { label: 'Trazer pra frente', keys: 'Ctrl+Shift+]', run: () => s.reorder(ids(), 'topo') },
          { label: 'Avançar', keys: 'Ctrl+]', run: () => s.reorder(ids(), 'frente') },
          { label: 'Recuar', keys: 'Ctrl+[', run: () => s.reorder(ids(), 'tras') },
          { label: 'Enviar pra trás', keys: 'Ctrl+Shift+[', run: () => s.reorder(ids(), 'fundo') },
        ],
        [
          { label: 'Soldar', run: () => s.combine('unir'), disabled: !vec },
          { label: 'Criar contornos (em curvas)', keys: 'Ctrl+Shift+O', run: () => s.convertToPath(ids()), disabled: !sel.some((l) => l.kind === 'texto' || l.kind === 'forma') },
          { label: 'Separar formas', run: () => s.breakApart(), disabled: !sel.some((l) => l.kind === 'caminho' || l.kind === 'forma') },
          { label: 'Contorno de corte de 3 mm', run: () => s.outline(3, true), disabled: !vec },
        ],
        [
          { label: 'Travar', keys: 'Ctrl+2', run: () => this.lockSelection() },
          { label: 'Ocultar', keys: 'Ctrl+3', run: () => this.hideSelection() },
          { label: 'Apagar', keys: 'Delete', run: () => s.remove(ids()), danger: true },
        ],
      );
    } else {
      groups.push([
        { label: 'Selecionar tudo', keys: 'Ctrl+A', run: () => s.selectAll(), disabled: !s.layers().length },
        { label: 'Destravar tudo', run: () => s.patchMany(s.layers().map((l) => l.id), (l) => (l.locked ? { locked: false } : null)), disabled: !s.layers().some((l) => l.locked) },
        { label: 'Mostrar tudo', run: () => s.patchMany(s.layers().map((l) => l.id), (l) => (l.visible ? null : { visible: true })), disabled: !s.layers().some((l) => !l.visible) },
        { label: 'Ajustar à janela', keys: 'Ctrl+0', run: () => this.fit() },
      ]);
    }
    const count = groups.reduce((n, g) => n + g.length, 0);
    const h = count * 28 + groups.length * 9 + 8;
    this.menu.set({
      x: Math.min(event.clientX, window.innerWidth - 240),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - h - 8)),
      groups,
    });
  }

  runMenu(item: MenuItem): void {
    this.menu.set(null);
    item.run();
  }

  @HostListener('document:pointerdown')
  closeMenu(): void {
    if (this.menu()) this.menu.set(null);
  }

  private lockSelection(): void {
    const ids = this.store.selectedIds();
    this.store.patchMany(ids, () => ({ locked: true }));
    this.store.select(null);
  }

  private hideSelection(): void {
    const ids = this.store.selectedIds();
    this.store.patchMany(ids, () => ({ visible: false }));
    this.store.select(null);
  }

  // ---------- teclado ----------

  @HostListener('document:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') this.spaceHeld.set(false);
  }

  @HostListener('window:blur')
  onBlur(): void {
    this.spaceHeld.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (isTyping(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const s = this.store;
    const sel = s.selectedIds();

    if (event.code === 'Space') {
      event.preventDefault();
      if (!this.spaceHeld()) this.spaceHeld.set(true);
      return;
    }
    if (event.key === 'F1' || (!ctrl && event.key === '?')) {
      event.preventDefault();
      this.showHelp.set(true);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) this.hideDock.update((v) => !v);
      else this.hideAll.update((v) => !v);
      return;
    }

    if (ctrl) {
      const code = event.code;
      if (key === 'z') { event.preventDefault(); if (event.shiftKey) s.redo(); else s.undo(); return; }
      if (key === 'y') { event.preventDefault(); s.redo(); return; }
      if (key === 'd') { event.preventDefault(); s.duplicate(sel); return; }
      if (key === 'a') { event.preventDefault(); if (event.shiftKey) s.select(null); else s.selectAll(); return; }
      if (key === 'g') { event.preventDefault(); if (event.shiftKey) s.ungroup(); else s.group(); return; }
      if (key === 'c') { if (s.copy()) s.status.set(`${sel.length} objeto(s) copiado(s).`); return; }
      if (key === 'x') { event.preventDefault(); s.cut(); return; }
      if (key === 'v') {
        if (event.shiftKey) { event.preventDefault(); s.paste(true); return; }
        // Sem imagem na área de transferência o navegador pode não disparar o
        // evento "paste": nesse caso cola o que foi copiado aqui dentro.
        this.pasteHandled = false;
        setTimeout(() => { if (!this.pasteHandled) s.paste(false); }, 60);
        return;
      }
      if (key === 'o' && event.shiftKey) { event.preventDefault(); s.convertToPath(sel); return; }
      if (code === 'Digit0' || code === 'Numpad0') { event.preventDefault(); this.fit(); return; }
      if (code === 'Digit1' || code === 'Numpad1') { event.preventDefault(); this.zoomTo(1); return; }
      if (code === 'Digit2') { event.preventDefault(); this.lockSelection(); return; }
      if (code === 'Digit3') { event.preventDefault(); this.hideSelection(); return; }
      if (key === '=' || key === '+' || code === 'NumpadAdd') { event.preventDefault(); this.zoomStep(1); return; }
      if (key === '-' || code === 'NumpadSubtract') { event.preventDefault(); this.zoomStep(-1); return; }
      if (code === 'BracketRight') { event.preventDefault(); s.reorder(sel, event.shiftKey ? 'topo' : 'frente'); return; }
      if (code === 'BracketLeft') { event.preventDefault(); s.reorder(sel, event.shiftKey ? 'fundo' : 'tras'); return; }
      return;
    }

    if (key === 'escape') {
      this.menu.set(null);
      if (this.showHelp()) this.showHelp.set(false);
      else if (this.pen().length) this.finishPen(false);
      else if (s.nodeSel()) s.nodeSel.set(null);
      else s.select(null);
      return;
    }
    if (key === 'enter' && this.pen().length) { this.finishPen(false); return; }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      if (s.tool() === 'nos' && s.nodeSel()) s.nodeOp('delete');
      else s.remove(sel.filter((id) => !s.layer(id)?.locked));
      return;
    }
    if (key.startsWith('arrow') && sel.length) {
      event.preventDefault();
      const step = event.shiftKey ? 5 : 0.5;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      s.patchMany(sel, (l) => (l.locked ? null : { x: l.x + dx, y: l.y + dy }));
      return;
    }
    if (key === 'x') {
      if (event.shiftKey) s.swapPaint();
      else s.paintTarget.update((t) => (t === 'fill' ? 'stroke' : 'fill'));
      return;
    }
    if (key === 'd') { s.defaultColors(); return; }
    if (key === '/') { s.setPaint(s.paintTarget(), null); return; }
    const tool = TOOL_GROUPS.flat().find((t) => t.key.toLowerCase() === key);
    if (tool) this.setTool(tool.id);
  }
}
