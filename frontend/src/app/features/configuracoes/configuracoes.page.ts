import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import {
  ConfiguracaoIa,
  PROVEDORES,
  ProvedorIa,
  TesteConexao,
} from './configuracao-ia.model';
import { ConfiguracaoIaService } from './configuracao-ia.service';
import { mensagemDeErro } from '../../core/erro-http';

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

  readonly config = signal<ConfiguracaoIa | null>(null);
  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly testando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly sucesso = signal<string | null>(null);
  readonly teste = signal<TesteConexao | null>(null);
  readonly confirmandoRemocao = signal(false);
  readonly mostrarChave = signal(false);

  // Campos do formulário.
  provedor: ProvedorIa = '';
  modelo = '';
  /** Vazio significa "não mexer na chave salva" — o cliente nunca a recebe. */
  chave = '';

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
    this.mostrarChave.set(false);
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

  rotuloDoProvedorEfetivo(): string {
    const p = this.config()?.provedorEfetivo;
    switch (p) {
      case 'openrouter': return 'OpenRouter';
      case 'anthropic': return 'Anthropic';
      case 'heuristico': return 'Interpretação local (sem IA)';
      default: return p ?? '—';
    }
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
