import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { THEMES, ThemeDef } from '../../core/themes.data';
import { IconComponent, IconName } from '../../shared/icon';
import {
  ConfiguracaoIa,
  PROVEDORES,
  ProvedorIa,
  TesteConexao,
} from './configuracao-ia.model';
import { ConfiguracaoIaService } from './configuracao-ia.service';
import { mensagemDeErro } from '../../core/erro-http';
import { BackupEstado, SistemaService, idadeTexto, tamanhoTexto } from '../../core/sistema.service';
import { ItemDoHub, PluginsService } from '../../core/plugins.service';
import { PublicarService } from '../publicar/publicar.service';
import { AppAutorizado, ConexoesService, TokenMcp } from '../../core/conexoes.service';

@Component({
  selector: 'app-configuracoes-page',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, DatePipe],
  templateUrl: './configuracoes.page.html',
  styleUrl: './configuracoes.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracoesPageComponent {
  private readonly service = inject(ConfiguracaoIaService);
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);

  readonly provedores = PROVEDORES;
  readonly temas: ThemeDef[] = THEMES;

  readonly config = signal<ConfiguracaoIa | null>(null);
  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly testando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly sucesso = signal<string | null>(null);
  readonly teste = signal<TesteConexao | null>(null);
  readonly confirmandoRemocao = signal(false);
  readonly mostrarChave = signal(false);
  readonly mostrarChaveUpscale = signal(false);
  readonly confirmandoRemocaoUpscale = signal(false);
  /** Estado do backup (spec 025): só carregado para quem está em PUBLICADORES. */
  readonly backup = signal<BackupEstado | null>(null);
  /** Plug-ins instalados (spec 029), com versão e a última versão recusada pelo deployer. */
  readonly plugins = signal<ItemDoHub[]>([]);
  private readonly registro = inject(PluginsService);
  readonly idade = idadeTexto;
  readonly tamanho = tamanhoTexto;
  private readonly sistema = inject(SistemaService);
  private readonly publicar = inject(PublicarService);

  /** Conexões (spec 030): apps autorizados pelo OAuth do núcleo e tokens MCP estáticos, por plug-in. */
  private readonly conexoes = inject(ConexoesService);
  readonly apps = signal<AppAutorizado[]>([]);
  readonly tokensMcp = signal<TokenMcp[]>([]);
  readonly pluginsComMcp = signal<ItemDoHub[]>([]);
  /** Token recém-gerado: aparece uma vez só. */
  readonly tokenNovo = signal<{ plugin: string; token: string } | null>(null);
  readonly erroConexoes = signal<string | null>(null);
  pluginDoToken = '';

  // Campos do formulário.
  provedor: ProvedorIa = '';
  modelo = '';
  /** Vazio significa "não mexer na chave salva" — o cliente nunca a recebe. */
  chave = '';

  /** Chave do serviço que amplia foto no Editor de Imagens. Mesma regra. */
  chaveUpscale = '';

  readonly descricaoDoProvedor = computed(() =>
    this.provedores.find((p) => p.valor === this.provedorSelecionado())?.descricao ?? '',
  );

  private readonly provedorSelecionado = signal<ProvedorIa>('');

  readonly modelosSugeridos = computed(() => this.config()?.modelosSugeridos ?? []);

  /** Um modelo sem visão só serve para lançamento por texto. */
  readonly modeloEscolhidoLeImagens = computed(() => {
    const escolhido = this.modelosSugeridos().find((m) => m.id === this.modeloAtual());
    return escolhido?.leImagens ?? null;
  });

  private readonly modeloAtual = signal('');

  readonly precisaDeChave = computed(() => {
    const p = this.provedorSelecionado();
    return p === 'openrouter' || p === 'anthropic';
  });

  constructor() {
    this.carregar();
    void this.carregarConexoes();
    void this.publicar.permissao().then((r) => {
      if (r.podePublicar) {
        void this.sistema.backup().then((b) => this.backup.set(b));
        void this.registro.listar().then((l) => this.plugins.set(l.filter((i) => i.origem === 'plugin')), () => undefined);
      }
    });
  }

  nomeDoPlugin(id: string): string {
    return this.pluginsComMcp().find((p) => p.id === id)?.nome ?? id;
  }

  async carregarConexoes(): Promise<void> {
    try {
      const [apps, tokens, itens] = await Promise.all([this.conexoes.autorizados(), this.conexoes.tokens(), this.registro.listar()]);
      this.apps.set(apps);
      this.tokensMcp.set(tokens);
      const comMcp = itens.filter((i) => i.origem === 'plugin' && !!i.mcp);
      this.pluginsComMcp.set(comMcp);
      if (!this.pluginDoToken && comMcp.length) this.pluginDoToken = comMcp[0].id;
    } catch (e) {
      this.erroConexoes.set(mensagemDeErro(e, 'Não foi possível carregar as conexões'));
    }
  }

  async revogarApp(a: AppAutorizado): Promise<void> {
    if (!confirm(`Revogar o acesso de ${a.nome} ao ${this.nomeDoPlugin(a.plugin)}?`)) return;
    try {
      await this.conexoes.revogarApp(a.id);
      await this.carregarConexoes();
    } catch (e) {
      this.erroConexoes.set(mensagemDeErro(e, 'Não foi possível revogar'));
    }
  }

  async gerarToken(): Promise<void> {
    if (!this.pluginDoToken) return;
    try {
      const t = await this.conexoes.criarToken(this.pluginDoToken);
      this.tokenNovo.set({ plugin: t.plugin, token: t.token });
      await this.carregarConexoes();
    } catch (e) {
      this.erroConexoes.set(mensagemDeErro(e, 'Não foi possível gerar o token'));
    }
  }

  async revogarToken(t: TokenMcp): Promise<void> {
    if (!confirm(`Revogar este token do ${this.nomeDoPlugin(t.plugin)}? Quem usa ele perde o acesso em até 1 minuto.`)) return;
    try {
      await this.conexoes.revogarToken(t.id);
      if (this.tokenNovo()?.plugin === t.plugin) this.tokenNovo.set(null);
      await this.carregarConexoes();
    } catch (e) {
      this.erroConexoes.set(mensagemDeErro(e, 'Não foi possível revogar'));
    }
  }

  copiar(texto: string): void {
    void navigator.clipboard?.writeText(texto);
  }

  private carregar(): void {
    this.carregando.set(true);
    this.service.obter().subscribe({
      next: (c) => {
        this.aplicar(c);
        this.carregando.set(false);
      },
      error: (err) => {
        this.carregando.set(false);
        this.erro.set(mensagemDeErro(err, 'Não foi possível carregar as configurações'));
      },
    });
  }

  private aplicar(c: ConfiguracaoIa): void {
    this.config.set(c);
    this.provedor = c.provedor;
    this.provedorSelecionado.set(c.provedor);
    this.modelo = c.modelo ?? '';
    this.modeloAtual.set(c.modelo ?? '');
    this.chave = '';
    this.chaveUpscale = '';
    this.mostrarChave.set(false);
    this.mostrarChaveUpscale.set(false);
  }

  aoMudarProvedor(valor: ProvedorIa): void {
    this.provedor = valor;
    this.provedorSelecionado.set(valor);
    this.teste.set(null);
    this.sucesso.set(null);
  }

  aoMudarModelo(valor: string): void {
    this.modelo = valor;
    this.modeloAtual.set(valor);
    this.teste.set(null);
  }

  usarModeloSugerido(id: string): void {
    this.aoMudarModelo(id);
  }

  salvar(): void {
    if (this.salvando()) return;

    this.salvando.set(true);
    this.erro.set(null);
    this.sucesso.set(null);

    this.service
      .salvar({
        provedor: this.provedor,
        modelo: this.modelo.trim() || null,
        // Campo em branco = manter o que já está salvo.
        chaveApi: this.chave.trim() ? this.chave.trim() : null,
        chaveUpscale: this.chaveUpscale.trim() ? this.chaveUpscale.trim() : null,
      })
      .subscribe({
        next: (c) => {
          this.salvando.set(false);
          this.aplicar(c);
          this.sucesso.set('Configuração salva.');
        },
        error: (err) => {
          this.salvando.set(false);
          this.erro.set(mensagemDeErro(err, 'Não foi possível salvar a configuração'));
        },
      });
  }

  testar(): void {
    if (this.testando()) return;

    this.testando.set(true);
    this.teste.set(null);
    this.erro.set(null);

    this.service
      .testar(this.provedor, this.modelo.trim() || null, this.chave.trim() || null)
      .subscribe({
        next: (r) => {
          this.testando.set(false);
          this.teste.set(r);
        },
        error: (err) => {
          this.testando.set(false);
          this.erro.set(mensagemDeErro(err, 'Não foi possível testar a conexão'));
        },
      });
  }

  pedirRemocaoDaChave(): void {
    this.confirmandoRemocao.set(true);
  }

  cancelarRemocao(): void {
    this.confirmandoRemocao.set(false);
  }

  removerChave(): void {
    this.service.removerChave().subscribe({
      next: (c) => {
        this.confirmandoRemocao.set(false);
        this.aplicar(c);
        this.sucesso.set('Chave removida.');
      },
      error: (err) => {
        this.confirmandoRemocao.set(false);
        this.erro.set(mensagemDeErro(err, 'Não foi possível remover a chave'));
      },
    });
  }

  alternarVisibilidadeDaChave(): void {
    this.mostrarChave.update((v) => !v);
  }

  alternarVisibilidadeDaChaveUpscale(): void {
    this.mostrarChaveUpscale.update((v) => !v);
  }

  pedirRemocaoDaChaveUpscale(): void {
    this.confirmandoRemocaoUpscale.set(true);
  }

  cancelarRemocaoUpscale(): void {
    this.confirmandoRemocaoUpscale.set(false);
  }

  removerChaveUpscale(): void {
    this.service.removerChaveUpscale().subscribe({
      next: (c) => {
        this.confirmandoRemocaoUpscale.set(false);
        this.aplicar(c);
        this.sucesso.set('Chave de ampliação removida.');
      },
      error: (err) => {
        this.confirmandoRemocaoUpscale.set(false);
        this.erro.set(mensagemDeErro(err, 'Não foi possível remover a chave de ampliação'));
      },
    });
  }

  rotuloDoProvedorEfetivo(): string {
    const p = this.config()?.provedorEfetivo;
    switch (p) {
      case 'openrouter': return 'OpenRouter';
      case 'anthropic': return 'Anthropic';
      case 'heuristico': return 'Interpretação local (sem IA)';
      default: return p ?? '—';
    }
  }

  escolherTema(id: string): void {
    this.theme.setPalette(id);
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
