import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { CerebroService, ConfigIa, ModeloSugerido, ProvedorIa, TesteIa } from './cerebro.service';

interface OpcaoProvedor {
  valor: ProvedorIa;
  rotulo: string;
  descricao: string;
}

const PROVEDORES: OpcaoProvedor[] = [
  {
    valor: 'openrouter',
    rotulo: 'OpenRouter',
    descricao: 'Uma chave só para modelos de vários fornecedores (Claude, GPT, Gemini…). É a mesma conta das Finanças.',
  },
  {
    valor: 'anthropic',
    rotulo: 'Anthropic (direto)',
    descricao: 'Chama a API da Anthropic sem intermediário. Precisa de uma chave sk-ant-… do console da Anthropic.',
  },
  {
    valor: '',
    rotulo: 'Padrão do servidor',
    descricao: 'Usa as chaves do .env da VPS: ANTHROPIC_API_KEY e, se não houver, OPENROUTER_API_KEY.',
  },
  {
    valor: 'off',
    rotulo: 'Desligado',
    descricao: 'Nada é enviado para fora. As capturas chegam à Inbox sem sugestão e você escolhe a pasta ao aprovar.',
  },
];

/** Aba "Configurações": provedor, modelo e chave da IA que classifica a Inbox. */
@Component({
  selector: 'app-cerebro-ia',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './cerebro-ia.component.html',
  styleUrls: ['./cerebro-comum.css', './cerebro-ia.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroIaComponent {
  private readonly api = inject(CerebroService);

  /** Avisa a página para atualizar o selo "classificação ligada/desligada". */
  readonly mudou = output<void>();

  readonly provedores = PROVEDORES;
  readonly config = signal<ConfigIa | null>(null);
  readonly erro = signal('');
  readonly aviso = signal('');
  readonly salvando = signal(false);
  readonly testando = signal(false);
  readonly teste = signal<TesteIa | null>(null);

  provedor = signal<ProvedorIa>('openrouter');
  modelo = '';
  chave = '';
  readonly mostrarChave = signal(false);

  readonly modelos = computed<ModeloSugerido[]>(() => {
    const c = this.config();
    if (!c) return [];
    return this.provedor() === 'anthropic' ? c.modelos.anthropic : c.modelos.openrouter;
  });

  readonly pedeChave = computed(() => this.provedor() === 'openrouter' || this.provedor() === 'anthropic');

  readonly placeholderModelo = computed(() => {
    const c = this.config();
    if (!c) return '';
    return this.provedor() === 'anthropic' ? c.servidor.modelo_anthropic : c.servidor.modelo_openrouter;
  });

  /** O servidor já tem chave para o provedor escolhido (vale se a tela não tiver uma). */
  readonly servidorTemChave = computed(() => {
    const c = this.config();
    if (!c) return false;
    return this.provedor() === 'anthropic' ? c.servidor.anthropic : c.servidor.openrouter;
  });

  constructor() {
    void this.carregar();
  }

  async carregar(): Promise<void> {
    try {
      const c = await this.api.configIa();
      this.config.set(c);
      this.provedor.set(c.provedor === '' && !c.servidor.anthropic && !c.servidor.openrouter ? 'openrouter' : c.provedor);
      this.modelo = c.modelo ?? '';
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Carregar a configuração de IA'));
    }
  }

  escolherModelo(id: string): void {
    this.modelo = id;
  }

  /** Chave digitada (null = manter a salva). */
  private chaveDigitada(): string | null {
    return this.chave.trim() ? this.chave.trim() : null;
  }

  async testar(): Promise<void> {
    this.testando.set(true);
    this.teste.set(null);
    this.erro.set('');
    try {
      this.teste.set(await this.api.testarIa(this.provedor(), this.modelo.trim() || null, this.chaveDigitada()));
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Testar a conexão'));
    } finally {
      this.testando.set(false);
    }
  }

  async salvar(): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    this.aviso.set('');
    try {
      this.config.set(await this.api.salvarIa(this.provedor(), this.modelo.trim() || null, this.chaveDigitada()));
      this.chave = '';
      this.mostrarChave.set(false);
      this.aviso.set('Configuração salva. As próximas capturas já usam esta IA.');
      this.mudou.emit();
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Salvar a configuração de IA'));
    } finally {
      this.salvando.set(false);
    }
  }

  async removerChave(): Promise<void> {
    if (!confirm('Remover a chave salva na tela? Se o servidor tiver uma chave no .env, ela volta a valer.')) return;
    this.salvando.set(true);
    try {
      this.config.set(await this.api.salvarIa(this.provedor(), this.modelo.trim() || null, ''));
      this.aviso.set('Chave removida.');
      this.mudou.emit();
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Remover a chave'));
    } finally {
      this.salvando.set(false);
    }
  }

  nomeProvedor(p: string): string {
    switch (p) {
      case 'openrouter': return 'OpenRouter';
      case 'anthropic': return 'Anthropic';
      default: return 'nenhum';
    }
  }
}
