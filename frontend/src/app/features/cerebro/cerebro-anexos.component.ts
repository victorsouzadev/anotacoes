import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { mensagemDeErro } from '../../core/erro-http';
import { CerebroService } from './cerebro.service';

/** Configurações → "Ler texto de PDFs e imagens" (spec 026). Desligado por padrão: custa por uso. */
@Component({
  selector: 'app-cerebro-anexos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (estado(); as e) {
      <section class="card">
        <h2>Ler texto de PDFs e imagens</h2>
        <p class="ajuda">
          Fotos (de um quadro, recibo, cartão) e PDFs de até 20 páginas e 10 MB anexados às capturas têm o texto transcrito
          pela mesma IA da Inbox e entram na nota em <code>## Texto extraído</code> — aí a busca, a classificação e o MCP
          passam a enxergar o conteúdo. O arquivo original não muda.
        </p>
        <p class="alerta">Custa por uso: cada anexo lido é uma chamada à IA com o arquivo inteiro (PDFs grandes custam mais).
          Nem todo modelo da OpenRouter lê PDF; quando não lê, a nota registra o motivo.</p>
        @if (!e.ia) { <p class="alerta erro">Configure um provedor de IA (seção acima) para usar a leitura.</p> }
        <label class="opcao" [class.marcada]="e.ligado">
          <input type="checkbox" [checked]="e.ligado" (change)="alternar($any($event.target).checked)" [disabled]="salvando()" />
          <span><strong>{{ e.ligado ? 'Ligado' : 'Desligado' }}</strong>
            <small>Vale para as próximas capturas. Para um item que já está na Inbox, use "Reclassificar".</small></span>
        </label>
        @if (erro(); as m) { <p class="alerta erro">{{ m }}</p> }
      </section>
    }
  `,
  styleUrls: ['./cerebro-comum.css', './cerebro-ia.component.css'],
})
export class CerebroAnexosComponent implements OnInit {
  private api = inject(CerebroService);
  readonly estado = signal<{ ligado: boolean; ia: boolean } | null>(null);
  readonly salvando = signal(false);
  readonly erro = signal('');

  async ngOnInit(): Promise<void> {
    try { this.estado.set(await this.api.configAnexos()); } catch (e) { this.erro.set(mensagemDeErro(e, 'Não foi possível carregar.')); }
  }

  async alternar(ligado: boolean): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    try { this.estado.set(await this.api.salvarAnexos(ligado)); }
    catch (e) { this.erro.set(mensagemDeErro(e, 'Não foi possível salvar.')); }
    finally { this.salvando.set(false); }
  }
}
