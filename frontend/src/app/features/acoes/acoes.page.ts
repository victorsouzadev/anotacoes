import { Component, OnInit, computed, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent } from '../../shared/icon';
import { AcoesService, Carteira, Operacao, TipoOperacao } from './acoes.service';

/** Carteira de ações da B3: registra compras e vendas e mostra posição, preço médio e resultado. */
@Component({
  selector: 'app-acoes-page',
  standalone: true,
  imports: [RouterLink, IconComponent, FormsModule, DecimalPipe, DatePipe],
  templateUrl: './acoes.page.html',
  styleUrl: './acoes.page.css',
})
export class AcoesPageComponent implements OnInit {
  readonly carteira = signal<Carteira | null>(null);
  readonly operacoes = signal<Operacao[]>([]);
  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly abertas = computed(() => this.carteira()?.posicoes.filter((p) => p.quantidade > 0) ?? []);
  readonly encerradas = computed(() => this.carteira()?.posicoes.filter((p) => p.quantidade === 0) ?? []);

  ticker = '';
  tipo: TipoOperacao = 'compra';
  quantidade: number | null = null;
  preco: number | null = null;
  taxas: number | null = null;
  data = new Date().toLocaleDateString('sv-SE');
  observacoes = '';

  constructor(
    readonly auth: AuthService,
    readonly theme: ThemeService,
    private api: AcoesService,
  ) {}

  ngOnInit(): void {
    void this.recarregar();
  }

  async recarregar(): Promise<void> {
    this.carregando.set(true);
    try {
      const [carteira, operacoes] = await Promise.all([this.api.carteira(), this.api.operacoes()]);
      this.carteira.set(carteira);
      this.operacoes.set(operacoes);
    } catch {
      this.erro.set('Não foi possível carregar a carteira.');
    } finally {
      this.carregando.set(false);
    }
  }

  async registrar(): Promise<void> {
    if (!this.ticker.trim() || !this.quantidade || !this.preco || !this.data) {
      this.erro.set('Preencha código, quantidade, preço e data.');
      return;
    }
    this.salvando.set(true);
    this.erro.set(null);
    try {
      await this.api.registrar({
        ticker: this.ticker.trim().toUpperCase(),
        tipo: this.tipo,
        quantidade: this.quantidade,
        precoUnitario: this.preco,
        taxas: this.taxas,
        data: this.data,
        observacoes: this.observacoes.trim() || null,
      });
      this.ticker = '';
      this.quantidade = this.preco = this.taxas = null;
      this.observacoes = '';
      await this.recarregar();
    } catch (e) {
      this.erro.set(e instanceof HttpErrorResponse && e.error?.erro ? e.error.erro : 'Não foi possível registrar a operação.');
    } finally {
      this.salvando.set(false);
    }
  }

  async remover(op: Operacao): Promise<void> {
    if (!confirm(`Excluir a ${op.tipo} de ${op.quantidade} ${op.ticker}?`)) return;
    await this.api.remover(op.id);
    await this.recarregar();
  }

  /** Classe de cor para valores de resultado. */
  sinal(v: number | null | undefined): string {
    if (v == null || v === 0) return '';
    return v > 0 ? 'positivo' : 'negativo';
  }

  themeIconName(): 'sun' | 'moon' | 'monitor' {
    const pref = this.theme.pref();
    if (pref === 'light') return 'sun';
    if (pref === 'dark') return 'moon';
    return 'monitor';
  }
}
