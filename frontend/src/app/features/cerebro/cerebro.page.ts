import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { mensagemDeErro } from '../../core/erro-http';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { CerebroMe, CerebroService, ItemInbox } from './cerebro.service';
import { CerebroConectarComponent } from './cerebro-conectar.component';
import { CerebroIaComponent } from './cerebro-ia.component';
import { CerebroNotasComponent } from './cerebro-notas.component';
import { CerebroHistoricoComponent } from './cerebro-historico.component';
import { CerebroAppsComponent } from './cerebro-apps.component';

type Aba = 'inbox' | 'notas' | 'historico' | 'conectar' | 'config';

/** Enquanto houver captura na fila, a lista se atualiza sozinha neste intervalo. */
const INTERVALO_FILA_MS = 5000;

@Component({
  selector: 'app-cerebro-page',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, DatePipe, CerebroConectarComponent, CerebroIaComponent, CerebroNotasComponent, CerebroHistoricoComponent, CerebroAppsComponent],
  templateUrl: './cerebro.page.html',
  styleUrls: ['./cerebro-comum.css', './cerebro.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroPageComponent {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  private readonly api = inject(CerebroService);

  /** null = carregando; false = sem acesso ou fora do ar. */
  readonly me = signal<CerebroMe | null | false>(null);
  readonly motivo = signal('');
  readonly aba = signal<Aba>('inbox');

  readonly itens = signal<ItemInbox[]>([]);
  readonly carregandoInbox = signal(false);
  readonly erro = signal('');
  readonly aviso = signal('');
  /** Pasta escolhida por item (path → pasta); vazio = a sugerida. */
  readonly pastas = signal<Record<string, string>>({});
  readonly ocupado = signal<string | null>(null);

  texto = '';
  link = '';
  tags = '';
  readonly enviando = signal(false);

  /** Nota que a aba Notas deve abrir (ex.: logo depois de aprovar). */
  readonly notaParaAbrir = signal<string | null>(null);
  /** Caminho da última nota aprovada, para o link "Ver nota". */
  readonly ultimaAprovada = signal<string | null>(null);

  readonly naFila = computed(() => this.itens().some((i) => i.capture_status === 'queued' || i.capture_status === 'processing'));

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    void this.iniciar();
  }

  private async iniciar(): Promise<void> {
    try {
      this.me.set(await this.api.me());
      await this.carregarInbox();
    } catch (err) {
      this.me.set(false);
      this.motivo.set(location.protocol !== 'https:'
        ? 'O Segundo Cérebro só responde pelo endereço HTTPS do hub (o subdomínio configurado no nginx-proxy-manager).'
        : mensagemDeErro(err, 'Abrir o Segundo Cérebro'));
    }
  }

  async carregarInbox(): Promise<void> {
    clearTimeout(this.timer);
    this.carregandoInbox.set(true);
    try {
      this.itens.set(await this.api.inbox());
      this.erro.set('');
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Carregar a Inbox'));
    } finally {
      this.carregandoInbox.set(false);
    }
    if (this.naFila()) this.timer = setTimeout(() => void this.carregarInbox(), INTERVALO_FILA_MS);
  }

  /** A aba Configurações mudou a IA: atualiza o aviso de classificação. */
  async recarregarMe(): Promise<void> {
    try {
      this.me.set(await this.api.me());
    } catch {
      /* mantém o que já estava na tela */
    }
  }

  readonly classificacaoLigada = computed(() => {
    const m = this.me();
    return !!m && m.classificacao;
  });

  async reclassificar(item: ItemInbox): Promise<void> {
    await this.decidir(item, () => this.api.reclassificar(item.path), 'Voltou para a fila de classificação.', false);
    await this.carregarInbox();
  }

  async capturar(): Promise<void> {
    if (!this.texto.trim() && !this.link.trim()) return;
    this.enviando.set(true);
    this.aviso.set('');
    try {
      const tags = this.tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
      await this.api.capturar(this.texto.trim(), this.link.trim(), tags);
      this.texto = '';
      this.link = '';
      this.tags = '';
      this.aviso.set('Salvo na Inbox.');
      await this.carregarInbox();
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Salvar na Inbox'));
    } finally {
      this.enviando.set(false);
    }
  }

  pastaDe(item: ItemInbox): string {
    return this.pastas()[item.path] ?? item.suggested_folder ?? '';
  }

  escolherPasta(item: ItemInbox, pasta: string): void {
    this.pastas.update((p) => ({ ...p, [item.path]: pasta }));
  }

  async aprovar(item: ItemInbox): Promise<void> {
    const pasta = this.pastaDe(item);
    if (!pasta) {
      this.erro.set('Escolha a pasta de destino antes de aprovar.');
      return;
    }
    this.ultimaAprovada.set(null);
    await this.decidir(item, async () => {
      const r = await this.api.aprovar(item.path, pasta);
      this.ultimaAprovada.set(r.path);
    }, `Aprovada e movida para ${pasta}.`);
  }

  verNota(path: string): void {
    this.notaParaAbrir.set(null);
    this.aba.set('notas');
    // Sinal novo a cada clique: a aba reage mesmo se for a mesma nota.
    queueMicrotask(() => this.notaParaAbrir.set(path));
  }

  async rejeitar(item: ItemInbox): Promise<void> {
    this.ultimaAprovada.set(null);
    await this.decidir(item, () => this.api.rejeitar(item.path), 'Rejeitado (foi para 90-Arquivo/Inbox rejeitada).');
  }

  private async decidir(item: ItemInbox, acao: () => Promise<unknown>, ok: string, sai = true): Promise<void> {
    this.ocupado.set(item.path);
    this.erro.set('');
    try {
      await acao();
      if (sai) this.itens.update((l) => l.filter((i) => i.path !== item.path));
      this.aviso.set(ok);
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Decidir o item'));
    } finally {
      this.ocupado.set(null);
    }
  }

  rotuloFila(item: ItemInbox): string {
    switch (item.capture_status) {
      case 'queued': return 'Na fila';
      case 'processing': return 'Classificando…';
      case 'error': return 'Erro';
      default: return item.suggested_folder ? 'Pronto para revisar' : 'Sem sugestão';
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
