/** Estado do modo Ilustração. Fica num serviço provido pela page (e não no
 * componente) porque o componente é destruído ao trocar de modo — e porque a
 * page precisa disso tudo pra salvar o projeto no backend. */

import { Injectable, computed, signal } from '@angular/core';
import { uuid } from '../../core/uuid';
import { DEFAULT_FONT_ID, FontLibrary, UploadedFont } from './fonts';
import {
  Bounds, FillPaint, fillRuleOf, ImageLayer, Layer, LayerEffects, PathLayer, Point, ShapeLayer, ShapeType, TextLayer, VPath,
  applyMatrix, boundsCenter, boundsCorners, centerPaths, growBounds, layerBase, layerMatrix, normalizeHex,
  pathsBounds, pathsToD, reversePath, round, shapePaths, topFraction, transformPaths, unionBounds,
} from './illustration-model';
import { TextLayout, layoutText } from './svg-text';
import { effectsPad } from './illustration-paint';
import {
  AreaSource, BoolOp, addNodeAfter, booleanPaths, cornerNode, deleteNode, eraseArea, offsetOutline, smoothNode, splitIslands,
} from './vector-ops';
import { ImageStats, PresetId, VectorizeParams, VectorizeResult } from './vectorize';

export interface IllustrationProjectData {
  version: number;
  widthMm: number;
  heightMm: number;
  layers: Layer[];
  fonts: UploadedFont[];
  guides?: Guide[];
  grid?: GridSettings;
  boards?: Artboard[];
}

/** Prancheta a mais (a primeira é a do documento, em 0,0). Ficam sempre em
 * coordenadas positivas, à direita da primeira. */
export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAIN_BOARD = 'principal';
const BOARD_GAP_MM = 20;

/** Guia arrastada da régua: `x` é uma linha vertical em x = pos. */
export interface Guide {
  id: string;
  axis: 'x' | 'y';
  pos: number;
}

export interface GridSettings {
  show: boolean;
  snap: boolean;
  stepMm: number;
}

interface DocState {
  layers: Layer[];
  widthMm: number;
  heightMm: number;
}

export type Tool = 'selecionar' | 'nos' | 'caneta' | 'lapis' | 'borracha' | 'texto' | 'retangulo' | 'elipse' | 'estrela' | 'poligono' | 'contagotas' | 'mao' | 'zoom';
export type PaintTarget = 'fill' | 'stroke';

export interface SelectionGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface NodeSelection {
  layerId: string;
  path: number;
  node: number;
}

/** Imagem sendo vetorizada: sobrevive à troca de modo, pra os ajustes não se
 * perderem. */
export interface VectorSource {
  name: string;
  canvas: HTMLCanvasElement;
  /** Versão reduzida que vira a camada de referência no projeto salvo. */
  dataUrl: string;
}

const MAX_HISTORY = 100;

/** Coordenadas com 3 casas (1 µm) no projeto salvo: precisão total deixaria
 * um desenho vetorizado de 40 mil nós com vários MB, perto do teto do backend. */
function compactPath(p: VPath): VPath {
  const r = (pt: Point): Point => [round(pt[0], 3), round(pt[1], 3)];
  return { start: r(p.start), closed: p.closed, segments: p.segments.map((s) => ({ c1: s.c1 && r(s.c1), c2: s.c2 && r(s.c2), to: r(s.to) })) };
}

function compactLayer(l: Layer): Layer {
  if (l.kind === 'caminho') return { ...l, paths: l.paths.map(compactPath) };
  if (l.kind === 'texto' && l.guide) return { ...l, guide: compactPath(l.guide) };
  return l;
}
export const CUT_COLOR = '#e53935';

/** Cópias de camadas mascaradas apontam pra cópia da máscara, não pra original. */
function remapClips(originals: Layer[], copies: Layer[]): Layer[] {
  const ids = new Map(originals.map((l, i) => [l.id, copies[i].id]));
  return copies.map((c) => (c.clipBy ? ({ ...c, clipBy: ids.get(c.clipBy) ?? null } as Layer) : c));
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

@Injectable()
export class IllustrationStore {
  widthMm = signal(200);
  heightMm = signal(200);
  /** De trás pra frente: a última é a que fica por cima. */
  layers = signal<Layer[]>([]);
  selectedIds = signal<string[]>([]);
  tool = signal<Tool>('selecionar');
  nodeSel = signal<NodeSelection | null>(null);
  /** Cor dos elementos novos (o conta-gotas troca). */
  currentFill = signal<string | null>('#6d5ef8');
  currentStroke = signal<string | null>(null);
  currentStrokeWidth = signal(0.35);
  /** Qual quadrado do widget de cores está na frente (X alterna). */
  paintTarget = signal<PaintTarget>('fill');
  keepRatio = signal(true);
  snap = signal(true);
  /** Raio da borracha vetorial, em mm. */
  eraserMm = signal(3);
  guides = signal<Guide[]>([]);
  boards = signal<Artboard[]>([]);
  /** Todas as pranchetas, a do documento primeiro. */
  allBoards = computed<Artboard[]>(() => [
    { id: MAIN_BOARD, name: 'Prancheta 1', x: 0, y: 0, w: this.widthMm(), h: this.heightMm() },
    ...this.boards(),
  ]);
  /** Até onde vão as pranchetas (a área de trabalho cresce junto). */
  extent = computed(() => this.allBoards().reduce((e, b) => ({ w: Math.max(e.w, b.x + b.w), h: Math.max(e.h, b.y + b.h) }), { w: 0, h: 0 }));
  showGuides = signal(true);
  grid = signal<GridSettings>({ show: false, snap: false, stepMm: 10 });
  /** Sobe quando o painel deve focar o campo de texto. */
  focusText = signal(0);
  canUndo = signal(false);
  canRedo = signal(false);
  status = signal('');

  // vetorização
  vecSource = signal<VectorSource | null>(null);
  vecStats = signal<ImageStats | null>(null);
  vecPreset = signal<PresetId | null>(null);
  /** A leitura que a análise escolheu (o menu marca com ✦). */
  vecSuggested = signal<PresetId | null>(null);
  vecReason = signal('');
  vecParams = signal<VectorizeParams | null>(null);
  vecWidthMm = signal(120);
  vecGroupId = signal<string | null>(null);
  vecRefId = signal<string | null>(null);
  vecInfo = signal('');
  /** Imagem mandada pelo Print & Cut, esperando o modo abrir. */
  pendingImport = signal<{ name: string; canvas: HTMLCanvasElement } | null>(null);

  private clipboard: Layer[] = [];
  private pasteCount = 0;
  private liveEditing = false;
  private past: DocState[] = [];
  private future: DocState[] = [];
  private dragBase: DocState | null = null;
  private geoCache = new WeakMap<Layer, { v: number; paths: VPath[] }>();
  private layoutCache = new WeakMap<Layer, { v: number; layout: TextLayout | null }>();
  private dCache = new WeakMap<Layer, { v: number; d: string }>();

  constructor(public fonts: FontLibrary) {}

  hasContent = computed(() => this.layers().length > 0);

  /** Caixa da seleção como o painel Transformar mostra: com uma camada, o
   * tamanho dela sem o giro; com várias, a caixa que envolve tudo. */
  geometry = computed<SelectionGeometry | null>(() => {
    this.fonts.version();
    const b = this.selectionBounds();
    if (!b) return null;
    const l = this.primary();
    if (this.selection().length === 1 && l) {
      const lb = this.localBounds(l);
      return { x: b.minX, y: b.minY, w: (lb.maxX - lb.minX) * Math.abs(l.scaleX), h: (lb.maxY - lb.minY) * Math.abs(l.scaleY) };
    }
    return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  });

  /** Cor que o widget mostra: a da seleção, ou a padrão sem seleção. */
  shownFill = computed(() => {
    const l = this.primary();
    return l && l.kind !== 'imagem' ? l.fill : this.currentFill();
  });

  shownStroke = computed(() => {
    const l = this.primary();
    return l && l.kind !== 'imagem' ? l.stroke : this.currentStroke();
  });

  shownStrokeWidth = computed(() => {
    const l = this.primary();
    return l && l.kind !== 'imagem' ? l.strokeWidth : this.currentStrokeWidth();
  });

  private defaultPaint(): Pick<Layer, 'fill' | 'stroke' | 'strokeWidth'> {
    return { fill: this.currentFill(), stroke: this.currentStroke(), strokeWidth: this.currentStrokeWidth() };
  }

  selection = computed(() => {
    const ids = new Set(this.selectedIds());
    return this.layers().filter((l) => ids.has(l.id));
  });

  /** A camada que o painel edita: a última clicada. */
  primary = computed(() => {
    const ids = this.selectedIds();
    const id = ids[ids.length - 1];
    return id ? (this.layers().find((l) => l.id === id) ?? null) : null;
  });

  /** Cores usadas no documento, pra trocar uma cor em tudo de uma vez. */
  palette = computed(() => {
    const seen = new Map<string, number>();
    for (const l of this.layers()) {
      if (l.kind === 'imagem') continue;
      for (const c of [l.fill, l.stroke]) {
        const hex = normalizeHex(c);
        if (hex) seen.set(hex, (seen.get(hex) ?? 0) + 1);
      }
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  });

  // ---------- geometria ----------

  /** Contornos da camada no espaço local. Texto depende da fonte: enquanto ela
   * carrega, volta vazio, e a versão da biblioteca invalida o cache. */
  localPaths(l: Layer): VPath[] {
    const v = l.kind === 'texto' ? this.fonts.version() : 0;
    const hit = this.geoCache.get(l);
    if (hit && hit.v === v) return hit.paths;
    let paths: VPath[] = [];
    if (l.kind === 'caminho') paths = l.paths;
    else if (l.kind === 'forma') paths = shapePaths(l);
    else if (l.kind === 'texto') paths = this.textLayout(l)?.paths ?? [];
    this.geoCache.set(l, { v, paths });
    return paths;
  }

  textLayout(l: TextLayer): TextLayout | null {
    const v = this.fonts.version();
    const hit = this.layoutCache.get(l);
    if (hit && hit.v === v) return hit.layout;
    const font = this.fonts.get(l.fontId, l.weight);
    const layout = font ? layoutText(font, l) : null;
    this.layoutCache.set(l, { v, layout });
    return layout;
  }

  worldPaths(l: Layer): VPath[] {
    return transformPaths(this.localPaths(l), layerMatrix(l));
  }

  localBounds(l: Layer): Bounds {
    if (l.kind === 'imagem') return { minX: -l.w / 2, minY: -l.h / 2, maxX: l.w / 2, maxY: l.h / 2 };
    const b = pathsBounds(this.localPaths(l));
    if (b) return b;
    if (l.kind === 'texto') {
      // Fonte ainda carregando: uma caixa aproximada pra seleção não sumir.
      const w = Math.max(...l.text.split('\n').map((s) => s.length), 1) * l.sizeMm * 0.55;
      const h = l.text.split('\n').length * l.sizeMm * l.lineHeight;
      return { minX: -w / 2, minY: -h / 2, maxX: w / 2, maxY: h / 2 };
    }
    return { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 };
  }

  worldBounds(l: Layer): Bounds {
    const m = layerMatrix(l);
    let b: Bounds | null = null;
    if (l.kind === 'imagem' || !this.localPaths(l).length) {
      for (const c of boundsCorners(this.localBounds(l))) b = growBounds(b, applyMatrix(m, c));
      return b!;
    }
    return pathsBounds(this.worldPaths(l)) ?? this.localBounds(l);
  }

  selectionBounds(): Bounds | null {
    return this.selection().reduce<Bounds | null>((acc, l) => unionBounds(acc, this.worldBounds(l)), null);
  }

  // ---------- histórico ----------

  private snapshot(): DocState {
    return { layers: this.layers(), widthMm: this.widthMm(), heightMm: this.heightMm() };
  }

  private restore(s: DocState): void {
    this.layers.set(s.layers);
    this.widthMm.set(s.widthMm);
    this.heightMm.set(s.heightMm);
    const ids = new Set(s.layers.map((l) => l.id));
    this.selectedIds.update((sel) => sel.filter((id) => ids.has(id)));
    this.nodeSel.set(null);
  }

  /** Guarda o estado atual antes de uma mudança. As camadas são imutáveis
   * (toda edição troca o objeto), então o snapshot é só a referência. */
  record(): void {
    this.past.push(this.snapshot());
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.syncHistory();
  }

  /** Arrasto: o estado de antes fica guardado e só entra no histórico se o
   * arrasto mudou alguma coisa. */
  begin(): void {
    this.dragBase = this.snapshot();
  }

  end(): void {
    const base = this.dragBase;
    this.dragBase = null;
    if (!base) return;
    const now = this.snapshot();
    if (base.layers === now.layers && base.widthMm === now.widthMm && base.heightMm === now.heightMm) return;
    this.past.push(base);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.syncHistory();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.snapshot());
    this.restore(prev);
    this.syncHistory();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.restore(next);
    this.syncHistory();
  }

  private syncHistory(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }

  // ---------- camadas ----------

  layer(id: string): Layer | null {
    return this.layers().find((l) => l.id === id) ?? null;
  }

  newPathLayer(name: string, paths: VPath[], style: Partial<Layer> = {}): PathLayer {
    const c = centerPaths(paths);
    return { ...layerBase(uuid(), name), ...this.defaultPaint(), ...style, kind: 'caminho', paths: c.paths, x: c.cx, y: c.cy } as PathLayer;
  }

  newShape(shape: ShapeType, x: number, y: number, w: number, h: number): ShapeLayer {
    const names: Record<ShapeType, string> = { retangulo: 'Retângulo', elipse: 'Elipse', estrela: 'Estrela', poligono: 'Polígono' };
    return {
      ...layerBase(uuid(), names[shape]), ...this.defaultPaint(), kind: 'forma', shape, x, y, w, h,
      radius: 0, points: shape === 'estrela' ? 5 : 6, innerRatio: 0.45,
    };
  }

  newText(x: number, y: number, text = 'Texto'): TextLayer {
    return {
      ...layerBase(uuid(), 'Texto'), fill: '#222222', kind: 'texto', x, y, text,
      fontId: DEFAULT_FONT_ID, weight: 400, sizeMm: 12, tracking: 0, lineHeight: 1.2, align: 'center',
      curve: 'reta', bend: 30, guide: null, guideOffset: 0,
    };
  }

  addLayers(layers: Layer[], options: { select?: boolean; at?: number; record?: boolean } = {}): void {
    if (!layers.length) return;
    if (options.record !== false) this.record();
    this.layers.update((list) => {
      const at = options.at ?? list.length;
      return [...list.slice(0, at), ...layers, ...list.slice(at)];
    });
    if (options.select !== false) this.selectedIds.set(layers.map((l) => l.id));
  }

  /** Aplica um patch. `record: false` é pra quem já chamou `begin()` (arrasto)
   * ou `record()` antes. */
  patch(id: string, patch: Partial<Layer>, record = true): void {
    if (record) this.record();
    this.layers.update((list) => list.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));
  }

  patchMany(ids: string[], fn: (l: Layer) => Partial<Layer> | null, record = true): void {
    const set = new Set(ids);
    if (record) this.record();
    this.layers.update((list) => list.map((l) => {
      if (!set.has(l.id)) return l;
      const p = fn(l);
      return p ? ({ ...l, ...p } as Layer) : l;
    }));
  }

  /** Mesmo patch em toda a seleção (cor, traço, opacidade…). */
  patchSelection(patch: Partial<Layer>, record = true): void {
    this.patchMany(this.selectedIds(), () => patch, record);
  }

  remove(ids: string[]): void {
    if (!ids.length) return;
    const set = new Set(ids);
    this.record();
    // Máscara apagada solta o que ela recortava.
    this.layers.update((list) => list
      .filter((l) => !set.has(l.id))
      .map((l) => (l.clipBy && set.has(l.clipBy) ? ({ ...l, clipBy: null } as Layer) : l)));
    this.selectedIds.update((sel) => sel.filter((id) => !set.has(id)));
    this.nodeSel.set(null);
    if (this.vecRefId() && set.has(this.vecRefId()!)) this.vecRefId.set(null);
  }

  duplicate(ids: string[]): void {
    const set = new Set(ids);
    const groups = new Map<string, string>();
    const copies = this.layers()
      .filter((l) => set.has(l.id))
      .map((l) => {
        const groupId = l.groupId ? (groups.get(l.groupId) ?? groups.set(l.groupId, uuid()).get(l.groupId)!) : null;
        return { ...clone(l), id: uuid(), name: `${l.name} (cópia)`, x: l.x + 5, y: l.y + 5, groupId } as Layer;
      });
    this.addLayers(remapClips(this.layers().filter((l) => set.has(l.id)), copies));
  }

  /** Clique numa camada seleciona o grupo inteiro dela. */
  select(id: string | null, additive = false): void {
    if (!id) {
      if (!additive) this.selectedIds.set([]);
      return;
    }
    const l = this.layer(id);
    const unit = l?.groupId ? this.layers().filter((x) => x.groupId === l.groupId).map((x) => x.id) : [id];
    if (additive) {
      const cur = new Set(this.selectedIds());
      const all = unit.every((u) => cur.has(u));
      for (const u of unit) {
        if (all) cur.delete(u);
        else cur.add(u);
      }
      // A clicada vai pro fim: é ela que o painel mostra.
      this.selectedIds.set([...[...cur].filter((x) => x !== id), ...(cur.has(id) ? [id] : [])]);
    } else {
      this.selectedIds.set([...unit.filter((u) => u !== id), id]);
    }
  }

  selectAll(): void {
    this.selectedIds.set(this.layers().filter((l) => l.visible && !l.locked).map((l) => l.id));
  }

  reorder(ids: string[], where: 'frente' | 'tras' | 'topo' | 'fundo'): void {
    const set = new Set(ids);
    const list = [...this.layers()];
    if (!list.some((l) => set.has(l.id))) return;
    this.record();
    if (where === 'topo' || where === 'fundo') {
      const moving = list.filter((l) => set.has(l.id));
      const rest = list.filter((l) => !set.has(l.id));
      this.layers.set(where === 'topo' ? [...rest, ...moving] : [...moving, ...rest]);
      return;
    }
    if (where === 'frente') {
      for (let i = list.length - 2; i >= 0; i--) {
        if (set.has(list[i].id) && !set.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      }
    } else {
      for (let i = 1; i < list.length; i++) {
        if (set.has(list[i].id) && !set.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
    }
    this.layers.set(list);
  }

  group(): void {
    const ids = this.selectedIds();
    if (ids.length < 2) return;
    const g = uuid();
    this.patchMany(ids, () => ({ groupId: g }));
  }

  ungroup(): void {
    this.patchMany(this.selectedIds(), () => ({ groupId: null }));
  }

  setDocSize(w: number, h: number): void {
    this.record();
    this.widthMm.set(w);
    this.heightMm.set(h);
  }

  clear(): void {
    this.layers.set([]);
    this.guides.set([]);
    this.boards.set([]);
    this.selectedIds.set([]);
    this.nodeSel.set(null);
    this.past = [];
    this.future = [];
    this.syncHistory();
    this.widthMm.set(200);
    this.heightMm.set(200);
    this.vecSource.set(null);
    this.vecStats.set(null);
    this.vecPreset.set(null);
    this.vecSuggested.set(null);
    this.vecParams.set(null);
    this.vecGroupId.set(null);
    this.vecRefId.set(null);
    this.vecInfo.set('');
    this.fonts.setUploads([]);
  }

  // ---------- edição contínua ----------

  /** Controle deslizante, seletor de cor, digitação: cada movimento aplica na
   * hora, mas o histórico ganha um passo só, fechado em `commitLive()`. */
  live(fn: () => void): void {
    if (!this.liveEditing) {
      this.liveEditing = true;
      this.begin();
    }
    fn();
  }

  commitLive(): void {
    if (!this.liveEditing) return;
    this.liveEditing = false;
    this.end();
  }

  // ---------- cores ----------

  /** Preenchimento ou traço da seleção; sem seleção, o padrão dos próximos. */
  setPaint(which: PaintTarget, value: string | null, live = false): void {
    const ids = this.selection().filter((l) => l.kind !== 'imagem').map((l) => l.id);
    if (!ids.length) {
      if (which === 'fill') this.currentFill.set(value);
      else this.currentStroke.set(value);
      return;
    }
    if (value) (which === 'fill' ? this.currentFill : this.currentStroke).set(value);
    const apply = () => this.patchMany(ids, (l) => (which === 'stroke' && value && !l.stroke && !l.strokeWidth ? { stroke: value, strokeWidth: 0.35 } : { [which]: value }), false);
    if (live) this.live(apply);
    else {
      this.record();
      apply();
    }
  }

  setStrokeWidth(mm: number, live = false): void {
    const w = Math.max(0, Math.min(50, mm));
    const ids = this.selection().filter((l) => l.kind !== 'imagem').map((l) => l.id);
    if (!ids.length) {
      this.currentStrokeWidth.set(w);
      return;
    }
    const apply = () => this.patchMany(ids, (l) => ({ strokeWidth: w, stroke: l.stroke ?? (w > 0 ? '#000000' : null) }), false);
    if (live) this.live(apply);
    else {
      this.record();
      apply();
    }
  }

  /** Shift+X: troca preenchimento e traço. */
  swapPaint(): void {
    const ids = this.selection().filter((l) => l.kind !== 'imagem').map((l) => l.id);
    if (!ids.length) {
      const f = this.currentFill();
      this.currentFill.set(this.currentStroke());
      this.currentStroke.set(f);
      return;
    }
    this.patchMany(ids, (l) => ({ fill: l.stroke, stroke: l.fill, strokeWidth: l.strokeWidth || 0.35 }));
  }

  /** D: cores padrão (preenchimento branco, traço preto), como no Illustrator. */
  defaultColors(): void {
    this.currentFill.set('#ffffff');
    this.currentStroke.set('#000000');
    this.currentStrokeWidth.set(0.35);
    const ids = this.selection().filter((l) => l.kind !== 'imagem').map((l) => l.id);
    if (ids.length) this.patchMany(ids, () => ({ fill: '#ffffff', stroke: '#000000', strokeWidth: 0.35 }));
  }

  // ---------- transformar ----------

  moveSelectionTo(axis: 'x' | 'y', value: number, record = true): void {
    const g = this.geometry();
    if (!g || !Number.isFinite(value)) return;
    const d = value - (axis === 'x' ? g.x : g.y);
    this.patchMany(this.selectedIds(), (l) => (l.locked ? null : axis === 'x' ? { x: l.x + d } : { y: l.y + d }), record);
  }

  resizeSelectionTo(axis: 'w' | 'h', value: number, record = true): void {
    const g = this.geometry();
    if (!g || !(value > 0)) return;
    const f = value / (axis === 'w' ? g.w : g.h);
    if (!Number.isFinite(f) || f <= 0) return;
    const fx = axis === 'w' || this.keepRatio() ? f : 1;
    const fy = axis === 'h' || this.keepRatio() ? f : 1;
    const sel = this.selection();
    if (sel.length === 1) {
      this.patch(sel[0].id, { scaleX: sel[0].scaleX * fx, scaleY: sel[0].scaleY * fy }, record);
      return;
    }
    // Várias: escala a partir do canto de cima à esquerda da seleção.
    this.patchMany(sel.map((l) => l.id), (l) => ({
      x: g.x + (l.x - g.x) * fx, y: g.y + (l.y - g.y) * fy, scaleX: l.scaleX * fx, scaleY: l.scaleY * fy,
    }), record);
  }

  rotateSelectionTo(deg: number, record = true): void {
    const l = this.primary();
    if (!l || !Number.isFinite(deg)) return;
    this.patch(l.id, { rotation: ((((deg + 180) % 360) + 360) % 360) - 180 }, record);
  }

  /** Leva a camada pra uma posição da pilha (0 = fundo), como arrastar no
   * painel Camadas. */
  moveLayerTo(id: string, index: number): void {
    const list = [...this.layers()];
    const from = list.findIndex((l) => l.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(list.length - 1, index));
    if (from === to) return;
    this.record();
    const [l] = list.splice(from, 1);
    list.splice(to, 0, l);
    this.layers.set(list);
  }

  /** Atributo `d` da camada no espaço local, guardado por objeto (camadas são
   * imutáveis) — o palco e as miniaturas do painel Camadas leem daqui. */
  pathD(l: Layer): string {
    if (l.kind === 'imagem') return '';
    const v = l.kind === 'texto' ? this.fonts.version() : 0;
    const hit = this.dCache.get(l);
    if (hit && hit.v === v) return hit.d;
    const d = pathsToD(this.localPaths(l));
    this.dCache.set(l, { v, d });
    return d;
  }

  // ---------- área de transferência ----------

  copy(): number {
    this.clipboard = clone(this.selection());
    this.pasteCount = 0;
    return this.clipboard.length;
  }

  cut(): number {
    const n = this.copy();
    this.remove(this.selectedIds());
    return n;
  }

  hasClipboard(): boolean {
    return this.clipboard.length > 0;
  }

  /** Colar desloca um pouco a cada vez; "colar no lugar" (Ctrl+Shift+V) não. */
  paste(inPlace: boolean): void {
    if (!this.clipboard.length) return;
    this.pasteCount++;
    const off = inPlace ? 0 : 5 * this.pasteCount;
    const groups = new Map<string, string>();
    const copies = this.clipboard.map((l) => {
      const groupId = l.groupId ? (groups.get(l.groupId) ?? groups.set(l.groupId, uuid()).get(l.groupId)!) : null;
      return { ...clone(l), id: uuid(), x: l.x + off, y: l.y + off, groupId } as Layer;
    });
    this.addLayers(remapClips(this.clipboard, copies));
  }

  // ---------- organizar ----------

  /** Unidades de alinhamento: um grupo se move como uma peça só. */
  private units(): { ids: string[]; b: Bounds }[] {
    const map = new Map<string, { ids: string[]; b: Bounds | null }>();
    for (const l of this.selection()) {
      if (l.locked) continue;
      const key = l.groupId ?? l.id;
      const u = map.get(key) ?? { ids: [], b: null };
      u.ids.push(l.id);
      u.b = unionBounds(u.b, this.worldBounds(l));
      map.set(key, u);
    }
    return [...map.values()].filter((u): u is { ids: string[]; b: Bounds } => !!u.b);
  }

  private shiftUnits(moves: { ids: string[]; dx: number; dy: number }[]): void {
    const delta = new Map<string, [number, number]>();
    for (const m of moves) for (const id of m.ids) delta.set(id, [m.dx, m.dy]);
    this.patchMany([...delta.keys()], (l) => {
      const [dx, dy] = delta.get(l.id)!;
      return { x: l.x + dx, y: l.y + dy };
    });
  }

  /** Com uma peça só, alinha à prancheta; com várias, entre si. */
  align(mode: AlignMode): void {
    const units = this.units();
    if (!units.length) return;
    const ref: Bounds = units.length > 1
      ? units.reduce<Bounds | null>((acc, u) => unionBounds(acc, u.b), null)!
      : { minX: 0, minY: 0, maxX: this.widthMm(), maxY: this.heightMm() };
    this.shiftUnits(units.map((u) => {
      let dx = 0, dy = 0;
      if (mode === 'left') dx = ref.minX - u.b.minX;
      if (mode === 'right') dx = ref.maxX - u.b.maxX;
      if (mode === 'hcenter') dx = (ref.minX + ref.maxX) / 2 - (u.b.minX + u.b.maxX) / 2;
      if (mode === 'top') dy = ref.minY - u.b.minY;
      if (mode === 'bottom') dy = ref.maxY - u.b.maxY;
      if (mode === 'vcenter') dy = (ref.minY + ref.maxY) / 2 - (u.b.minY + u.b.maxY) / 2;
      return { ids: u.ids, dx, dy };
    }));
  }

  /** Espaço igual entre as peças (não entre os centros): é o que o olho lê. */
  distribute(axis: 'h' | 'v'): void {
    const units = this.units();
    if (units.length < 3) return;
    const lo = (b: Bounds): number => (axis === 'h' ? b.minX : b.minY);
    const hi = (b: Bounds): number => (axis === 'h' ? b.maxX : b.maxY);
    units.sort((a, b) => lo(a.b) - lo(b.b));
    const start = lo(units[0].b);
    const end = Math.max(...units.map((u) => hi(u.b)));
    const total = units.reduce((s, u) => s + hi(u.b) - lo(u.b), 0);
    const gap = (end - start - total) / (units.length - 1);
    let cursor = start;
    this.shiftUnits(units.map((u) => {
      const d = cursor - lo(u.b);
      cursor += hi(u.b) - lo(u.b) + gap;
      return { ids: u.ids, dx: axis === 'h' ? d : 0, dy: axis === 'v' ? d : 0 };
    }));
  }

  /** Espelha em volta do centro da seleção. */
  flip(axis: 'h' | 'v'): void {
    const b = this.selectionBounds();
    if (!b) return;
    const [cx, cy] = boundsCenter(b);
    this.patchMany(this.selectedIds(), (l) => (axis === 'h'
      ? { scaleX: -l.scaleX, x: 2 * cx - l.x, rotation: -l.rotation }
      : { scaleY: -l.scaleY, y: 2 * cy - l.y, rotation: -l.rotation }));
  }

  // ---------- combinar e contornos ----------

  private areaSource(l: Layer): AreaSource {
    const stroke = l.stroke && l.strokeWidth > 0 ? l.strokeWidth / 2 : 0;
    return { paths: this.worldPaths(l), pad: stroke, strokeOnly: !l.fill && !l.paint, nonzero: fillRuleOf(l) === 'nonzero' };
  }

  private vectorSelection(): Layer[] {
    return this.selection().filter((l) => l.kind !== 'imagem');
  }

  combine(op: BoolOp): boolean {
    const sources = this.vectorSelection();
    if (sources.length < (op === 'unir' ? 1 : 2)) return false;
    const result = booleanPaths(op, sources.map((l) => this.areaSource(l)));
    const names: Record<BoolOp, string> = { unir: 'União', subtrair: 'Subtração', intersecao: 'Interseção', excluir: 'Exclusão' };
    const base = sources[0];
    const at = this.layers().findIndex((l) => l.id === base.id);
    const ids = new Set(sources.map((l) => l.id));
    this.record();
    this.layers.update((list) => list.filter((l) => !ids.has(l.id)));
    if (!result.length) {
      this.selectedIds.set([]);
      this.status.set('A operação não deixou nenhuma área.');
      return true;
    }
    const layer = this.newPathLayer(names[op], result, { fill: base.fill ?? base.stroke ?? this.currentFill() ?? '#222222', stroke: null, opacity: base.opacity });
    this.addLayers([layer], { at: Math.max(0, Math.min(at, this.layers().length)), record: false });
    return true;
  }

  /** Contorno com margem em volta da seleção (ou de tudo). */
  outline(marginMm: number, outerOnly: boolean): boolean {
    const sources = this.vectorSelection().length ? this.vectorSelection() : this.layers().filter((l) => l.visible && l.kind !== 'imagem' && !l.cut);
    if (!sources.length) return false;
    // Contorno e sombra de efeito também são impressos: a margem conta a partir deles.
    const paths = offsetOutline(sources.map((l) => {
      const src = this.areaSource(l);
      return { ...src, pad: Math.max(src.pad, effectsPad(l)) };
    }), marginMm, { outerOnly });
    if (!paths.length) return false;
    const layer = this.newPathLayer(`Contorno ${marginMm.toFixed(1).replace('.', ',')} mm`, paths, {
      fill: null, stroke: CUT_COLOR, strokeWidth: 0.3, cut: true,
    });
    // Atrás de tudo: se ganhar preenchimento (fundo branco do adesivo), não cobre a arte.
    this.addLayers([layer], { at: 0 });
    return true;
  }

  // ---------- pintura especial, efeitos e máscara ----------

  /** Degradê/padrão (ou `null`, de volta à cor sólida) na seleção. */
  setFillPaint(paint: FillPaint | null, live = false): void {
    const ids = this.selection().filter((l) => l.kind !== 'imagem').map((l) => l.id);
    if (!ids.length) return;
    const apply = (): void => this.patchMany(ids, () => ({ paint }), false);
    if (live) this.live(apply);
    else {
      this.record();
      apply();
    }
  }

  setEffects(patch: Partial<LayerEffects>, live = false): void {
    const ids = this.selection().filter((l) => l.kind !== 'imagem').map((l) => l.id);
    if (!ids.length) return;
    const apply = (): void => this.patchMany(ids, (l) => {
      const next = { ...(l.effects ?? {}), ...patch };
      const empty = !next.outline && !next.outline2 && !next.shadow;
      return { effects: empty ? null : next };
    }, false);
    if (live) this.live(apply);
    else {
      this.record();
      apply();
    }
  }

  /** A máscara de recorte possível agora: a camada de cima da seleção recorta
   * as de baixo (como no Illustrator). */
  clipCandidate = computed(() => {
    const sel = this.selection();
    if (sel.length < 2) return null;
    const order = new Map(this.layers().map((l, i) => [l.id, i]));
    const top = [...sel].sort((a, b) => order.get(b.id)! - order.get(a.id)!)[0];
    return top.kind === 'imagem' || top.mask ? null : top;
  });

  canReleaseClip = computed(() => this.selection().some((l) => l.mask || l.clipBy));

  makeClip(): boolean {
    const mask = this.clipCandidate();
    if (!mask) return false;
    const others = this.selection().filter((l) => l.id !== mask.id).map((l) => l.id);
    const g = uuid();
    this.record();
    this.patchMany([mask.id, ...others], (l) => (l.id === mask.id ? { mask: true, clipBy: null, groupId: g } : { clipBy: mask.id, groupId: g }), false);
    return true;
  }

  /** Solta a máscara: a forma volta a pintar e o conteúdo aparece inteiro. */
  releaseClip(): void {
    const sel = this.selection();
    const masks = new Set(sel.filter((l) => l.mask).map((l) => l.id));
    for (const l of sel) if (l.clipBy) masks.add(l.clipBy);
    if (!masks.size) return;
    this.record();
    this.layers.update((list) => list.map((l) => {
      if (masks.has(l.id)) return { ...l, mask: false, groupId: null } as Layer;
      if (l.clipBy && masks.has(l.clipBy)) return { ...l, clipBy: null, groupId: null } as Layer;
      return l;
    }));
  }

  /** Borracha: apaga a faixa varrida (pontos em mm da prancheta) das camadas
   * selecionadas — ou, sem seleção, de tudo o que ela tocou. Forma e texto
   * apagados viram caminho. */
  eraseAlong(stroke: Point[], radiusMm: number): number {
    if (!stroke.length) return 0;
    const sel = this.selection().filter((l) => l.kind !== 'imagem' && !l.locked);
    const pool = sel.length ? sel : this.layers().filter((l) => l.visible && !l.locked && l.kind !== 'imagem' && !l.mask);
    const replaced = new Map<string, Layer | null>();
    for (const l of pool) {
      const out = eraseArea(this.areaSource(l), stroke, radiusMm);
      if (!out) continue;
      if (!out.length) {
        replaced.set(l.id, null);
        continue;
      }
      const strokeOnly = !l.fill && !l.paint;
      const c = centerPaths(out);
      const { id, name, opacity, visible, locked, groupId, cut, paint, effects, clipBy, mask } = l;
      replaced.set(l.id, {
        ...layerBase(id, name), opacity, visible, locked, groupId, cut, paint, effects, clipBy, mask,
        // Área que era só traço vira preenchimento com a cor do traço.
        fill: strokeOnly ? l.stroke : l.fill,
        stroke: strokeOnly ? null : l.stroke,
        strokeWidth: l.strokeWidth,
        kind: 'caminho', paths: c.paths, x: c.cx, y: c.cy,
      } as PathLayer);
    }
    if (!replaced.size) return 0;
    this.record();
    this.layers.update((list) => list.flatMap((l) => {
      if (!replaced.has(l.id)) return [l];
      const r = replaced.get(l.id);
      return r ? [r] : [];
    }));
    this.selectedIds.update((ids) => ids.filter((id) => replaced.get(id) !== null));
    return replaced.size;
  }

  /** Texto e forma viram caminho (é o que permite editar nós). */
  convertToPath(ids: string[]): void {
    const set = new Set(ids);
    const targets = this.layers().filter((l) => set.has(l.id) && (l.kind === 'texto' || l.kind === 'forma'));
    if (!targets.length) return;
    this.record();
    this.layers.update((list) => list.map((l) => {
      if (!set.has(l.id) || (l.kind !== 'texto' && l.kind !== 'forma')) return l;
      const paths = this.localPaths(l);
      const { id, name, x, y, rotation, scaleX, scaleY, opacity, visible, locked, fill, stroke, strokeWidth, groupId, cut, paint, effects, clipBy, mask } = l;
      const label = l.kind === 'texto' ? `“${l.text.split('\n')[0].slice(0, 24)}”` : name;
      return { id, name: label, x, y, rotation, scaleX, scaleY, opacity, visible, locked, fill, stroke, strokeWidth, groupId, cut, paint, effects, clipBy, mask, fillRule: fillRuleOf(l), kind: 'caminho', paths } as PathLayer;
    }));
  }

  /** Recentra pedaços de uma camada, mantendo o transform: cada pedaço vira
   * camada própria no mesmo lugar da tela. */
  private piecesOf(l: Layer, pieces: VPath[][], names: string[]): PathLayer[] {
    const m = layerMatrix(l);
    return pieces.map((paths, i) => {
      const c = centerPaths(paths);
      const [x, y] = applyMatrix(m, [c.cx, c.cy]);
      const { rotation, scaleX, scaleY, opacity, fill, stroke, strokeWidth, cut, paint, effects } = l;
      return {
        ...layerBase(uuid(), names[i]), rotation, scaleX, scaleY, opacity, fill, stroke, strokeWidth, cut, paint, effects,
        kind: 'caminho', paths: c.paths, x, y,
      } as PathLayer;
    });
  }

  /** Separa em ilhas: um desenho vetorizado vira uma camada por mancha. */
  breakApart(): void {
    const targets = this.selection().filter((l) => l.kind === 'caminho' || l.kind === 'forma');
    const created: PathLayer[] = [];
    const ids = new Set<string>();
    for (const l of targets) {
      const islands = splitIslands(this.localPaths(l));
      if (islands.length < 2) continue;
      ids.add(l.id);
      created.push(...this.piecesOf(l, islands, islands.map((_, i) => `${l.name} ${i + 1}`)));
    }
    if (!created.length) {
      this.status.set('Nada pra separar: a forma já é uma peça só.');
      return;
    }
    this.replaceWith(ids, created);
  }

  /** Cada letra vira uma camada (dá pra ajustar o espaço entre elas na mão). */
  separateLetters(id: string): void {
    const l = this.layer(id);
    if (!l || l.kind !== 'texto') return;
    const layout = this.textLayout(l);
    if (!layout) return;
    const pieces: VPath[][] = [];
    const names: string[] = [];
    layout.glyphs.forEach((g, i) => {
      if (!g.length) return;
      pieces.push(g);
      names.push(`Letra ${layout.chars[i]}`);
    });
    const g = uuid();
    const created = this.piecesOf(l, pieces, names).map((p) => ({ ...p, groupId: g }));
    this.replaceWith(new Set([id]), created);
  }

  private replaceWith(ids: Set<string>, created: Layer[]): void {
    const list = this.layers();
    const at = list.findIndex((l) => ids.has(l.id));
    this.record();
    this.layers.set([...list.slice(0, at).filter((l) => !ids.has(l.id)), ...created, ...list.slice(at).filter((l) => !ids.has(l.id))]);
    this.selectedIds.set(created.map((l) => l.id));
  }

  /** Põe o texto correndo pelo caminho: a guia é copiada pro texto (em
   * coordenadas da prancheta, centradas), então o caminho pode até sumir. */
  attachTextToPath(textId: string, pathId: string): boolean {
    const t = this.layer(textId);
    const p = this.layer(pathId);
    if (!t || t.kind !== 'texto' || !p || p.kind === 'imagem') return false;
    const guide = this.worldPaths(p).find((x) => x.segments.length);
    if (!guide) return false;
    const c = centerPaths([guide]);
    // Em forma fechada o texto começa centrado no topo — senão, numa elipse,
    // ele sairia do ponto da direita e correria de cabeça pra baixo por baixo.
    const closed = c.paths[0].closed;
    this.patch(textId, {
      curve: 'caminho', guide: c.paths[0], guideOffset: closed ? topFraction(c.paths[0]) : 0, align: closed ? 'center' : 'left',
      x: c.cx, y: c.cy, rotation: 0, scaleX: 1, scaleY: 1,
    } as Partial<TextLayer>);
    return true;
  }

  /** Troca o lado do caminho em que o texto corre (por dentro/por fora). */
  flipGuide(textId: string): void {
    const t = this.layer(textId);
    if (!t || t.kind !== 'texto' || !t.guide) return;
    this.patch(textId, { guide: reversePath(t.guide), guideOffset: t.guide.closed ? (1 - t.guideOffset) % 1 : t.guideOffset } as Partial<TextLayer>);
  }

  // ---------- nós ----------

  setPath(layerId: string, pathIndex: number, path: VPath | null, record: boolean): void {
    const l = this.layer(layerId);
    if (!l || l.kind !== 'caminho') return;
    const paths = [...l.paths];
    if (path) paths[pathIndex] = path;
    else paths.splice(pathIndex, 1);
    if (!paths.length) {
      this.remove([layerId]);
      return;
    }
    this.patch(layerId, { paths } as Partial<PathLayer>, record);
  }

  /** Suavizar, canto, acrescentar ou apagar o nó selecionado. */
  nodeOp(op: 'smooth' | 'corner' | 'add' | 'delete'): void {
    const sel = this.nodeSel();
    const l = sel ? this.layer(sel.layerId) : null;
    if (!sel || !l || l.kind !== 'caminho') return;
    const path = l.paths[sel.path];
    if (!path) return;
    this.record();
    if (op === 'delete') {
      this.setPath(l.id, sel.path, deleteNode(path, sel.node), false);
      this.nodeSel.set(null);
      return;
    }
    const next = op === 'smooth' ? smoothNode(path, sel.node) : op === 'corner' ? cornerNode(path, sel.node) : addNodeAfter(path, sel.node);
    this.setPath(l.id, sel.path, next, false);
    if (op === 'add') this.nodeSel.set({ ...sel, node: sel.node + 1 });
  }

  // ---------- vetorização ----------

  /** Entra (ou substitui a prévia anterior) o resultado da vetorização, no
   * tamanho pedido e centrado na prancheta. */
  applyVectorization(result: VectorizeResult, widthMm: number): void {
    const ppm = result.w / widthMm;
    const hMm = result.h / ppm;
    const ox = this.widthMm() / 2 - widthMm / 2;
    const oy = this.heightMm() / 2 - hMm / 2;
    const toMm = (p: Point): Point => [ox + p[0] / ppm, oy + p[1] / ppm];
    const groupId = this.vecGroupId() && this.layers().some((l) => l.groupId === this.vecGroupId()) ? this.vecGroupId()! : uuid();
    const layers: PathLayer[] = result.layers.map((out) => {
      const mm = out.paths.map((p) => ({
        start: toMm(p.start),
        closed: p.closed,
        segments: p.segments.map((s) => ({ c1: s.c1 ? toMm(s.c1) : null, c2: s.c2 ? toMm(s.c2) : null, to: toMm(s.to) })),
      }));
      const style = out.stroke
        ? { fill: null, stroke: out.color, strokeWidth: Math.max(0.1, Math.round((out.strokeWidthPx / ppm) * 100) / 100) }
        : { fill: out.color, stroke: null };
      return { ...this.newPathLayer(out.name, mm, style), groupId };
    });

    const list = this.layers();
    const at = list.findIndex((l) => l.groupId === groupId);
    this.record();
    const rest = list.filter((l) => l.groupId !== groupId);
    const insertAt = at >= 0 ? at : rest.length;
    let next = [...rest.slice(0, insertAt), ...layers, ...rest.slice(insertAt)];

    // Referência: a própria imagem, oculta e travada no fundo, pra desenhar por cima.
    const src = this.vecSource();
    const refId = this.vecRefId();
    const ref = refId ? next.find((l) => l.id === refId) : null;
    if (src && !ref) {
      const img: ImageLayer = {
        ...layerBase(uuid(), `Referência: ${src.name}`), kind: 'imagem', src: src.dataUrl,
        w: widthMm, h: hMm, x: this.widthMm() / 2, y: this.heightMm() / 2,
        fill: null, opacity: 0.4, visible: false, locked: true,
      };
      next = [img, ...next];
      this.vecRefId.set(img.id);
    } else if (ref && ref.kind === 'imagem') {
      next = next.map((l) => (l.id === ref.id ? { ...ref, w: widthMm, h: hMm, x: this.widthMm() / 2, y: this.heightMm() / 2 } : l));
    }
    this.layers.set(next);
    this.vecGroupId.set(groupId);
    this.selectedIds.set(layers.map((l) => l.id));
  }

  // ---------- projeto ----------

  serialize(): IllustrationProjectData | null {
    if (!this.layers().length) return null;
    // Só vão as fontes enviadas que algum texto usa.
    const used = new Set(this.layers().filter((l): l is TextLayer => l.kind === 'texto').map((l) => l.fontId));
    return {
      version: 1,
      widthMm: this.widthMm(),
      heightMm: this.heightMm(),
      layers: this.layers().map(compactLayer),
      fonts: this.fonts.uploads().filter((u) => used.has(this.fonts.uploadFontId(u.id))),
      guides: this.guides(),
      grid: this.grid(),
      boards: this.boards(),
    };
  }

  // ---------- pranchetas ----------

  addBoard(): Artboard {
    const e = this.extent();
    const n = this.allBoards().length + 1;
    const b: Artboard = { id: uuid(), name: `Prancheta ${n}`, x: Math.round(e.w + BOARD_GAP_MM), y: 0, w: this.widthMm(), h: this.heightMm() };
    this.boards.update((l) => [...l, b]);
    return b;
  }

  patchBoard(id: string, patch: Partial<Artboard>): void {
    this.boards.update((l) => l.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  removeBoard(id: string): void {
    this.boards.update((l) => l.filter((b) => b.id !== id));
  }

  boardBounds(id: string): Bounds {
    const b = this.allBoards().find((x) => x.id === id) ?? this.allBoards()[0];
    return { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h };
  }

  // ---------- guias e grade ----------

  addGuide(axis: 'x' | 'y', pos: number): string {
    const id = uuid();
    this.guides.update((g) => [...g, { id, axis, pos }]);
    this.showGuides.set(true);
    return id;
  }

  moveGuide(id: string, pos: number): void {
    this.guides.update((g) => g.map((x) => (x.id === id ? { ...x, pos } : x)));
  }

  removeGuide(id: string): void {
    this.guides.update((g) => g.filter((x) => x.id !== id));
  }

  /** Onde um valor gruda: guias e grade, dentro da tolerância (mm). */
  snapTargets(axis: 'x' | 'y'): number[] {
    return this.showGuides() ? this.guides().filter((g) => g.axis === axis).map((g) => g.pos) : [];
  }

  /** Ponto grudado na grade (quando a atração da grade está ligada). */
  snapToGrid(p: Point): Point {
    const g = this.grid();
    if (!g.snap || g.stepMm <= 0) return p;
    return [Math.round(p[0] / g.stepMm) * g.stepMm, Math.round(p[1] / g.stepMm) * g.stepMm];
  }

  hydrate(data: IllustrationProjectData): void {
    this.clear();
    this.fonts.setUploads(data.fonts ?? []);
    this.widthMm.set(data.widthMm || 200);
    this.heightMm.set(data.heightMm || 200);
    this.layers.set(data.layers ?? []);
    this.guides.set(data.guides ?? []);
    this.boards.set(data.boards ?? []);
    if (data.grid) this.grid.set(data.grid);
  }
}
