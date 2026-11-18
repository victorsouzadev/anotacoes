import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { mensagemDeErro } from '../../core/erro-http';
import { CerebroService, EstadoBuscaSemantica } from './cerebro.service';

/** Configurações → "Busca por significado" (spec 027). Desligada por padrão: indexar custa por uso. */
@Component({
  selector: 'app-cerebro-busca-semantica',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (estado(); as e) {
      <section class="card">
        <h2>Busca por significado</h2>
        <p class="ajuda">
          Além das palavras, a busca (na tela, no MCP e nas sugestões de links da Inbox) passa a achar notas pelo sentido:
          "gastos com o carro" encontra a nota "Revisão do Gol". Cada trecho das notas vira um vetor no servidor
          (<code>{{ e.modelo }}</code>), recalculado só quando a nota muda.
        </p>
        @if (!e.disponivel) {
          <p class="alerta erro">Precisa de uma chave da OpenAI: cadastre em Transcrição de áudio (serviço OpenAI) ou defina
            <code>CEREBRO_EMBEDDINGS_API_KEY</code> no servidor.</p>
        } @else {
          <p class="alerta">Custo estimado para indexar o vault hoje: ~{{ milhar(e.estimativa.tokens) }} tokens, cerca de
            US$ {{ e.estimativa.custo_usd }}. Depois, só as notas alteradas. Chave: {{ e.origem_chave === 'servidor' ? 'do servidor' : 'a da transcrição' }}.</p>
        }
        <label class="opcao" [class.marcada]="e.ligado">
          <input type="checkbox" [checked]="e.ligado" (change)="alternar($any($event.target).checked)" [disabled]="salvando() || (!e.disponivel && !e.ligado)" />
          <span><strong>{{ e.ligado ? 'Ligada' : 'Desligada' }}</strong>
            @if (e.ligado) { <small>Indexadas: {{ e.progresso.feitas }} de {{ e.progresso.total }} notas.</small> }</span>
        </label>
        @if (erro(); as m) { <p class="alerta erro">{{ m }}</p> }
      </section>
    }
  `,
  styleUrls: ['./cerebro-comum.css', './cerebro-ia.component.css'],
})
export class CerebroBuscaSemanticaComponent implements OnInit, OnDestroy {
  private api = inject(CerebroService);
  readonly estado = signal<EstadoBuscaSemantica | null>(null);
  readonly salvando = signal(false);
  readonly erro = signal('');
  private timer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    await this.carregar();
    // Enquanto indexa, atualiza o progresso.
    this.timer = setInterval(() => {
      const e = this.estado();
      if (e?.ligado && e.progresso.feitas < e.progresso.total) void this.carregar();
    }, 5000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  milhar(n: number): string {
    return n.toLocaleString('pt-BR');
  }

  private async carregar(): Promise<void> {
    try { this.estado.set(await this.api.buscaSemantica()); } catch (e) { this.erro.set(mensagemDeErro(e, 'Não foi possível carregar.')); }
  }

  async alternar(ligado: boolean): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    try { this.estado.set(await this.api.salvarBuscaSemantica(ligado)); }
    catch (e) { this.erro.set(mensagemDeErro(e, 'Não foi possível salvar.')); }
    finally { this.salvando.set(false); }
  }
}
