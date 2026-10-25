import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent } from '../../../../shared/icon';
import { mensagemDeErro } from '../../../../core/erro-http';
import { uuid } from '../../../../core/uuid';
import { ia } from '../../apps';
import { EstudioService } from '../../estudio.service';
import { Midia, QuadroResumo, Valor } from '../../estudio.models';
import { ESTUDIO_CSS } from '../../shared/estilos';
import { GerarModalComponent } from '../../shared/gerar-modal';
import { SeletorMidiaComponent } from '../../shared/seletor-midia';
import { JUNTAS, Junta, POSES, poseDe } from './boneco';
import { DocumentoCena, FundoCena, Forma, ObjetoCena, PROPORCOES, PalcoMotor, cenaVazia } from './palco-motor';

/** Prompt do render do palco para a geração final. */
export function promptDoPalco(descricao: string, estilo: string, personagens: number): string {
  const partes = [
    'Turn this rough 3D blocking render into a finished image.',
    'Keep exactly the camera angle, framing and composition, and the position, pose and size of every figure and object.',
  ];
  if (personagens > 0) {
    partes.push(personagens === 1
      ? 'The gray mannequin is the character shown in the second image: same face, hair and clothes.'
      : `The gray mannequins are the characters shown in the other ${personagens} images, from left to right in the same order: same faces, hair and clothes.`);
  }
  if (descricao.trim()) partes.push(descricao.trim());
  if (estilo.trim()) partes.push(`Style: ${estilo.trim()}.`);
  return partes.join(' ');
}

type Escolha = 'modelo' | 'imagem' | 'fundo-imagem' | 'fundo-panorama' | 'fundo-mundo' | 'personagens';

/**
 * Palco 3D: monte a cena antes de gerar — bonecos posáveis, objetos 3D da biblioteca (os do
 * "Objeto 3D"), imagens recortadas, fundo plano, panorama 360 ou mundo splat — e gere a imagem
 * final mantendo câmera, poses e composição (e a identidade dos personagens de referência).
 */
@Component({
  selector: 'app-palco',
  standalone: true,
  imports: [IconComponent, SeletorMidiaComponent, GerarModalComponent],
  template: `
    <div class="pc">
      <div class="pc-barra">
        <input class="e-input pc-nome" [value]="nome()" (input)="nome.set($any($event.target).value)" aria-label="Nome da cena" />
        <div class="e-chips">
          <button type="button" class="e-chip" [class.e-on]="modo() === 'translate'" (click)="definirModo('translate')" title="Mover (W)">Mover</button>
          <button type="button" class="e-chip" [class.e-on]="modo() === 'rotate'" (click)="definirModo('rotate')" title="Girar (E)">Girar</button>
          <button type="button" class="e-chip" [class.e-on]="modo() === 'scale'" (click)="definirModo('scale')" title="Escalar (R)">Escalar</button>
          <button type="button" class="e-chip" [class.e-on]="pose()" (click)="alternarPose()" title="Clique numa parte do boneco para girar só ela">Posar juntas</button>
        </div>
        <button type="button" class="e-btn e-sm" (click)="motor.enquadrar()">Enquadrar</button>
        <select class="e-select pc-prop" [value]="proporcao()" (change)="definirProporcao($any($event.target).value)" title="Proporção do render">
          @for (p of proporcoes; track p) { <option [value]="p">{{ p }}</option> }
        </select>
        <span class="pc-esp"></span>
        <button type="button" class="e-btn e-sm" (click)="abrirLista()"><app-icon name="folder" [size]="13" /> Abrir</button>
        <button type="button" class="e-btn e-sm" [disabled]="salvando()" (click)="salvar()">{{ salvando() ? 'Salvando…' : 'Salvar' }}</button>
        <button type="button" class="e-btn e-sm" (click)="baixarRender()"><app-icon name="download" [size]="13" /> Render</button>
        <button type="button" class="e-btn e-pri" [disabled]="preparando()" (click)="prepararGeracao()"><app-icon name="sparkles" [size]="14" /> {{ preparando() ? 'Renderizando…' : 'Gerar imagem' }}</button>
      </div>
      @if (lista(); as l) {
        <div class="e-card pc-lista">
          @for (q of l; track q.id) { <button type="button" class="e-btn e-sm" (click)="carregar(q.id)">{{ q.nome }}</button> }
          @empty { <span class="e-muted">Nenhuma cena salva.</span> }
          <button type="button" class="e-btn e-sm" (click)="lista.set(null)">Fechar</button>
        </div>
      }
      @if (erro()) { <p class="e-erro pc-pad">{{ erro() }}</p> }

      <div class="pc-corpo">
        <aside class="pc-lado e-card">
          <p class="pc-rot">Adicionar</p>
          <div class="pc-add">
            <button type="button" class="e-btn e-sm" (click)="addBoneco()"><app-icon name="plus" [size]="12" /> Boneco</button>
            <button type="button" class="e-btn e-sm" (click)="escolha.set('modelo')"><app-icon name="box" [size]="12" /> Modelo 3D</button>
            <button type="button" class="e-btn e-sm" (click)="escolha.set('imagem')"><app-icon name="image" [size]="12" /> Imagem</button>
            @for (f of formas; track f.id) { <button type="button" class="e-btn e-sm" (click)="addForma(f.id)">{{ f.nome }}</button> }
          </div>
          <p class="pc-rot">Na cena</p>
          <div class="pc-objs">
            @for (o of objetos(); track o.id) {
              <button type="button" class="pc-obj" [class.pc-on]="sel()?.id === o.id" (click)="motor.selecionar(o.id)">{{ o.nome }}</button>
            } @empty {
              <span class="e-muted pc-pequeno">Comece com um boneco ou um modelo 3D.</span>
            }
          </div>
        </aside>

        <div class="pc-view" #view></div>

        <aside class="pc-props e-card">
          @if (sel(); as o) {
            <div class="pc-linha">
              <input class="e-input" [value]="o.nome" (change)="mudar({ nome: $any($event.target).value })" aria-label="Nome do objeto" />
              <button type="button" class="e-ib" (click)="duplicar(o)" title="Duplicar" aria-label="Duplicar"><app-icon name="duplicate" [size]="14" /></button>
              <button type="button" class="e-ib" (click)="motor.remover(o.id)" title="Tirar da cena" aria-label="Tirar"><app-icon name="delete" [size]="14" /></button>
            </div>
            @if (o.tipo !== 'modelo' && o.tipo !== 'imagem') {
              <label class="e-campo"><span>Cor</span><input type="color" [value]="o.cor ?? '#c9b8a6'" (input)="mudar({ cor: $any($event.target).value })" /></label>
            }
            @for (eixo of ['posicao', 'rotacao', 'escala']; track eixo) {
              <div class="e-campo">
                <span>{{ eixo === 'posicao' ? 'Posição (m)' : eixo === 'rotacao' ? 'Rotação (°)' : 'Escala' }}</span>
                <div class="pc-xyz">
                  @for (i of [0, 1, 2]; track i) {
                    <input class="e-input" type="number" [step]="eixo === 'rotacao' ? 5 : 0.1" [value]="$any(o)[eixo][i]" (change)="mudarEixo(eixo, i, +$any($event.target).value)" />
                  }
                </div>
              </div>
            }
            @if (o.tipo === 'boneco') {
              <div class="e-campo">
                <span>Pose pronta</span>
                <div class="e-chips">
                  @for (p of poses; track p.id) { <button type="button" class="e-chip" (click)="mudar({ pose: poseDe(p.id) })">{{ p.nome }}</button> }
                </div>
              </div>
              <label class="e-campo">
                <span>Junta</span>
                <select class="e-select" [value]="junta() ?? ''" (change)="escolherJunta($any($event.target).value)">
                  <option value="">— escolha (ou clique no boneco com "Posar juntas") —</option>
                  @for (j of juntas; track j.id) { <option [value]="j.id">{{ j.nome }}</option> }
                </select>
              </label>
              @if (junta(); as j) {
                @for (i of [0, 1, 2]; track i) {
                  <label class="e-campo"><span>{{ ['Frente/trás', 'Torcer', 'Lado'][i] }}: {{ grau(o, j, i) }}°</span>
                    <input type="range" min="-180" max="180" step="1" [value]="grau(o, j, i)" (input)="mudarJunta(o, j, i, +$any($event.target).value)" />
                  </label>
                }
              }
            }
          } @else {
            <p class="pc-rot">Fundo</p>
            <div class="e-chips">
              <button type="button" class="e-chip" [class.e-on]="fundo().tipo === 'cor'" (click)="definirFundo({ tipo: 'cor', cor: fundo().cor ?? '#d9dce3' })">Cor</button>
              <button type="button" class="e-chip" [class.e-on]="fundo().tipo === 'imagem'" (click)="escolha.set('fundo-imagem')">Imagem</button>
              <button type="button" class="e-chip" [class.e-on]="fundo().tipo === 'panorama'" (click)="escolha.set('fundo-panorama')">Panorama 360</button>
              <button type="button" class="e-chip" [class.e-on]="fundo().tipo === 'mundo'" (click)="escolha.set('fundo-mundo')">Mundo 3D</button>
            </div>
            @if (fundo().tipo === 'cor') {
              <input type="color" [value]="fundo().cor ?? '#d9dce3'" (input)="definirFundo({ tipo: 'cor', cor: $any($event.target).value })" />
            }
            <label class="pc-check"><input type="checkbox" [checked]="chao()" (change)="alternarChao($any($event.target).checked)" /> Chão com sombra</label>
            <p class="pc-rot">Câmera</p>
            <label class="e-campo"><span>Lente: {{ fov() }}° ({{ lente() }} mm)</span><input type="range" min="15" max="90" [value]="fov()" (input)="definirFov(+$any($event.target).value)" /></label>
            <p class="pc-rot">Luz</p>
            <label class="e-campo"><span>Intensidade</span><input type="range" min="0" max="5" step="0.1" [value]="luz().intensidade" (input)="mudarLuz('intensidade', +$any($event.target).value)" /></label>
            <label class="e-campo"><span>Direção: {{ luz().azimute }}°</span><input type="range" min="-180" max="180" [value]="luz().azimute" (input)="mudarLuz('azimute', +$any($event.target).value)" /></label>
            <label class="e-campo"><span>Altura: {{ luz().elevacao }}°</span><input type="range" min="5" max="90" [value]="luz().elevacao" (input)="mudarLuz('elevacao', +$any($event.target).value)" /></label>
          }
          <hr />
          <p class="pc-rot">Para gerar</p>
          <textarea class="e-textarea" rows="3" placeholder="O que é a cena (ex.: dois amigos conversando num café em Lisboa ao entardecer)" [value]="descricao()" (input)="descricao.set($any($event.target).value)"></textarea>
          <input class="e-input" placeholder="Estilo (ex.: fotografia de cinema, 35 mm)" [value]="estilo()" (input)="estilo.set($any($event.target).value)" />
          <div class="e-campo">
            <span>Personagens (identidade dos bonecos, na ordem)</span>
            <div class="pc-pers">
              @for (m of personagens(); track m.id) {
                <button type="button" class="pc-pers-item" (click)="tirarPersonagem(m)" title="Tirar"><img [src]="m.thumb ?? m.url" alt="" /></button>
              }
              <button type="button" class="e-btn e-sm" (click)="escolha.set('personagens')"><app-icon name="plus" [size]="12" /></button>
            </div>
          </div>
        </aside>
      </div>
    </div>

    @if (escolha(); as e) {
      <e-seletor-midia [titulo]="tituloEscolha(e)" [tipos]="tiposEscolha(e)" [multiplo]="e === 'personagens'" [max]="e === 'personagens' ? 4 : null"
        (escolhido)="escolhido(e, $event)" (fechar)="escolha.set(null)" />
    }
    @if (render(); as r) {
      <e-gerar-modal titulo="Gerar a cena" [config]="cfgImagem" opInicial="editar" appHistorico="palco"
        [entradasIniciais]="{ imagens: [r].concat(personagens()) }" [parametrosIniciais]="parametrosGeracao()"
        (concluido)="gerado($event)" (fechar)="render.set(null)" />
    }
  `,
  styles: [ESTUDIO_CSS, `
    :host { display: block; height: 100%; }
    .pc { height: 100%; display: flex; flex-direction: column; }
    .pc-barra { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; }
    .pc-nome { max-width: 200px; font-weight: 600; }
    .pc-prop { width: 80px; }
    .pc-esp { flex: 1; }
    .pc-lista { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; margin: 8px 12px 0; }
    .pc-pad { padding: 0 12px; }
    .pc-corpo { flex: 1; min-height: 0; display: grid; grid-template-columns: 200px 1fr 290px; }
    .pc-lado, .pc-props { border-radius: 0; border-width: 0 1px 0 0; padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    .pc-props { border-width: 0 0 0 1px; }
    .pc-rot { margin: 4px 0 0; font-size: 12px; font-weight: 700; color: var(--text-muted); }
    .pc-add { display: flex; flex-wrap: wrap; gap: 6px; }
    .pc-objs { display: flex; flex-direction: column; gap: 2px; }
    .pc-obj { text-align: left; border: none; background: none; padding: 6px 8px; border-radius: 6px; font-size: 13px; }
    .pc-obj:hover { background: var(--tag-bg); }
    .pc-obj.pc-on { background: var(--accent-soft); color: var(--accent-dark); font-weight: 600; }
    .pc-pequeno { font-size: 12px; }
    .pc-view { position: relative; min-width: 0; min-height: 300px; background: #222; }
    .pc-linha { display: flex; gap: 6px; }
    .pc-xyz { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
    .pc-xyz .e-input { padding: 6px; font-size: 12.5px; }
    .pc-check { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    .pc-pers { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .pc-pers-item { width: 44px; height: 44px; padding: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: none; }
    .pc-pers-item img { width: 100%; height: 100%; object-fit: cover; }
    hr { border: none; border-top: 1px solid var(--border); width: 100%; margin: 6px 0; }
    input[type=range] { width: 100%; accent-color: var(--accent); }
    @media (max-width: 1000px) { .pc-corpo { grid-template-columns: 1fr; grid-template-rows: 55vh auto auto; } .pc-lado { order: 2; } .pc-props { order: 3; } }
  `],
})
export class PalcoPageComponent implements AfterViewInit, OnDestroy {
  private readonly api = inject(EstudioService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @ViewChild('view', { static: true }) view!: ElementRef<HTMLDivElement>;

  readonly motor = new PalcoMotor();
  readonly cfgImagem = ia('criar-imagem')!;
  readonly poses = POSES;
  readonly juntas = JUNTAS;
  readonly poseDe = poseDe;
  readonly proporcoes = Object.keys(PROPORCOES);
  readonly formas: { id: Forma; nome: string }[] = [
    { id: 'cubo', nome: 'Cubo' }, { id: 'esfera', nome: 'Esfera' }, { id: 'cilindro', nome: 'Cilindro' }, { id: 'cone', nome: 'Cone' }, { id: 'plano', nome: 'Plano' },
  ];

  readonly id = signal(uuid());
  readonly nome = signal('Cena');
  readonly objetos = signal<ObjetoCena[]>([]);
  readonly sel = signal<ObjetoCena | null>(null);
  readonly junta = signal<Junta | null>(null);
  readonly modo = signal<'translate' | 'rotate' | 'scale'>('translate');
  readonly pose = signal(false);
  readonly fundo = signal<FundoCena>(cenaVazia().fundo);
  readonly luz = signal(cenaVazia().luz);
  readonly fov = signal(40);
  readonly chao = signal(true);
  readonly proporcao = signal('16:9');
  readonly midias = signal(new Map<string, Midia>());
  readonly personagens = signal<Midia[]>([]);
  readonly descricao = signal('');
  readonly estilo = signal('');
  readonly escolha = signal<Escolha | null>(null);
  readonly render = signal<Midia | null>(null);
  readonly lista = signal<QuadroResumo[] | null>(null);
  readonly preparando = signal(false);
  readonly salvando = signal(false);
  readonly erro = signal('');
  readonly lente = computed(() => Math.round(12 / Math.tan((this.fov() * Math.PI) / 360)));

  async ngAfterViewInit(): Promise<void> {
    this.motor.aoSelecionar = (id, junta) => {
      this.sel.set(id ? { ...this.motor.objeto(id)! } : null);
      this.junta.set(junta);
    };
    this.motor.aoMudar = () => this.objetos.set(this.motor.objetos().map((o) => ({ ...o })));
    try {
      await this.motor.iniciar(this.view.nativeElement, (id) => {
        const m = this.midias().get(id);
        return m ? { url: m.url, nome: m.nome } : undefined;
      });
    } catch (e) {
      this.erro.set('Não consegui abrir o 3D neste navegador: ' + (e instanceof Error ? e.message : e));
      return;
    }
    const q = this.route.snapshot.queryParamMap;
    if (q.get('quadro')) await this.carregar(q.get('quadro')!);
    else this.addBoneco();
    const entrada = q.get('entrada');
    if (entrada) {
      const m = await this.api.midia(entrada).catch(() => null);
      if (m) await this.escolhido(m.tipo === 'mundo' ? 'fundo-mundo' : m.tipo === 'modelo3d' ? 'modelo' : 'imagem', [m]);
    }
    window.addEventListener('keydown', this.teclas);
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.teclas);
    this.motor.destruir();
  }

  private readonly teclas = (e: KeyboardEvent) => {
    const alvo = e.target as HTMLElement;
    if (alvo.closest('input, textarea, select')) return;
    if (e.key === 'w') this.definirModo('translate');
    if (e.key === 'e') this.definirModo('rotate');
    if (e.key === 'r') this.definirModo('scale');
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel()) this.motor.remover(this.sel()!.id);
  };

  // ---------- objetos ----------

  addBoneco(): void {
    const n = this.objetos().filter((o) => o.tipo === 'boneco').length;
    void this.motor.adicionar({
      id: uuid(), tipo: 'boneco', nome: `Boneco ${n + 1}`, posicao: [n * 0.8 - (n ? 0.4 : 0), 0, 0], rotacao: [0, 0, 0], escala: [1, 1, 1],
      cor: ['#c9b8a6', '#a8b7c9', '#b9c9a8', '#c9a8b9'][n % 4], pose: poseDe('pe'),
    });
  }

  addForma(forma: Forma): void {
    void this.motor.adicionar({
      id: uuid(), tipo: 'forma', forma, nome: this.formas.find((f) => f.id === forma)!.nome, posicao: [1.2, 0, -0.5], rotacao: [0, 0, 0], escala: [1, 1, 1], cor: '#9aa4b5',
    });
  }

  duplicar(o: ObjetoCena): void {
    this.motor.duplicar(o.id, uuid());
  }

  mudar(m: Partial<ObjetoCena>): void {
    const o = this.sel();
    if (!o) return;
    this.motor.atualizar(o.id, m);
    this.sel.set({ ...this.motor.objeto(o.id)! });
  }

  mudarEixo(eixo: string, i: number, v: number): void {
    const o = this.sel();
    if (!o || !Number.isFinite(v)) return;
    const atual = [...(o as unknown as Record<string, [number, number, number]>)[eixo]] as [number, number, number];
    atual[i] = v;
    this.mudar({ [eixo]: atual });
  }

  escolherJunta(j: string): void {
    const o = this.sel();
    if (!o) return;
    this.motor.selecionar(o.id, (j || null) as Junta | null);
  }

  grau(o: ObjetoCena, j: Junta, i: number): number {
    return o.pose?.[j]?.[i] ?? 0;
  }

  mudarJunta(o: ObjetoCena, j: Junta, i: number, v: number): void {
    const r = [...(o.pose?.[j] ?? [0, 0, 0])] as [number, number, number];
    r[i] = v;
    this.motor.definirJunta(o.id, j, r);
    this.sel.set({ ...this.motor.objeto(o.id)! });
  }

  definirModo(m: 'translate' | 'rotate' | 'scale'): void {
    this.modo.set(m);
    this.motor.modo(m);
  }

  alternarPose(): void {
    this.pose.set(!this.pose());
    this.motor.definirModoPose(this.pose());
  }

  // ---------- ambiente ----------

  async definirFundo(f: FundoCena): Promise<void> {
    this.fundo.set(f);
    await this.motor.definirFundo(f);
  }

  alternarChao(sim: boolean): void {
    this.chao.set(sim);
    this.motor.mostrarChao(sim);
  }

  definirFov(v: number): void {
    this.fov.set(v);
    this.motor.definirFov(v);
  }

  mudarLuz(campo: 'intensidade' | 'azimute' | 'elevacao', v: number): void {
    this.luz.update((l) => ({ ...l, [campo]: v }));
    this.motor.definirLuz(this.luz());
  }

  definirProporcao(p: string): void {
    this.proporcao.set(p);
    this.motor.definirProporcao(p);
  }

  tituloEscolha(e: Escolha): string {
    return ({ modelo: 'Modelo 3D', imagem: 'Imagem (de preferência sem fundo)', 'fundo-imagem': 'Imagem de fundo', 'fundo-panorama': 'Panorama 360 (equiretangular)', 'fundo-mundo': 'Mundo 3D (splat)', personagens: 'Personagens' } as Record<Escolha, string>)[e];
  }

  tiposEscolha(e: Escolha): ('imagem' | 'modelo3d' | 'mundo')[] {
    return e === 'modelo' ? ['modelo3d'] : e === 'fundo-mundo' ? ['mundo'] : ['imagem'];
  }

  async escolhido(e: Escolha, lista: Midia[]): Promise<void> {
    this.escolha.set(null);
    if (!lista.length) return;
    this.midias.update((mapa) => { const n = new Map(mapa); lista.forEach((m) => n.set(m.id, m)); return n; });
    const m = lista[0];
    try {
      switch (e) {
        case 'modelo':
          await this.motor.adicionar({ id: uuid(), tipo: 'modelo', midia: m.id, nome: m.nome.replace(/\.[^.]+$/, ''), posicao: [-1, 0, 0], rotacao: [0, 0, 0], escala: [1, 1, 1] });
          break;
        case 'imagem':
          await this.motor.adicionar({ id: uuid(), tipo: 'imagem', midia: m.id, nome: m.nome.replace(/\.[^.]+$/, ''), posicao: [0, 0, -1], rotacao: [0, 0, 0], escala: [1.5, 1.5, 1.5] });
          break;
        case 'fundo-imagem': await this.definirFundo({ tipo: 'imagem', midia: m.id }); break;
        case 'fundo-panorama': await this.definirFundo({ tipo: 'panorama', midia: m.id }); break;
        case 'fundo-mundo': await this.definirFundo({ tipo: 'mundo', midia: m.id }); break;
        case 'personagens': this.personagens.update((l) => [...l, ...lista.filter((x) => !l.some((y) => y.id === x.id))].slice(0, 4)); break;
      }
    } catch (err) {
      this.erro.set('Não consegui pôr na cena: ' + (err instanceof Error ? err.message : err));
    }
  }

  tirarPersonagem(m: Midia): void {
    this.personagens.update((l) => l.filter((x) => x.id !== m.id));
  }

  // ---------- gerar ----------

  parametrosGeracao(): Record<string, Valor> {
    return { prompt: promptDoPalco(this.descricao(), this.estilo(), this.personagens().length), proporcao: this.proporcao() };
  }

  async prepararGeracao(): Promise<void> {
    this.preparando.set(true);
    this.erro.set('');
    try {
      const blob = await this.motor.renderizar();
      const m = await this.api.enviarBytes(blob, `${this.nome()} — render.png`, 'palco', 'Palco 3D');
      this.render.set(m);
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui renderizar a cena'));
    } finally {
      this.preparando.set(false);
    }
  }

  gerado(m: Midia[]): void {
    this.render.set(null);
    if (m[0]) void this.router.navigate(['/estudio/biblioteca'], { queryParams: { m: m[0].id } });
  }

  async baixarRender(): Promise<void> {
    const blob = await this.motor.renderizar();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.nome()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- salvar ----------

  async salvar(): Promise<void> {
    this.salvando.set(true);
    this.erro.set('');
    try {
      const doc: DocumentoCena & { descricao: string; estilo: string; personagens: string[] } = {
        ...this.motor.documento(), descricao: this.descricao(), estilo: this.estilo(), personagens: this.personagens().map((p) => p.id),
      };
      const thumb = await miniatura(await this.motor.renderizar());
      await this.api.salvarQuadro(this.id(), 'cena', this.nome(), doc, thumb);
      void this.router.navigate([], { queryParams: { quadro: this.id() }, replaceUrl: true });
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui salvar a cena'));
    } finally {
      this.salvando.set(false);
    }
  }

  async abrirLista(): Promise<void> {
    this.lista.set(await this.api.quadros('cena'));
  }

  async carregar(id: string): Promise<void> {
    this.lista.set(null);
    try {
      const q = await this.api.quadro(id);
      const d = JSON.parse(q.data) as DocumentoCena & { descricao?: string; estilo?: string; personagens?: string[] };
      const ids = [...new Set([...d.objetos.map((o) => o.midia), d.fundo.midia, ...(d.personagens ?? [])].filter((x): x is string => !!x))];
      const achadas = (await Promise.all(ids.map((i) => this.api.midia(i).catch(() => null)))).filter((m): m is Midia => !!m);
      this.midias.set(new Map(achadas.map((m) => [m.id, m])));
      this.id.set(q.id);
      this.nome.set(q.nome);
      this.descricao.set(d.descricao ?? '');
      this.estilo.set(d.estilo ?? '');
      this.personagens.set(achadas.filter((m) => d.personagens?.includes(m.id)));
      this.fundo.set(d.fundo);
      this.luz.set(d.luz);
      this.fov.set(d.camera.fov);
      this.chao.set(d.chao);
      this.proporcao.set(d.proporcao);
      await this.motor.carregar({ ...d, objetos: d.objetos.filter((o) => !o.midia || this.midias().has(o.midia)) });
      this.objetos.set(this.motor.objetos().map((o) => ({ ...o })));
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não consegui abrir a cena'));
    }
  }
}

async function miniatura(blob: Blob): Promise<string> {
  const img = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = Math.round((img.height / img.width) * 320);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
