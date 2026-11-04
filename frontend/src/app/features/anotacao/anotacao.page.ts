import { Component, ElementRef, HostListener, computed, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/icon';
import { mensagemDeErro } from '../../core/erro-http';
import { AnotacaoService, DocumentoAnotacao, TIPOS, Tipo } from './anotacao.service';
import { Marcacao, Pedaco, aparar, limiteValido, moverLimite, ocorrencias, partir } from './trechos';

/** Uma cor por tipo, com transparência: funciona no tema claro e no escuro. */
const MATIZ: Record<Tipo, number> = {
  PERSON: 210, CPF: 0, RG: 20, CNPJ: 340, CNH: 40, PHONE: 140, EMAIL: 180,
  ADDRESS: 270, VEHICLE: 60, COMPANY: 30, BANK: 300, CARD: 100,
};

/** Um documento na lista do modo em lote. */
interface ItemLote {
  doc: DocumentoAnotacao;
  marcacoes: Marcacao[];
  pedacos: Pedaco[];
  /** Fica para depois: não entra na aprovação do lote e volta no modo "um por vez". */
  deixar: boolean;
}

const CHAVE_MODO = 'anotacao.modo';
const CHAVE_TAMANHO = 'anotacao.tamanho';
const TAMANHO_PADRAO = 25;
const TAMANHO_MAXIMO = 100;

function lerPreferencia(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}

function gravarPreferencia(chave: string, valor: string): void {
  try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: só não lembra */ }
}

/**
 * Anotação: aprova ou corrige a pré-anotação que o Claude fez num relato.
 * Clique numa marcação para tirar (ou devolver); selecione um trecho para marcar.
 * Enter aprova e passa para o próximo; P pula.
 * No modo "em lote" você lê uma lista (tamanho à escolha), tira o que estiver errado,
 * deixa para depois o que quiser revisar com calma e aprova o resto de uma vez.
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
        @if (resumo(); as r) {
          <span class="contagem">{{ r.pendentes }} pendentes · {{ r.aprovadas + aprovadasAgora() }} aprovadas</span>
        }
        @if (habilitado()) {
          <div class="modos" role="group" aria-label="Modo de revisão">
            <button type="button" [class.ativo]="modo() === 'um'" (click)="mudarModo('um')">Um por vez</button>
            <button type="button" [class.ativo]="modo() === 'lote'" (click)="mudarModo('lote')">Em lote</button>
          </div>
          @if (modo() === 'lote') {
            <label class="tamanho" title="Quantos documentos aparecem por vez (1 a 100)">
              Lote de
              <input type="number" min="1" [max]="tamanhoMaximo" [value]="tamanho()" (change)="aplicarTamanho($any($event.target).value)" />
            </label>
          }
        }
      </header>

      <main class="content">
        @if (carregando()) {
          <p class="aviso">Carregando…</p>
        } @else if (!habilitado()) {
          <p class="aviso">Ferramenta desligada neste servidor. Ela só funciona com <code>Anotacao__RunDir</code>
            apontando para a pasta local do run.</p>
        } @else if (modo() === 'lote') {
          @if (itens().length === 0) {
            <p class="aviso">Nenhuma proposta pendente. Peça ao Claude o próximo lote.</p>
          } @else {
            <p class="dica">Leia a lista. Clique numa marcação para tirá-la; use «Deixar para depois» no que quiser
              revisar com calma (isso volta no modo «Um por vez»). Aprove no fim.</p>
            @for (it of itens(); track it.doc.rowId; let n = $index) {
              <article class="cartao" [class.deixado]="it.deixar">
                <div class="cartao-topo">
                  <strong>{{ n + 1 }}.</strong>
                  <span class="id">documento {{ it.doc.rowId }}</span>
                  <span class="qtd">{{ contar(it) }} marcações</span>
                  <button type="button" class="link" (click)="alternarDeixar(it)">
                    {{ it.deixar ? 'Voltar ao lote' : 'Deixar para depois' }}
                  </button>
                </div>
                <div class="relato compacto" (mouseup)="aoSelecionarNoLote(it, $event)">
                  @for (p of it.pedacos; track p.inicio) {
                    @if (p.kind === 'marca') {
                      <span class="ent" [class.removida]="p.marcacao.removida" [style]="cor(p.marcacao.tipo)"
                            (click)="alternarNoLote(it, p.marcacao)"
                            [title]="p.marcacao.removida ? 'Clique para devolver' : 'Clique para tirar'"><span
                            [attr.data-ini]="p.inicio">{{ p.texto }}</span><sup>{{ p.marcacao.tipo }}</sup></span>
                    } @else {
                      <span [attr.data-ini]="p.inicio" [class.tag]="p.tag" [class.quebra]="p.quebra">{{ p.texto }}</span>
                    }
                  }
                </div>
                @if (selecaoLote(); as s) {
                  @if (s.rowId === it.doc.rowId) {
                    <div class="marcar">
                      <span>Marcar <strong>{{ s.texto }}</strong> como</span>
                      @for (t of tipos; track t) {
                        <button type="button" class="chip" [style]="cor(t)" (click)="marcarNoLote(it, t)">{{ t }}</button>
                      }
                      <button type="button" class="link" (click)="selecaoLote.set(null)">cancelar</button>
                    </div>
                  }
                }
              </article>
            }
            <footer class="acoes">
              <span class="resumo-lote">{{ aprovaveis() }} para aprovar@if (deixados() > 0) { · {{ deixados() }} para depois }</span>
              <button type="button" class="primario" (click)="aprovarLote()" [disabled]="salvando() || aprovaveis() === 0">
                <app-icon name="check" [size]="14" /> Aprovar {{ aprovaveis() }}
              </button>
            </footer>
            @if (erro()) { <p class="erro">{{ erro() }}</p> }
          }
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
                @if (!m.removida) {
                  <span class="ajuste" title="Ajustar o começo">
                    <button type="button" class="icone" (click)="mover(m, 'inicio', 1)" title="Começo: tirar 1 letra">▸</button>
                    <button type="button" class="icone" (click)="mover(m, 'inicio', -1)" title="Começo: incluir 1 letra">◂</button>
                  </span>
                  <span class="ajuste" title="Ajustar o fim">
                    <button type="button" class="icone" (click)="mover(m, 'fim', -1)" title="Fim: tirar 1 letra (Shift: 5)">◂</button>
                    <button type="button" class="icone" (click)="mover(m, 'fim', 1)" title="Fim: incluir 1 letra (Shift: 5)">▸</button>
                  </span>
                  @if (selecao()) {
                    <button type="button" class="icone texto" (click)="usarSelecao(m)" title="Trocar o trecho pelo texto selecionado">usar seleção</button>
                  }
                }
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
    .ajuste { display: inline-flex; gap: 2px; }
    .icone.texto { font-size: 11px; padding: 4px 8px; }
    .icone { display: flex; border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); border-radius: 6px; padding: 4px; cursor: pointer; }
    .acoes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; position: sticky; bottom: 0; background: var(--bg); padding: 10px 0; }
    .acoes input { flex: 1; min-width: 180px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
    .acoes button { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; }
    .primario { background: var(--accent); color: var(--accent-contrast); border: 1px solid var(--accent); }
    .secundario { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
    kbd { font-size: 10px; opacity: .6; font-family: inherit; }
    .erro { color: var(--danger); }
    .rodape { font-size: 12px; color: var(--text-muted); }
    .modos { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
    .modos button { background: var(--surface); color: var(--text-muted); border: none; padding: 5px 10px; font-size: 12px; cursor: pointer; }
    .modos button.ativo { background: var(--accent); color: var(--accent-contrast); }
    .tamanho { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
    .tamanho input { width: 64px; padding: 4px 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
    .dica { color: var(--text-muted); font-size: 13px; margin: 0 0 12px; }
    .cartao { margin-bottom: 14px; }
    .cartao.deixado { opacity: .55; }
    .cartao-topo { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
    .cartao-topo .id { flex: 1; }
    .relato.compacto { line-height: 1.7; font-size: 14px; padding: 12px 14px; }
    .resumo-lote { flex: 1; font-size: 13px; color: var(--text-muted); }
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
  readonly resumo = signal<{ pendentes: number; aprovadas: number } | null>(null);
  readonly modo = signal<'um' | 'lote'>(lerPreferencia(CHAVE_MODO) === 'lote' ? 'lote' : 'um');
  readonly tamanho = signal(this.tamanhoSalvo());
  readonly itens = signal<ItemLote[]>([]);
  readonly selecaoLote = signal<{ rowId: string; inicio: number; fim: number; texto: string } | null>(null);
  readonly aprovaveis = computed(() => this.itens().filter((i) => !i.deixar).length);
  readonly deixados = computed(() => this.itens().filter((i) => i.deixar).length);
  readonly tamanhoMaximo = TAMANHO_MAXIMO;
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
      if (estado.habilitado) await this.recarregar();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'carregar a anotação'));
    } finally {
      this.carregando.set(false);
    }
  }

  private tamanhoSalvo(): number {
    const n = Number(lerPreferencia(CHAVE_TAMANHO));
    return Number.isInteger(n) && n >= 1 && n <= TAMANHO_MAXIMO ? n : TAMANHO_PADRAO;
  }

  private recarregar(): Promise<void> {
    return this.modo() === 'lote' ? this.carregarLote() : this.carregar();
  }

  async mudarModo(modo: 'um' | 'lote'): Promise<void> {
    if (modo === this.modo()) return;
    this.modo.set(modo);
    gravarPreferencia(CHAVE_MODO, modo);
    this.carregando.set(true);
    try {
      await this.recarregar();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'carregar a anotação'));
    } finally {
      this.carregando.set(false);
    }
  }

  async aplicarTamanho(valor: string): Promise<void> {
    const n = Math.min(TAMANHO_MAXIMO, Math.max(1, Math.floor(Number(valor)) || TAMANHO_PADRAO));
    this.tamanho.set(n);
    gravarPreferencia(CHAVE_TAMANHO, String(n));
    try {
      await this.carregarLote();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'carregar o lote'));
    }
  }

  private async carregarLote(): Promise<void> {
    const docs = await this.api.lote(this.tamanho(), this.pulados);
    this.itens.set(
      docs.map((doc) => {
        const marcacoes = doc.entidades.map((e) => ({ id: this.proximoId++, tipo: e.tipo, inicio: e.inicio, fim: e.fim, removida: false }));
        return { doc, marcacoes, pedacos: partir(doc.texto, marcacoes), deixar: false };
      }),
    );
    if (docs[0]) this.resumo.set({ pendentes: docs[0].pendentes, aprovadas: docs[0].aprovadas });
    this.erro.set(null);
    window.scrollTo({ top: 0 });
  }

  contar(it: ItemLote): number {
    return it.marcacoes.filter((m) => !m.removida).length;
  }

  alternarNoLote(it: ItemLote, m: Marcacao): void {
    const marcacoes = it.marcacoes.map((x) => (x.id === m.id ? { ...x, removida: !x.removida } : x));
    this.itens.update((lista) => lista.map((x) => (x === it ? { ...x, marcacoes, pedacos: partir(x.doc.texto, marcacoes) } : x)));
  }

  /** Seleção do mouse dentro do relato de um documento da lista. */
  aoSelecionarNoLote(it: ItemLote, evento: MouseEvent): void {
    const sel = this.lerSelecao(evento.currentTarget as HTMLElement, it.doc.texto);
    this.selecaoLote.set(sel ? { rowId: it.doc.rowId, ...sel } : null);
  }

  /** Marca o trecho selecionado (e as repetições dele) no documento da lista. */
  marcarNoLote(it: ItemLote, tipo: Tipo): void {
    const s = this.selecaoLote();
    if (!s || s.rowId !== it.doc.rowId) return;
    const texto = it.doc.texto;
    const ativas = it.marcacoes.filter((m) => !m.removida);
    const livre = (i: number, f: number) => !ativas.some((m) => i < m.fim && f > m.inicio);
    const novas = ocorrencias(texto, s.texto).filter(([i, f]) => livre(i, f));
    if (!novas.some(([i]) => i === s.inicio) && livre(s.inicio, s.fim)) novas.push([s.inicio, s.fim]);
    const marcacoes = [...it.marcacoes, ...novas.map(([i, f]) => ({ id: this.proximoId++, tipo, inicio: i, fim: f, removida: false }))];
    this.itens.update((lista) => lista.map((x) => (x === it ? { ...x, marcacoes, pedacos: partir(texto, marcacoes) } : x)));
    this.selecaoLote.set(null);
    window.getSelection()?.removeAllRanges();
  }

  alternarDeixar(it: ItemLote): void {
    this.itens.update((lista) => lista.map((x) => (x === it ? { ...x, deixar: !x.deixar } : x)));
  }

  /** Aprova os documentos do lote que não ficaram para depois e carrega o próximo lote. */
  async aprovarLote(): Promise<void> {
    if (this.salvando()) return;
    const aprovar = this.itens().filter((i) => !i.deixar);
    if (!aprovar.length) return;
    this.salvando.set(true);
    try {
      const res = await this.api.decidirLote(
        aprovar.map((i) => ({
          rowId: i.doc.rowId,
          observacao: '',
          entidades: i.marcacoes
            .filter((m) => !m.removida)
            .map((m) => ({ tipo: m.tipo as Tipo, inicio: m.inicio, fim: m.fim, texto: i.doc.texto.slice(m.inicio, m.fim) })),
        })),
      );
      this.aprovadasAgora.update((n) => n + res.gravadas);
      this.pulados.push(...this.itens().filter((i) => i.deixar).map((i) => i.doc.rowId), ...res.erros.map((e) => e.rowId));
      await this.carregarLote();
      if (res.erros.length) this.erro.set(`${res.erros.length} não gravaram: ${res.erros.map((e) => `${e.rowId} (${e.erro})`).join('; ')}`);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'salvar o lote'));
    } finally {
      this.salvando.set(false);
    }
  }

  private async carregar(): Promise<void> {
    const d = await this.api.proximo(this.pulados);
    this.doc.set(d);
    if (d) this.resumo.set({ pendentes: d.pendentes, aprovadas: d.aprovadas });
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

  /** Move uma ponta da marcação; com Shift pressionado o passo é de 5 letras. */
  mover(m: Marcacao, ponta: 'inicio' | 'fim', passo: number): void {
    const texto = this.doc()?.texto;
    if (!texto) return;
    const delta = this.shift ? passo * 5 : passo;
    const novo = moverLimite(texto, this.marcacoes(), m.id, ponta, delta);
    if (novo) this.definir(m.id, novo[0], novo[1]);
  }

  /** Troca o trecho da marcação pelo texto selecionado (útil quando precisa mudar muito). */
  usarSelecao(m: Marcacao): void {
    const s = this.selecao();
    const texto = this.doc()?.texto;
    if (!s || !texto || !limiteValido(texto, this.marcacoes(), m.id, s.inicio, s.fim)) return;
    this.definir(m.id, s.inicio, s.fim);
    this.selecao.set(null);
    window.getSelection()?.removeAllRanges();
  }

  private definir(id: number, inicio: number, fim: number): void {
    this.marcacoes.update((ms) => ms.map((x) => (x.id === id ? { ...x, inicio, fim } : x)));
  }

  private shift = false;

  @HostListener('document:keydown', ['$event'])
  @HostListener('document:keyup', ['$event'])
  registrarShift(e: KeyboardEvent): void {
    this.shift = e.shiftKey;
  }

  trocarTipo(m: Marcacao, tipo: string): void {
    this.marcacoes.update((ms) => ms.map((x) => (x.id === m.id ? { ...x, tipo, removida: false } : x)));
  }

  /** Converte a seleção do mouse em posições do relato, pelos data-ini dos pedaços. */
  aoSelecionar(): void {
    const raiz = this.relato()?.nativeElement;
    const texto = this.doc()?.texto;
    if (!raiz || !texto) return;
    const sel = this.lerSelecao(raiz, texto);
    if (sel) this.selecao.set(sel);
  }

  /** Posições da seleção do mouse dentro de `raiz`, ou null se não houver seleção válida ali. */
  private lerSelecao(raiz: HTMLElement, texto: string): { inicio: number; fim: number; texto: string } | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    const posicao = (no: Node, offset: number): number | null => {
      const el = (no.nodeType === Node.TEXT_NODE ? no.parentElement : (no as Element))?.closest('[data-ini]');
      return el && raiz.contains(el) ? Number(el.getAttribute('data-ini')) + offset : null;
    };
    const ini = posicao(r.startContainer, r.startOffset);
    const fim = posicao(r.endContainer, r.endOffset);
    if (ini === null || fim === null || fim <= ini) return null;
    const [a, b] = aparar(texto, ini, fim);
    return b > a ? { inicio: a, fim: b, texto: texto.slice(a, b) } : null;
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
    if (this.modo() === 'lote') return; // aprovar um lote inteiro nunca é por atalho
    const alvo = e.target as HTMLElement;
    if (alvo.closest('input, select, textarea')) return;
    if (e.key === 'Enter') { e.preventDefault(); void this.aprovar(); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); void this.pular(); }
    else if (e.key === 'Escape') this.selecao.set(null);
  }
}
