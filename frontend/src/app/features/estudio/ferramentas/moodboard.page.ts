import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { mensagemDeErro } from '../../../core/erro-http';
import { uuid } from '../../../core/uuid';
import { AppIa, ia } from '../apps';
import { EstudioService } from '../estudio.service';
import { Midia, QuadroResumo, Valor } from '../estudio.models';
import { ESTUDIO_CSS } from '../shared/estilos';
import { GerarModalComponent } from '../shared/gerar-modal';
import { SeletorMidiaComponent } from '../shared/seletor-midia';

export interface ItemMoodboard {
  id: string;
  tipo: 'imagem' | 'nota';
  midia?: string;
  texto?: string;
  cor?: string;
  x: number;
  y: number;
  w: number;
}

export interface DocumentoMoodboard {
  itens: ItemMoodboard[];
}

/** Prompt das notas do quadro (as notas descrevem o clima; as imagens vão como referência). */
export function promptDasNotas(itens: ItemMoodboard[]): string {
  return itens.filter((i) => i.tipo === 'nota' && i.texto?.trim()).map((i) => i.texto!.trim()).join('. ');
}

const CORES = ['#fff3a8', '#ffd6e0', '#cdeffd', '#d7f8d0', '#eadcff'];

/**
 * Moodboard: um quadro livre com imagens e notas, para juntar referências e usá-las (todas ou as
 * escolhidas) como guia de uma geração de imagem ou de vídeo.
 */
@Component({
  selector: 'app-moodboard',
  standalone: true,
  imports: [IconComponent, SeletorMidiaComponent, GerarModalComponent],
  template: `
    <div class="mb">
      <div class="mb-topo">
        <input class="e-input mb-nome" [value]="nome()" (input)="nome.set($any($event.target).value)" aria-label="Nome do moodboard" />
        <button type="button" class="e-btn" (click)="seletor.set(true)"><app-icon name="image" [size]="13" /> Imagens</button>
        <button type="button" class="e-btn" (click)="nota()"><app-icon name="sticky" [size]="13" /> Nota</button>
        <button type="button" class="e-btn" (click)="abrirLista()"><app-icon name="folder" [size]="13" /> Abrir</button>
        <button type="button" class="e-btn" [disabled]="salvando()" (click)="salvar()">{{ salvando() ? 'Salvando…' : 'Salvar' }}</button>
        <span class="mb-esp"></span>
        <span class="e-muted mb-sel">{{ selecionados().size ? selecionados().size + ' escolhida(s)' : 'Clique nas imagens para escolher (sem escolha = todas)' }}</span>
        <button type="button" class="e-btn e-pri" [disabled]="!imagens().length" (click)="gerar.set(cfgImagem)"><app-icon name="sparkles" [size]="13" /> Gerar imagem</button>
        <button type="button" class="e-btn" [disabled]="!imagens().length" (click)="gerar.set(cfgVideo)"><app-icon name="film" [size]="13" /> Gerar vídeo</button>
      </div>
      @if (lista(); as l) {
        <div class="e-card mb-lista">
          @for (q of l; track q.id) { <button type="button" class="e-btn e-sm" (click)="carregar(q.id)">{{ q.nome }}</button> }
          @empty { <span class="e-muted">Nenhum moodboard salvo.</span> }
          <button type="button" class="e-btn e-sm" (click)="lista.set(null)">Fechar</button>
        </div>
      }
      @if (erro()) { <p class="e-erro">{{ erro() }}</p> }
      <div class="mb-quadro" (pointermove)="arrastar($event)" (pointerup)="soltar()" (pointerleave)="soltar()">
        @for (it of itens(); track it.id) {
          <div class="mb-item" [class.mb-on]="selecionados().has(it.id)" [style.left.px]="it.x" [style.top.px]="it.y" [style.width.px]="it.w"
            (pointerdown)="pegar($event, it, 'mover')">
            @if (it.tipo === 'imagem') {
              @if (midia(it.midia!); as m) { <img [src]="m.thumb ?? m.url" alt="" draggable="false" (click)="alternar(it)" /> }
            } @else {
              <textarea class="mb-nota" [style.background]="it.cor" [value]="it.texto ?? ''" placeholder="Clima, cores, época, luz…"
                (pointerdown)="$event.stopPropagation()" (input)="mudar(it, { texto: $any($event.target).value })"></textarea>
            }
            <button type="button" class="mb-x" (pointerdown)="$event.stopPropagation()" (click)="remover(it)" aria-label="Tirar">×</button>
            <span class="mb-alca" (pointerdown)="pegar($event, it, 'redimensionar')"></span>
          </div>
        } @empty {
          <p class="e-vazio mb-vazio">Junte imagens de referência e notas. Depois gere uma imagem ou um vídeo guiado pelo quadro.</p>
        }
      </div>
    </div>
    @if (seletor()) {
      <e-seletor-midia titulo="Imagens para o quadro" [tipos]="['imagem']" [multiplo]="true" (escolhido)="adicionar($event)" (fechar)="seletor.set(false)" />
    }
    @if (gerar(); as g) {
      <e-gerar-modal [titulo]="g.nome + ' com o moodboard'" [config]="g" opInicial="{{ g.id === 'criar-video' ? 'referencias' : 'editar' }}" appHistorico="moodboard"
        [entradasIniciais]="{ imagens: referencias() }" [parametrosIniciais]="parametros()" (concluido)="gerado($event)" (fechar)="gerar.set(null)" />
    }
  `,
  styles: [ESTUDIO_CSS, `
    .mb { display: flex; flex-direction: column; height: 100%; }
    .mb-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .mb-nome { max-width: 220px; font-weight: 600; }
    .mb-esp { flex: 1; }
    .mb-sel { font-size: 12px; }
    .mb-lista { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; margin: 10px 16px 0; }
    .mb-quadro { position: relative; flex: 1; min-height: 600px; overflow: auto; background-color: var(--bg); background-image: radial-gradient(var(--border) 1px, transparent 1px); background-size: 22px 22px; touch-action: none; }
    .mb-vazio { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .mb-item { position: absolute; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.12); background: var(--surface); cursor: grab; user-select: none; outline: 3px solid transparent; }
    .mb-item.mb-on { outline-color: var(--accent); }
    .mb-item img { display: block; width: 100%; border-radius: 8px; }
    .mb-nota { display: block; width: 100%; min-height: 110px; border: none; border-radius: 8px; padding: 10px; font: inherit; font-size: 14px; resize: vertical; color: #333; }
    .mb-x { position: absolute; top: -9px; right: -9px; width: 22px; height: 22px; border-radius: 50%; border: none; background: var(--surface); box-shadow: 0 2px 6px rgba(0,0,0,.2); color: var(--text-muted); display: none; }
    .mb-item:hover .mb-x { display: block; }
    .mb-alca { position: absolute; right: -6px; bottom: -6px; width: 14px; height: 14px; border-radius: 4px; background: var(--accent); cursor: nwse-resize; display: none; }
    .mb-item:hover .mb-alca { display: block; }
  `],
})
export class MoodboardPageComponent {
  private readonly api = inject(EstudioService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly cfgImagem = ia('criar-imagem')!;
  readonly cfgVideo = ia('criar-video')!;
  readonly id = signal(uuid());
  readonly nome = signal('Moodboard');
  readonly itens = signal<ItemMoodboard[]>([]);
  readonly midias = signal(new Map<string, Midia>());
  readonly selecionados = signal(new Set<string>());
  readonly seletor = signal(false);
  readonly gerar = signal<AppIa | null>(null);
  readonly lista = signal<QuadroResumo[] | null>(null);
  readonly salvando = signal(false);
  readonly erro = signal('');
  readonly imagens = computed(() => this.itens().filter((i) => i.tipo === 'imagem'));
  private arrasto: { it: ItemMoodboard; modo: 'mover' | 'redimensionar'; x: number; y: number; ox: number; oy: number; ow: number; moveu: boolean } | null = null;

  constructor() {
    const q = this.route.snapshot.queryParamMap.get('quadro');
    if (q) void this.carregar(q);
  }

  midia(id: string): Midia | undefined { return this.midias().get(id); }

  /** Imagens que vão como referência: as escolhidas, ou todas. */
  referencias(): Midia[] {
    const sel = this.selecionados();
    return this.imagens().filter((i) => !sel.size || sel.has(i.id)).map((i) => this.midia(i.midia!)).filter((m): m is Midia => !!m);
  }

  parametros(): Record<string, Valor> {
    const p = promptDasNotas(this.itens());
    return p ? { prompt: p } : {};
  }

  adicionar(lista: Midia[]): void {
    this.seletor.set(false);
    const base = this.itens().length;
    this.midias.update((mapa) => { const n = new Map(mapa); lista.forEach((m) => n.set(m.id, m)); return n; });
    this.itens.update((l) => [...l, ...lista.map<ItemMoodboard>((m, i) => ({
      id: uuid(), tipo: 'imagem', midia: m.id, x: 30 + ((base + i) % 5) * 230, y: 30 + Math.floor((base + i) / 5) * 240, w: 210,
    }))]);
  }

  nota(): void {
    const n = this.itens().length;
    this.itens.update((l) => [...l, { id: uuid(), tipo: 'nota', texto: '', cor: CORES[n % CORES.length], x: 40 + (n % 5) * 40, y: 40 + (n % 5) * 30, w: 220 }]);
  }

  mudar(it: ItemMoodboard, m: Partial<ItemMoodboard>): void {
    this.itens.update((l) => l.map((x) => (x.id === it.id ? { ...x, ...m } : x)));
  }

  remover(it: ItemMoodboard): void {
    this.itens.update((l) => l.filter((x) => x.id !== it.id));
    this.selecionados.update((s) => { const n = new Set(s); n.delete(it.id); return n; });
  }

  alternar(it: ItemMoodboard): void {
    if (this.arrasto?.moveu) return;
    this.selecionados.update((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; });
  }

  pegar(e: PointerEvent, it: ItemMoodboard, modo: 'mover' | 'redimensionar'): void {
    e.stopPropagation();
    this.arrasto = { it, modo, x: e.clientX, y: e.clientY, ox: it.x, oy: it.y, ow: it.w, moveu: false };
  }

  arrastar(e: PointerEvent): void {
    const a = this.arrasto;
    if (!a) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) a.moveu = true;
    if (a.modo === 'mover') this.mudar(a.it, { x: Math.max(0, a.ox + dx), y: Math.max(0, a.oy + dy) });
    else this.mudar(a.it, { w: Math.max(90, a.ow + dx) });
  }

  soltar(): void {
    // O clique (escolher) vem logo depois do pointerup: espera ele para saber se foi arrasto.
    setTimeout(() => (this.arrasto = null), 0);
  }

  gerado(m: Midia[]): void {
    this.gerar.set(null);
    if (m.length) this.adicionar(m);
  }

  async salvar(): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    try {
      const capa = this.midia(this.imagens()[0]?.midia ?? '')?.thumb ?? null;
      await this.api.salvarQuadro(this.id(), 'moodboard', this.nome(), { itens: this.itens() } satisfies DocumentoMoodboard, capa);
      void this.router.navigate([], { queryParams: { quadro: this.id() }, replaceUrl: true });
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui salvar'));
    } finally {
      this.salvando.set(false);
    }
  }

  async abrirLista(): Promise<void> {
    this.lista.set(await this.api.quadros('moodboard'));
  }

  async carregar(id: string): Promise<void> {
    this.lista.set(null);
    try {
      const q = await this.api.quadro(id);
      const d = JSON.parse(q.data) as DocumentoMoodboard;
      const ids = [...new Set(d.itens.map((i) => i.midia).filter((x): x is string => !!x))];
      const achadas = await Promise.all(ids.map((i) => this.api.midia(i).catch(() => null)));
      this.midias.set(new Map(achadas.filter((m): m is Midia => !!m).map((m) => [m.id, m])));
      this.id.set(q.id);
      this.nome.set(q.nome);
      this.itens.set(d.itens.filter((i) => i.tipo === 'nota' || this.midias().has(i.midia!)));
      this.selecionados.set(new Set());
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui abrir o moodboard'));
    }
  }
}
