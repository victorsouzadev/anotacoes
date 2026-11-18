import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener,
  Input, OnChanges, OnDestroy, Output, ViewChild,
} from '@angular/core';
import { NotePage, PaperStyle, Point } from '../../data/models';
import { IconComponent } from '../../shared/icon';
import { Renderer } from './engine/renderer';
import { Viewport } from './engine/viewport';
import { AcaoLeitura, acaoDaTecla, acaoDoGesto, acaoDoToque, navegar } from './note-reader-nav';

/**
 * Modo leitura / apresentação (spec 024). Componente separado do editor de propósito: não há
 * ferramenta, seleção nem gravação aqui, então nada pode ser alterado por engano. O link público
 * (spec 023) usa o mesmo componente sem o editor.
 */
@Component({
  selector: 'app-note-reader',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="reader" [class.sem-cursor]="cursorOculto" (pointermove)="mostrarCursor()">
      <canvas #canvas
        (pointerdown)="onPointerDown($event)" (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)" (pointercancel)="onPointerUp($event)"
        (wheel)="onWheel($event)" (dblclick)="ajustar()"></canvas>
      <div class="barra" [class.visivel]="barraVisivel">
        @if (titulo) { <span class="titulo">{{ titulo }}</span> }
        <span class="pagina">{{ indice + 1 }} / {{ pages.length }}</span>
        <button type="button" (click)="ir('anterior')" [disabled]="indice === 0" title="Página anterior (←)">‹</button>
        <button type="button" (click)="ir('proxima')" [disabled]="indice >= pages.length - 1" title="Próxima página (→)">›</button>
        <button type="button" (click)="telaCheia()" title="Tela cheia (F)"><app-icon name="fullscreen" [size]="16" /></button>
        @if (podeFechar) {
          <button type="button" (click)="fechar.emit(indice)" title="Voltar a editar (Esc)"><app-icon name="x" [size]="16" /></button>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 100; display: block; }
    .reader { position: absolute; inset: 0; background: var(--bg); touch-action: none; }
    .reader.sem-cursor, .reader.sem-cursor canvas { cursor: none; }
    canvas { display: block; width: 100%; height: 100%; cursor: grab; }
    .barra {
      position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 8px;
      background: var(--surface); border: 1px solid var(--border); border-radius: 999px;
      padding: 6px 10px; box-shadow: var(--shadow); font-size: 13px;
      opacity: 0; transition: opacity .25s; pointer-events: none;
    }
    .barra.visivel { opacity: 1; pointer-events: auto; }
    .barra button {
      border: none; background: none; color: var(--text); width: 30px; height: 30px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center; font-size: 18px;
    }
    .barra button:hover:not(:disabled) { background: var(--accent-soft); }
    .barra button:disabled { opacity: .35; }
    .titulo { font-weight: 600; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pagina { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  `],
})
export class NoteReaderComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) pages: NotePage[] = [];
  @Input() paperStyle: PaperStyle = 'blank';
  @Input() inicio = 0;
  @Input() titulo = '';
  /** Mostra o botão de voltar a editar e aceita Esc (no link público não há para onde voltar). */
  @Input() podeFechar = true;
  @Output() fechar = new EventEmitter<number>();

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  indice = 0;
  barraVisivel = true;
  cursorOculto = false;

  private viewport = new Viewport();
  private renderer!: Renderer;
  private resizeObserver?: ResizeObserver;
  private ponteiros = new Map<number, Point>();
  private inicioGesto: { x: number; y: number; t: number } | null = null;
  private ultimoPan: Point | null = null;
  private moveu = false;
  private pinca: { dist: number } | null = null;
  private timerBarra: ReturnType<typeof setTimeout> | null = null;
  private timerCursor: ReturnType<typeof setTimeout> | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.indice = Math.min(Math.max(0, this.inicio), Math.max(0, this.pages.length - 1));
    if (this.renderer) this.ajustar();
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.renderer = new Renderer(canvas, this.viewport, () => this.desenhar());
    this.resizeObserver = new ResizeObserver(() => {
      this.renderer.resize(canvas.clientWidth, canvas.clientHeight);
      this.ajustar();
    });
    this.resizeObserver.observe(canvas);
    this.mostrarBarra();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.timerBarra) clearTimeout(this.timerBarra);
    if (this.timerCursor) clearTimeout(this.timerCursor);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }

  private get elementos() {
    return this.pages[this.indice]?.elements ?? [];
  }

  ajustar(): void {
    if (!this.renderer) return;
    const els = this.elementos;
    if (els.length === 0) {
      this.viewport.scale = 1;
      this.viewport.offsetX = 0;
      this.viewport.offsetY = 0;
    } else {
      this.viewport.fitToScreen(Renderer.contentBBox(els), this.renderer.width, this.renderer.height);
    }
    this.desenhar();
  }

  private desenhar(): void {
    this.renderer?.render(this.elementos, new Set(), null, null, this.paperStyle);
  }

  ir(acao: AcaoLeitura): void {
    const novo = navegar(this.indice, this.pages.length, acao);
    if (novo === this.indice) return;
    this.indice = novo;
    this.ajustar();
    this.mostrarBarra();
    this.cdr.markForCheck();
  }

  async telaCheia(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.canvasRef.nativeElement.parentElement?.requestFullscreen();
    } catch { /* navegador sem suporte ou recusou: segue em janela */ }
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const acao = acaoDaTecla(ev.key);
    if (acao) {
      ev.preventDefault();
      this.ir(acao);
      return;
    }
    if (ev.key === 'f' || ev.key === 'F') {
      ev.preventDefault();
      void this.telaCheia();
    } else if (ev.key === 'Escape' && this.podeFechar && !document.fullscreenElement) {
      ev.preventDefault();
      this.fechar.emit(this.indice);
    } else if (ev.key === '0') {
      this.ajustar();
    }
  }

  private ponto(ev: PointerEvent): Point {
    const r = this.canvasRef.nativeElement.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  onPointerDown(ev: PointerEvent): void {
    this.canvasRef.nativeElement.setPointerCapture(ev.pointerId);
    const p = this.ponto(ev);
    this.ponteiros.set(ev.pointerId, p);
    if (this.ponteiros.size === 2) {
      const [a, b] = [...this.ponteiros.values()];
      this.pinca = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      this.inicioGesto = null;
      return;
    }
    this.inicioGesto = { x: p.x, y: p.y, t: performance.now() };
    this.ultimoPan = p;
    this.moveu = false;
  }

  onPointerMove(ev: PointerEvent): void {
    if (!this.ponteiros.has(ev.pointerId)) return;
    const p = this.ponto(ev);
    this.ponteiros.set(ev.pointerId, p);
    if (this.pinca && this.ponteiros.size === 2) {
      const [a, b] = [...this.ponteiros.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.viewport.zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist / this.pinca.dist);
      this.pinca.dist = dist;
      this.desenhar();
      return;
    }
    if (!this.ultimoPan) return;
    const dx = p.x - this.ultimoPan.x;
    const dy = p.y - this.ultimoPan.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.moveu = true;
    this.viewport.pan(dx, dy);
    this.ultimoPan = p;
    this.desenhar();
  }

  onPointerUp(ev: PointerEvent): void {
    const p = this.ponto(ev);
    this.ponteiros.delete(ev.pointerId);
    if (this.ponteiros.size < 2) this.pinca = null;
    const g = this.inicioGesto;
    this.inicioGesto = null;
    this.ultimoPan = null;
    if (!g || this.ponteiros.size > 0) return;
    const gesto = acaoDoGesto(p.x - g.x, p.y - g.y, performance.now() - g.t);
    if (gesto) {
      this.ir(gesto);
      return;
    }
    if (!this.moveu) {
      const toque = acaoDoToque(p.x, this.renderer.width);
      if (toque) this.ir(toque);
      else this.mostrarBarra();
    }
  }

  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      this.viewport.zoomAt(this.ponto(ev as unknown as PointerEvent), ev.deltaY < 0 ? 1.1 : 1 / 1.1);
    } else {
      this.viewport.pan(-ev.deltaX, -ev.deltaY);
    }
    this.desenhar();
  }

  mostrarBarra(): void {
    this.barraVisivel = true;
    if (this.timerBarra) clearTimeout(this.timerBarra);
    this.timerBarra = setTimeout(() => { this.barraVisivel = false; this.cdr.markForCheck(); }, 2500);
    this.cdr.markForCheck();
  }

  /** O cursor some depois de 2 s parado (apresentação). */
  mostrarCursor(): void {
    if (this.cursorOculto) {
      this.cursorOculto = false;
      this.cdr.markForCheck();
    }
    if (this.timerCursor) clearTimeout(this.timerCursor);
    this.timerCursor = setTimeout(() => { this.cursorOculto = true; this.cdr.markForCheck(); }, 2000);
  }
}
