import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, output, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { CerebroService, Grafo } from './cerebro.service';

interface No {
  path: string; title: string; pasta: string;
  x: number; y: number; vx: number; vy: number;
  grau: number; fixo: boolean;
}
interface Aresta { a: No; b: No }

/** Cores das pastas de primeiro nível, na ordem em que aparecem. */
const CORES = ['#7c6cf0', '#e7548c', '#1fa37a', '#e59a2b', '#3b8fd9', '#c2185b', '#8d6e63', '#26a6b5', '#9c27b0', '#6d8b2e'];

/**
 * Aba "Grafo": as notas como pontos e os [[links]] como linhas, no estilo do Obsidian. Simulação de
 * forças própria em canvas (sem biblioteca): arrasta para mover, roda para zoom, clique abre a nota.
 */
@Component({
  selector: 'app-cerebro-grafo',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="barra">
      <input [(ngModel)]="busca" (ngModelChange)="desenhar()" placeholder="Destacar notas…" />
      <label class="opcao"><input type="checkbox" [(ngModel)]="soLigadas" (ngModelChange)="montar()" /> Só notas com ligação</label>
      <label class="opcao"><input type="checkbox" [(ngModel)]="sistema" (ngModelChange)="montar()" /> Incluir _sistema</label>
      <button class="botao pequeno" (click)="carregar()"><app-icon name="refresh" [size]="12" /> Atualizar</button>
    </div>
    @if (erro()) { <p class="alerta erro">{{ erro() }}</p> }
    <div class="palco card">
      <canvas #tela
        (pointerdown)="baixar($event)" (pointermove)="mover($event)" (pointerup)="soltar($event)"
        (pointerleave)="sair()" (wheel)="zoom($event)"></canvas>
      @if (vazio()) { <p class="vazio sobre">Nenhuma nota para mostrar.</p> }
    </div>
    <div class="legenda">
      @for (p of legenda(); track p.pasta) {
        <span><i [style.background]="p.cor"></i>{{ p.pasta || '(raiz)' }} · {{ p.total }}</span>
      }
      <span class="ajuda sem-margem">{{ resumo() }} · arraste para mover, role para zoom, clique para abrir</span>
    </div>
  `,
  styleUrls: ['./cerebro-comum.css'],
  styles: [`
    :host { display: flex; flex-direction: column; gap: 10px; }
    .barra { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .barra input:not([type]) { flex: 1 1 200px; }
    .opcao { font-size: 12.5px; color: var(--text-muted); display: flex; gap: 4px; align-items: center; }
    .palco { position: relative; padding: 0; height: min(70vh, 720px); overflow: hidden; }
    canvas { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
    .sobre { position: absolute; inset: 0; display: grid; place-items: center; }
    .legenda { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-muted); align-items: center; }
    .legenda i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroGrafoComponent implements AfterViewInit {
  private readonly api = inject(CerebroService);
  private readonly tela = viewChild.required<ElementRef<HTMLCanvasElement>>('tela');

  readonly abrir = output<string>();
  readonly erro = signal('');
  readonly vazio = signal(false);
  readonly legenda = signal<{ pasta: string; cor: string; total: number }[]>([]);
  readonly resumo = signal('');

  busca = '';
  soLigadas = false;
  sistema = false;

  private dados: Grafo | null = null;
  private nos: No[] = [];
  private arestas: Aresta[] = [];
  private cores = new Map<string, string>();
  private calor = 1;
  private quadro = 0;
  private escala = 1;
  private origem = { x: 0, y: 0 };
  private sobre: No | null = null;
  private arrasto: { no: No | null; x: number; y: number; moveu: boolean } | null = null;
  private observador?: ResizeObserver;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.quadro);
      this.observador?.disconnect();
    });
  }

  ngAfterViewInit(): void {
    this.observador = new ResizeObserver(() => this.ajustarTamanho());
    this.observador.observe(this.tela().nativeElement);
    void this.carregar();
  }

  async carregar(): Promise<void> {
    this.erro.set('');
    try {
      this.dados = await this.api.grafo();
      this.montar();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível carregar o grafo.'));
    }
  }

  /** Monta os nós e arestas a partir dos dados e dos filtros, e reinicia a simulação. */
  montar(): void {
    if (!this.dados) return;
    const visivel = (path: string, pasta: string) => this.sistema || !pasta.startsWith('_');
    const porPath = new Map<string, No>();
    const antigos = new Map(this.nos.map(n => [n.path, n]));
    for (const n of this.dados.nos) {
      if (!visivel(n.path, n.pasta)) continue;
      const a = antigos.get(n.path);
      const ang = Math.random() * Math.PI * 2, r = 50 + Math.random() * 200;
      porPath.set(n.path, {
        path: n.path, title: n.title, pasta: n.pasta, grau: 0, fixo: false,
        x: a?.x ?? Math.cos(ang) * r, y: a?.y ?? Math.sin(ang) * r, vx: 0, vy: 0,
      });
    }
    const arestas: Aresta[] = [];
    for (const l of this.dados.links) {
      const a = porPath.get(l.de), b = porPath.get(l.para);
      if (!a || !b) continue;
      arestas.push({ a, b });
      a.grau++; b.grau++;
    }
    this.nos = [...porPath.values()].filter(n => !this.soLigadas || n.grau > 0);
    this.arestas = arestas;

    this.cores.clear();
    const contagem = new Map<string, number>();
    for (const n of this.nos) contagem.set(n.pasta, (contagem.get(n.pasta) ?? 0) + 1);
    [...contagem.keys()].sort().forEach((p, i) => this.cores.set(p, CORES[i % CORES.length]));
    this.legenda.set([...contagem].sort().map(([pasta, total]) => ({ pasta, total, cor: this.cores.get(pasta)! })));
    this.resumo.set(`${this.nos.length} notas, ${arestas.length} ligações`);
    this.vazio.set(this.nos.length === 0);
    this.aquecer();
  }

  private aquecer(): void {
    this.calor = 1;
    cancelAnimationFrame(this.quadro);
    const passo = () => {
      this.simular();
      this.desenhar();
      this.calor *= 0.985;
      if (this.calor > 0.01 || this.arrasto?.no) this.quadro = requestAnimationFrame(passo);
    };
    this.quadro = requestAnimationFrame(passo);
  }

  /** Um passo da simulação: repulsão entre todos, mola nas ligações e leve puxão ao centro. */
  private simular(): void {
    const nos = this.nos, k = this.calor;
    for (let i = 0; i < nos.length; i++) {
      const a = nos[i];
      for (let j = i + 1; j < nos.length; j++) {
        const b = nos[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 250000) continue;
        const f = (900 / d2) * k;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const { a, b } of this.arestas) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 70) / d) * 0.04 * k;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const n of nos) {
      n.vx -= n.x * 0.004 * k; n.vy -= n.y * 0.004 * k;
      if (n.fixo) { n.vx = n.vy = 0; continue; }
      n.vx *= 0.6; n.vy *= 0.6;
      n.x += n.vx; n.y += n.vy;
    }
  }

  private raio(n: No): number {
    return 3.5 + Math.min(Math.sqrt(n.grau) * 2, 10);
  }

  desenhar(): void {
    const c = this.tela().nativeElement;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const css = getComputedStyle(c);
    const texto = css.getPropertyValue('--text').trim() || '#333';
    const mudo = css.getPropertyValue('--text-muted').trim() || '#888';
    const dpr = window.devicePixelRatio || 1;
    const w = c.width / dpr, h = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + this.origem.x, h / 2 + this.origem.y);
    ctx.scale(this.escala, this.escala);

    const termo = this.busca.trim().toLowerCase();
    const foco = this.sobre;
    const vizinhos = new Set<No>();
    if (foco) for (const { a, b } of this.arestas) { if (a === foco) vizinhos.add(b); if (b === foco) vizinhos.add(a); }
    const apagado = (n: No) =>
      (foco && n !== foco && !vizinhos.has(n)) || (termo && !n.title.toLowerCase().includes(termo));

    ctx.lineWidth = 1 / this.escala;
    for (const { a, b } of this.arestas) {
      const ligada = foco && (a === foco || b === foco);
      ctx.strokeStyle = ligada ? this.cores.get(foco!.pasta)! : mudo;
      ctx.globalAlpha = ligada ? 0.9 : foco ? 0.08 : 0.3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const n of this.nos) {
      ctx.globalAlpha = apagado(n) ? 0.15 : 1;
      ctx.fillStyle = this.cores.get(n.pasta)!;
      ctx.beginPath(); ctx.arc(n.x, n.y, this.raio(n), 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = texto;
    ctx.textAlign = 'center';
    ctx.font = `${11 / this.escala}px system-ui, sans-serif`;
    for (const n of this.nos) {
      const mostrar = n === foco || vizinhos.has(n) || (termo && !apagado(n)) || this.escala > 1.4 || n.grau >= 4;
      if (!mostrar) continue;
      ctx.globalAlpha = apagado(n) ? 0.2 : 1;
      ctx.fillText(n.title, n.x, n.y + this.raio(n) + 12 / this.escala);
    }
    ctx.globalAlpha = 1;
  }

  private ajustarTamanho(): void {
    const c = this.tela().nativeElement;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    this.desenhar();
  }

  /** Posição do ponteiro em coordenadas do grafo. */
  private ponto(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.tela().nativeElement.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - r.width / 2 - this.origem.x) / this.escala,
      y: (e.clientY - r.top - r.height / 2 - this.origem.y) / this.escala,
    };
  }

  private noEm(e: PointerEvent): No | null {
    const p = this.ponto(e);
    for (let i = this.nos.length - 1; i >= 0; i--) {
      const n = this.nos[i], r = this.raio(n) + 3 / this.escala;
      if ((n.x - p.x) ** 2 + (n.y - p.y) ** 2 <= r * r) return n;
    }
    return null;
  }

  baixar(e: PointerEvent): void {
    this.tela().nativeElement.setPointerCapture(e.pointerId);
    const no = this.noEm(e);
    if (no) no.fixo = true;
    this.arrasto = { no, x: e.clientX, y: e.clientY, moveu: false };
  }

  mover(e: PointerEvent): void {
    const a = this.arrasto;
    if (!a) {
      const n = this.noEm(e);
      if (n !== this.sobre) {
        this.sobre = n;
        this.tela().nativeElement.style.cursor = n ? 'pointer' : 'grab';
        this.desenhar();
      }
      return;
    }
    if (Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) > 3) a.moveu = true;
    if (a.no) {
      const p = this.ponto(e);
      a.no.x = p.x; a.no.y = p.y;
      if (this.calor < 0.3) this.aquecerLeve();
    } else {
      this.origem.x += e.clientX - a.x;
      this.origem.y += e.clientY - a.y;
      a.x = e.clientX; a.y = e.clientY;
      this.desenhar();
    }
  }

  private aquecerLeve(): void {
    const parado = this.calor <= 0.01;
    this.calor = 0.3;
    if (parado) this.aquecer();
  }

  soltar(e: PointerEvent): void {
    const a = this.arrasto;
    this.arrasto = null;
    if (!a) return;
    if (a.no) a.no.fixo = false;
    if (a.no && !a.moveu) this.abrir.emit(a.no.path);
    this.tela().nativeElement.releasePointerCapture?.(e.pointerId);
  }

  sair(): void {
    if (this.sobre && !this.arrasto) { this.sobre = null; this.desenhar(); }
  }

  zoom(e: WheelEvent): void {
    e.preventDefault();
    const antes = this.ponto(e);
    this.escala = Math.min(4, Math.max(0.2, this.escala * Math.exp(-e.deltaY * 0.0015)));
    const depois = this.ponto(e);
    this.origem.x += (depois.x - antes.x) * this.escala;
    this.origem.y += (depois.y - antes.y) * this.escala;
    this.desenhar();
  }
}
