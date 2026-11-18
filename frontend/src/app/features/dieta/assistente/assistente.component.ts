import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../../core/erro-http';
import { markdownSimples } from '../../financas/components/chat/markdown-simples';
import { DietaApiService } from '../dieta-api.service';
import { MensagemChat, RespostaChat } from '../dieta.models';

/**
 * Aba "Assistente" (spec 016): o mesmo chat do app (POST /api/dieta/chat), com a configuração de IA
 * do hub. O assistente pergunta antes de gravar; quando grava, a tela recarrega o dia.
 */
@Component({
  selector: 'app-dieta-assistente',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <div class="mensagens">
        @for (m of mensagens(); track $index) {
          <div class="msg" [class.minha]="m.papel === 'usuario'" [innerHTML]="m.papel === 'assistente' ? md(m.texto) : m.texto"></div>
        } @empty {
          <p class="sub">Pergunte sobre o seu dia, peça para montar o plano ou registrar uma refeição ("almocei arroz, feijão e frango").
            O assistente confirma com você antes de gravar.</p>
        }
        @if (pergunta(); as p) {
          <div class="opcoes">
            @for (o of p.opcoes; track o) { <button type="button" (click)="enviar(o)">{{ o }}</button> }
          </div>
        }
        @if (pensando()) { <p class="sub">Pensando…</p> }
        @if (erro(); as e) { <p class="erro">{{ e }}</p> }
      </div>
      <form (submit)="$event.preventDefault(); enviar(texto)">
        <input [(ngModel)]="texto" name="texto" placeholder="Escreva aqui" [disabled]="pensando()" />
        <button type="submit" class="primario" [disabled]="pensando() || !texto.trim()">Enviar</button>
      </form>
    </section>
  `,
  styles: [`
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .mensagens { display: flex; flex-direction: column; gap: 8px; max-height: 60dvh; overflow: auto; }
    .msg { background: var(--bg); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 13.5px; line-height: 1.5; max-width: 85%; }
    .msg.minha { align-self: flex-end; background: var(--accent-soft); white-space: pre-wrap; }
    .opcoes { display: flex; flex-wrap: wrap; gap: 6px; }
    form { display: flex; gap: 8px; }
    input { flex: 1; min-width: 0; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13.5px; }
    button { border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 13px; font-weight: 600; }
    .primario { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
    button:disabled { opacity: .5; }
    .sub { font-size: 12.5px; color: var(--text-muted); margin: 0; } .erro { color: var(--danger); font-size: 13px; margin: 0; }
  `],
})
export class AssistenteComponent {
  private api = inject(DietaApiService);
  @Output() alterou = new EventEmitter<void>();
  readonly mensagens = signal<MensagemChat[]>([]);
  readonly pergunta = signal<RespostaChat['pergunta']>(null);
  readonly pensando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly md = markdownSimples;
  texto = '';

  async enviar(texto: string): Promise<void> {
    const t = texto.trim();
    if (!t || this.pensando()) return;
    this.texto = '';
    this.erro.set(null);
    this.pergunta.set(null);
    const historico = [...this.mensagens(), { papel: 'usuario' as const, texto: t }];
    this.mensagens.set(historico);
    this.pensando.set(true);
    try {
      const r = await this.api.chat(historico);
      this.mensagens.set([...historico, { papel: 'assistente', texto: r.resposta }]);
      this.pergunta.set(r.pergunta ?? null);
      if (r.alterou) this.alterou.emit();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível responder'));
    } finally {
      this.pensando.set(false);
    }
  }
}
