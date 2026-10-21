import { Component, ElementRef, HostListener, computed, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/icon';
import { mensagemDeErro } from '../../core/erro-http';
import { AnotacaoService, DocumentoAnotacao, TIPOS, Tipo } from './anotacao.service';
import { Marcacao, aparar, ocorrencias, partir } from './trechos';

/** Uma cor por tipo, com transparência: funciona no tema claro e no escuro. */
const MATIZ: Record<Tipo, number> = {
  PERSON: 210, CPF: 0, RG: 20, CNPJ: 340, CNH: 40, PHONE: 140, EMAIL: 180,
  ADDRESS: 270, VEHICLE: 60, COMPANY: 30, BANK: 300, CARD: 100,
};

/**
 * Anotação: aprova ou corrige a pré-anotação que o Claude fez num relato.
 * Clique numa marcação para tirar (ou devolver); selecione um trecho para marcar.
 * Enter aprova e passa para o próximo; P pula.
 */
@Component({
  selector: 'app-anotacao-page',
  standalone: true,
  imports: [RouterLink, IconComponent, FormsModule],
  template: `
    <div class="page">
      <header class="top-bar">
        <a class="hub-link" routerLink="/" title="Voltar ao início"><app-icon name="grid" [size]="16" /></a>
        <h1>Anotação</h1>
        @if (doc(); as d) {
          <span class="contagem">{{ d.pendentes }} pendentes · {{ d.aprovadas + aprovadasAgora() }} aprovadas</span>
        }
      </header>

      <main class="content">
        @if (carregando()) {
          <p class="aviso">Carregando…</p>
        } @else if (!habilitado()) {
          <p class="aviso">Ferramenta desligada neste servidor. Ela só funciona com <code>Anotacao__RunDir</code>
            apontando para a pasta local do run.</p>
        } @else if (!doc()) {
          <p class="aviso">Nenhuma proposta pendente. Peça ao Claude o próximo lote.</p>
        } @else {
          <div class="relato" #relato (mouseup)="aoSelecionar()">
            @for (p of pedacos(); track p.inicio) {
              @if (p.kind === 'marca') {
                <span class="ent" [class.removida]="p.marcacao.removida" [style]="cor(p.marcacao.tipo)"
                      (click)="alternar(p.marcacao)" [title]="p.marcacao.removida ? 'Clique para devolver' : 'Clique para tirar'"><span
                      [attr.data-ini]="p.inicio">{{ p.texto }}</span><sup>{{ p.marcacao.tipo }}</sup></span>
              } @else {
                <span [attr.data-ini]="p.inicio" [class.tag]="p.tag" [class.quebra]="p.quebra">{{ p.texto }}</span>
              }
            }
          </div>

          @if (selecao(); as s) {
            <div class="marcar">
              <span>Marcar <strong>{{ s.texto }}</strong> como</span>
              @for (t of tipos; track t) {
                <button type="button" class="chip" [style]="cor(t)" (click)="marcar(t)">{{ t }}</button>
              }
              <button type="button" class="link" (click)="selecao.set(null)">cancelar</button>
            </div>
          }

          <ul class="lista">
            @for (m of marcacoesOrdenadas(); track m.id) {
              <li [class.removida]="m.removida">
                <select [ngModel]="m.tipo" (ngModelChange)="trocarTipo(m, $event)" [style]="cor(m.tipo)">
                  @for (t of tipos; track t) { <option [value]="t">{{ t }}</option> }
                </select>
                <span class="valor">{{ trecho(m) }}</span>
                <button type="button" class="icone" (click)="alternar(m)" [title]="m.removida ? 'Devolver' : 'Tirar'">
                  <app-icon [name]="m.removida ? 'undo' : 'x'" [size]="14" />
                </button>
              </li>
            } @empty {
              <li class="vazio">Nenhuma marcação.</li>
            }
          </ul>

          <footer class="acoes">
            <input type="text" [(ngModel)]="observacao" placeholder="Observação (opcional)" />
            <button type="button" class="secundario" (click)="pular()" [disabled]="salvando()">Pular <kbd>P</kbd></button>
            <button type="button" class="primario" (click)="aprovar()" [disabled]="salvando()">
              <app-icon name="check" [size]="14" /> Aprovar <kbd>Enter</kbd>
            </button>
          </footer>
          @if (erro()) { <p class="erro">{{ erro() }}</p> }
          <p class="rodape">Documento {{ doc()!.rowId }}@if (doc()!.modelo) { · proposta de {{ doc()!.modelo }} }</p>
        }
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); color: var(--text); }
    .top-bar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .top-bar h1 { font-size: 16px; margin: 0; flex: 1; }
    .hub-link { display: flex; color: var(--text-muted); }
    .contagem { font-size: 13px; color: var(--text-muted); }
    .content { max-width: 920px; margin: 0 auto; padding: 20px 16px 40px; }
    .aviso { color: var(--text-muted); }
    .relato {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 18px; line-height: 1.9; font-size: 15px; white-space: pre-wrap; word-break: break-word;
    }
    .tag { color: var(--text-muted); opacity: .35; font-size: 11px; }
    /* A quebra continua no DOM (as posições da seleção dependem dela), só não aparece. */
    .tag.quebra { font-size: 0; }
    .quebra::after { content: '\\A'; font-size: 15px; }
    .ent {
      background: hsl(var(--h) 85% 55% / .22); border-bottom: 2px solid hsl(var(--h) 70% 45%);
      border-radius: 3px; padding: 1px 2px; cursor: pointer;
    }
    .ent sup { font-size: 9px; font-weight: 600; margin-left: 2px; color: hsl(var(--h) 60% 40%); user-select: none; }
    .ent.removida { background: none; border-bottom: 2px dashed var(--text-muted); text-decoration: line-through; opacity: .6; }
    .marcar {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; padding: 10px 12px;
      border: 1px solid var(--accent); border-radius: var(--radius); background: var(--surface); font-size: 13px;
    }
    .chip, select {
      border: 1px solid hsl(var(--h) 70% 45%); background: hsl(var(--h) 85% 55% / .15); color: var(--text);
      border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .link { background: none; border: none; color: var(--text-muted); text-decoration: underline; cursor: pointer; }
    .lista { list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 6px; }
    .lista li { display: flex; align-items: center; gap: 10px; font-size: 14px; }
    .lista li.removida .valor { text-decoration: line-through; color: var(--text-muted); }
    .lista .valor { flex: 1; overflow-wrap: anywhere; }
    .lista .vazio { color: var(--text-muted); }
    .icone { display: flex; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); border-radius: 6px; padding: 4px; cursor: pointer; }
    .acoes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; position: sticky; bottom: 0; background: var(--bg); padding: 10px 0; }
    .acoes input { flex: 1; min-width: 180px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
    .acoes button { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; }
    .primario { background: var(--accent); color: var(--accent-contrast); border: 1px solid var(--accent); }
    .secundario { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
    kbd { font-size: 10px; opacity: .6; font-family: inherit; }
    .erro { color: var(--danger); }
    .rodape { font-size: 12px; color: var(--text-muted); }
  `],
})
export class AnotacaoPageComponent {
  readonly tipos = TIPOS;
  readonly carregando = signal(true);
  readonly habilitado = signal(false);
  readonly salvando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly doc = signal<DocumentoAnotacao | null>(null);
  readonly marcacoes = signal<Marcacao[]>([]);
  readonly selecao = signal<{ inicio: number; fim: number; texto: string } | null>(null);
  readonly aprovadasAgora = signal(0);
  observacao = '';

  private readonly relato = viewChild<ElementRef<HTMLElement>>('relato');
  private readonly pulados: string[] = [];
  private proximoId = 1;

  readonly pedacos = computed(() => partir(this.doc()?.texto ?? '', this.marcacoes()));
  readonly marcacoesOrdenadas = computed(() => [...this.marcacoes()].sort((a, b) => a.inicio - b.inicio));

  constructor(private api: AnotacaoService) {
    void this.iniciar();
  }

  private async iniciar(): Promise<void> {
    try {
      const estado = await this.api.estado();
      this.habilitado.set(estado.habilitado);
      if (estado.habilitado) await this.carregar();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'carregar a anotação'));
    } finally {
      this.carregando.set(false);
    }
  }

  private async carregar(): Promise<void> {
    const d = await this.api.proximo(this.pulados);
    this.doc.set(d);
    this.marcacoes.set((d?.entidades ?? []).map((e) => ({ id: this.proximoId++, tipo: e.tipo, inicio: e.inicio, fim: e.fim, removida: false })));
    this.selecao.set(null);
    this.observacao = '';
    this.erro.set(null);
    window.scrollTo({ top: 0 });
  }

  cor(tipo: string): string {
    return `--h: ${MATIZ[tipo as Tipo] ?? 0}`;
  }

  trecho(m: Marcacao): string {
    return this.doc()?.texto.slice(m.inicio, m.fim) ?? '';
  }

  alternar(m: Marcacao): void {
    this.marcacoes.update((ms) => ms.map((x) => (x.id === m.id ? { ...x, removida: !x.removida } : x)));
  }

  trocarTipo(m: Marcacao, tipo: string): void {
    this.marcacoes.update((ms) => ms.map((x) => (x.id === m.id ? { ...x, tipo, removida: false } : x)));
  }

  /** Converte a seleção do mouse em posições do relato, pelos data-ini dos pedaços. */
  aoSelecionar(): void {
    const sel = window.getSelection();
    const raiz = this.relato()?.nativeElement;
    const texto = this.doc()?.texto;
    if (!sel || sel.isCollapsed || !raiz || !texto) return;
    const r = sel.getRangeAt(0);
    const posicao = (no: Node, offset: number): number | null => {
      const el = (no.nodeType === Node.TEXT_NODE ? no.parentElement : (no as Element))?.closest('[data-ini]');
      return el && raiz.contains(el) ? Number(el.getAttribute('data-ini')) + offset : null;
    };
    const ini = posicao(r.startContainer, r.startOffset);
    const fim = posicao(r.endContainer, r.endOffset);
    if (ini === null || fim === null || fim <= ini) return;
    const [a, b] = aparar(texto, ini, fim);
    if (b > a) this.selecao.set({ inicio: a, fim: b, texto: texto.slice(a, b) });
  }

  /** Marca o trecho selecionado e todas as repetições dele que ainda não estão marcadas. */
  marcar(tipo: Tipo): void {
    const s = this.selecao();
    const texto = this.doc()?.texto;
    if (!s || !texto) return;
    const ativas = this.marcacoes().filter((m) => !m.removida);
    const livre = (i: number, f: number) => !ativas.some((m) => i < m.fim && f > m.inicio);
    const novas = ocorrencias(texto, s.texto).filter(([i, f]) => livre(i, f));
    if (!novas.some(([i]) => i === s.inicio) && livre(s.inicio, s.fim)) novas.push([s.inicio, s.fim]);
    this.marcacoes.update((ms) => [...ms, ...novas.map(([i, f]) => ({ id: this.proximoId++, tipo, inicio: i, fim: f, removida: false }))]);
    this.selecao.set(null);
    window.getSelection()?.removeAllRanges();
  }

  async aprovar(): Promise<void> {
    const d = this.doc();
    if (!d || this.salvando()) return;
    this.salvando.set(true);
    try {
      const entidades = this.marcacoes()
        .filter((m) => !m.removida)
        .map((m) => ({ tipo: m.tipo as Tipo, inicio: m.inicio, fim: m.fim, texto: this.trecho(m) }));
      await this.api.decidir(d.rowId, entidades, this.observacao);
      this.aprovadasAgora.update((n) => n + 1);
      await this.carregar();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'salvar a decisão'));
    } finally {
      this.salvando.set(false);
    }
  }

  async pular(): Promise<void> {
    const d = this.doc();
    if (!d) return;
    this.pulados.push(d.rowId);
    await this.carregar();
  }

  @HostListener('document:keydown', ['$event'])
  atalho(e: KeyboardEvent): void {
    const alvo = e.target as HTMLElement;
    if (alvo.closest('input, select, textarea')) return;
    if (e.key === 'Enter') { e.preventDefault(); void this.aprovar(); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); void this.pular(); }
    else if (e.key === 'Escape') this.selecao.set(null);
  }
}
