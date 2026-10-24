import { DestroyRef, inject, signal } from '@angular/core';
import { EstudioService } from '../estudio.service';
import { Job } from '../estudio.models';

/**
 * Histórico de gerações de uma tela, que se atualiza sozinho enquanto há geração na fila ou
 * rodando (consulta a cada 3 s só as ativas) e para quando a tela fecha.
 */
export class HistoricoGeracoes {
  private readonly api: EstudioService;
  readonly jobs = signal<Job[]>([]);
  readonly carregando = signal(false);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly app: string | null, api?: EstudioService, destroy?: DestroyRef) {
    this.api = api ?? inject(EstudioService);
    (destroy ?? inject(DestroyRef)).onDestroy(() => this.parar());
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      this.jobs.set(await this.api.geracoes({ app: this.app ?? undefined, limite: 40 }));
      this.vigiar();
    } finally {
      this.carregando.set(false);
    }
  }

  adicionar(job: Job): void {
    this.jobs.update((l) => [job, ...l.filter((j) => j.id !== job.id)]);
    this.vigiar();
  }

  async cancelar(job: Job): Promise<void> {
    this.trocar(await this.api.cancelar(job.id));
  }

  async ocultar(job: Job): Promise<void> {
    await this.api.ocultar(job.id);
    this.jobs.update((l) => l.filter((j) => j.id !== job.id));
  }

  private trocar(job: Job): void {
    this.jobs.update((l) => l.map((j) => (j.id === job.id ? job : j)));
  }

  private ativos(): Job[] {
    return this.jobs().filter((j) => j.status === 'fila' || j.status === 'rodando');
  }

  private vigiar(): void {
    if (this.timer || this.ativos().length === 0) return;
    this.timer = setInterval(async () => {
      const ativos = this.ativos();
      if (ativos.length === 0) {
        this.parar();
        return;
      }
      for (const j of ativos) {
        try {
          const novo = await this.api.geracao(j.id);
          if (novo.status === 'concluido' && j.status !== 'concluido') this.api.versaoBiblioteca.update((v) => v + 1);
          this.trocar(novo);
        } catch { /* rede oscilando: tenta na próxima volta */ }
      }
    }, 3000);
  }

  private parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
