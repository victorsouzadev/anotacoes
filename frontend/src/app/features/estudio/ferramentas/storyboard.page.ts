import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { mensagemDeErro } from '../../../core/erro-http';
import { uuid } from '../../../core/uuid';
import { ia } from '../apps';
import { EstudioService } from '../estudio.service';
import { Midia, QuadroResumo, Valor } from '../estudio.models';
import { ESTUDIO_CSS } from '../shared/estilos';
import { GerarModalComponent } from '../shared/gerar-modal';
import { duracaoLegivel } from '../shared/midia';
import { SeletorMidiaComponent } from '../shared/seletor-midia';
import { DocumentoTimeline } from './montagem.page';

export interface Plano {
  id: string;
  titulo: string;
  /** O que acontece no plano — vira o prompt de imagem e de vídeo. */
  descricao: string;
  /** Câmera/enquadramento (plano geral, close…). */
  camera: string;
  duracao: number;
  imagem: string | null;
  video: string | null;
  notas: string;
}

export interface DocumentoStoryboard {
  /** Estilo comum a todos os planos (entra no fim de cada prompt). */
  estilo: string;
  proporcao: string;
  planos: Plano[];
}

/** Prompt de um plano: descrição + câmera + estilo comum. */
export function promptDoPlano(p: Plano, estilo: string): string {
  return [p.descricao.trim(), p.camera.trim() && `Camera: ${p.camera.trim()}.`, estilo.trim() && `Style: ${estilo.trim()}.`].filter(Boolean).join(' ');
}

/** Storyboard → linha do tempo da montagem: o vídeo do plano, ou a imagem pela duração dele. */
export function timelineDoStoryboard(d: DocumentoStoryboard, duracoes: Map<string, number>): DocumentoTimeline {
  const formato = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] }[d.proporcao] ?? [1920, 1080];
  return {
    largura: formato[0], altura: formato[1], fps: 30, audios: [],
    clipes: d.planos.filter((p) => p.video || p.imagem).map((p) => {
      const midia = (p.video ?? p.imagem)!;
      const fim = p.video ? Math.min(p.duracao, duracoes.get(p.video) ?? p.duracao) : p.duracao;
      return { id: uuid(), midia, inicio: 0, fim, volume: 1, fadeIn: 0, fadeOut: 0 };
    }),
  };
}

type Geracao = { tipo: 'imagem' | 'video'; plano: Plano };

@Component({
  selector: 'app-storyboard',
  standalone: true,
  imports: [IconComponent, SeletorMidiaComponent, GerarModalComponent],
  template: `
    <div class="sb">
      <div class="sb-topo">
        <input class="e-input sb-nome" [value]="nome()" (input)="nome.set($any($event.target).value)" aria-label="Nome do storyboard" />
        <select class="e-select sb-prop" [value]="doc().proporcao" (change)="mudarDoc('proporcao', $any($event.target).value)">
          <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
        </select>
        <button type="button" class="e-btn" (click)="abrirLista()"><app-icon name="folder" [size]="13" /> Abrir</button>
        <button type="button" class="e-btn" (click)="novo()"><app-icon name="plus" [size]="13" /> Novo</button>
        <button type="button" class="e-btn" [disabled]="salvando()" (click)="salvar()">{{ salvando() ? 'Salvando…' : 'Salvar' }}</button>
        <button type="button" class="e-btn e-pri" [disabled]="!prontosParaMontar()" (click)="montar()"><app-icon name="film" [size]="13" /> Montar vídeo</button>
        <span class="e-muted sb-total">{{ doc().planos.length }} planos · {{ legivel(total()) }}</span>
      </div>
      @if (lista(); as l) {
        <div class="e-card sb-lista">
          @for (q of l; track q.id) { <button type="button" class="e-btn e-sm" (click)="carregar(q.id)">{{ q.nome }}</button> }
          @empty { <span class="e-muted">Nenhum storyboard salvo.</span> }
          <button type="button" class="e-btn e-sm" (click)="lista.set(null)">Fechar</button>
        </div>
      }
      <label class="e-campo sb-estilo">
        <span>Estilo de todos os planos</span>
        <input class="e-input" placeholder="ex.: filme de animação em stop motion, luz de fim de tarde, cores quentes" [value]="doc().estilo" (input)="mudarDoc('estilo', $any($event.target).value)" />
      </label>

      <div class="sb-planos">
        @for (p of doc().planos; track p.id; let i = $index) {
          <article class="e-card sb-plano">
            <div class="sb-midia">
              @if (p.video && midia(p.video); as v) {
                <video [src]="v.url" [poster]="v.thumb ?? ''" controls playsinline></video>
              } @else if (p.imagem && midia(p.imagem); as img) {
                <img [src]="img.url" alt="" />
              } @else {
                <span class="sb-sem"><app-icon name="image" [size]="26" /></span>
              }
            </div>
            <div class="sb-info">
              <div class="sb-linha">
                <span class="sb-num">{{ i + 1 }}</span>
                <input class="e-input sb-titulo" [value]="p.titulo" placeholder="Plano" (input)="mudar(p, 'titulo', $any($event.target).value)" />
                <input class="e-input sb-dur" type="number" min="1" max="60" [value]="p.duracao" (input)="mudar(p, 'duracao', +$any($event.target).value)" title="Duração (s)" />
              </div>
              <textarea class="e-textarea" rows="3" placeholder="O que acontece (vira o prompt)" [value]="p.descricao" (input)="mudar(p, 'descricao', $any($event.target).value)"></textarea>
              <input class="e-input" placeholder="Câmera (plano geral, close, travelling…)" [value]="p.camera" (input)="mudar(p, 'camera', $any($event.target).value)" />
              <div class="sb-acoes">
                <button type="button" class="e-btn e-sm" (click)="gerar.set({ tipo: 'imagem', plano: p })"><app-icon name="sparkles" [size]="12" /> Gerar imagem</button>
                <button type="button" class="e-btn e-sm" (click)="escolhendo.set(p)"><app-icon name="folder" [size]="12" /> Da biblioteca</button>
                <button type="button" class="e-btn e-sm" [disabled]="!p.imagem" (click)="gerar.set({ tipo: 'video', plano: p })"><app-icon name="film" [size]="12" /> Animar</button>
                <button type="button" class="e-ib" (click)="moverPlano(i, -1)" title="Antes" aria-label="Mover para antes">↑</button>
                <button type="button" class="e-ib" (click)="moverPlano(i, 1)" title="Depois" aria-label="Mover para depois">↓</button>
                <button type="button" class="e-ib" (click)="removerPlano(p)" title="Tirar" aria-label="Tirar plano"><app-icon name="delete" [size]="13" /></button>
              </div>
            </div>
          </article>
        }
        <button type="button" class="sb-add" (click)="adicionarPlano()"><app-icon name="plus" [size]="18" /> Plano</button>
      </div>
      @if (erro()) { <p class="e-erro">{{ erro() }}</p> }
    </div>

    @if (escolhendo(); as p) {
      <e-seletor-midia titulo="Imagem ou vídeo do plano" [tipos]="['imagem', 'video']" (escolhido)="usar(p, $event[0])" (fechar)="escolhendo.set(null)" />
    }
    @if (gerar(); as g) {
      <e-gerar-modal [titulo]="g.tipo === 'imagem' ? 'Imagem do plano ' + g.plano.titulo : 'Animar o plano ' + g.plano.titulo"
        [config]="g.tipo === 'imagem' ? cfgImagem : cfgVideo" [opInicial]="g.tipo === 'video' ? 'imagem' : 'texto'" appHistorico="storyboard"
        [parametrosIniciais]="parametros(g)" [entradasIniciais]="entradas(g)"
        (concluido)="gerado(g, $event)" (fechar)="gerar.set(null)" />
    }
  `,
  styles: [ESTUDIO_CSS, `
    .sb { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
    .sb-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sb-nome { max-width: 260px; font-weight: 600; }
    .sb-prop { width: 90px; }
    .sb-total { margin-left: auto; }
    .sb-lista { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; }
    .sb-estilo { max-width: 760px; }
    .sb-planos { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .sb-plano { display: flex; flex-direction: column; overflow: hidden; }
    .sb-midia { position: relative; aspect-ratio: 16 / 9; background: var(--tag-bg); display: flex; align-items: center; justify-content: center; }
    .sb-midia img, .sb-midia video { width: 100%; height: 100%; object-fit: cover; background: #000; }
    .sb-sem { color: var(--text-muted); }
    .sb-info { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .sb-linha { display: flex; gap: 6px; align-items: center; }
    .sb-num { width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: var(--accent-contrast); font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .sb-titulo { flex: 1; font-weight: 600; }
    .sb-dur { width: 64px; }
    .sb-acoes { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .sb-add { min-height: 200px; border: 1.5px dashed var(--border); border-radius: var(--radius); background: none; color: var(--text-muted); font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; }
  `],
})
export class StoryboardPageComponent {
  private readonly api = inject(EstudioService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly cfgImagem = ia('criar-imagem')!;
  readonly cfgVideo = ia('criar-video')!;
  readonly id = signal(uuid());
  readonly nome = signal('Storyboard');
  readonly doc = signal<DocumentoStoryboard>({ estilo: '', proporcao: '16:9', planos: [] });
  readonly midias = signal(new Map<string, Midia>());
  readonly escolhendo = signal<Plano | null>(null);
  readonly gerar = signal<Geracao | null>(null);
  readonly lista = signal<QuadroResumo[] | null>(null);
  readonly salvando = signal(false);
  readonly erro = signal('');
  readonly total = computed(() => this.doc().planos.reduce((t, p) => t + p.duracao, 0));
  readonly prontosParaMontar = computed(() => this.doc().planos.some((p) => p.video || p.imagem));

  constructor() {
    const q = this.route.snapshot.queryParamMap.get('quadro');
    if (q) void this.carregar(q);
    else this.adicionarPlano();
  }

  legivel(s: number): string { return duracaoLegivel(s); }
  midia(id: string): Midia | undefined { return this.midias().get(id); }

  mudarDoc<K extends keyof DocumentoStoryboard>(campo: K, valor: DocumentoStoryboard[K]): void {
    this.doc.update((d) => ({ ...d, [campo]: valor }));
  }

  mudar<K extends keyof Plano>(p: Plano, campo: K, valor: Plano[K]): void {
    this.doc.update((d) => ({ ...d, planos: d.planos.map((x) => (x.id === p.id ? { ...x, [campo]: valor } : x)) }));
  }

  adicionarPlano(): void {
    const n = this.doc().planos.length + 1;
    this.doc.update((d) => ({
      ...d,
      planos: [...d.planos, { id: uuid(), titulo: `Plano ${n}`, descricao: '', camera: '', duracao: 5, imagem: null, video: null, notas: '' }],
    }));
  }

  removerPlano(p: Plano): void {
    if (!confirm(`Tirar "${p.titulo}"? Os arquivos continuam na biblioteca.`)) return;
    this.doc.update((d) => ({ ...d, planos: d.planos.filter((x) => x.id !== p.id) }));
  }

  moverPlano(i: number, dir: number): void {
    const l = [...this.doc().planos];
    const j = i + dir;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    this.doc.update((d) => ({ ...d, planos: l }));
  }

  usar(p: Plano, m: Midia | undefined): void {
    this.escolhendo.set(null);
    if (!m) return;
    this.guardarMidia(m);
    if (m.tipo === 'video') this.mudar(p, 'video', m.id);
    else this.mudarPlano(p, { imagem: m.id, video: null });
  }

  parametros(g: Geracao): Record<string, Valor> {
    const prompt = promptDoPlano(g.plano, this.doc().estilo);
    const base: Record<string, Valor> = prompt ? { prompt } : {};
    if (g.tipo === 'imagem') base['proporcao'] = this.doc().proporcao;
    return base;
  }

  entradas(g: Geracao): Record<string, Midia[]> {
    const img = g.plano.imagem ? this.midia(g.plano.imagem) : undefined;
    return g.tipo === 'video' && img ? { imagem: [img] } : {};
  }

  gerado(g: Geracao, m: Midia[]): void {
    this.gerar.set(null);
    const r = m[0];
    if (!r) return;
    this.guardarMidia(r);
    if (g.tipo === 'video') this.mudar(g.plano, 'video', r.id);
    else this.mudarPlano(g.plano, { imagem: r.id, video: null });
  }

  novo(): void {
    this.id.set(uuid());
    this.nome.set('Storyboard');
    this.doc.set({ estilo: '', proporcao: '16:9', planos: [] });
    this.adicionarPlano();
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  async salvar(): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    try {
      const capa = this.doc().planos.map((p) => this.midia(p.imagem ?? '')?.thumb).find((t) => !!t) ?? null;
      await this.api.salvarQuadro(this.id(), 'storyboard', this.nome(), this.doc(), capa);
      void this.router.navigate([], { queryParams: { quadro: this.id() }, replaceUrl: true });
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui salvar'));
    } finally {
      this.salvando.set(false);
    }
  }

  async abrirLista(): Promise<void> {
    this.lista.set(await this.api.quadros('storyboard'));
  }

  async carregar(id: string): Promise<void> {
    this.lista.set(null);
    try {
      const q = await this.api.quadro(id);
      const d = JSON.parse(q.data) as DocumentoStoryboard;
      const ids = [...new Set(d.planos.flatMap((p) => [p.imagem, p.video]).filter((x): x is string => !!x))];
      const achadas = await Promise.all(ids.map((i) => this.api.midia(i).catch(() => null)));
      this.midias.set(new Map(achadas.filter((m): m is Midia => !!m).map((m) => [m.id, m])));
      this.id.set(q.id);
      this.nome.set(q.nome);
      this.doc.set(d);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui abrir o storyboard'));
    }
  }

  /** Vira uma montagem (linha do tempo) e abre o editor de montagem com ela. */
  async montar(): Promise<void> {
    try {
      await this.salvar();
      const duracoes = new Map([...this.midias().values()].map((m) => [m.id, m.duracaoSeg ?? 0]));
      const tl = timelineDoStoryboard(this.doc(), duracoes);
      const idTl = uuid();
      const capa = this.midia(tl.clipes[0]?.midia ?? '')?.thumb ?? null;
      const formato = this.doc().proporcao;
      await this.api.salvarQuadro(idTl, 'timeline', `${this.nome()} — montagem`, { ...tl, formato }, capa);
      void this.router.navigate(['/estudio/ferramentas/montagem'], { queryParams: { quadro: idTl } });
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui montar'));
    }
  }

  private mudarPlano(p: Plano, mudancas: Partial<Plano>): void {
    this.doc.update((d) => ({ ...d, planos: d.planos.map((x) => (x.id === p.id ? { ...x, ...mudancas } : x)) }));
  }

  private guardarMidia(m: Midia): void {
    this.midias.update((mapa) => new Map(mapa).set(m.id, m));
  }
}
