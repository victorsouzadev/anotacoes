import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { mensagemDeErro } from '../../core/erro-http';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon';
import { CerebroMe, CerebroService, ItemInbox, ResultadoBusca } from './cerebro.service';

type Aba = 'inbox' | 'busca' | 'conectar';

/** Enquanto houver captura na fila, a lista se atualiza sozinha neste intervalo. */
const INTERVALO_FILA_MS = 5000;

@Component({
  selector: 'app-cerebro-page',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, DatePipe],
  templateUrl: './cerebro.page.html',
  styleUrl: './cerebro.page.css',
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

  termo = '';
  readonly resultados = signal<ResultadoBusca[] | null>(null);
  readonly buscando = signal(false);

  readonly naFila = computed(() => this.itens().some((i) => i.capture_status === 'queued' || i.capture_status === 'processing'));
  readonly origem = location.origin;

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
    await this.decidir(item, () => this.api.aprovar(item.path, pasta), `Movido para ${pasta}.`);
  }

  async rejeitar(item: ItemInbox): Promise<void> {
    await this.decidir(item, () => this.api.rejeitar(item.path), 'Rejeitado (foi para 90-Arquivo/Inbox rejeitada).');
  }

  private async decidir(item: ItemInbox, acao: () => Promise<unknown>, ok: string): Promise<void> {
    this.ocupado.set(item.path);
    this.erro.set('');
    try {
      await acao();
      this.itens.update((l) => l.filter((i) => i.path !== item.path));
      this.aviso.set(ok);
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Decidir o item'));
    } finally {
      this.ocupado.set(null);
    }
  }

  async buscar(): Promise<void> {
    this.buscando.set(true);
    try {
      this.resultados.set(await this.api.buscar(this.termo.trim()));
      this.erro.set('');
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Buscar no vault'));
    } finally {
      this.buscando.set(false);
    }
  }

  /** O FTS5 marca o trecho achado com **; vira <mark> sem passar HTML do vault adiante. */
  trechos(snippet: string): { texto: string; marcado: boolean }[] {
    return snippet.split('**').map((texto, i) => ({ texto, marcado: i % 2 === 1 }));
  }

  rotuloFila(item: ItemInbox): string {
    switch (item.capture_status) {
      case 'queued': return 'Na fila';
      case 'processing': return 'Classificando…';
      case 'error': return 'Erro';
      default: return item.suggested_folder ? 'Pronto para revisar' : 'Sem sugestão';
    }
  }

  copiar(texto: string): void {
    void navigator.clipboard?.writeText(texto);
    this.aviso.set('Copiado.');
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
