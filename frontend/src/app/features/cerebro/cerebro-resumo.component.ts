import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { CerebroService, ResumoAnalitico } from './cerebro.service';

/**
 * Aba "Resumo": análise do Cérebro feita pela IA. O servidor escolhe sozinho (sem IA) o que é mais
 * relevante e manda só trechos, numa chamada só; o último resumo fica guardado e só é refeito no botão.
 */
@Component({
  selector: 'app-cerebro-resumo',
  standalone: true,
  imports: [IconComponent, DatePipe, FormsModule],
  templateUrl: './cerebro-resumo.component.html',
  styleUrls: ['./cerebro-comum.css', './cerebro-resumo.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroResumoComponent {
  private readonly api = inject(CerebroService);

  /** Pede para a página abrir uma nota na aba Notas. */
  readonly abrir = output<string>();

  readonly resumo = signal<ResumoAnalitico | null>(null);
  readonly carregando = signal(true);
  readonly gerando = signal(false);
  readonly erro = signal('');

  dias = 14;
  salvar = false;

  constructor() {
    void this.carregar();
  }

  private async carregar(): Promise<void> {
    try {
      const r = await this.api.resumo();
      this.resumo.set(r.resumo);
      if (r.resumo) this.dias = r.resumo.dias;
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Carregar o resumo'));
    } finally {
      this.carregando.set(false);
    }
  }

  async gerar(): Promise<void> {
    this.gerando.set(true);
    this.erro.set('');
    try {
      const r = await this.api.gerarResumo(this.dias, this.salvar);
      this.resumo.set(r.resumo);
    } catch (err) {
      this.erro.set(mensagemDeErro(err, 'Gerar o resumo'));
    } finally {
      this.gerando.set(false);
    }
  }

  /** ~4 caracteres por token em português: só uma ideia de custo. */
  tokens(r: ResumoAnalitico): number {
    return Math.round(r.caracteres_enviados / 4 / 100) * 100;
  }
}
