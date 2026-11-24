import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth.service';
import { mensagemDeErro } from '../../core/erro-http';
import { ThemeService } from '../../core/theme.service';
import { IconComponent } from '../../shared/icon';
import { Painel, PainelService, PluginNoPainel, ROTULO_ESTADO, ROTULO_SITUACAO, oQueFalta, ordenar, rotuloDaEtapa } from './painel.service';

/** Painel de plug-ins (spec 040): o que está no ar e o que falta em cada ferramenta. */
@Component({
  selector: 'app-plugins-page',
  standalone: true,
  imports: [IconComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <grafite-barra atual="hub" (grafite-tema)="trocarTema($event)" (grafite-sair)="sair($event)"></grafite-barra>

      <main class="content">
        <header class="topo">
          <h1>Plug-ins</h1>
          <button type="button" class="botao" [disabled]="carregando()" (click)="carregar()">
            <app-icon name="refresh" [size]="14" /> {{ carregando() ? 'Conferindo…' : 'Conferir de novo' }}
          </button>
        </header>

        @if (negado()) {
          <p class="vazio">Esta conta não está em HUB_ADMINISTRADORES no servidor.</p>
        } @else {
          @if (erro(); as e) { <p class="alerta falha" role="alert">{{ e }}</p> }
          @if (painel(); as p) {
            @for (a of avisos(); track a) {
              <p class="alerta"><app-icon name="alert" [size]="14" /> {{ a }}</p>
            }
            <dl class="recursos">
              <div><dt>Memória livre</dt><dd>{{ p.recursos.memoriaLivreMb === null ? '—' : p.recursos.memoriaLivreMb + ' MB' }}</dd></div>
              <div><dt>Conexões livres no banco</dt><dd>{{ p.recursos.conexoesLivres ?? '—' }}</dd></div>
              <div><dt>Limite por plug-in</dt><dd>{{ p.recursos.limiteDoPluginMb }} MB</dd></div>
            </dl>

            <ul class="lista">
              @for (i of plugins(); track i.id) {
                <li>
                  <details [open]="i.situacao === 'com-falha'">
                    <summary>
                      <span class="nome">{{ i.nome }} @if (i.congelado) { <small>congelado</small> }</span>
                      <span class="selo" [class]="'selo ' + i.situacao">{{ rotulo[i.situacao] }}</span>
                      <span class="meta">
                        <code>{{ i.versao ?? 'sem versão' }}</code>
                        @if (i.memoriaMb !== null) { <span>{{ i.memoriaMb }} de {{ i.limiteMb }} MB</span> }
                        @if (falta(i); as f) { <span class="falta">{{ f }}</span> }
                      </span>
                    </summary>
                    <div class="detalhe">
                      @if (i.ultimaFalha) { <p class="falha-texto">Última falha: {{ i.ultimaFalha }}</p> }
                      <p class="linha">
                        Id <code>{{ i.id }}</code>
                        @if (i.versaoAnterior) { · versão anterior <code>{{ i.versaoAnterior }}</code> }
                        @if (i.health !== null) { · health {{ i.health ? 'responde' : 'não responde' }} }
                      </p>
                      <ul class="etapas">
                        @for (e of i.etapas; track e.nome) {
                          <li [class]="e.estado">
                            <span class="etapa-nome">{{ etapa(e.nome) }}</span>
                            <span class="etapa-estado">{{ estado[e.estado] }}</span>
                            @if (e.detalhe) { <span class="etapa-detalhe">{{ e.detalhe }}</span> }
                          </li>
                        }
                      </ul>
                    </div>
                  </details>
                </li>
              } @empty {
                <li class="vazio">Nenhum plug-in no registro.</li>
              }
            </ul>
          } @else if (carregando()) {
            <p class="vazio">Conferindo o registro, o GitHub e o banco…</p>
          }
        }
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); color: var(--text); }
    .content { max-width: 820px; margin: 0 auto; padding: 32px 28px 56px; }
    .topo { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
    h1 { font-size: 22px; margin: 0; }
    .botao {
      display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; min-height: 36px;
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface);
      font-size: 13px; font-weight: 600;
    }
    .botao:hover:not(:disabled) { border-color: var(--accent); }
    .botao:disabled { opacity: .6; cursor: default; }
    .alerta {
      display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 10px 14px;
      border: 1px solid var(--atencao); border-radius: var(--radius-sm); color: var(--atencao); font-size: 13px;
    }
    .alerta.falha { border-color: var(--danger); color: var(--danger); }
    .recursos { display: flex; flex-wrap: wrap; gap: 8px 32px; margin: 16px 0 24px; }
    .recursos dt { font-size: 12px; color: var(--text-muted); }
    .recursos dd { margin: 2px 0 0; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .lista, .etapas { list-style: none; margin: 0; padding: 0; }
    .lista > li { border-top: 1px solid var(--border); }
    .lista > li:last-child { border-bottom: 1px solid var(--border); }
    summary {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center;
      padding: 14px 4px; cursor: pointer; list-style: none;
    }
    summary::-webkit-details-marker { display: none; }
    summary:focus-visible, .botao:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .nome { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
    .nome small { font-weight: 400; color: var(--text-muted); }
    .meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: var(--text-muted); }
    .falta { color: var(--text); }
    .selo { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: var(--tag-bg); color: var(--tag-text); white-space: nowrap; }
    .selo.no-ar { background: color-mix(in srgb, var(--positivo) 14%, transparent); color: var(--positivo); }
    .selo.com-falha { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
    .selo.pronto, .selo.incompleto { background: color-mix(in srgb, var(--atencao) 16%, transparent); color: var(--atencao); }
    code { font-family: ui-monospace, monospace; font-size: 12px; }
    .detalhe { padding: 0 4px 18px; font-size: 13px; }
    .linha { margin: 0 0 10px; color: var(--text-muted); }
    .falha-texto { margin: 0 0 10px; color: var(--danger); overflow-wrap: anywhere; }
    .etapas li { display: grid; grid-template-columns: 160px 160px minmax(0, 1fr); gap: 2px 12px; padding: 5px 0; }
    .etapa-estado, .etapa-detalhe { color: var(--text-muted); overflow-wrap: anywhere; }
    .feita .etapa-estado { color: var(--positivo); }
    .falhou .etapa-estado { color: var(--danger); }
    .pendente .etapa-estado { color: var(--atencao); }
    .vazio { color: var(--text-muted); font-size: 14px; padding: 16px 4px; }
    @media (max-width: 760px) {
      .content { padding: 20px 16px 40px; }
      .botao { min-height: 44px; }
      .etapas li { grid-template-columns: minmax(0, 1fr) auto; }
      .etapa-detalhe { grid-column: 1 / -1; }
    }
  `],
})
export class PluginsPageComponent {
  private readonly api = inject(PainelService);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);

  readonly painel = signal<Painel | null>(null);
  readonly carregando = signal(false);
  readonly negado = signal(false);
  readonly erro = signal<string | null>(null);
  readonly plugins = computed(() => ordenar(this.painel()?.plugins ?? []));
  readonly avisos = computed(() => [...(this.painel()?.avisos ?? []), ...(this.painel()?.recursos.avisos ?? [])]);

  readonly rotulo = ROTULO_SITUACAO;
  readonly estado = ROTULO_ESTADO;
  readonly etapa = rotuloDaEtapa;
  readonly falta = (p: PluginNoPainel) => oQueFalta(p);

  constructor() {
    void this.carregar();
  }

  async carregar(): Promise<void> {
    if (this.carregando()) return;
    this.carregando.set(true);
    this.erro.set(null);
    try {
      this.painel.set(await this.api.listar());
      this.negado.set(false);
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 403) this.negado.set(true);
      else this.erro.set(mensagemDeErro(e, 'Ler os plug-ins'));
    } finally {
      this.carregando.set(false);
    }
  }

  trocarTema(e: Event): void {
    e.preventDefault();
    const t = (e as CustomEvent<string>).detail;
    if (t === 'system' || t === 'light' || t === 'dark') this.theme.set(t);
  }

  sair(e: Event): void {
    e.preventDefault();
    this.auth.logout();
  }
}
