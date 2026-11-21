import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { mensagemDeErro } from '../../core/erro-http';
import { IconComponent } from '../../shared/icon';
import { ConexoesService, PedidoOAuth } from '../../core/conexoes.service';

/**
 * Consentimento do OAuth do núcleo (spec 030): um aplicativo (o Claude, por exemplo) pede acesso ao MCP de
 * um plug-in. Fica em /autorizar, na raiz, porque /<plug-in>/* é do plug-in.
 */
@Component({
  selector: 'app-autorizar-page',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fundo">
      <main class="cartao">
        @if (pedido(); as p) {
          <h1><span class="marca"><app-icon name="grid" [size]="16" /></span> {{ p.plugin_nome }}</h1>
          <p class="pergunta">Permitir que <strong>{{ p.cliente }}</strong> use o <strong>{{ p.plugin_nome }}</strong> em seu nome?</p>
          @if (p.plugin === 'cerebro') {
            <ul>
              <li>Buscar e ler notas, a Inbox e o diário.</li>
              <li>Mandar capturas para a Inbox, criar notas em <code>_sistema/ai</code> e anexar ao diário.</li>
              <li>Aprovar ou rejeitar itens da Inbox quando você pedir.</li>
            </ul>
          } @else {
            <p class="sub">O aplicativo poderá usar as ferramentas do MCP deste plug-in com a sua conta.</p>
          }
          <p class="sub">Depois de permitir, você volta para <strong>{{ p.redirect_host }}</strong>. Conta: {{ auth.user()?.email }}.
            Dá para revogar a qualquer hora em Configurações → Conexões.</p>
          <div class="acoes">
            <button type="button" (click)="responder(false)" [disabled]="enviando()">Recusar</button>
            <button type="button" class="primario" (click)="responder(true)" [disabled]="enviando()">Permitir</button>
          </div>
        } @else if (erro(); as e) {
          <h1><span class="marca"><app-icon name="grid" [size]="16" /></span> Autorizar aplicativo</h1>
          <p class="erro">{{ e }}</p>
        } @else {
          <p class="sub">Carregando…</p>
        }
      </main>
    </div>
  `,
  styles: [`
    .fundo { min-height: 100dvh; display: flex; align-items: center; justify-content: center; background: var(--bg); padding: 16px; }
    .cartao { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; width: min(460px, 100%); box-shadow: var(--shadow); }
    h1 { font-size: 17px; margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
    .marca { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: var(--accent-contrast); }
    .pergunta { font-size: 15px; line-height: 1.5; }
    ul { font-size: 13.5px; line-height: 1.6; padding-left: 18px; }
    .sub { font-size: 12.5px; color: var(--text-muted); line-height: 1.5; }
    .erro { color: var(--danger); font-size: 14px; }
    .acoes { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
    button { border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 9px 16px; font-size: 14px; font-weight: 600; }
    .primario { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
    button:disabled { opacity: .6; }
  `],
})
export class AutorizarPageComponent implements OnInit {
  private api = inject(ConexoesService);
  private route = inject(ActivatedRoute);
  readonly auth = inject(AuthService);
  readonly pedido = signal<PedidoOAuth | null>(null);
  readonly erro = signal<string | null>(null);
  readonly enviando = signal(false);
  private id = '';

  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.queryParamMap.get('pedido') ?? '';
    try {
      this.pedido.set(await this.api.pedido(this.id));
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Pedido de autorização inválido ou vencido. Volte ao aplicativo e tente de novo'));
    }
  }

  async responder(aprovar: boolean): Promise<void> {
    this.enviando.set(true);
    try {
      const { redirect } = await this.api.consentir(this.id, aprovar);
      location.href = redirect;
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível concluir. Volte ao aplicativo e tente de novo'));
      this.pedido.set(null);
      this.enviando.set(false);
    }
  }
}
