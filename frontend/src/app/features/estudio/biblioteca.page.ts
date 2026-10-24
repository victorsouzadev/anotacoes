import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { IconComponent } from '../../shared/icon';
import { mensagemDeErro } from '../../core/erro-http';
import { craftsQueAbrem } from './apps';
import { EstudioService } from './estudio.service';
import { Midia, TipoMidia, tamanhoLegivel } from './estudio.models';
import { ESTUDIO_CSS } from './shared/estilos';
import { MidiaCardComponent, MidiaVisorComponent, NOME_DO_TIPO, duracaoLegivel } from './shared/midia';

/** Atalhos "usar em…" por tipo de arquivo: rota da ferramenta e a entrada que ela recebe. */
const USOS: Record<TipoMidia, { rotulo: string; rota: string; op?: string }[]> = {
  imagem: [
    { rotulo: 'Editar com IA', rota: '/estudio/ferramentas/editar-imagem' },
    { rotulo: 'Novos ângulos', rota: '/estudio/ia/angulos' },
    { rotulo: 'Remover fundo', rota: '/estudio/ia/remover-fundo' },
    { rotulo: 'Ampliar', rota: '/estudio/ia/ampliar' },
    { rotulo: 'Animar (vídeo)', rota: '/estudio/ia/criar-video', op: 'imagem' },
    { rotulo: 'Objeto 3D', rota: '/estudio/ia/imagem-3d', op: 'imagem' },
    { rotulo: 'Mundo 3D', rota: '/estudio/ia/mundo-3d', op: 'imagem' },
    { rotulo: 'Referência para nova imagem', rota: '/estudio/ia/criar-imagem', op: 'editar' },
  ],
  video: [
    { rotulo: 'Estender', rota: '/estudio/ia/estender-video' },
    { rotulo: 'Trocar fundo', rota: '/estudio/ia/trocar-fundo' },
    { rotulo: 'Criar som', rota: '/estudio/ia/criar-audio', op: 'video-para-audio' },
    { rotulo: 'Extrair quadros', rota: '/estudio/ferramentas/quadros' },
    { rotulo: 'Montagem', rota: '/estudio/ferramentas/montagem' },
  ],
  audio: [{ rotulo: 'Montagem (trilha)', rota: '/estudio/ferramentas/montagem' }],
  modelo3d: [
    { rotulo: 'Pôr no palco 3D', rota: '/estudio/ferramentas/palco' },
    { rotulo: 'Refazer malha', rota: '/estudio/ia/imagem-3d', op: 'topologia' },
  ],
  mundo: [{ rotulo: 'Usar como cenário no palco', rota: '/estudio/ferramentas/palco' }],
  documento: [],
};

@Component({
  selector: 'app-estudio-biblioteca',
  standalone: true,
  imports: [IconComponent, MidiaCardComponent, MidiaVisorComponent, DatePipe, RouterLink],
  template: `
    <div class="bb" (dragover)="$event.preventDefault()" (drop)="soltar($event)">
      <div class="bb-lista">
        <div class="bb-topo">
          <h1 class="e-titulo">Biblioteca</h1>
          <label class="e-btn e-pri"><app-icon name="upload" [size]="14" /> {{ enviando() ? 'Enviando…' : 'Enviar' }}
            <input type="file" hidden multiple (change)="enviar($any($event.target))" />
          </label>
        </div>
        <div class="bb-filtros">
          <input class="e-input" type="search" placeholder="Buscar pelo nome ou prompt" [value]="busca()" (input)="digitar($any($event.target).value)" />
          <select class="e-select bb-pasta" [value]="pasta()" (change)="pasta.set($any($event.target).value); carregar()">
            <option value="">Todas as pastas</option>
            @for (p of pastas(); track p) { <option [value]="p">{{ p }}</option> }
          </select>
        </div>
        <div class="e-chips bb-tipos">
          <button type="button" class="e-chip" [class.e-on]="!tipo() && !favoritos()" (click)="tipo.set(null); favoritos.set(false); carregar()">Tudo</button>
          @for (t of tipos; track t) {
            <button type="button" class="e-chip" [class.e-on]="tipo() === t" (click)="tipo.set(t); favoritos.set(false); carregar()">{{ nomeTipo(t) }}</button>
          }
          <button type="button" class="e-chip" [class.e-on]="favoritos()" (click)="favoritos.set(!favoritos()); carregar()"><app-icon name="heart" [size]="11" /> Favoritos</button>
        </div>
        @if (erro()) { <p class="e-erro">{{ erro() }}</p> }
        <div class="e-grid-midias">
          @for (m of itens(); track m.id) {
            <e-midia-card [midia]="m" [selecionada]="sel()?.id === m.id" (escolher)="abrir($event)" />
          } @empty {
            <p class="e-vazio">{{ carregando() ? 'Carregando…' : 'Nada aqui. Arraste arquivos para esta tela ou use Enviar.' }}</p>
          }
        </div>
        @if (temMais()) { <button type="button" class="e-btn bb-mais" (click)="carregar(true)">Carregar mais</button> }
      </div>

      @if (sel(); as m) {
        <aside class="bb-painel e-card">
          <div class="bb-painel-topo">
            <strong class="bb-nome" [title]="m.nome">{{ m.nome }}</strong>
            <button type="button" class="e-ib" (click)="fecharPainel()" aria-label="Fechar"><app-icon name="x" [size]="15" /></button>
          </div>
          <e-midia-visor [midia]="m" />
          <dl class="bb-ficha">
            <dt>Tipo</dt><dd>{{ nomeTipo(m.tipo) }} · {{ tamanho(m) }}</dd>
            @if (m.largura) { <dt>Tamanho</dt><dd>{{ m.largura }} × {{ m.altura }} px</dd> }
            @if (m.duracaoSeg) { <dt>Duração</dt><dd>{{ duracao(m) }}</dd> }
            <dt>Criado</dt><dd>{{ m.criadoEm | date: 'dd/MM/yyyy HH:mm' }} · {{ m.origem }}</dd>
            @if (m.prompt) { <dt>Prompt</dt><dd class="bb-prompt">{{ m.prompt }}</dd> }
          </dl>
          <div class="bb-acoes">
            <a class="e-btn e-sm" [href]="m.url" [attr.download]="m.nome"><app-icon name="download" [size]="13" /> Baixar</a>
            <button type="button" class="e-btn e-sm" (click)="favoritar(m)"><app-icon name="heart" [size]="13" /> {{ m.favorito ? 'Desfavoritar' : 'Favoritar' }}</button>
            <button type="button" class="e-btn e-sm" (click)="renomear(m)"><app-icon name="edit" [size]="13" /> Renomear</button>
            <button type="button" class="e-btn e-sm" (click)="mover(m)"><app-icon name="folder" [size]="13" /> Pasta</button>
            @if (m.tipo === 'imagem') { <button type="button" class="e-btn e-sm" (click)="aoEditor(m)"><app-icon name="image" [size]="13" /> Para o Editor de Imagens</button> }
            <button type="button" class="e-btn e-sm e-perigo" (click)="apagar(m)"><app-icon name="delete" [size]="13" /> Apagar</button>
          </div>
          @if (crafts().length) {
            <p class="bb-rot">Abrir em</p>
            <div class="bb-acoes">
              @for (c of crafts(); track c.id) {
                <a class="e-btn e-sm" [routerLink]="c.rota" [queryParams]="{ abrir: m.id }"><app-icon [name]="c.icone" [size]="13" /> {{ c.nome }}</a>
              }
            </div>
          }
          @if (usos().length) {
            <p class="bb-rot">Usar em</p>
            <div class="bb-acoes">
              @for (u of usos(); track u.rotulo) {
                <a class="e-btn e-sm" [routerLink]="u.rota" [queryParams]="{ entrada: m.id, op: u.op ?? null }">{{ u.rotulo }}</a>
              }
            </div>
          }
          @if (aviso()) { <p class="e-muted bb-aviso">{{ aviso() }}</p> }
        </aside>
      }
    </div>
  `,
  styles: [ESTUDIO_CSS, `
    .bb { display: flex; gap: 16px; padding: 20px; min-height: 100%; align-items: flex-start; }
    .bb-lista { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
    .bb-topo { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .bb-topo label { cursor: pointer; }
    .bb-filtros { display: flex; gap: 10px; flex-wrap: wrap; }
    .bb-filtros .e-input { flex: 1 1 240px; }
    .bb-pasta { max-width: 220px; }
    .bb-mais { align-self: center; }
    .bb-painel { position: sticky; top: 0; width: 380px; flex-shrink: 0; padding: 14px; display: flex; flex-direction: column; gap: 12px; max-height: calc(100dvh - 90px); overflow: auto; }
    .bb-painel-topo { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .bb-nome { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bb-ficha { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; font-size: 12.5px; }
    .bb-ficha dt { color: var(--text-muted); font-weight: 600; }
    .bb-ficha dd { margin: 0; }
    .bb-prompt { white-space: pre-wrap; max-height: 120px; overflow: auto; }
    .bb-acoes { display: flex; flex-wrap: wrap; gap: 6px; }
    .bb-rot { margin: 4px 0 0; font-size: 12px; font-weight: 700; color: var(--text-muted); }
    .bb-aviso { font-size: 12px; margin: 0; }
    @media (max-width: 900px) {
      .bb { flex-direction: column; }
      .bb-painel { position: static; width: 100%; max-height: none; }
    }
  `],
})
export class BibliotecaPageComponent {
  private readonly api = inject(EstudioService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tipos: TipoMidia[] = ['imagem', 'video', 'audio', 'modelo3d', 'mundo', 'documento'];
  readonly itens = signal<Midia[]>([]);
  readonly pastas = signal<string[]>([]);
  readonly sel = signal<Midia | null>(null);
  readonly tipo = signal<TipoMidia | null>(null);
  readonly pasta = signal('');
  readonly busca = signal('');
  readonly favoritos = signal(false);
  readonly carregando = signal(true);
  readonly enviando = signal(false);
  readonly temMais = signal(false);
  readonly erro = signal('');
  readonly aviso = signal('');
  readonly crafts = computed(() => (this.sel() ? craftsQueAbrem(this.sel()!.nome) : []));
  readonly usos = computed(() => (this.sel() ? USOS[this.sel()!.tipo] : []));
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly lote = 120;

  constructor() {
    void this.api.pastas().then((p) => this.pastas.set(p), () => undefined);
    const inicial = this.route.snapshot.queryParamMap.get('m');
    if (inicial) void this.api.midia(inicial).then((m) => this.sel.set(m), () => undefined);
    // Recarrega quando outra tela da sessão gera ou envia algo.
    effect(() => {
      this.api.versaoBiblioteca();
      void this.carregar();
    });
  }

  nomeTipo(t: TipoMidia): string { return NOME_DO_TIPO[t]; }
  tamanho(m: Midia): string { return tamanhoLegivel(m.tamanho); }
  duracao(m: Midia): string { return duracaoLegivel(m.duracaoSeg); }

  digitar(v: string): void {
    this.busca.set(v);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.carregar(), 250);
  }

  async carregar(mais = false): Promise<void> {
    this.carregando.set(true);
    try {
      const antes = mais ? this.itens().at(-1)?.criadoEm : undefined;
      const novos = await this.api.midias({
        tipo: this.tipo() ?? undefined, q: this.busca() || undefined, pasta: this.pasta() || undefined,
        favoritos: this.favoritos(), limite: this.lote, antes,
      });
      this.itens.set(mais ? [...this.itens(), ...novos] : novos);
      this.temMais.set(novos.length === this.lote);
      this.erro.set('');
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui abrir a biblioteca'));
    } finally {
      this.carregando.set(false);
    }
  }

  abrir(m: Midia): void {
    this.sel.set(m);
    this.aviso.set('');
    void this.router.navigate([], { queryParams: { m: m.id }, replaceUrl: true });
  }

  fecharPainel(): void {
    this.sel.set(null);
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  async enviar(input: HTMLInputElement): Promise<void> {
    if (!input.files?.length) return;
    await this.subir(input.files);
    input.value = '';
  }

  async soltar(e: DragEvent): Promise<void> {
    e.preventDefault();
    if (e.dataTransfer?.files.length) await this.subir(e.dataTransfer.files);
  }

  private async subir(arquivos: FileList): Promise<void> {
    this.enviando.set(true);
    try {
      const novas = await this.api.enviarArquivos(arquivos, this.pasta() || undefined);
      if (novas.length === 1) this.abrir(novas[0]);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui enviar'));
    } finally {
      this.enviando.set(false);
    }
  }

  async favoritar(m: Midia): Promise<void> {
    this.trocar(await this.api.atualizarMidia(m.id, { favorito: !m.favorito }));
  }

  async renomear(m: Midia): Promise<void> {
    const nome = prompt('Novo nome', m.nome)?.trim();
    if (nome) this.trocar(await this.api.atualizarMidia(m.id, { nome }));
  }

  async mover(m: Midia): Promise<void> {
    const pasta = prompt('Pasta (vazio = sem pasta)', m.pasta ?? '');
    if (pasta === null) return;
    this.trocar(await this.api.atualizarMidia(m.id, { pasta: pasta.trim() }));
    void this.api.pastas().then((p) => this.pastas.set(p), () => undefined);
  }

  async aoEditor(m: Midia): Promise<void> {
    try {
      await this.api.enviarAoEditor(m.id);
      this.aviso.set('Está na biblioteca do Editor de Imagens (botão Biblioteca da barra do editor).');
    } catch (e) {
      this.aviso.set(mensagemDeErro(e, 'Não consegui mandar para o Editor'));
    }
  }

  async apagar(m: Midia): Promise<void> {
    if (!confirm(`Apagar "${m.nome}"? O arquivo sai da biblioteca e do disco.`)) return;
    await this.api.apagarMidia(m.id);
    this.fecharPainel();
  }

  private trocar(m: Midia): void {
    this.itens.update((l) => l.map((x) => (x.id === m.id ? m : x)));
    this.sel.set(m);
  }
}
