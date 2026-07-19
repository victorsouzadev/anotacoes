import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, ViewChild, effect } from '@angular/core';
import { uuid } from '../../core/uuid';
import { ArrowElement, CanvasElement, ChecklistElement, ImageElement, Point, PomodoroElement, ShapeElement, StickyElement, StrokeElement, TextElement } from '../../data/models';
import { arrowBendPoint, intersectRayWithBBox } from './engine/arrow-geometry';
import { checklistHeight, checklistItemLayouts, CHECKLIST_DEFAULT_FONT_SIZE } from './engine/checklist-layout';
import { EditorStore, translateElement } from './engine/editor-store';
import { elementBBox, hitTestElement, distToSegment, bboxIntersectsRect, pointInBBox, hitTextCheckbox, HANDLE_HIT_SIZE } from './engine/hit-test';
import { downscaleImageBlob } from './engine/image-utils';
import { playPomodoroBeep } from './engine/pomodoro-sound';
import { pomodoroButtonLayouts, pomodoroDisplaySec, POMODORO_BREAK_SEC, POMODORO_DEFAULT_H, POMODORO_DEFAULT_W, POMODORO_WORK_SEC } from './engine/pomodoro-layout';
import { Renderer } from './engine/renderer';
import { STICKY_FONT_SIZE, STICKY_MIN_H } from './engine/sticky-layout';

const MAX_IMAGE_WORLD_DIM = 360;
/** Abaixo desse deslocamento (em px de tela) entre pointerdown e pointerup, um gesto
 * na área vazia do canvas conta como clique (não arraste) — usado pra decidir se um
 * "marquee" que não moveu deve virar criação de texto em vez de só limpar a seleção. */
const CLICK_DRAG_THRESHOLD = 4;

type DragMode = 'none' | 'draw-stroke' | 'draw-shape' | 'draw-arrow' | 'marquee' | 'move' | 'resize' | 'rotate' | 'pan' | 'erase-area';

@Component({
  selector: 'app-canvas-host',
  standalone: true,
  template: `<canvas #canvas
    (pointerdown)="onPointerDown($event)"
    (pointermove)="onPointerMove($event)"
    (pointerup)="onPointerUp($event)"
    (pointercancel)="onPointerUp($event)"
    (dblclick)="onDoubleClick($event)"
    (contextmenu)="$event.preventDefault()"
  ></canvas>`,
  styles: [`
    :host { display: block; width: 100%; height: 100%; overflow: hidden; touch-action: none; }
    canvas { display: block; cursor: crosshair; }
  `],
})
export class CanvasHostComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) store!: EditorStore;
  /** Id do elemento sendo editado no overlay de texto/sticky/checklist (se algum) —
   * escondido do próprio desenho do canvas enquanto isso, senão o texto "fantasma"
   * renderizado por baixo do textarea transparente sobrepõe visualmente o que está
   * sendo digitado, ficando dessincronizado do resultado final. */
  @Input() set hiddenElementId(id: string | null) {
    this._hiddenElementId = id;
    this.scheduleRender();
  }
  get hiddenElementId(): string | null {
    return this._hiddenElementId;
  }
  private _hiddenElementId: string | null = null;
  @Output() requestTextEdit = new EventEmitter<TextElement>();
  @Output() requestStickyEdit = new EventEmitter<StickyElement>();
  @Output() requestChecklistEdit = new EventEmitter<ChecklistElement>();
  @Output() elementsChanged = new EventEmitter<void>();
  /** Para ações discretas de "um clique só" (toggle de checkbox) — salvar na hora em
   * vez de esperar o debounce de elementsChanged, senão um F5 logo em seguida perde a
   * mudança (mesma classe de bug já corrigida para undo/redo/exclusão no editor.page). */
  @Output() requestImmediateSave = new EventEmitter<void>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private renderer!: Renderer;
  private ro?: ResizeObserver;

  private dragMode: DragMode = 'none';
  private activeStroke: StrokeElement | null = null;
  private drawStart: Point | null = null;
  private marquee: { x: number; y: number; w: number; h: number } | null = null;
  private lastPanPoint: Point | null = null;
  private dragOrigins = new Map<string, CanvasElement>();
  private dragStartWorld: Point | null = null;
  private resizeHandle = '';
  private rotateStartAngle = 0;
  private pointers = new Map<number, Point>();
  private pinchStartDist = 0;
  private pinchStartScale = 1;

  constructor() {
    // Redesenha automaticamente sempre que elementos/seleção mudarem — inclusive por
    // caminhos que não passam por eventos de ponteiro (undo/redo, editar texto/sticky
    // no overlay, excluir seleção pelo toolbar, trazer para frente/enviar para trás).
    // Chamar scheduleRender() manualmente em cada um desses lugares é frágil demais:
    // basta esquecer um caminho para o canvas ficar com conteúdo desatualizado.
    effect(() => {
      this.store.elements();
      this.store.selectedIds();
      this.store.paperStyle();
      this.scheduleRender();
    });
  }

  private pomodoroTickInterval: ReturnType<typeof setInterval> | null = null;

  ngAfterViewInit(): void {
    this.renderer = new Renderer(this.canvasRef.nativeElement, this.store.viewport, () => this.scheduleRender());
    this.ro = new ResizeObserver(() => this.resizeAndRender());
    this.ro.observe(this.canvasRef.nativeElement.parentElement!);
    this.resizeAndRender();
    this.pomodoroTickInterval = setInterval(() => this.tickPomodoros(), 1000);
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    if (this.pomodoroTickInterval) clearInterval(this.pomodoroTickInterval);
  }

  private resizeAndRender(): void {
    const parent = this.canvasRef.nativeElement.parentElement!;
    this.renderer.resize(parent.clientWidth, parent.clientHeight);
    this.scheduleRender();
  }

  private rafId: number | null = null;
  scheduleRender(): void {
    if (!this.renderer || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      const preview = this.activeStroke ?? this.pendingShape ?? this.pendingArrow ?? null;
      const elements = this._hiddenElementId
        ? this.store.elements().filter((e) => e.id !== this._hiddenElementId)
        : this.store.elements();
      this.renderer.render(elements, this.store.selectedIds(), preview, this.marquee, this.store.paperStyle());
    });
  }

  fitToScreen(): void {
    const box = Renderer.contentBBox(this.store.elements());
    this.store.viewport.fitToScreen(box, this.renderer.width, this.renderer.height);
    this.scheduleRender();
  }

  private screenPoint(ev: PointerEvent): Point {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  onPointerDown(ev: PointerEvent): void {
    this.canvasRef.nativeElement.setPointerCapture(ev.pointerId);
    this.pointers.set(ev.pointerId, this.screenPoint(ev));
    if (this.pointers.size === 2) {
      this.startPinch();
      return;
    }
    const screen = this.screenPoint(ev);
    const world = this.store.viewport.screenToWorld(screen);
    const tool = this.store.tool();

    if (ev.button === 1 || ev.button === 2 || tool === 'pan') {
      this.dragMode = 'pan';
      this.lastPanPoint = screen;
      return;
    }

    switch (tool) {
      case 'pen':
        this.dragMode = 'draw-stroke';
        this.activeStroke = {
          id: uuid(),
          type: 'stroke',
          points: [world],
          pressures: [ev.pressure || 0.5],
          color: this.store.penColor(),
          thickness: this.store.penThickness(),
          zIndex: this.store.nextZIndex(),
          rotation: 0,
        };
        break;
      case 'eraser-stroke': {
        const hit = this.topHitAt(world);
        if (hit) this.store.removeElements([hit.id]);
        break;
      }
      case 'eraser-area':
        this.dragMode = 'erase-area';
        this.drawStart = world;
        this.marquee = { x: screen.x, y: screen.y, w: 0, h: 0 };
        break;
      case 'rect':
      case 'ellipse':
        this.dragMode = 'draw-shape';
        this.drawStart = world;
        this.activeStroke = null;
        this.pendingShape = {
          id: uuid(),
          type: 'shape',
          shape: tool,
          x: world.x,
          y: world.y,
          w: 0,
          h: 0,
          color: this.store.penColor(),
          thickness: this.store.penThickness(),
          fill: this.store.fillShape(),
          zIndex: this.store.nextZIndex(),
          rotation: 0,
        };
        break;
      case 'line':
      case 'arrow': {
        this.dragMode = 'draw-arrow';
        this.drawStart = world;
        const start = this.resolveArrowEndpoint(world);
        this.pendingArrow = {
          id: uuid(),
          type: 'arrow',
          from: start.point,
          to: start.point,
          fromId: start.elId ?? null,
          color: this.store.penColor(),
          thickness: this.store.penThickness(),
          startArrow: this.store.arrowStart(),
          endArrow: this.store.arrowEnd(),
          zIndex: this.store.nextZIndex(),
          rotation: 0,
        };
        break;
      }
      case 'text':
        this.createTextAt(world);
        this.store.tool.set('select');
        break;
      case 'sticky': {
        const el: StickyElement = {
          id: uuid(),
          type: 'sticky',
          x: world.x,
          y: world.y,
          w: 180,
          h: STICKY_MIN_H,
          content: '',
          color: this.store.stickyColor(),
          fontSize: STICKY_FONT_SIZE,
          zIndex: this.store.nextZIndex(),
          rotation: 0,
        };
        this.store.addElement(el);
        this.requestStickyEdit.emit(el);
        this.store.tool.set('select');
        break;
      }
      case 'checklist': {
        const el: ChecklistElement = {
          id: uuid(),
          type: 'checklist',
          x: world.x,
          y: world.y,
          w: 220,
          h: checklistHeight(1, CHECKLIST_DEFAULT_FONT_SIZE),
          color: '#ffffff',
          fontSize: CHECKLIST_DEFAULT_FONT_SIZE,
          items: [{ id: uuid(), text: '', checked: false }],
          zIndex: this.store.nextZIndex(),
          rotation: 0,
        };
        this.store.addElement(el);
        this.requestChecklistEdit.emit(el);
        this.store.tool.set('select');
        break;
      }
      case 'pomodoro': {
        const el: PomodoroElement = {
          id: uuid(),
          type: 'pomodoro',
          x: world.x,
          y: world.y,
          w: POMODORO_DEFAULT_W,
          h: POMODORO_DEFAULT_H,
          workDurationSec: POMODORO_WORK_SEC,
          breakDurationSec: POMODORO_BREAK_SEC,
          phase: 'work',
          running: false,
          phaseEndAt: null,
          remainingSec: POMODORO_WORK_SEC,
          cyclesCompleted: 0,
          zIndex: this.store.nextZIndex(),
          rotation: 0,
        };
        this.store.addElement(el);
        this.elementsChanged.emit();
        this.store.tool.set('select');
        break;
      }
      case 'select':
        this.handleSelectPointerDown(screen, world, ev.shiftKey);
        break;
    }
    this.scheduleRender();
  }

  private pendingShape: ShapeElement | null = null;
  private pendingArrow: ArrowElement | null = null;

  private createTextAt(world: Point): void {
    const el: TextElement = {
      id: uuid(),
      type: 'text',
      x: world.x,
      y: world.y,
      w: 220,
      content: '',
      fontSize: 16,
      bold: false,
      italic: false,
      underline: false,
      align: 'left',
      fontFamily: 'sans',
      color: this.store.penColor(),
      zIndex: this.store.nextZIndex(),
      rotation: 0,
    };
    this.store.addElement(el);
    this.requestTextEdit.emit(el);
  }

  private handleSelectPointerDown(screen: Point, world: Point, shiftKey: boolean): void {
    const pomodoroButtonHit = this.hitPomodoroButton(world);
    if (pomodoroButtonHit) {
      if (pomodoroButtonHit.button === 'playPause') this.togglePomodoroRunning(pomodoroButtonHit.elId);
      else this.resetPomodoro(pomodoroButtonHit.elId);
      return;
    }
    const checkboxHit = this.hitChecklistCheckbox(world);
    if (checkboxHit) {
      this.toggleChecklistItem(checkboxHit.elId, checkboxHit.itemId);
      return;
    }
    const textChecklistHit = this.hitTextChecklistCheckbox(world);
    if (textChecklistHit) {
      this.toggleTextChecklistLine(textChecklistHit.elId, textChecklistHit.checkboxCharOffset);
      return;
    }
    const selected = this.store.selectedIds();
    if (selected.size > 0) {
      const handle = this.hitHandle(world);
      if (handle) {
        this.dragMode = handle === 'rotate' ? 'rotate' : 'resize';
        this.resizeHandle = handle;
        this.dragStartWorld = world;
        this.snapshotSelection();
        return;
      }
    }
    const hit = this.topHitAt(world);
    if (hit) {
      if (shiftKey) {
        const next = new Set(selected);
        next.has(hit.id) ? next.delete(hit.id) : next.add(hit.id);
        this.store.select([...next]);
      } else if (!selected.has(hit.id)) {
        this.store.select([hit.id]);
      }
      this.dragMode = 'move';
      this.dragStartWorld = world;
      this.snapshotSelection();
    } else {
      if (!shiftKey) this.store.clearSelection();
      this.dragMode = 'marquee';
      this.marquee = { x: screen.x, y: screen.y, w: 0, h: 0 };
      this.drawStart = world;
    }
  }

  private snapshotSelection(): void {
    this.dragOrigins.clear();
    for (const e of this.store.elements()) {
      if (this.store.selectedIds().has(e.id)) this.dragOrigins.set(e.id, structuredClone(e));
    }
  }

  private topHitAt(world: Point): CanvasElement | undefined {
    const sorted = [...this.store.elements()].sort((a, b) => b.zIndex - a.zIndex);
    return sorted.find((e) => hitTestElement(world, e));
  }

  private hitChecklistCheckbox(world: Point): { elId: string; itemId: string } | null {
    const checklists = [...this.store.elements()]
      .filter((e): e is ChecklistElement => e.type === 'checklist')
      .sort((a, b) => b.zIndex - a.zIndex);
    for (const el of checklists) {
      for (const { item, checkbox } of checklistItemLayouts(el)) {
        if (pointInBBox(world, {
          minX: checkbox.x, minY: checkbox.y,
          maxX: checkbox.x + checkbox.w, maxY: checkbox.y + checkbox.h,
        })) {
          return { elId: el.id, itemId: item.id };
        }
      }
    }
    return null;
  }

  private hitTextChecklistCheckbox(world: Point): { elId: string; checkboxCharOffset: number } | null {
    const texts = [...this.store.elements()]
      .filter((e): e is TextElement => e.type === 'text')
      .sort((a, b) => b.zIndex - a.zIndex);
    for (const el of texts) {
      const hit = hitTextCheckbox(world, el);
      if (hit) return { elId: el.id, checkboxCharOffset: hit.checkboxCharOffset };
    }
    return null;
  }

  /** Marca/desmarca uma linha de checklist inline reescrevendo só o token "[ ]"/"[x]"
   * (3 caracteres) no offset conhecido — sem reabrir o modo de edição de texto. */
  private toggleTextChecklistLine(elId: string, checkboxCharOffset: number): void {
    const el = this.store.elements().find((e) => e.id === elId);
    if (!el || el.type !== 'text') return;
    const token = el.content.slice(checkboxCharOffset, checkboxCharOffset + 3);
    const next = token[1] === ' ' ? '[x]' : '[ ]';
    const content = el.content.slice(0, checkboxCharOffset) + next + el.content.slice(checkboxCharOffset + 3);
    this.store.updateElement(elId, { content } as Partial<CanvasElement>, { commit: true });
    this.requestImmediateSave.emit();
  }

  private toggleChecklistItem(elId: string, itemId: string): void {
    const el = this.store.elements().find((e) => e.id === elId);
    if (!el || el.type !== 'checklist') return;
    const items = el.items.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it));
    this.store.updateElement(elId, { items } as Partial<CanvasElement>, { commit: true });
    this.requestImmediateSave.emit();
  }

  private hitPomodoroButton(world: Point): { elId: string; button: 'playPause' | 'reset' } | null {
    const pomodoros = [...this.store.elements()]
      .filter((e): e is PomodoroElement => e.type === 'pomodoro')
      .sort((a, b) => b.zIndex - a.zIndex);
    for (const el of pomodoros) {
      const { playPause, reset } = pomodoroButtonLayouts(el);
      if (pointInBBox(world, { minX: playPause.x, minY: playPause.y, maxX: playPause.x + playPause.w, maxY: playPause.y + playPause.h })) {
        return { elId: el.id, button: 'playPause' };
      }
      if (pointInBBox(world, { minX: reset.x, minY: reset.y, maxX: reset.x + reset.w, maxY: reset.y + reset.h })) {
        return { elId: el.id, button: 'reset' };
      }
    }
    return null;
  }

  private togglePomodoroRunning(elId: string): void {
    const el = this.store.elements().find((e) => e.id === elId);
    if (!el || el.type !== 'pomodoro') return;
    const patch: Partial<PomodoroElement> = el.running
      ? { running: false, remainingSec: pomodoroDisplaySec(el), phaseEndAt: null }
      : { running: true, phaseEndAt: new Date(Date.now() + el.remainingSec * 1000).toISOString() };
    this.store.updateElement(elId, patch as Partial<CanvasElement>, { commit: true });
    this.requestImmediateSave.emit();
  }

  private resetPomodoro(elId: string): void {
    const el = this.store.elements().find((e) => e.id === elId);
    if (!el || el.type !== 'pomodoro') return;
    const patch: Partial<PomodoroElement> = {
      running: false,
      phase: 'work',
      remainingSec: el.workDurationSec,
      phaseEndAt: null,
      cyclesCompleted: 0,
    };
    this.store.updateElement(elId, patch as Partial<CanvasElement>, { commit: true });
    this.requestImmediateSave.emit();
  }

  /** Roda a cada segundo: some com os elementos pomodoro em execução, e quando algum
   * chega a zero troca de fase (foco↔pausa) e toca o beep — não passa pelo histórico
   * de undo (o relógio chegar a zero não é uma ação do usuário) e salva na hora. */
  private tickPomodoros(): void {
    const pomodoros = this.store.elements().filter((e): e is PomodoroElement => e.type === 'pomodoro' && e.running);
    if (pomodoros.length === 0) return;
    let transitioned = false;
    const patches = new Map<string, Partial<CanvasElement>>();
    const now = Date.now();
    for (const el of pomodoros) {
      if (pomodoroDisplaySec(el, now) > 0) continue;
      transitioned = true;
      const nextPhase = el.phase === 'work' ? 'break' : 'work';
      const nextDuration = nextPhase === 'work' ? el.workDurationSec : el.breakDurationSec;
      patches.set(el.id, {
        phase: nextPhase,
        remainingSec: nextDuration,
        phaseEndAt: new Date(now + nextDuration * 1000).toISOString(),
        cyclesCompleted: el.phase === 'work' ? el.cyclesCompleted + 1 : el.cyclesCompleted,
      } as Partial<CanvasElement>);
    }
    if (patches.size > 0) {
      this.store.updateElements(patches, { commit: false });
      this.requestImmediateSave.emit();
    }
    if (transitioned) playPomodoroBeep();
    this.scheduleRender();
  }

  onDoubleClick(ev: MouseEvent): void {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const screen = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const world = this.store.viewport.screenToWorld(screen);
    const hit = this.topHitAt(world);
    if (!hit) return;
    if (hit.type === 'text') {
      this.requestTextEdit.emit(hit);
      this.store.tool.set('select');
    } else if (hit.type === 'sticky') {
      this.requestStickyEdit.emit(hit);
      this.store.tool.set('select');
    } else if (hit.type === 'checklist') {
      this.requestChecklistEdit.emit(hit);
      this.store.tool.set('select');
    }
  }

  /** Onde uma seta deve "grudar" ao ser desenhada/arrastada sobre outro elemento —
   * encosta na borda voltada para o ponto de origem, não no centro (que ficaria por
   * baixo do conteúdo do elemento). Retorna o ponto puro se não há elemento sob ele. */
  private resolveArrowEndpoint(world: Point, excludeId?: string): { point: Point; elId?: string } {
    const hit = [...this.store.elements()]
      .filter((e) => e.id !== excludeId && e.type !== 'arrow' && e.type !== 'stroke')
      .sort((a, b) => b.zIndex - a.zIndex)
      .find((e) => pointInBBox(world, elementBBox(e)));
    if (!hit) return { point: world };
    const box = elementBBox(hit);
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    return { point: intersectRayWithBBox(center, world, box), elId: hit.id };
  }

  /** Depois de mover/redimensionar elementos, atualiza as pontas de qualquer seta
   * conectada a eles (fromId/toId) para acompanhar a nova posição — sem isso, "ligar"
   * uma seta a um elemento só funcionaria até a próxima vez que ele fosse movido. */
  private reattachArrows(patches: Map<string, Partial<CanvasElement>>): void {
    const current = this.store.elements();
    const temp = current.map((e) => (patches.has(e.id) ? ({ ...e, ...patches.get(e.id) } as CanvasElement) : e));
    const byId = new Map(temp.map((e) => [e.id, e]));
    for (const el of temp) {
      if (el.type !== 'arrow' || (!el.fromId && !el.toId)) continue;
      const patch: Partial<ArrowElement> = {};
      if (el.fromId && byId.has(el.fromId)) patch.from = this.edgePointFor(el.fromId, el.to, byId);
      if (el.toId && byId.has(el.toId)) patch.to = this.edgePointFor(el.toId, el.from, byId);
      if (Object.keys(patch).length > 0) {
        patches.set(el.id, { ...(patches.get(el.id) as object | undefined ?? {}), ...patch });
      }
    }
  }

  private edgePointFor(targetId: string, otherPoint: Point, byId: Map<string, CanvasElement>): Point {
    const target = byId.get(targetId);
    if (!target) return otherPoint;
    const box = elementBBox(target);
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    return intersectRayWithBBox(center, otherPoint, box);
  }

  private hitHandle(world: Point): string | null {
    const ids = this.store.selectedIds();
    const els = this.store.elements().filter((e) => ids.has(e.id));
    if (els.length === 0) return null;
    const s = HANDLE_HIT_SIZE / this.store.viewport.scale;

    if (els.length === 1 && els[0].type === 'arrow') {
      const arrow = els[0];
      if (distBetween(world, arrow.from) <= s) return 'arrow-from';
      if (distBetween(world, arrow.to) <= s) return 'arrow-to';
      if (distBetween(world, arrowBendPoint(arrow)) <= s) return 'arrow-bend';
      return null;
    }

    const boxes = els.map(elementBBox);
    const box = boxes.reduce((acc, b) => ({
      minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY),
    }));
    const corners: [string, Point][] = [
      ['nw', { x: box.minX, y: box.minY }], ['ne', { x: box.maxX, y: box.minY }],
      ['sw', { x: box.minX, y: box.maxY }], ['se', { x: box.maxX, y: box.maxY }],
    ];
    for (const [name, p] of corners) {
      if (Math.abs(world.x - p.x) <= s && Math.abs(world.y - p.y) <= s) return name;
    }
    const rotateHandle = { x: (box.minX + box.maxX) / 2, y: box.minY - 24 / this.store.viewport.scale };
    if (Math.hypot(world.x - rotateHandle.x, world.y - rotateHandle.y) <= s) return 'rotate';
    return null;
  }

  onPointerMove(ev: PointerEvent): void {
    if (!this.pointers.has(ev.pointerId)) return;
    const screen = this.screenPoint(ev);
    this.pointers.set(ev.pointerId, screen);
    if (this.pointers.size === 2) {
      this.doPinch();
      return;
    }
    const world = this.store.viewport.screenToWorld(screen);

    switch (this.dragMode) {
      case 'draw-stroke':
        if (this.activeStroke) {
          this.activeStroke.points.push(world);
          this.activeStroke.pressures.push(ev.pressure || 0.5);
        }
        break;
      case 'draw-shape':
        if (this.pendingShape && this.drawStart) {
          let w = world.x - this.drawStart.x;
          let h = world.y - this.drawStart.y;
          if (ev.shiftKey) {
            const side = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * side;
            h = Math.sign(h || 1) * side;
          }
          this.pendingShape = {
            ...this.pendingShape,
            x: Math.min(this.drawStart.x, this.drawStart.x + w),
            y: Math.min(this.drawStart.y, this.drawStart.y + h),
            w: Math.abs(w),
            h: Math.abs(h),
          };
          if (w < 0) this.pendingShape.x = this.drawStart.x + w;
          if (h < 0) this.pendingShape.y = this.drawStart.y + h;
        }
        break;
      case 'draw-arrow':
        if (this.pendingArrow && this.drawStart) {
          if (ev.shiftKey) {
            this.pendingArrow = { ...this.pendingArrow, to: snapAngle(this.drawStart, world), toId: null };
          } else {
            const end = this.resolveArrowEndpoint(world);
            this.pendingArrow = { ...this.pendingArrow, to: end.point, toId: end.elId ?? null };
          }
        }
        break;
      case 'marquee':
      case 'erase-area':
        if (this.drawStart) {
          const startScreen = this.screenOf(this.drawStart);
          this.marquee = {
            x: Math.min(startScreen.x, screen.x),
            y: Math.min(startScreen.y, screen.y),
            w: Math.abs(screen.x - startScreen.x),
            h: Math.abs(screen.y - startScreen.y),
          };
        }
        break;
      case 'move':
        if (this.dragStartWorld) {
          const dx = world.x - this.dragStartWorld.x;
          const dy = world.y - this.dragStartWorld.y;
          const patches = new Map<string, Partial<CanvasElement>>();
          for (const [id, orig] of this.dragOrigins) {
            const clone = structuredClone(orig);
            translateElement(clone, dx, dy);
            patches.set(id, clone);
          }
          this.reattachArrows(patches);
          this.store.updateElements(patches, { commit: false });
        }
        break;
      case 'resize':
        this.doResize(world);
        break;
      case 'rotate':
        this.doRotate(world);
        break;
      case 'pan':
        if (this.lastPanPoint) {
          this.store.viewport.pan(screen.x - this.lastPanPoint.x, screen.y - this.lastPanPoint.y);
          this.lastPanPoint = screen;
        }
        break;
    }
    this.scheduleRender();
  }

  private screenOf(world: Point): Point {
    return this.store.viewport.worldToScreen(world);
  }

  private doResize(world: Point): void {
    if (!this.dragStartWorld || this.dragOrigins.size !== 1) return;
    const [id, orig] = [...this.dragOrigins.entries()][0];
    if (orig.type === 'arrow' && this.resizeHandle.startsWith('arrow-')) {
      this.doArrowHandleDrag(id, orig, world);
      return;
    }
    if (orig.type === 'stroke' || orig.type === 'arrow') return;
    const dx = world.x - this.dragStartWorld.x;
    const dy = world.y - this.dragStartWorld.y;
    const clone = structuredClone(orig) as ShapeElement | TextElement | StickyElement | ChecklistElement | ImageElement | PomodoroElement;
    const h = clone.type === 'text' ? 20 : clone.h;
    let { x, y, w } = clone;
    let newH = h;
    if (this.resizeHandle.includes('e')) w = Math.max(10, clone.w + dx);
    if (this.resizeHandle.includes('s')) newH = Math.max(10, h + dy);
    if (this.resizeHandle.includes('w')) { w = Math.max(10, clone.w - dx); x = clone.x + dx; }
    if (this.resizeHandle.includes('n')) { newH = Math.max(10, h - dy); y = clone.y + dy; }
    let patch: Partial<CanvasElement>;
    if (clone.type === 'text') {
      // Só as alças de canto existem (ver hitHandle), então todo redimensionamento de
      // texto altera a largura — usamos essa razão pra escalar a fonte junto, do
      // contrário o texto ficaria com o mesmo tamanho dentro de uma caixa maior/menor.
      const scale = clone.w > 0 ? w / clone.w : 1;
      const fontSize = Math.min(200, Math.max(8, Math.round(clone.fontSize * scale)));
      patch = { x, y, w, fontSize };
    } else {
      patch = { x, y, w, h: newH };
    }
    this.store.updateElement(id, patch, { commit: false });
  }

  /** Arrasta uma ponta (com possível "grude" em outro elemento) ou o vergalho de
   * curva de uma seta selecionada — as três alças que hitHandle() reconhece pra setas. */
  private doArrowHandleDrag(id: string, orig: ArrowElement, world: Point): void {
    const patch: Partial<ArrowElement> = {};
    if (this.resizeHandle === 'arrow-from') {
      const resolved = this.resolveArrowEndpoint(world, id);
      patch.from = resolved.point;
      patch.fromId = resolved.elId ?? null;
    } else if (this.resizeHandle === 'arrow-to') {
      const resolved = this.resolveArrowEndpoint(world, id);
      patch.to = resolved.point;
      patch.toId = resolved.elId ?? null;
    } else if (this.resizeHandle === 'arrow-bend') {
      patch.curve = world;
    }
    this.store.updateElement(id, patch as Partial<CanvasElement>, { commit: false });
  }

  private doRotate(world: Point): void {
    if (this.dragOrigins.size === 0) return;
    const els = [...this.dragOrigins.values()];
    const boxes = els.map(elementBBox);
    const box = boxes.reduce((acc, b) => ({
      minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY),
    }));
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const angle = Math.atan2(world.y - cy, world.x - cx) + Math.PI / 2;
    const patches = new Map<string, Partial<CanvasElement>>();
    for (const id of this.dragOrigins.keys()) {
      patches.set(id, { rotation: angle });
    }
    this.store.updateElements(patches, { commit: false });
  }

  private startPinch(): void {
    const pts = [...this.pointers.values()];
    this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    this.pinchStartScale = this.store.viewport.scale;
    this.dragMode = 'none';
  }

  private doPinch(): void {
    const pts = [...this.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const targetScale = this.pinchStartScale * (dist / (this.pinchStartDist || 1));
    this.store.viewport.zoomAt(mid, targetScale / this.store.viewport.scale);
    this.scheduleRender();
  }

  onPointerUp(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size > 0) return;

    switch (this.dragMode) {
      case 'draw-stroke':
        if (this.activeStroke && this.activeStroke.points.length > 0) {
          this.store.addElement(this.activeStroke);
          this.elementsChanged.emit();
        }
        this.activeStroke = null;
        break;
      case 'draw-shape':
        if (this.pendingShape && (this.pendingShape.w > 2 || this.pendingShape.h > 2)) {
          this.store.addElement(this.pendingShape);
          this.elementsChanged.emit();
        }
        this.pendingShape = null;
        break;
      case 'draw-arrow':
        if (this.pendingArrow) {
          this.store.addElement(this.pendingArrow);
          this.elementsChanged.emit();
        }
        this.pendingArrow = null;
        break;
      case 'erase-area':
        if (this.marquee) {
          const rect = this.screenRectToWorld(this.marquee);
          const ids = this.store.elements()
            .filter((e) => bboxIntersectsRect(elementBBox(e), rect))
            .map((e) => e.id);
          if (ids.length) { this.store.removeElements(ids); this.elementsChanged.emit(); }
        }
        this.marquee = null;
        break;
      case 'marquee':
        if (this.marquee) {
          const rect = this.screenRectToWorld(this.marquee);
          const ids = this.store.elements()
            .filter((e) => bboxIntersectsRect(elementBBox(e), rect))
            .map((e) => e.id);
          if (ids.length > 0) {
            this.store.select(ids);
          } else if (this.marquee.w < CLICK_DRAG_THRESHOLD && this.marquee.h < CLICK_DRAG_THRESHOLD && this.drawStart) {
            // Clique simples (sem arrastar) em área vazia — deixa digitar na hora,
            // sem precisar trocar pra ferramenta "Texto" na barra primeiro.
            this.createTextAt(this.drawStart);
          }
        }
        this.marquee = null;
        break;
      case 'move':
      case 'resize':
      case 'rotate':
        this.commitDrag();
        this.elementsChanged.emit();
        break;
    }
    this.dragMode = 'none';
    this.drawStart = null;
    this.dragStartWorld = null;
    this.lastPanPoint = null;
    this.scheduleRender();
  }

  private commitDrag(): void {
    const current = this.store.elements();
    const patches = new Map<string, Partial<CanvasElement>>();
    for (const id of this.dragOrigins.keys()) {
      const el = current.find((e) => e.id === id);
      if (el) patches.set(id, el);
    }
    // Reverte para o estado pré-arraste e reaplica como comando único (undo/redo íntegro).
    const before = [...this.dragOrigins.values()];
    const beforeIds = new Set(this.dragOrigins.keys());
    const restored = current.map((e) => {
      if (!beforeIds.has(e.id)) return e;
      return before.find((b) => b.id === e.id)!;
    });
    this.store.elements.set(restored);
    this.store.updateElements(patches, { commit: true });
    this.dragOrigins.clear();
  }

  private screenRectToWorld(r: { x: number; y: number; w: number; h: number }) {
    const a = this.store.viewport.screenToWorld({ x: r.x, y: r.y });
    const b = this.store.viewport.screenToWorld({ x: r.x + r.w, y: r.y + r.h });
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
  }

  /** Colar imagem (Ctrl+V) — screenshots ou fotos copiadas de fora do app. Ouve no
   * document (não no canvas) porque o canvas não é focável/editável e nunca receberia
   * o evento nativo de paste. */
  @HostListener('document:paste', ['$event'])
  onPaste(ev: ClipboardEvent): void {
    const target = ev.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, [contenteditable]')) return;
    const items = ev.clipboardData?.items;
    if (!items) return;
    const imageItem = [...items].find((it) => it.type.startsWith('image/'));
    if (!imageItem) return;
    const blob = imageItem.getAsFile();
    if (!blob) return;
    ev.preventDefault();
    this.insertPastedImage(blob);
  }

  private async insertPastedImage(blob: Blob): Promise<void> {
    const { dataUrl, w, h } = await downscaleImageBlob(blob);
    const scale = Math.min(1, MAX_IMAGE_WORLD_DIM / Math.max(w, h));
    const worldW = w * scale;
    const worldH = h * scale;
    const center = this.store.viewport.screenToWorld({ x: this.renderer.width / 2, y: this.renderer.height / 2 });
    const el: ImageElement = {
      id: uuid(),
      type: 'image',
      x: center.x - worldW / 2,
      y: center.y - worldH / 2,
      w: worldW,
      h: worldH,
      src: dataUrl,
      zIndex: this.store.nextZIndex(),
      rotation: 0,
    };
    this.store.addElement(el);
    this.store.select([el.id]);
    this.store.tool.set('select');
    this.elementsChanged.emit();
    this.scheduleRender();
  }

  @HostListener('wheel', ['$event'])
  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const screen = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    if (ev.ctrlKey || ev.metaKey || Math.abs(ev.deltaY) > 0 && !ev.shiftKey) {
      const factor = Math.exp(-ev.deltaY * 0.001);
      this.store.viewport.zoomAt(screen, factor);
    } else {
      this.store.viewport.pan(ev.deltaX, ev.deltaY);
    }
    this.scheduleRender();
  }
}

function distBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 12; // 15°
  const snapped = Math.round(angle / step) * step;
  return { x: from.x + Math.cos(snapped) * dist, y: from.y + Math.sin(snapped) * dist };
}
