import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { AppsSync, CerebroService } from './cerebro.service';

/**
 * Configurações → "Apps do hub": a rotina que busca dados de Tarefas, Finanças e Publicar/Imagens
 * pelos MCPs deles e grava um resumo de cada um em _sistema/apps.
 */
@Component({
  selector: 'app-cerebro-apps',
  standalone: true,
  imports: [FormsModule, IconComponent, DatePipe],
  templateUrl: './cerebro-apps.component.html',
  styleUrls: ['./cerebro-comum.css', './cerebro-apps.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroAppsComponent {
  private readonly api = inject(CerebroService);

  readonly config = signal<AppsSync | null>(null);
  readonly erro = signal('');
  readonly aviso = signal('');
  readonly salvando = signal(false);
  readonly sincronizando = signal(false);

  ativo = true;
  horarios: string[] = [];
  appsAtivos: Record<string, boolean> = {};
  novoHorario = '';

  constructor() {
    void this.carregar();
  }

  private aplicar(c: AppsSync): void {
    this.config.set(c);
    this.ativo = c.ativo;
    this.horarios = [...c.horarios];
    this.appsAtivos = Object.fromEntries(c.apps.map((a) => [a.id, a.ativo]));
  }

  async carregar(): Promise<void> {
    try {
      this.aplicar(await this.api.appsSync());
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Carregar a rotina dos apps'));
    }
  }

  adicionarHorario(): void {
    const h = this.novoHorario.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) {
      this.erro.set('Use o formato HH:mm, por exemplo 08:00.');
      return;
    }
    if (!this.horarios.includes(h)) this.horarios = [...this.horarios, h].sort();
    this.novoHorario = '';
    this.erro.set('');
  }

  removerHorario(h: string): void {
    this.horarios = this.horarios.filter((x) => x !== h);
  }

  async salvar(): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    try {
      const apps = Object.entries(this.appsAtivos).filter(([, on]) => on).map(([id]) => id);
      this.aplicar(await this.api.salvarAppsSync(this.ativo, this.horarios, apps));
      this.aviso.set('Rotina salva.');
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Salvar a rotina'));
    } finally {
      this.salvando.set(false);
    }
  }

  async sincronizarAgora(): Promise<void> {
    this.sincronizando.set(true);
    this.erro.set('');
    this.aviso.set('');
    try {
      this.aplicar(await this.api.sincronizarApps());
      const r = this.config()?.ultima?.resultados ?? [];
      this.aviso.set(`Sincronizado: ${r.filter((x) => x.ok).length} de ${r.length} apps.`);
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Sincronizar os apps'));
    } finally {
      this.sincronizando.set(false);
    }
  }

  nome(id: string): string {
    return this.config()?.apps.find((a) => a.id === id)?.nome ?? id;
  }
}
