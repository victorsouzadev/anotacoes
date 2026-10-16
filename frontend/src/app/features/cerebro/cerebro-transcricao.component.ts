import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { CerebroService, ConfigTranscricao } from './cerebro.service';

/** Configurações → "Transcrição de áudio": serviço, modelo e chave, sem mexer no .env da VPS. */
@Component({
  selector: 'app-cerebro-transcricao',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    @if (config(); as c) {
      <section class="card">
        <h2>Transcrição de áudio</h2>
        <p class="ajuda">
          Áudios gravados no app do celular ou compartilhados do WhatsApp viram texto antes de a IA organizar.
          Usa um serviço compatível com a OpenAI (Whisper). A chave fica cifrada no servidor e não volta inteira para a tela.
        </p>
        <div class="estado" [class.ativo]="c.efetivo.ligado">
          <app-icon [name]="c.efetivo.ligado ? 'check' : 'x'" [size]="14" />
          @if (c.efetivo.ligado) {
            Ligada: <code>{{ c.efetivo.modelo }}</code> · chave {{ c.efetivo.origem === 'tela' ? 'cadastrada aqui' : 'do servidor (.env)' }}
          } @else {
            Desligada: os áudios chegam na Inbox sem transcrição.
          }
        </div>
        @if (c.chave_invalida) {
          <p class="alerta erro">A chave salva não abre mais (o JWT_SECRET mudou). Cadastre de novo.</p>
        }

        <h3>Serviço</h3>
        <div class="opcoes">
          @for (s of c.servicos; track s.id) {
            <label class="opcao" [class.marcada]="servico === s.id">
              <input type="radio" name="servico-transcricao" [value]="s.id" [(ngModel)]="servico" />
              <span><strong>{{ s.nome }}</strong> <small>{{ s.descricao }} Modelo padrão: <code>{{ s.modelo }}</code>.</small></span>
            </label>
          }
        </div>

        <h3>Chave de API</h3>
        @if (c.chave_configurada) {
          <p class="ajuda sem-margem">Salva: <code>{{ c.chave_mascarada }}</code>. Deixe em branco para manter.</p>
        }
        <div class="linha">
          <input type="password" autocomplete="off" [(ngModel)]="chave" [placeholder]="servico === 'groq' ? 'gsk_…' : 'sk-…'" />
          <input [(ngModel)]="modelo" placeholder="Modelo (opcional)" />
        </div>
        <div class="linha acoes">
          <button class="botao primario" (click)="salvar()" [disabled]="salvando()">{{ salvando() ? 'Salvando…' : 'Salvar' }}</button>
          @if (c.chave_configurada) {
            <button class="botao" (click)="apagar()" [disabled]="salvando()">Apagar chave</button>
          }
        </div>
        @if (erro()) { <p class="alerta erro">{{ erro() }}</p> }
        @if (aviso()) { <p class="alerta ok">{{ aviso() }}</p> }
      </section>
    }
  `,
  styleUrls: ['./cerebro-comum.css', './cerebro-ia.component.css'],
  styles: [`.acoes { margin-top: 10px; } h3 { margin: 14px 0 8px; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CerebroTranscricaoComponent {
  private readonly api = inject(CerebroService);
  readonly config = signal<ConfigTranscricao | null>(null);
  readonly salvando = signal(false);
  readonly erro = signal('');
  readonly aviso = signal('');
  servico = 'openai';
  modelo = '';
  chave = '';

  constructor() {
    void this.api.configTranscricao().then((c) => this.aplicar(c)).catch((e) => this.erro.set(mensagemDeErro(e, 'Não foi possível carregar.')));
  }

  private aplicar(c: ConfigTranscricao): void {
    this.config.set(c);
    this.servico = c.servico;
    this.modelo = c.modelo ?? '';
    this.chave = '';
  }

  salvar(): Promise<void> { return this.enviar(this.chave.trim() || null, 'Salvo. Vale para os próximos áudios.'); }
  apagar(): Promise<void> { return this.enviar('', 'Chave apagada.'); }

  private async enviar(chave: string | null, ok: string): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    this.aviso.set('');
    try {
      this.aplicar(await this.api.salvarTranscricao(this.servico, this.modelo.trim() || null, chave));
      this.aviso.set(ok);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível salvar.'));
    } finally {
      this.salvando.set(false);
    }
  }
}
