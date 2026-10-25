import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IconComponent } from '../../../shared/icon';
import { AuthService } from '../../../core/auth.service';
import { mensagemDeErro } from '../../../core/erro-http';
import { CraftApp, IAS, craft } from '../apps';
import { EstudioService } from '../estudio.service';
import { Midia } from '../estudio.models';
import { ESTUDIO_CSS } from '../shared/estilos';
import { FormGeracaoComponent } from '../shared/form-geracao';
import { HistoricoGeracoes } from '../shared/historico';
import { JobCardComponent } from '../shared/job-card';
import { SeletorMidiaComponent } from '../shared/seletor-midia';
import { destinoDoSalvar, lerMensagem, mensagemAbrir } from './ponte';

/**
 * Um craft app dentro do hub: o build web dele (servido em /estudio/apps/<id>/) num iframe do
 * mesmo endereço, com `?host=parent`. Abrir e salvar passam pela biblioteca do Estúdio, e o
 * painel de IA gera arquivos que entram direto no app.
 */
@Component({
  selector: 'app-craft-host',
  standalone: true,
  imports: [IconComponent, RouterLink, SeletorMidiaComponent, FormGeracaoComponent, JobCardComponent],
  template: `
    @if (app(); as a) {
      <div class="ch">
        <div class="ch-barra">
          <button type="button" class="e-btn e-sm" [disabled]="!pronto()" (click)="seletor.set(true)"><app-icon name="folder" [size]="13" /> Abrir da biblioteca</button>
          <span class="ch-doc">
            @if (doc(); as d) { <app-icon name="file" [size]="13" /> {{ d.nome }} }
            @if (sujo()) { <span class="ch-sujo" title="Alterações não salvas">● não salvo</span> }
            @if (status()) { <span class="ch-status">{{ status() }}</span> }
          </span>
          <span class="ch-espaco"></span>
          <button type="button" class="e-btn e-sm" [class.e-pri]="painelIa()" (click)="painelIa.set(!painelIa())"><app-icon name="sparkles" [size]="13" /> IA</button>
          <a class="e-ib" [href]="srcTexto()" target="_blank" rel="noopener" title="Abrir sozinho numa aba (sem a biblioteca)" aria-label="Abrir numa aba"><app-icon name="external" [size]="14" /></a>
        </div>
        @if (aviso()) { <div class="ch-aviso">{{ aviso() }}</div> }
        <div class="ch-corpo">
          @if (indisponivel()) {
            <div class="ch-vazio e-card">
              <app-icon [name]="a.icone" [size]="36" />
              <h2>{{ a.nome }} ainda não está publicado neste servidor</h2>
              <p class="e-muted">O build web dos craft apps é feito pelo GitHub Actions (workflow "Craft apps") e copiado para <code>downloads/crafts/{{ a.id }}/</code> (servido em <code>/crafts/{{ a.id }}/</code>) na VPS. Depois de rodar o workflow, recarregue esta página.</p>
              <p class="e-muted">Enquanto isso, a versão oficial: <a [href]="'https://getartcraft.com/apps/' + a.id" target="_blank" rel="noopener">getartcraft.com/apps/{{ a.id }}</a></p>
              <a class="e-btn" routerLink="/estudio">Voltar ao Estúdio</a>
            </div>
          } @else {
            <iframe #quadro class="ch-iframe" [src]="src()" [title]="a.nome" allow="clipboard-read; clipboard-write; fullscreen; microphone; midi; autoplay"></iframe>
          }
          @if (painelIa()) {
            <aside class="ch-ia e-card">
              <div class="ch-ia-topo">
                <select class="e-select" [value]="iaId()" (change)="iaId.set($any($event.target).value)">
                  @for (x of iasDoApp(); track x.id) { <option [value]="x.id">{{ x.nome }}</option> }
                </select>
                <button type="button" class="e-ib" (click)="painelIa.set(false)" aria-label="Fechar painel"><app-icon name="x" [size]="14" /></button>
              </div>
              @for (cfg of [iaAtual()]; track cfg.id) {
                <e-form-geracao [config]="cfg" [appHistorico]="'craft-' + a.id" (gerado)="historico.adicionar($event)" />
              }
              <h3 class="ch-ia-sub">Resultados — clique para mandar ao {{ a.nome }}</h3>
              @for (j of historico.jobs(); track j.id) {
                <e-job-card [job]="j" (abrir)="mandarAoApp($event)" (cancelar)="historico.cancelar($event)" (ocultar)="historico.ocultar($event)" />
              }
            </aside>
          }
        </div>
      </div>
      @if (seletor()) {
        <e-seletor-midia [titulo]="'Abrir no ' + a.nome" [tipos]="['documento', 'imagem', 'video', 'audio']" [extensoes]="a.abre.join(',')" (escolhido)="abrirMidia($event[0])" (fechar)="seletor.set(false)" />
      }
    } @else {
      <p class="e-vazio">App não encontrado. <a routerLink="/estudio">Voltar ao Estúdio</a></p>
    }
  `,
  styles: [ESTUDIO_CSS, `
    :host { display: block; height: 100%; }
    .ch { height: 100%; display: flex; flex-direction: column; }
    .ch-barra { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; }
    .ch-doc { display: flex; align-items: center; gap: 6px; font-size: 12.5px; min-width: 0; }
    .ch-sujo { color: var(--atencao); font-weight: 600; }
    .ch-status { color: var(--text-muted); }
    .ch-espaco { flex: 1; }
    .ch-aviso { padding: 8px 14px; background: color-mix(in srgb, var(--atencao) 14%, var(--surface)); font-size: 13px; border-bottom: 1px solid var(--border); }
    .ch-corpo { flex: 1; min-height: 0; display: flex; position: relative; }
    .ch-iframe { flex: 1; border: none; width: 100%; height: 100%; background: #f3f3f3; }
    .ch-vazio { margin: 40px auto; align-self: flex-start; max-width: 560px; padding: 28px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
    .ch-vazio h2 { font-size: 17px; margin: 6px 0 0; }
    .ch-vazio p { margin: 0; font-size: 13.5px; }
    .ch-vazio a:not(.e-btn) { color: var(--accent); }
    .ch-ia { width: 380px; flex-shrink: 0; border-radius: 0; border-width: 0 0 0 1px; padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    .ch-ia-topo { display: flex; gap: 8px; }
    .ch-ia-sub { font-size: 13px; margin: 6px 0 0; }
    @media (max-width: 820px) { .ch-ia { position: absolute; inset: 0 0 0 auto; width: min(380px, 100%); z-index: 5; box-shadow: var(--shadow-lg); } }
  `],
})
export class CraftHostPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(EstudioService);
  private readonly auth = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);
  @ViewChild('quadro') quadro?: ElementRef<HTMLIFrameElement>;

  readonly app = signal<CraftApp | null>(null);
  readonly pronto = signal(false);
  readonly sujo = signal(false);
  /** Ponte em JavaScript sem aviso de "não salvo" (só o PhotoCraft avisa): na dúvida, pergunta ao sair. */
  private semAvisoDeSujo = false;
  private recebeuSujo = false;
  readonly doc = signal<Midia | null>(null);
  readonly status = signal('');
  readonly aviso = signal('');
  readonly indisponivel = signal(false);
  readonly seletor = signal(false);
  readonly painelIa = signal(false);
  readonly iaId = signal('criar-imagem');
  readonly srcTexto = signal('');
  readonly src = computed<SafeResourceUrl>(() => this.sanitizer.bypassSecurityTrustResourceUrl(this.srcTexto()));
  readonly historico: HistoricoGeracoes;
  private pendente: Midia | null = null;
  private ouvinte = (e: MessageEvent) => void this.receber(e);

  /** IAs que fazem sentido para o que o app recebe (imagem, vídeo, áudio…). */
  readonly iasDoApp = computed(() => {
    const a = this.app();
    if (!a) return [];
    const mapa: Record<string, string[]> = {
      imagem: ['criar-imagem', 'remover-fundo', 'ampliar', 'angulos'],
      video: ['criar-video', 'estender-video', 'trocar-fundo'],
      audio: ['criar-audio'],
      documento: ['criar-imagem'],
    };
    const ids = [...new Set(a.recebe.flatMap((t) => mapa[t] ?? []))];
    return IAS.filter((x) => ids.includes(x.id) && !x.rota.includes('/ferramentas/'));
  });
  readonly iaAtual = computed(() => this.iasDoApp().find((x) => x.id === this.iaId()) ?? this.iasDoApp()[0]);

  constructor() {
    const id = this.route.snapshot.paramMap.get('craft') ?? '';
    this.app.set(craft(id) ?? null);
    this.historico = new HistoricoGeracoes(`craft-${id}`);
  }

  async ngOnInit(): Promise<void> {
    const a = this.app();
    if (!a) return;
    if (!this.iasDoApp().some((x) => x.id === this.iaId())) this.iaId.set(this.iasDoApp()[0]?.id ?? 'criar-imagem');
    if (a.webgpu && !('gpu' in navigator)) {
      this.aviso.set(`${a.nome} usa WebGPU, que este navegador não tem ligado. Use Chrome ou Edge atualizados (ou o programa do Windows).`);
    }
    const base = `/crafts/${a.id}/`;
    try {
      const r = await fetch(base + 'index.html', { method: 'HEAD', cache: 'no-store' });
      const tipo = r.headers.get('content-type') ?? '';
      // Em desenvolvimento (ng serve) /crafts cai no index.html do próprio hub: o tipo é HTML do mesmo
      // jeito, mas só o Caddy da pasta dos crafts põe o cabeçalho X-Craft-App.
      this.indisponivel.set(!r.ok || !tipo.includes('html') || r.headers.get('x-craft-app') !== a.id);
    } catch {
      this.indisponivel.set(true);
    }
    const autor = encodeURIComponent(this.auth.user()?.email ?? '');
    this.srcTexto.set(`${base}index.html?host=parent&author=${autor}`);
    window.addEventListener('message', this.ouvinte);
    void this.historico.carregar();

    const abrir = this.route.snapshot.queryParamMap.get('abrir');
    if (abrir) {
      try {
        this.pendente = await this.api.midia(abrir);
        this.status.set('Abrindo ' + this.pendente.nome + '…');
      } catch { /* apagado */ }
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.ouvinte);
  }

  /** Avisa antes de fechar a aba com alterações não salvas. */
  @HostListener('window:beforeunload', ['$event'])
  antesDeSair(e: BeforeUnloadEvent): void {
    if (this.sujo()) e.preventDefault();
  }

  /** Usado pela rota (canDeactivate) ao navegar dentro do hub. */
  podeSair(): boolean {
    if (this.sujo()) return confirm(`Há alterações não salvas no ${this.app()?.nome}. Sair mesmo assim?`);
    if (this.semAvisoDeSujo && !this.recebeuSujo && this.pronto())
      return confirm(`O ${this.app()?.nome} não avisa o hub quando há alterações não salvas. Salvou o que precisava? Sair mesmo assim?`);
    return true;
  }

  async abrirMidia(m: Midia | undefined): Promise<void> {
    this.seletor.set(false);
    if (!m) return;
    if (this.sujo() && !confirm('O documento aberto tem alterações não salvas. Abrir outro mesmo assim?')) return;
    await this.enviarAoApp(m, true);
  }

  async mandarAoApp(m: Midia): Promise<void> {
    await this.enviarAoApp(m, false);
  }

  private async enviarAoApp(m: Midia, comoDocumento: boolean): Promise<void> {
    const a = this.app();
    const alvo = this.quadro?.nativeElement.contentWindow;
    if (!a || !alvo) return;
    try {
      this.status.set('Abrindo ' + m.nome + '…');
      const bytes = await this.api.bytes(m);
      alvo.postMessage(mensagemAbrir(a.id, m.nome, bytes, comoDocumento ? 'abrir' : 'inserir'), location.origin, [bytes]);
      if (comoDocumento) this.doc.set(m);
      this.status.set('');
    } catch (e) {
      this.status.set(mensagemDeErro(e, 'Não consegui abrir o arquivo'));
    }
  }

  private async receber(e: MessageEvent): Promise<void> {
    const a = this.app();
    const alvo = this.quadro?.nativeElement.contentWindow;
    if (!a || e.origin !== location.origin || e.source !== alvo) return;
    const ev = lerMensagem(e.data, a.id);
    if (!ev) return;
    switch (ev.tipo) {
      case 'ready':
        this.pronto.set(true);
        this.semAvisoDeSujo = ev.ponteJs;
        if (this.pendente) {
          const m = this.pendente;
          this.pendente = null;
          await this.enviarAoApp(m, true);
        }
        break;
      case 'dirty':
        this.recebeuSujo = true;
        this.sujo.set(ev.sujo);
        break;
      case 'failed':
        this.aviso.set(`${a.nome} não conseguiu iniciar: ${ev.erro}`);
        break;
      case 'save':
        await this.salvar(a, ev.nome, ev.bytes, ev.salvarComo);
        break;
    }
  }

  /** Salvar do app → biblioteca: por cima do documento aberto, documento novo ou cópia (ver destinoDoSalvar). */
  private async salvar(a: CraftApp, nome: string, bytes: ArrayBuffer, salvarComo: boolean | null): Promise<void> {
    const blob = new Blob([bytes]);
    const atual = this.doc();
    try {
      this.status.set('Salvando ' + nome + '…');
      const destino = destinoDoSalvar(atual, nome, salvarComo);
      if (destino === 'substituir' && atual) {
        this.doc.set(await this.api.substituirArquivo(atual.id, blob));
      } else {
        const nova = await this.api.enviarBytes(blob, nome, 'craft', a.nome);
        if (destino === 'novo-documento') this.doc.set(nova);
      }
      this.status.set(`Salvo na biblioteca: ${nome}`);
      setTimeout(() => this.status().startsWith('Salvo') && this.status.set(''), 4000);
    } catch (err) {
      this.status.set(mensagemDeErro(err, 'Não consegui salvar na biblioteca'));
    }
  }
}

export const sairDoCraft = (c: CraftHostPageComponent) => c.podeSair();
