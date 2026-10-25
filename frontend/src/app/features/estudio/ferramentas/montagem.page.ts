import { Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { mensagemDeErro } from '../../../core/erro-http';
import { uuid } from '../../../core/uuid';
import { EstudioService } from '../estudio.service';
import { Job, Midia, QuadroResumo } from '../estudio.models';
import { ESTUDIO_CSS } from '../shared/estilos';
import { JobCardComponent } from '../shared/job-card';
import { duracaoLegivel } from '../shared/midia';
import { SeletorMidiaComponent } from '../shared/seletor-midia';

export interface ClipeTimeline {
  id: string;
  midia: string;
  inicio: number;
  fim: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface AudioTimeline extends ClipeTimeline {
  /** Onde a trilha começa no vídeo final (s). */
  posicao: number;
}

export interface DocumentoTimeline {
  largura: number;
  altura: number;
  fps: number;
  clipes: ClipeTimeline[];
  audios: AudioTimeline[];
}

const FORMATOS = [
  { id: '16:9', rotulo: 'Paisagem 16:9', largura: 1920, altura: 1080 },
  { id: '9:16', rotulo: 'Vertical 9:16 (Reels/TikTok)', largura: 1080, altura: 1920 },
  { id: '1:1', rotulo: 'Quadrado 1:1', largura: 1080, altura: 1080 },
  { id: '4:5', rotulo: 'Retrato 4:5 (feed)', largura: 1080, altura: 1350 },
];

/** Duração de um clipe no vídeo final. */
export function duracaoClipe(c: ClipeTimeline): number {
  return Math.max(0.1, c.fim - c.inicio);
}

/**
 * Montagem de vídeo simples: clipes e imagens em sequência, corte de início/fim, volume, fade e
 * trilhas de áudio, exportada em MP4 pelo ffmpeg do servidor. Para edição fina, o FilmCraft.
 */
@Component({
  selector: 'app-montagem',
  standalone: true,
  imports: [IconComponent, RouterLink, SeletorMidiaComponent, JobCardComponent],
  template: `
    <div class="mt">
      <div class="mt-topo">
        <input class="e-input mt-nome" [value]="nome()" (input)="nome.set($any($event.target).value); alterado.set(true)" aria-label="Nome da montagem" />
        <select class="e-select mt-formato" [value]="formato()" (change)="formato.set($any($event.target).value); alterado.set(true)">
          @for (f of formatos; track f.id) { <option [value]="f.id">{{ f.rotulo }}</option> }
        </select>
        <button type="button" class="e-btn" (click)="abrirLista()"><app-icon name="folder" [size]="13" /> Abrir</button>
        <button type="button" class="e-btn" [disabled]="salvando()" (click)="salvar()"><app-icon name="check" [size]="13" /> {{ salvando() ? 'Salvando…' : 'Salvar' }}</button>
        <button type="button" class="e-btn e-pri" [disabled]="!clipes().length || exportando()" (click)="exportar()"><app-icon name="download" [size]="13" /> {{ exportando() ? 'Exportando…' : 'Exportar MP4' }}</button>
        <span class="mt-total e-muted">{{ legivel(total()) }}</span>
      </div>
      @if (lista(); as l) {
        <div class="e-card mt-lista">
          @for (q of l; track q.id) { <button type="button" class="e-btn e-sm" (click)="carregar(q.id)">{{ q.nome }}</button> }
          @empty { <span class="e-muted">Nenhuma montagem salva.</span> }
          <button type="button" class="e-btn e-sm" (click)="lista.set(null)">Fechar</button>
        </div>
      }

      <div class="mt-corpo">
        <div class="e-card mt-preview">
          @if (selecionado(); as s) {
            @if (midia(s.midia); as m) {
              @if (m.tipo === 'imagem') {
                <img [src]="m.url" alt="" class="mt-midia" />
              } @else {
                <video #player class="mt-midia" [src]="m.url" controls playsinline (loadedmetadata)="irPara(s.inicio)" (timeupdate)="tempo.set(player.currentTime)"></video>
              }
              <div class="mt-props">
                <strong class="mt-prop-nome">{{ m.nome }}</strong>
                @if (m.tipo !== 'imagem') {
                  <div class="mt-linha">
                    <button type="button" class="e-btn e-sm" (click)="marcar('inicio')">Início aqui ({{ legivel(s.inicio) }})</button>
                    <button type="button" class="e-btn e-sm" (click)="marcar('fim')">Fim aqui ({{ legivel(s.fim) }})</button>
                  </div>
                } @else {
                  <label class="e-campo"><span>Duração na tela (s)</span><input class="e-input" type="number" min="0.5" step="0.5" [value]="s.fim - s.inicio" (input)="definirDuracao(s, +$any($event.target).value)" /></label>
                }
                <div class="mt-grade">
                  <label class="e-campo"><span>Volume</span><input type="range" min="0" max="2" step="0.05" [value]="s.volume" (input)="mudar(s, 'volume', +$any($event.target).value)" /></label>
                  <label class="e-campo"><span>Aparecer (s)</span><input class="e-input" type="number" min="0" step="0.25" [value]="s.fadeIn" (input)="mudar(s, 'fadeIn', +$any($event.target).value)" /></label>
                  <label class="e-campo"><span>Sumir (s)</span><input class="e-input" type="number" min="0" step="0.25" [value]="s.fadeOut" (input)="mudar(s, 'fadeOut', +$any($event.target).value)" /></label>
                  @if (ehAudio(s)) {
                    <label class="e-campo"><span>Começa em (s)</span><input class="e-input" type="number" min="0" step="0.5" [value]="$any(s).posicao" (input)="mudar(s, 'posicao', +$any($event.target).value)" /></label>
                  }
                </div>
                <div class="mt-linha">
                  @if (!ehAudio(s)) {
                    <button type="button" class="e-btn e-sm" (click)="moverClipe(s, -1)">← Antes</button>
                    <button type="button" class="e-btn e-sm" (click)="moverClipe(s, 1)">Depois →</button>
                  }
                  <button type="button" class="e-btn e-sm e-perigo" (click)="remover(s)"><app-icon name="delete" [size]="12" /> Tirar</button>
                </div>
              </div>
            }
          } @else {
            <p class="e-vazio">Adicione clipes e imagens abaixo; clique num item para cortar e ajustar.</p>
          }
        </div>
        <div class="mt-exp">
          @for (j of exportacoes(); track j.id) { <e-job-card [job]="j" (abrir)="abrirResultado($event)" (cancelar)="cancelar($event)" (ocultar)="ocultar($event)" /> }
        </div>
      </div>

      <div class="e-card mt-trilhas">
        <div class="mt-trilha">
          <span class="mt-rot"><app-icon name="film" [size]="13" /> Vídeo</span>
          <div class="mt-itens">
            @for (c of clipes(); track c.id) {
              <button type="button" class="mt-item" [class.mt-on]="selecionado()?.id === c.id" [style.flex-basis.px]="largura(c)" (click)="selecionar(c)" [title]="midia(c.midia)?.nome ?? ''">
                @if (midia(c.midia)?.thumb; as t) { <img [src]="t" alt="" /> }
                <span>{{ legivel(duracao(c)) }}</span>
              </button>
            }
            <button type="button" class="mt-add" (click)="seletor.set('clipe')"><app-icon name="plus" [size]="14" /> Clipe ou imagem</button>
          </div>
        </div>
        <div class="mt-trilha">
          <span class="mt-rot"><app-icon name="music" [size]="13" /> Áudio</span>
          <div class="mt-itens">
            @for (a of audios(); track a.id) {
              <button type="button" class="mt-item mt-audio" [class.mt-on]="selecionado()?.id === a.id" [style.flex-basis.px]="largura(a)" (click)="selecionar(a)">
                <span>{{ midia(a.midia)?.nome }} · {{ legivel(a.posicao) }}</span>
              </button>
            }
            <button type="button" class="mt-add" (click)="seletor.set('audio')"><app-icon name="plus" [size]="14" /> Trilha</button>
          </div>
        </div>
      </div>
      @if (erro()) { <p class="e-erro">{{ erro() }}</p> }
      <p class="e-muted mt-dica">Edição fina (efeitos, cor, legendas)? Exporte e abra no <a routerLink="/estudio/apps/filmcraft">FilmCraft</a>.</p>
    </div>
    @if (seletor(); as s) {
      <e-seletor-midia [titulo]="s === 'clipe' ? 'Clipes e imagens' : 'Trilha de áudio'" [tipos]="s === 'clipe' ? ['video', 'imagem'] : ['audio', 'video']" [multiplo]="true"
        (escolhido)="adicionar(s, $event)" (fechar)="seletor.set(null)" />
    }
  `,
  styles: [ESTUDIO_CSS, `
    .mt { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
    .mt-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .mt-nome { max-width: 260px; font-weight: 600; }
    .mt-formato { max-width: 230px; }
    .mt-total { margin-left: auto; font-variant-numeric: tabular-nums; }
    .mt-lista { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; }
    .mt-corpo { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr); gap: 12px; align-items: start; }
    .mt-preview { padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 260px; }
    .mt-midia { width: 100%; max-height: 46vh; object-fit: contain; background: #000; border-radius: var(--radius-sm); }
    .mt-props { display: flex; flex-direction: column; gap: 10px; }
    .mt-prop-nome { font-size: 13px; }
    .mt-linha { display: flex; gap: 6px; flex-wrap: wrap; }
    .mt-grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
    .mt-exp { display: flex; flex-direction: column; gap: 8px; }
    .mt-trilhas { padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow-x: auto; }
    .mt-trilha { display: flex; align-items: stretch; gap: 8px; min-height: 64px; }
    .mt-rot { width: 72px; flex-shrink: 0; display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; color: var(--text-muted); }
    .mt-itens { display: flex; gap: 4px; align-items: stretch; flex: 1; }
    .mt-item { position: relative; flex: 0 0 auto; min-width: 48px; height: 64px; border: 2px solid var(--border); border-radius: 8px; background: var(--tag-bg); overflow: hidden; padding: 0; display: flex; align-items: flex-end; }
    .mt-item img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .mt-item span { position: relative; margin: 3px; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,.6); color: #fff; font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: calc(100% - 6px); }
    .mt-audio { height: 40px; align-self: center; background: color-mix(in srgb, var(--accent) 18%, var(--surface)); }
    .mt-on { border-color: var(--accent); }
    .mt-add { flex: 0 0 auto; border: 1.5px dashed var(--border); border-radius: 8px; background: none; color: var(--text-muted); font-size: 12px; font-weight: 600; padding: 0 12px; display: flex; align-items: center; gap: 4px; }
    .mt-dica { font-size: 12px; }
    .mt-dica a { color: var(--accent); }
    @media (max-width: 860px) { .mt-corpo { grid-template-columns: 1fr; } }
  `],
})
export class MontagemPageComponent implements OnDestroy {
  private readonly api = inject(EstudioService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @ViewChild('player') player?: ElementRef<HTMLVideoElement>;

  readonly formatos = FORMATOS;
  readonly id = signal(uuid());
  readonly nome = signal('Montagem');
  readonly formato = signal('16:9');
  readonly clipes = signal<ClipeTimeline[]>([]);
  readonly audios = signal<AudioTimeline[]>([]);
  readonly midias = signal(new Map<string, Midia>());
  readonly selecionado = signal<ClipeTimeline | AudioTimeline | null>(null);
  readonly seletor = signal<'clipe' | 'audio' | null>(null);
  readonly lista = signal<QuadroResumo[] | null>(null);
  readonly tempo = signal(0);
  readonly salvando = signal(false);
  readonly exportando = signal(false);
  readonly alterado = signal(false);
  readonly erro = signal('');
  readonly exportacoes = signal<Job[]>([]);
  readonly total = computed(() => this.clipes().reduce((t, c) => t + duracaoClipe(c), 0));
  private vivo = true;

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('quadro')) void this.carregar(q.get('quadro')!);
    const entrada = q.get('entrada');
    if (entrada) void this.api.midia(entrada).then((m) => this.adicionar(m.tipo === 'audio' ? 'audio' : 'clipe', [m]), () => undefined);
  }

  ngOnDestroy(): void {
    this.vivo = false;
  }

  legivel(s: number): string {
    return duracaoLegivel(s);
  }

  midia(id: string): Midia | undefined {
    return this.midias().get(id);
  }

  duracao(c: ClipeTimeline): number {
    return duracaoClipe(c);
  }

  largura(c: ClipeTimeline): number {
    return Math.max(56, Math.min(420, duracaoClipe(c) * 18));
  }

  ehAudio(c: ClipeTimeline | AudioTimeline): c is AudioTimeline {
    return 'posicao' in c;
  }

  adicionar(tipo: 'clipe' | 'audio', lista: Midia[]): void {
    this.seletor.set(null);
    const mapa = new Map(this.midias());
    for (const m of lista) mapa.set(m.id, m);
    this.midias.set(mapa);
    if (tipo === 'clipe') {
      const novos = lista.map<ClipeTimeline>((m) => ({
        id: uuid(), midia: m.id, inicio: 0, fim: m.tipo === 'imagem' ? 3 : m.duracaoSeg ?? 5, volume: 1, fadeIn: 0, fadeOut: 0,
      }));
      this.clipes.update((l) => [...l, ...novos]);
      this.selecionado.set(novos[0] ?? null);
    } else {
      const novos = lista.map<AudioTimeline>((m) => ({
        id: uuid(), midia: m.id, inicio: 0, fim: m.duracaoSeg ?? 30, volume: 0.8, fadeIn: 0, fadeOut: 1, posicao: 0,
      }));
      this.audios.update((l) => [...l, ...novos]);
      this.selecionado.set(novos[0] ?? null);
    }
    this.alterado.set(true);
  }

  selecionar(c: ClipeTimeline | AudioTimeline): void {
    this.selecionado.set(c);
  }

  irPara(t: number): void {
    const v = this.player?.nativeElement;
    if (v) v.currentTime = t;
  }

  marcar(ponto: 'inicio' | 'fim'): void {
    const s = this.selecionado();
    const v = this.player?.nativeElement;
    if (!s || !v) return;
    const t = v.currentTime;
    if (ponto === 'inicio' && t < s.fim) this.mudar(s, 'inicio', t);
    if (ponto === 'fim' && t > s.inicio) this.mudar(s, 'fim', t);
  }

  definirDuracao(s: ClipeTimeline, d: number): void {
    if (d > 0) this.mudar(s, 'fim', s.inicio + d);
  }

  mudar(s: ClipeTimeline | AudioTimeline, campo: string, valor: number): void {
    if (!Number.isFinite(valor)) return;
    const novo = { ...s, [campo]: valor } as ClipeTimeline | AudioTimeline;
    if (this.ehAudio(novo)) this.audios.update((l) => l.map((x) => (x.id === s.id ? (novo as AudioTimeline) : x)));
    else this.clipes.update((l) => l.map((x) => (x.id === s.id ? novo : x)));
    this.selecionado.set(novo);
    this.alterado.set(true);
  }

  moverClipe(s: ClipeTimeline, dir: number): void {
    const l = [...this.clipes()];
    const i = l.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    this.clipes.set(l);
    this.alterado.set(true);
  }

  remover(s: ClipeTimeline | AudioTimeline): void {
    this.clipes.update((l) => l.filter((x) => x.id !== s.id));
    this.audios.update((l) => l.filter((x) => x.id !== s.id));
    this.selecionado.set(null);
    this.alterado.set(true);
  }

  documento(): DocumentoTimeline {
    const f = FORMATOS.find((x) => x.id === this.formato()) ?? FORMATOS[0];
    return { largura: f.largura, altura: f.altura, fps: 30, clipes: this.clipes(), audios: this.audios() };
  }

  async salvar(): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    try {
      const primeira = this.midia(this.clipes()[0]?.midia ?? '');
      await this.api.salvarQuadro(this.id(), 'timeline', this.nome(), { ...this.documento(), formato: this.formato() }, primeira?.thumb ?? null);
      this.alterado.set(false);
      void this.router.navigate([], { queryParams: { quadro: this.id() }, replaceUrl: true });
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui salvar'));
    } finally {
      this.salvando.set(false);
    }
  }

  async abrirLista(): Promise<void> {
    this.lista.set(await this.api.quadros('timeline'));
  }

  async carregar(id: string): Promise<void> {
    this.lista.set(null);
    try {
      const q = await this.api.quadro(id);
      const d = JSON.parse(q.data) as DocumentoTimeline & { formato?: string };
      const ids = [...new Set([...d.clipes, ...d.audios].map((c) => c.midia))];
      const achadas = await Promise.all(ids.map((i) => this.api.midia(i).catch(() => null)));
      this.midias.set(new Map(achadas.filter((m): m is Midia => !!m).map((m) => [m.id, m])));
      this.id.set(q.id);
      this.nome.set(q.nome);
      this.formato.set(d.formato ?? FORMATOS.find((f) => f.largura === d.largura && f.altura === d.altura)?.id ?? '16:9');
      this.clipes.set(d.clipes.filter((c) => this.midias().has(c.midia)));
      this.audios.set(d.audios.filter((c) => this.midias().has(c.midia)));
      this.selecionado.set(null);
      this.alterado.set(false);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui abrir a montagem'));
    }
  }

  async exportar(): Promise<void> {
    this.exportando.set(true);
    this.erro.set('');
    try {
      const d = this.documento();
      const entradas = { clipes: d.clipes.map((c) => c.midia), audios: d.audios.map((a) => a.midia) };
      const job = await this.api.local('montar', { ...d, nome: this.nome() }, entradas, 'montagem');
      this.exportacoes.update((l) => [job, ...l]);
      const fim = await this.api.aguardar(job.id, (j) => this.vivo && this.exportacoes.update((l) => l.map((x) => (x.id === j.id ? j : x))));
      if (fim.status === 'falhou') this.erro.set(fim.erro ?? 'A exportação falhou.');
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui exportar'));
    } finally {
      this.exportando.set(false);
    }
  }

  abrirResultado(m: Midia): void {
    void this.router.navigate(['/estudio/biblioteca'], { queryParams: { m: m.id } });
  }

  async cancelar(j: Job): Promise<void> {
    const novo = await this.api.cancelar(j.id);
    this.exportacoes.update((l) => l.map((x) => (x.id === j.id ? novo : x)));
  }

  async ocultar(j: Job): Promise<void> {
    await this.api.ocultar(j.id);
    this.exportacoes.update((l) => l.filter((x) => x.id !== j.id));
  }
}
