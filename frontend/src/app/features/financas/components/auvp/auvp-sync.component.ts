import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../shared/icon';
import { AuvpConfiguracao, AuvpService, AuvpSincronizacao } from '../../services/auvp.service';

// Importação das transações do open banking via AUVP Financeiro. Some da tela
// quando o servidor não tem a integração configurada.
@Component({
  selector: 'app-auvp-sync',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './auvp-sync.component.html',
  styleUrl: './auvp-sync.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuvpSyncComponent {
  private readonly auvp = inject(AuvpService);

  readonly sincronizado = output<void>();

  readonly config = signal<AuvpConfiguracao | null>(null);
  readonly chave = signal('');
  readonly ocupado = signal(false);
  readonly erro = signal<string | null>(null);
  readonly resultado = signal<AuvpSincronizacao | null>(null);
  readonly editandoChave = signal(false);

  constructor() {
    this.auvp.obter().subscribe({ next: (c) => this.config.set(c), error: () => this.config.set(null) });
  }

  salvarChave(): void {
    const chave = this.chave().trim();
    if (!chave) return;
    this.ocupado.set(true);
    this.erro.set(null);
    this.auvp.salvarChave(chave).subscribe({
      next: (c) => {
        this.config.set(c);
        this.chave.set('');
        this.editandoChave.set(false);
        this.ocupado.set(false);
      },
      error: (err) => this.falhar(err),
    });
  }

  removerChave(): void {
    if (!confirm('Remover a chave da AUVP? Os lançamentos já importados continuam aqui.')) return;
    this.auvp.removerChave().subscribe({ next: (c) => this.config.set(c), error: (err) => this.falhar(err) });
  }

  sincronizar(): void {
    this.ocupado.set(true);
    this.erro.set(null);
    this.resultado.set(null);
    this.auvp.sincronizar().subscribe({
      next: (r) => {
        this.resultado.set(r);
        this.config.update((c) => (c ? { ...c, ultimaSincronizacaoEm: r.sincronizadoEm } : c));
        this.ocupado.set(false);
        if (r.importadas > 0) this.sincronizado.emit();
      },
      error: (err) => this.falhar(err),
    });
  }

  quando(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  private falhar(err: { status?: number; error?: { erro?: string; detail?: string } }): void {
    this.ocupado.set(false);
    this.erro.set(
      err?.error?.erro ??
        err?.error?.detail ??
        (err?.status === 429 ? 'Muitas sincronizações seguidas. Espere um minuto.' : 'Não foi possível falar com a AUVP.'),
    );
  }
}
