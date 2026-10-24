import { Component, EventEmitter, Input, OnInit, Output, computed, effect, inject, signal, untracked } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { mensagemDeErro } from '../../../core/erro-http';
import { EstudioService } from '../estudio.service';
import { Estimativa, Job, Midia, ModeloCatalogo, OperacaoCatalogo, TipoMidia, Valor, dolares } from '../estudio.models';
import { ESTUDIO_CSS } from './estilos';
import { MidiaCardComponent } from './midia';
import { SeletorMidiaComponent } from './seletor-midia';

export const ROTULO_PARAMETRO: Record<string, string> = {
  prompt: 'Prompt', negativo: 'Evitar (prompt negativo)', letra: 'Letra da música', proporcao: 'Proporção', resolucao: 'Resolução',
  duracao: 'Duração (s)', quantidade: 'Quantidade', qualidade: 'Qualidade', audio: 'Gerar áudio junto', semente: 'Semente',
  anguloH: 'Girar em volta (°)', anguloV: 'Altura da câmera (°)', zoom: 'Distância (0 longe · 10 perto)', voz: 'Voz', forca: 'Força da mudança',
  escala: 'Ampliação', faces: 'Polígonos (faces)', pbr: 'Materiais PBR', tipoMalha: 'Tipo de malha', tipoPoligono: 'Polígonos', nivelFaces: 'Densidade',
  rig: 'Esqueleto para animar', fundo: 'Fundo',
};

export const ROTULO_ENTRADA: Record<string, string> = {
  imagens: 'Imagens de referência', imagem: 'Imagem', imagemFinal: 'Quadro final', imagemCostas: 'Vista de trás', imagemEsquerda: 'Vista da esquerda',
  imagemDireita: 'Vista da direita', mascara: 'Máscara (branco = mudar)', video: 'Vídeo', videos: 'Vídeos de referência', audios: 'Áudios de referência',
  arquivo3d: 'Modelo 3D (GLB)', fundo: 'Novo fundo',
};

const TIPO_DA_ENTRADA: Record<string, TipoMidia[]> = {
  imagens: ['imagem'], imagem: ['imagem'], imagemFinal: ['imagem'], imagemCostas: ['imagem'], imagemEsquerda: ['imagem'], imagemDireita: ['imagem'],
  mascara: ['imagem'], video: ['video'], videos: ['video'], audios: ['audio'], arquivo3d: ['modelo3d'], fundo: ['imagem'],
};

const LISTAS = new Set(['imagens', 'videos', 'audios']);
const TEXTOS_LONGOS = new Set(['prompt', 'negativo', 'letra']);

export interface ConfigForm {
  /** Ferramenta de IA (vai como "app" da geração, para o histórico de cada tela). */
  id: string;
  tipoModelo: ModeloCatalogo['tipo'];
  operacoes: { id: string; rotulo: string }[];
  familias?: string[];
  promptRotulo?: string;
  promptDica?: string;
  promptPadrao?: string;
  pipeline?: string;
  /** Entradas que a tela preenche sozinha e não mostra (ex.: a máscara pintada). */
  ocultas?: string[];
}

/**
 * Formulário de geração montado a partir do catálogo: escolhe modelo e operação, mostra só as
 * entradas e parâmetros que aquele modelo aceita, estima o custo e envia.
 */
@Component({
  selector: 'e-form-geracao',
  standalone: true,
  imports: [IconComponent, MidiaCardComponent, SeletorMidiaComponent],
  template: `
    @if (erroCatalogo()) { <p class="e-erro">{{ erroCatalogo() }}</p> }
    @if (modelos().length) {
      <div class="fg">
        @if (opsDisponiveis().length > 1) {
          <div class="e-chips">
            @for (o of opsDisponiveis(); track o.id) {
              <button type="button" class="e-chip" [class.e-on]="op() === o.id" (click)="trocarOp(o.id)">{{ o.rotulo }}</button>
            }
          </div>
        }

        <label class="e-campo">
          <span>Modelo</span>
          <select class="e-select" [value]="modeloId()" (change)="trocarModelo($any($event.target).value)">
            @for (g of grupos(); track g.familia) {
              <optgroup [label]="g.familia">
                @for (m of g.modelos; track m.id) { <option [value]="m.id" [selected]="m.id === modeloId()">{{ m.nome }}</option> }
              </optgroup>
            }
          </select>
          @if (modelo()?.descricao) { <small class="e-muted">{{ modelo()!.descricao }}</small> }
        </label>

        @for (chave of entradasVisiveis(); track chave) {
          <div class="e-campo">
            <span>{{ rotuloEntrada(chave) }}{{ obrigatoria(chave) ? '' : ' (opcional)' }}</span>
            <div class="fg-slot">
              @for (m of entradas()[chave] ?? []; track m.id) {
                <div class="fg-item">
                  <e-midia-card [midia]="m" />
                  <button type="button" class="fg-tirar" (click)="tirar(chave, m)" aria-label="Tirar"><app-icon name="x" [size]="11" /></button>
                </div>
              }
              @if (podeAdicionar(chave)) {
                <button type="button" class="fg-add" (click)="abrirSeletor(chave)"><app-icon name="plus" [size]="18" /><span>Escolher</span></button>
              }
            </div>
          </div>
        }

        @for (p of parametrosVisiveis(); track p) {
          @if (textoLongo(p)) {
            <label class="e-campo">
              <span>{{ p === 'prompt' ? (config.promptRotulo ?? 'Prompt') : rotulo(p) }}</span>
              <textarea class="e-textarea" [rows]="p === 'prompt' ? 4 : 2" [placeholder]="p === 'prompt' ? (config.promptPadrao ? 'Opcional: deixe vazio para o padrão' : (config.promptDica ?? '')) : ''"
                [value]="valorTexto(p)" (input)="definir(p, $any($event.target).value)"></textarea>
            </label>
          } @else if (opcoes(p).length) {
            <div class="e-campo">
              <span>{{ rotulo(p) }}</span>
              <div class="e-chips">
                @for (v of opcoes(p); track $index) {
                  <button type="button" class="e-chip" [class.e-on]="igual(valor(p), v)" (click)="definir(p, v)">{{ mostrar(p, v) }}</button>
                }
              </div>
            </div>
          } @else if (limites(p); as lim) {
            <label class="e-campo">
              <span>{{ rotulo(p) }}: {{ valor(p) }}</span>
              <input type="range" [min]="lim[0]" [max]="lim[1]" step="1" [value]="valor(p)" (input)="definir(p, +$any($event.target).value)" />
            </label>
          } @else {
            <label class="e-campo">
              <span>{{ rotulo(p) }} (opcional)</span>
              <input class="e-input" [type]="numerico(p) ? 'number' : 'text'" [value]="valorTexto(p)" (input)="definirLivre(p, $any($event.target).value)" />
            </label>
          }
        }

        <div class="fg-rodape">
          <span class="fg-custo" [class.fg-alerta]="estimativa()?.passaDoLimite">
            @if (estimativa(); as e) {
              ~{{ dolar(e.custoCentavos) }}
              @if (e.passaDoLimite) { · passa do teto mensal }
            }
          </span>
          <button type="button" class="e-btn e-pri" [disabled]="enviando() || !pronto()" (click)="gerar()">
            <app-icon name="sparkles" [size]="14" /> {{ enviando() ? 'Enviando…' : rotuloBotao }}
          </button>
        </div>
        @if (erro()) { <p class="e-erro">{{ erro() }}</p> }
      </div>
    } @else if (!erroCatalogo()) {
      <p class="e-muted">Carregando modelos…</p>
    }

    @if (seletor(); as s) {
      <e-seletor-midia [titulo]="rotuloEntrada(s)" [tipos]="tiposDaEntrada(s)" [multiplo]="ehLista(s)" [max]="maxDe(s)"
        (escolhido)="escolher(s, $event)" (fechar)="seletor.set(null)" />
    }
  `,
  styles: [ESTUDIO_CSS, `
    .fg { display: flex; flex-direction: column; gap: 14px; }
    .fg-slot { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: 8px; }
    .fg-item { position: relative; }
    .fg-tirar { position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(0,0,0,.6); color: #fff; display: flex; align-items: center; justify-content: center; }
    .fg-add { aspect-ratio: 1; border: 1.5px dashed var(--border); border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 11px; font-weight: 600; }
    .fg-add:hover { border-color: var(--accent); color: var(--accent); }
    .fg-rodape { display: flex; align-items: center; justify-content: space-between; gap: 10px; position: sticky; bottom: 0; background: var(--surface); padding: 10px 0 2px; }
    .fg-custo { font-size: 13px; color: var(--text-muted); font-weight: 600; }
    .fg-alerta { color: var(--danger); }
    small.e-muted { font-size: 12px; }
    input[type=range] { width: 100%; accent-color: var(--accent); }
  `],
})
export class FormGeracaoComponent implements OnInit {
  private readonly api = inject(EstudioService);

  @Input({ required: true }) config!: ConfigForm;
  @Input() rotuloBotao = 'Gerar';
  /** Histórico em que a geração entra, quando não é o da própria ferramenta (ex.: painel de IA de um craft app). */
  @Input() appHistorico: string | null = null;
  /** Arquivos que a tela já traz (ex.: ?entrada= da biblioteca, o render do palco). */
  @Input() entradasIniciais: Record<string, Midia[]> = {};
  @Input() opInicial: string | null = null;
  /** Chamado antes de enviar: a tela pode acrescentar entradas (ex.: subir a máscara pintada). */
  @Input() antesDeGerar?: (pedido: { entradas: Record<string, string[]>; parametros: Record<string, Valor> }) => Promise<void>;
  @Output() gerado = new EventEmitter<Job>();

  readonly catalogo = signal<ModeloCatalogo[]>([]);
  readonly erroCatalogo = signal('');
  readonly modeloId = signal('');
  readonly op = signal('');
  readonly params = signal<Record<string, Valor>>({});
  readonly entradas = signal<Record<string, Midia[]>>({});
  readonly estimativa = signal<Estimativa | null>(null);
  readonly enviando = signal(false);
  readonly erro = signal('');
  readonly seletor = signal<string | null>(null);
  readonly dolar = dolares;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly modelos = computed(() => {
    const ops = this.config.operacoes.map((o) => o.id);
    return this.catalogo().filter((m) =>
      m.tipo === this.config.tipoModelo &&
      (!this.config.familias?.length || this.config.familias.includes(m.familia)) &&
      ops.some((o) => o in m.ops));
  });

  readonly grupos = computed(() => {
    const mapa = new Map<string, ModeloCatalogo[]>();
    for (const m of this.modelos()) mapa.set(m.familia, [...(mapa.get(m.familia) ?? []), m]);
    return [...mapa.entries()].map(([familia, modelos]) => ({ familia, modelos }));
  });

  readonly modelo = computed(() => this.modelos().find((m) => m.id === this.modeloId()) ?? null);
  readonly opsDisponiveis = computed(() => this.config.operacoes.filter((o) => this.modelos().some((m) => o.id in m.ops)));
  readonly spec = computed<OperacaoCatalogo | null>(() => this.modelo()?.ops[this.op()] ?? null);

  readonly entradasVisiveis = computed(() => {
    const s = this.spec();
    if (!s) return [];
    const lista = s.entradas.filter((e) => !(this.config.ocultas ?? []).includes(e));
    if (this.config.pipeline === 'trocar-fundo') lista.push('fundo');
    return lista;
  });

  readonly parametrosVisiveis = computed(() => {
    const s = this.spec();
    if (!s) return [];
    // Prompt primeiro; semente fica de fora (poucos usam e confunde).
    return [...s.parametros].filter((p) => p !== 'semente').sort((a, b) => (a === 'prompt' ? -1 : b === 'prompt' ? 1 : 0));
  });

  readonly pronto = computed(() => {
    const s = this.spec();
    if (!s) return false;
    const e = this.entradas();
    for (const o of s.obrigatorios) {
      if (s.entradas.includes(o)) {
        if ((this.config.ocultas ?? []).includes(o)) continue;
        if (!e[o]?.length) return false;
      } else if (o === 'prompt' && !this.config.promptPadrao && !String(this.params()['prompt'] ?? '').trim()) {
        return false;
      }
    }
    if (this.config.pipeline === 'trocar-fundo' && !e['fundo']?.length) return false;
    return true;
  });

  constructor() {
    // Estima o custo quando muda modelo, operação, parâmetro ou entrada (com folga para digitar).
    effect(() => {
      const pedido = this.pedido();
      if (!pedido) return;
      untracked(() => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.api.estimar(pedido).then((e) => this.estimativa.set(e), () => this.estimativa.set(null)), 350);
      });
    });
  }

  async ngOnInit(): Promise<void> {
    this.entradas.set({ ...this.entradasIniciais });
    try {
      this.catalogo.set(await this.api.catalogo());
    } catch (e) {
      this.erroCatalogo.set(mensagemDeErro(e, 'Não consegui carregar os modelos'));
      return;
    }
    const primeiraOp = this.opsDisponiveis().find((o) => o.id === this.opInicial)?.id ?? this.opsDisponiveis()[0]?.id ?? '';
    const modelo = this.modelos().find((m) => primeiraOp in m.ops);
    this.op.set(primeiraOp);
    if (modelo) this.trocarModelo(modelo.id);
    this.encaixarIniciais();
  }

  // ---------- escolhas ----------

  trocarModelo(id: string): void {
    this.modeloId.set(id);
    const m = this.modelo();
    if (m && !(this.op() in m.ops)) this.op.set(this.config.operacoes.find((o) => o.id in m.ops)?.id ?? '');
    this.redefinirParametros();
  }

  trocarOp(id: string): void {
    this.op.set(id);
    if (!this.modelo() || !(id in this.modelo()!.ops)) {
      const m = this.modelos().find((x) => id in x.ops);
      if (m) this.modeloId.set(m.id);
    }
    this.redefinirParametros();
    this.encaixarIniciais();
  }

  /** Repete uma geração anterior (modelo, operação e parâmetros). */
  preencher(job: Job): void {
    if (!this.modelos().some((m) => m.id === job.modeloId)) return;
    this.modeloId.set(job.modeloId);
    this.op.set(job.operacao);
    this.params.set({ ...job.parametros });
  }

  definirEntrada(chave: string, midias: Midia[]): void {
    this.entradas.update((e) => ({ ...e, [chave]: midias }));
  }

  definir(p: string, v: Valor): void {
    this.params.update((x) => ({ ...x, [p]: v }));
  }

  definirLivre(p: string, texto: string): void {
    const t = texto.trim();
    this.params.update((x) => {
      const n = { ...x };
      if (t === '') delete n[p];
      else n[p] = this.numerico(p) && !isNaN(+t) ? +t : t;
      return n;
    });
  }

  abrirSeletor(chave: string): void {
    this.seletor.set(chave);
  }

  escolher(chave: string, midias: Midia[]): void {
    this.seletor.set(null);
    if (this.ehLista(chave)) {
      const atuais = this.entradas()[chave] ?? [];
      const novos = [...atuais, ...midias.filter((m) => !atuais.some((a) => a.id === m.id))];
      this.definirEntrada(chave, this.maxDe(chave) ? novos.slice(0, this.maxDe(chave)!) : novos);
    } else {
      this.definirEntrada(chave, midias.slice(0, 1));
    }
  }

  tirar(chave: string, m: Midia): void {
    this.definirEntrada(chave, (this.entradas()[chave] ?? []).filter((x) => x.id !== m.id));
  }

  async gerar(): Promise<void> {
    const pedido = this.pedido();
    if (!pedido) return;
    this.enviando.set(true);
    this.erro.set('');
    try {
      if (this.antesDeGerar) await this.antesDeGerar(pedido);
      const job = await this.api.gerar(pedido);
      this.gerado.emit(job);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui gerar'));
    } finally {
      this.enviando.set(false);
    }
  }

  // ---------- apoio do template ----------

  rotulo(p: string): string { return ROTULO_PARAMETRO[p] ?? p; }
  rotuloEntrada(e: string): string { return ROTULO_ENTRADA[e] ?? e; }
  tiposDaEntrada(e: string): TipoMidia[] { return TIPO_DA_ENTRADA[e] ?? ['imagem']; }
  ehLista(e: string): boolean { return LISTAS.has(e); }
  textoLongo(p: string): boolean { return TEXTOS_LONGOS.has(p); }
  numerico(p: string): boolean { return ['semente', 'faces', 'duracao', 'escala', 'forca'].includes(p); }
  opcoes(p: string): Valor[] { return this.spec()?.opcoes[p] ?? []; }
  limites(p: string): [number, number] | null { return this.spec()?.limites[p] ?? null; }
  obrigatoria(e: string): boolean { return e === 'fundo' || !!this.spec()?.obrigatorios.includes(e); }
  maxDe(e: string): number | null { return e === 'imagens' ? this.spec()?.maxImagens ?? null : null; }

  podeAdicionar(e: string): boolean {
    const n = this.entradas()[e]?.length ?? 0;
    if (!this.ehLista(e)) return n === 0;
    const max = this.maxDe(e);
    return !max || n < max;
  }

  valor(p: string): Valor | undefined {
    return this.params()[p] ?? this.spec()?.padroes[p];
  }

  valorTexto(p: string): string {
    const v = this.params()[p];
    return v == null ? '' : String(v);
  }

  igual(a: Valor | undefined, b: Valor): boolean {
    return a !== undefined && String(a) === String(b);
  }

  mostrar(p: string, v: Valor): string {
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    if (p === 'duracao') return `${v} s`;
    if (p === 'escala') return `${v}×`;
    if (p === 'qualidade') return ({ low: 'Baixa', medium: 'Média', high: 'Alta', standard: 'Padrão', detailed: 'Detalhada' } as Record<string, string>)[String(v)] ?? String(v);
    if (p === 'fundo') return v === 'transparent' ? 'Transparente' : 'Opaco';
    if (p === 'proporcao' && v === 'auto') return 'Automática';
    return String(v);
  }

  private redefinirParametros(): void {
    const prompt = this.params()['prompt'];
    const negativo = this.params()['negativo'];
    const novo: Record<string, Valor> = {};
    if (prompt !== undefined) novo['prompt'] = prompt;
    if (negativo !== undefined && this.spec()?.parametros.includes('negativo')) novo['negativo'] = negativo;
    this.params.set(novo);
  }

  /** Espalha os arquivos que a tela trouxe pelas entradas da operação atual (imagem → imagem ou imagens…). */
  private encaixarIniciais(): void {
    const s = this.spec();
    if (!s) return;
    const atuais = { ...this.entradas() };
    const soltos = Object.entries(this.entradasIniciais).filter(([k]) => !s.entradas.includes(k) && k !== 'fundo');
    for (const [, midias] of soltos) {
      for (const m of midias) {
        const destino = s.entradas.find((e) => this.tiposDaEntrada(e).includes(m.tipo) && !(this.config.ocultas ?? []).includes(e) && !(atuais[e]?.length && !this.ehLista(e)));
        if (destino && !(atuais[destino] ?? []).some((x) => x.id === m.id)) atuais[destino] = [...(atuais[destino] ?? []), m];
      }
    }
    this.entradas.set(atuais);
  }

  private pedido(): { modelo: string; operacao: string; parametros: Record<string, Valor>; entradas: Record<string, string[]>; app: string; pipeline?: string } | null {
    const m = this.modelo();
    const s = this.spec();
    if (!m || !s) return null;
    const parametros = { ...this.params() };
    if (this.config.promptPadrao && s.parametros.includes('prompt') && !String(parametros['prompt'] ?? '').trim()) parametros['prompt'] = this.config.promptPadrao;
    const entradas: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(this.entradas())) {
      if ((s.entradas.includes(k) || k === 'fundo') && v.length) entradas[k] = v.map((x) => x.id);
    }
    return { modelo: m.id, operacao: this.op(), parametros, entradas, app: this.appHistorico ?? this.config.id, pipeline: this.config.pipeline };
  }
}
