import { Component, EventEmitter, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { EstudioService } from '../estudio.service';
import { Job, Midia, Valor } from '../estudio.models';
import { ESTUDIO_CSS } from './estilos';
import { ConfigForm, FormGeracaoComponent } from './form-geracao';
import { JobCardComponent } from './job-card';

/**
 * Gerar sem sair da tela (storyboard, moodboard, palco): o formulário numa janela, que acompanha a
 * geração e devolve os arquivos quando ficam prontos.
 */
@Component({
  selector: 'e-gerar-modal',
  standalone: true,
  imports: [IconComponent, FormGeracaoComponent, JobCardComponent],
  template: `
    <div class="gm-fundo" (click)="fechar.emit()">
      <div class="gm-caixa e-card" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <header class="gm-topo">
          <strong>{{ titulo }}</strong>
          <button type="button" class="e-ib" (click)="fechar.emit()" aria-label="Fechar"><app-icon name="x" [size]="15" /></button>
        </header>
        <div class="gm-corpo">
          @if (job(); as j) {
            <e-job-card [job]="j" (abrir)="escolher([$event])" (cancelar)="cancelar(j)" />
            @if (j.status === 'concluido' && j.resultado.length > 1) { <p class="e-muted">Clique no resultado que quer usar.</p> }
            @if (j.status === 'falhou' || j.status === 'cancelado') { <button type="button" class="e-btn" (click)="job.set(null)">Tentar de novo</button> }
          } @else {
            <e-form-geracao [config]="config" [entradasIniciais]="entradasIniciais" [parametrosIniciais]="parametrosIniciais" [opInicial]="opInicial"
              [appHistorico]="appHistorico" [antesDeGerar]="antesDeGerar" (gerado)="acompanhar($event)" />
          }
        </div>
      </div>
    </div>
  `,
  styles: [ESTUDIO_CSS, `
    .gm-fundo { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .gm-caixa { width: min(520px, 100%); max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg); }
    .gm-topo { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .gm-corpo { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
  `],
})
export class GerarModalComponent implements OnDestroy {
  private readonly api = inject(EstudioService);
  @Input({ required: true }) config!: ConfigForm;
  @Input() titulo = 'Gerar';
  @Input() entradasIniciais: Record<string, Midia[]> = {};
  @Input() parametrosIniciais: Record<string, Valor> = {};
  @Input() opInicial: string | null = null;
  @Input() appHistorico: string | null = null;
  @Input() antesDeGerar?: FormGeracaoComponent['antesDeGerar'];
  @Output() concluido = new EventEmitter<Midia[]>();
  @Output() fechar = new EventEmitter<void>();

  readonly job = signal<Job | null>(null);
  private readonly parar = new AbortController();

  ngOnDestroy(): void {
    this.parar.abort();
  }

  async acompanhar(j: Job): Promise<void> {
    this.job.set(j);
    try {
      const fim = await this.api.aguardar(j.id, (x) => this.job.set(x), this.parar.signal);
      if (fim.status === 'concluido' && fim.resultado.length === 1) this.escolher(fim.resultado);
    } catch { /* janela fechada */ }
  }

  escolher(m: Midia[]): void {
    this.concluido.emit(m);
  }

  async cancelar(j: Job): Promise<void> {
    this.job.set(await this.api.cancelar(j.id));
  }
}
