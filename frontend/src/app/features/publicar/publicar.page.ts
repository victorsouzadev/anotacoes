import { DatePipe } from '@angular/common';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { mensagemDeErro } from '../../core/erro-http';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { ArquivoDoPacote, compactar, daSelecaoDePasta, doArrastar, slugDoNome, tamanhoLegivel } from './pacote';
import { PublicarService, SiteDetalhe, SiteResumo, StatusVersao, Variavel, Versao } from './publicar.service';

type Fase = 'parado' | 'compactando' | 'enviando';

interface Pendente {
  nome: string;
  descricao: string;
  /** ZIP pronto, ou a pasta que ainda vai ser compactada. */
  zip?: Blob;
  arquivos?: ArquivoDoPacote[];
}

const ROTULO_STATUS: Record<StatusVersao, string> = {
  Enviado: 'Na fila',
  Iniciando: 'Publicando…',
  NoAr: 'No ar',
  Falhou: 'Falhou',
  Substituido: 'Anterior',
};

@Component({
  selector: 'app-publicar-page',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, DatePipe],
  templateUrl: './publicar.page.html',
  styleUrl: './publicar.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicarPageComponent {
  private readonly api = inject(PublicarService);
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);

  readonly permitido = signal<boolean | null>(null);
  readonly sites = signal<SiteResumo[]>([]);
  readonly detalhe = signal<SiteDetalhe | null>(null);
  readonly erro = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  // Novo site.
  readonly criandoAberto = signal(false);
  novoNome = '';
  novoSlug = '';
  private slugEditado = false;
  readonly criando = signal(false);

  // Envio.
  readonly pendente = signal<Pendente | null>(null);
  readonly fase = signal<Fase>('parado');
  readonly progresso = signal(0);
  readonly arrastando = signal(false);

  // Versões, logs, variáveis, ações.
  readonly logAberto = signal<string | null>(null);
  readonly logsApp = signal<string | null>(null);
  readonly carregandoLogs = signal(false);
  readonly variaveis = signal<Variavel[] | null>(null);
  readonly salvandoVariaveis = signal(false);
  readonly operando = signal<string | null>(null);
  confirmacaoExclusao = '';

  readonly rotuloStatus = ROTULO_STATUS;
  readonly tamanho = tamanhoLegivel;

  readonly atual = computed(() => {
    const d = this.detalhe();
    return d?.versoes.find((v) => v.id === d.currentDeploymentId) ?? null;
  });
  readonly emAndamento = computed(() =>
    this.detalhe()?.versoes.some((v) => v.status === 'Enviado' || v.status === 'Iniciando') ?? false,
  );
  readonly temApi = computed(() => this.atual()?.tipo === 'DotNet');

  private urlModelo = '';
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pararPoll());
    void this.iniciar();
  }

  private async iniciar(): Promise<void> {
    const r = await this.api.permissao();
    this.urlModelo = r.urlModelo;
    this.permitido.set(r.podePublicar);
    if (r.podePublicar) await this.recarregarLista(true);
  }

  private async recarregarLista(selecionarPrimeiro = false): Promise<void> {
    try {
      const lista = await this.api.listar();
      this.sites.set(lista);
      if (selecionarPrimeiro && lista.length > 0 && !this.detalhe()) await this.selecionar(lista[0].id);
      if (lista.length === 0) this.criandoAberto.set(true);
    } catch (e) {
      this.falha(e, 'Não foi possível carregar os sites');
    }
  }

  async selecionar(id: string): Promise<void> {
    if (this.detalhe()?.id === id) return;
    this.pendente.set(null);
    this.logAberto.set(null);
    this.logsApp.set(null);
    this.variaveis.set(null);
    this.confirmacaoExclusao = '';
    this.erro.set(null);
    this.aviso.set(null);
    await this.atualizarDetalhe(id);
  }

  private async atualizarDetalhe(id = this.detalhe()?.id): Promise<void> {
    if (!id) return;
    try {
      const d = await this.api.detalhe(id);
      const antes = this.detalhe();
      this.detalhe.set(d);
      this.ajustarPoll();
      // Terminou uma publicação: atualiza a lista (status do cartão) e avisa.
      if (antes?.id === id && antes.versoes.some((v) => v.status === 'Enviado' || v.status === 'Iniciando') && !this.emAndamento()) {
        await this.recarregarLista();
        const ultima = d.versoes[0];
        if (ultima?.status === 'NoAr') this.aviso.set(`v${ultima.versao} no ar.`);
        else if (ultima?.status === 'Falhou') {
          this.erro.set(`A v${ultima.versao} não subiu. Veja o log da versão abaixo.`);
          this.logAberto.set(ultima.id);
        }
      }
    } catch (e) {
      this.falha(e, 'Não foi possível carregar o site');
    }
  }

  private ajustarPoll(): void {
    if (this.emAndamento() && !this.poll) {
      this.poll = setInterval(() => void this.atualizarDetalhe(), 1500);
    } else if (!this.emAndamento()) {
      this.pararPoll();
    }
  }

  private pararPoll(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  // ---------------------------------------------------------------- novo site

  abrirCriacao(): void {
    this.criandoAberto.set(true);
    this.novoNome = '';
    this.novoSlug = '';
    this.slugEditado = false;
  }

  nomeMudou(): void {
    if (!this.slugEditado) this.novoSlug = slugDoNome(this.novoNome);
  }

  slugMudou(): void {
    this.slugEditado = true;
    this.novoSlug = this.novoSlug.toLowerCase();
  }

  urlPrevia(): string {
    return this.urlModelo.replace('{slug}', this.novoSlug || 'seu-app');
  }

  async criar(): Promise<void> {
    this.criando.set(true);
    this.erro.set(null);
    try {
      const site = await this.api.criar(this.novoNome.trim(), this.novoSlug.trim());
      this.criandoAberto.set(false);
      await this.recarregarLista();
      this.detalhe.set(null);
      await this.selecionar(site.id);
    } catch (e) {
      this.falha(e, 'Não foi possível criar o site');
    } finally {
      this.criando.set(false);
    }
  }

  // ---------------------------------------------------------------- envio

  escolherZip(input: HTMLInputElement): void {
    const arquivo = input.files?.[0];
    if (arquivo) this.pendente.set({ nome: arquivo.name, descricao: tamanhoLegivel(arquivo.size), zip: arquivo });
    input.value = '';
  }

  escolherPasta(input: HTMLInputElement): void {
    if (input.files && input.files.length > 0) this.definirPasta(daSelecaoDePasta(input.files));
    input.value = '';
  }

  private definirPasta(arquivos: ArquivoDoPacote[]): void {
    if (arquivos.length === 0) return;
    const total = arquivos.reduce((s, a) => s + a.arquivo.size, 0);
    const raiz = arquivos[0].caminho.split('/')[0];
    const temApi = arquivos.some((a) => /(^|\/)api\//.test(a.caminho) || a.caminho.endsWith('.runtimeconfig.json'));
    const temWeb = arquivos.some((a) => /(^|\/)web\//.test(a.caminho) || /(^|\/)index\.html$/.test(a.caminho));
    const partes = [temApi ? 'API C#' : null, temWeb ? 'front' : null].filter(Boolean).join(' + ');
    this.pendente.set({
      nome: raiz || 'pasta',
      descricao: `${arquivos.length} arquivos, ${tamanhoLegivel(total)}${partes ? ` · ${partes}` : ''}`,
      arquivos,
    });
  }

  aoArrastarSobre(ev: DragEvent): void {
    ev.preventDefault();
    this.arrastando.set(true);
  }

  async aoSoltar(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    this.arrastando.set(false);
    if (!ev.dataTransfer) return;
    try {
      const r = await doArrastar(ev.dataTransfer);
      if ('zip' in r) this.pendente.set({ nome: r.zip.name, descricao: tamanhoLegivel(r.zip.size), zip: r.zip });
      else this.definirPasta(r.arquivos);
    } catch {
      this.erro.set('Não consegui ler o que foi arrastado. Tente pelos botões.');
    }
  }

  async publicar(): Promise<void> {
    const site = this.detalhe();
    const p = this.pendente();
    if (!site || !p) return;
    this.erro.set(null);
    this.aviso.set(null);
    try {
      let zip = p.zip;
      if (!zip) {
        this.fase.set('compactando');
        zip = await compactar(p.arquivos ?? []);
      }
      this.fase.set('enviando');
      this.progresso.set(0);
      await new Promise<void>((ok, falhou) => {
        this.api.enviar(site.id, zip!).subscribe({
          next: (ev) => {
            if (ev.type === HttpEventType.UploadProgress && ev.total) this.progresso.set(Math.round((ev.loaded / ev.total) * 100));
          },
          error: falhou,
          complete: ok,
        });
      });
      this.pendente.set(null);
      await this.atualizarDetalhe();
    } catch (e) {
      this.falha(e, 'O envio foi recusado');
    } finally {
      this.fase.set('parado');
    }
  }

  // ---------------------------------------------------------------- versões

  alternarLog(v: Versao): void {
    this.logAberto.set(this.logAberto() === v.id ? null : v.id);
  }

  async ativar(v: Versao, restaurarBanco: boolean): Promise<void> {
    const site = this.detalhe();
    if (!site) return;
    if (restaurarBanco && !confirm(`Voltar para a v${v.versao} e devolver o banco ao estado de antes da versão atual? O que foi gravado desde então se perde.`)) return;
    this.erro.set(null);
    try {
      await this.api.ativar(site.id, v.id, restaurarBanco);
      await this.atualizarDetalhe();
    } catch (e) {
      this.falha(e, 'Não foi possível voltar a versão');
    }
  }

  // ---------------------------------------------------------------- app

  async carregarLogs(): Promise<void> {
    const site = this.detalhe();
    if (!site) return;
    this.carregandoLogs.set(true);
    try {
      this.logsApp.set((await this.api.logs(site.id)) || '(sem saída)');
    } catch (e) {
      this.falha(e, 'Não foi possível ler os logs');
    } finally {
      this.carregandoLogs.set(false);
    }
  }

  async abrirVariaveis(): Promise<void> {
    const site = this.detalhe();
    if (!site) return;
    try {
      this.variaveis.set(await this.api.variaveis(site.id));
    } catch (e) {
      this.falha(e, 'Não foi possível carregar as variáveis');
    }
  }

  adicionarVariavel(): void {
    this.variaveis.update((l) => [...(l ?? []), { chave: '', valor: '' }]);
  }

  removerVariavel(i: number): void {
    this.variaveis.update((l) => (l ?? []).filter((_, j) => j !== i));
  }

  async salvarVariaveis(): Promise<void> {
    const site = this.detalhe();
    const lista = (this.variaveis() ?? []).filter((v) => v.chave.trim());
    if (!site) return;
    this.salvandoVariaveis.set(true);
    this.erro.set(null);
    try {
      await this.api.salvarVariaveis(site.id, lista.map((v) => ({ chave: v.chave.trim(), valor: v.valor })));
      this.aviso.set(this.temApi() && !site.parado ? 'Variáveis salvas e app reiniciado.' : 'Variáveis salvas.');
      this.variaveis.set(lista);
      await this.atualizarDetalhe();
    } catch (e) {
      this.falha(e, 'Não foi possível salvar as variáveis');
    } finally {
      this.salvandoVariaveis.set(false);
    }
  }

  async operar(acao: 'reiniciar' | 'parar' | 'excluir'): Promise<void> {
    const site = this.detalhe();
    if (!site) return;
    this.operando.set(acao);
    this.erro.set(null);
    this.aviso.set(null);
    try {
      if (acao === 'excluir') {
        await this.api.excluir(site.id);
        this.detalhe.set(null);
        await this.recarregarLista(true);
        this.aviso.set(`Site ${site.slug} excluído.`);
        return;
      }
      await (acao === 'reiniciar' ? this.api.reiniciar(site.id) : this.api.parar(site.id));
      this.aviso.set(acao === 'reiniciar' ? 'No ar.' : 'Site parado.');
      await this.atualizarDetalhe();
      await this.recarregarLista();
    } catch (e) {
      this.falha(e, acao === 'excluir' ? 'Não foi possível excluir' : `Não foi possível ${acao}`);
      await this.atualizarDetalhe();
    } finally {
      this.operando.set(null);
    }
  }

  async copiar(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.aviso.set('Endereço copiado.');
    } catch {
      this.aviso.set(url);
    }
  }

  // ---------------------------------------------------------------- utilidades

  descreverVersao(v: Versao): string {
    if (v.tipo === 'Estatico') return 'Site estático';
    return `.NET ${v.runtimeVersao} · ${v.entrada}${v.temWeb ? ' + front' : ''}`;
  }

  statusDoSite(s: SiteResumo): { texto: string; classe: string } {
    if (s.ultimo && (s.ultimo.status === 'Enviado' || s.ultimo.status === 'Iniciando')) return { texto: 'Publicando', classe: 'andamento' };
    if (s.parado) return { texto: 'Parado', classe: 'neutro' };
    if (s.atual) return { texto: `v${s.atual.versao} no ar`, classe: 'ok' };
    if (s.ultimo?.status === 'Falhou') return { texto: 'Falhou', classe: 'falha' };
    return { texto: 'Sem versão', classe: 'neutro' };
  }

  private falha(e: unknown, acao: string): void {
    // Os 502 daqui trazem o motivo real (o app não subiu), não "servidor fora do ar".
    const detalhe = e instanceof HttpErrorResponse ? (e.error as { error?: string } | null)?.error : null;
    this.erro.set(detalhe ? `${acao}: ${detalhe}` : e instanceof Error && !(e instanceof HttpErrorResponse) ? `${acao}: ${e.message}` : mensagemDeErro(e, acao));
  }

  themeIconName(): IconName {
    switch (this.theme.pref()) {
      case 'dark': return 'moon';
      case 'light': return 'sun';
      default: return 'monitor';
    }
  }

  themeLabel(): string {
    switch (this.theme.pref()) {
      case 'dark': return 'Tema: escuro (clique para claro)';
      case 'light': return 'Tema: claro (clique para automático)';
      default: return 'Tema: automático (clique para escuro)';
    }
  }
}
