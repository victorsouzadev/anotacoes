import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { IconComponent } from '../../../shared/icon';
import { Job, Midia, dolares } from '../estudio.models';
import { MidiaCardComponent } from './midia';

/** Uma geração no histórico: andamento, custo estimado, erro ou os arquivos que voltaram. */
@Component({
  selector: 'e-job-card',
  standalone: true,
  imports: [IconComponent, MidiaCardComponent, DatePipe],
  template: `
    <article class="jc" [class.jc-erro]="job.status === 'falhou'">
      <header class="jc-topo">
        <span class="jc-status" [attr.data-s]="job.status">{{ rotuloStatus() }}</span>
        <span class="jc-modelo">{{ job.modeloNome ?? job.modeloId }}</span>
        <span class="jc-espaco"></span>
        @if (job.provedor !== 'local') { <span class="jc-custo" title="Custo estimado">{{ custo() }}</span> }
        <span class="jc-data">{{ job.criadoEm | date: 'dd/MM HH:mm' }}</span>
      </header>
      @if (prompt()) { <p class="jc-prompt" [title]="prompt()">{{ prompt() }}</p> }
      @if (ativo()) {
        <div class="jc-andamento"><span class="jc-barra"></span><span>{{ job.mensagem }}</span></div>
      }
      @if (job.status === 'falhou') { <p class="jc-msg-erro">{{ job.erro }}</p> }
      @if (job.resultado.length) {
        <div class="jc-res">
          @for (m of job.resultado; track m.id) { <e-midia-card [midia]="m" (escolher)="abrir.emit($event)" /> }
        </div>
      }
      <footer class="jc-acoes">
        @if (ativo()) { <button type="button" class="jc-link" (click)="cancelar.emit(job)"><app-icon name="stop" [size]="12" /> Cancelar</button> }
        @if (!ativo()) { <button type="button" class="jc-link" (click)="repetir.emit(job)"><app-icon name="refresh" [size]="12" /> Usar estes ajustes</button> }
        @if (job.linkExterno) { <a class="jc-link" [href]="job.linkExterno" target="_blank" rel="noopener"><app-icon name="external" [size]="12" /> Abrir no site</a> }
        @if (!ativo()) { <button type="button" class="jc-link" (click)="ocultar.emit(job)"><app-icon name="x" [size]="12" /> Tirar do histórico</button> }
      </footer>
    </article>
  `,
  styles: [`
    .jc { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    .jc-erro { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
    .jc-topo { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
    .jc-status { padding: 2px 8px; border-radius: 999px; font-weight: 700; background: var(--tag-bg); color: var(--tag-text); }
    .jc-status[data-s="concluido"] { background: color-mix(in srgb, var(--positivo) 15%, transparent); color: var(--positivo); }
    .jc-status[data-s="falhou"] { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    .jc-status[data-s="rodando"], .jc-status[data-s="fila"] { background: var(--accent-soft); color: var(--accent-dark); }
    .jc-modelo { font-weight: 600; }
    .jc-espaco { flex: 1; }
    .jc-custo, .jc-data { color: var(--text-muted); }
    .jc-prompt { margin: 0; font-size: 13px; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .jc-andamento { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-muted); }
    .jc-barra { width: 60px; height: 4px; border-radius: 2px; background: var(--accent-soft); position: relative; overflow: hidden; flex-shrink: 0; }
    .jc-barra::after { content: ''; position: absolute; inset: 0; width: 40%; background: var(--accent); border-radius: 2px; animation: jc-anda 1.2s ease-in-out infinite; }
    @keyframes jc-anda { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
    .jc-msg-erro { margin: 0; font-size: 12.5px; color: var(--danger); white-space: pre-wrap; }
    .jc-res { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
    .jc-acoes { display: flex; gap: 12px; flex-wrap: wrap; }
    .jc-link { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; padding: 0; color: var(--text-muted); font-size: 12px; font-weight: 600; text-decoration: none; }
    .jc-link:hover { color: var(--accent); }
  `],
})
export class JobCardComponent {
  @Input({ required: true }) job!: Job;
  @Output() abrir = new EventEmitter<Midia>();
  @Output() cancelar = new EventEmitter<Job>();
  @Output() repetir = new EventEmitter<Job>();
  @Output() ocultar = new EventEmitter<Job>();

  ativo(): boolean {
    return this.job.status === 'fila' || this.job.status === 'rodando';
  }

  custo(): string {
    return '~' + dolares(this.job.custoEstimadoCentavos);
  }

  prompt(): string {
    const p = this.job.parametros['prompt'];
    return typeof p === 'string' ? p : '';
  }

  rotuloStatus(): string {
    return { fila: 'Na fila', rodando: 'Gerando', concluido: 'Pronto', falhou: 'Falhou', cancelado: 'Cancelado' }[this.job.status];
  }
}
