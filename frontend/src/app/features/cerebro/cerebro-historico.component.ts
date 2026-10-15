import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { CerebroService, OrigemVersao, Versao } from './cerebro.service';

const POR_PAGINA = 30;

/**
 * Aba "Histórico": o log do Cérebro. Cada versão diz quando, quem (você pela tela, o Claude pelo MCP,
 * o Obsidian pelo sync, ou o próprio Cérebro) e o que mudou. Dá para abrir as notas e voltar o
 * Cérebro inteiro para um ponto.
 */
@Component({
  selector: 'app-cerebro-historico',
  standalone: true,
  imports: [IconComponent, DatePipe],
  templateUrl: './cerebro-historico.component.html',
  styleUrls: ['./cerebro-comum.css', './cerebro-historico.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroHistoricoComponent {
  private readonly api = inject(CerebroService);

  /** Pede para a página abrir uma nota na aba Notas. */
  readonly abrir = output<string>();

  readonly versoes = signal<Versao[]>([]);
  readonly disponivel = signal(true);
  readonly temMais = signal(false);
  readonly carregando = signal(false);
  readonly restaurando = signal(false);
  readonly erro = signal('');
  readonly aviso = signal('');
  readonly filtro = signal<OrigemVersao | 'todas'>('todas');

  constructor() {
    void this.carregar(true);
  }

  async carregar(doZero: boolean): Promise<void> {
    this.carregando.set(true);
    try {
      const pular = doZero ? 0 : this.versoes().length;
      const h = await this.api.historico(null, pular, POR_PAGINA);
      this.disponivel.set(h.disponivel);
      this.versoes.set(doZero ? h.versoes : [...this.versoes(), ...h.versoes]);
      this.temMais.set(h.versoes.length === POR_PAGINA);
      this.erro.set('');
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Carregar o histórico'));
    } finally {
      this.carregando.set(false);
    }
  }

  visiveis(): Versao[] {
    const f = this.filtro();
    return f === 'todas' ? this.versoes() : this.versoes().filter((v) => v.origem === f);
  }

  rotuloOrigem(o: string): string {
    switch (o) {
      case 'tela': return 'Você (tela)';
      case 'claude': return 'Claude (MCP)';
      case 'obsidian': return 'Obsidian (sync)';
      default: return 'Cérebro';
    }
  }

  rotuloStatus(s: string): string {
    switch (s) {
      case 'A': return 'criada';
      case 'D': return 'removida';
      case 'R': return 'renomeada';
      default: return 'alterada';
    }
  }

  notas(v: Versao): { status: string; path: string }[] {
    return v.arquivos.filter((a) => a.path.endsWith('.md'));
  }

  async restaurarCerebro(v: Versao): Promise<void> {
    const quando = new Date(v.data).toLocaleString('pt-BR');
    if (!confirm(`Voltar o Cérebro inteiro para ${quando}?\n\n• Notas alteradas ou apagadas depois disso voltam ao conteúdo daquele momento.\n• Notas criadas depois vão para a lixeira (_sistema/lixeira).\n• O estado atual fica salvo no histórico, então isso também pode ser desfeito.`)) return;
    if (!confirm('Confirma a restauração do Cérebro inteiro?')) return;
    this.restaurando.set(true);
    try {
      const r = await this.api.restaurarCerebro(v.versao);
      this.aviso.set(`Cérebro restaurado para ${quando}: ${r.restored} notas voltaram, ${r.trashed} foram para a lixeira.`);
      await this.carregar(true);
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Restaurar o Cérebro'));
    } finally {
      this.restaurando.set(false);
    }
  }
}
