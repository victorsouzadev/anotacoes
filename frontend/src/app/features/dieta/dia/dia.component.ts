import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../../core/erro-http';
import { IconComponent } from '../../../shared/icon';
import { DietaApiService } from '../dieta-api.service';
import { arred, barrasDoDia, dataLocal, porRefeicao, rotuloData, somarDias, valoresDaPorcao } from '../dieta-calc';
import { Alimento, DiaResposta, REFEICOES, Refeicao, Registro } from '../dieta.models';

/** Aba "Dia" (spec 016): totais × metas, refeições, água, peso, registrar e repetir. */
@Component({
  selector: 'app-dieta-dia',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="navegar">
      <button type="button" (click)="mudarDia(-1)" aria-label="Dia anterior">‹</button>
      <strong>{{ rotulo() }}</strong>
      <button type="button" (click)="mudarDia(1)" [disabled]="data() >= hoje" aria-label="Próximo dia">›</button>
      @if (data() !== hoje) { <button type="button" class="link" (click)="irPara(hoje)">Hoje</button> }
    </div>

    @if (erro(); as e) { <p class="erro">{{ e }}</p> }

    @if (dia(); as d) {
      <section class="card">
        <div class="barras">
          @for (b of barras(); track b.nome) {
            <div class="barra">
              <div class="rotulo"><span>{{ b.nome }}</span><span>{{ arred(b.valor) }} / {{ arred(b.meta) }} {{ b.unidade }}</span></div>
              <div class="trilho"><div class="cheio" [class.passou]="b.pct > 110 && b.nome === 'Calorias'" [style.width.%]="b.pct > 100 ? 100 : b.pct"></div></div>
            </div>
          }
        </div>
        <div class="extras">
          @if (d.adesaoPlano !== null) { <span>Plano: {{ d.adesaoPlano }}%</span> }
          <span>Peso: {{ d.peso !== null ? arred(d.peso, 1) + ' kg' : '—' }}</span>
        </div>
      </section>

      <section class="card linha">
        <div class="agua">
          <span>Água: {{ arred(d.totais.aguaMl) }} ml</span>
          <button type="button" (click)="addAgua(250)">+250 ml</button>
          <button type="button" (click)="addAgua(500)">+500 ml</button>
          @if (d.agua.length) { <button type="button" class="link" (click)="desfazerAgua()">desfazer</button> }
        </div>
        <form class="peso" (submit)="$event.preventDefault(); salvarPeso()">
          <input type="number" step="0.1" min="20" max="400" placeholder="Peso (kg)" [(ngModel)]="pesoKg" name="peso" />
          <button type="submit" [disabled]="!pesoKg">Salvar peso</button>
        </form>
      </section>

      @for (g of grupos(); track g.refeicao) {
        <section class="card refeicao">
          <header>
            <h3>{{ g.nome }}</h3>
            <span class="kcal">{{ arred(g.kcal) }} kcal</span>
            <button type="button" (click)="abrirAdicionar(g.refeicao)"><app-icon name="plus" [size]="14" /> Adicionar</button>
            <button type="button" class="link" (click)="repetirOntem(g.refeicao)" title="Copia os itens desta refeição de ontem">Repetir de ontem</button>
          </header>
          @for (r of g.itens; track r.id) {
            <div class="item">
              <span class="nome">{{ r.nome }}</span>
              <input type="number" min="1" max="5000" [ngModel]="r.quantidadeG" (change)="mudarQuantidade(r, $any($event.target).value)" aria-label="Gramas" /> g
              <span class="kcal">{{ arred(r.kcal) }} kcal · P {{ arred(r.proteina) }} g</span>
              @if (r.fotoId) { <button type="button" class="icone" (click)="verFoto(r.fotoId)" title="Ver foto"><app-icon name="image" [size]="14" /></button> }
              <button type="button" class="icone" (click)="excluir(r)" title="Excluir"><app-icon name="delete" [size]="14" /></button>
            </div>
          } @empty {
            <p class="vazio">Nada registrado.</p>
          }
          @if (adicionando() === g.refeicao) {
            <div class="adicionar">
              <input [(ngModel)]="busca" (ngModelChange)="buscar()" placeholder="Buscar alimento (ex.: arroz cozido)" autofocus />
              @if (escolhido(); as a) {
                <div class="escolhido">
                  <strong>{{ a.nome }}</strong>
                  <input type="number" min="1" max="5000" [(ngModel)]="gramas" aria-label="Gramas" /> g
                  <span class="kcal">{{ arred(previa(a).kcal) }} kcal</span>
                  <button type="button" class="primario" (click)="registrar(g.refeicao, a)">Registrar</button>
                  <button type="button" class="link" (click)="escolhido.set(null)">trocar</button>
                </div>
              } @else {
                <ul class="resultados">
                  @for (a of resultados(); track a.id) {
                    <li><button type="button" (click)="escolher(a)">{{ a.nome }} <span>{{ arred(a.kcal) }} kcal/100 g{{ a.proprio ? ' · meu' : '' }}</span></button></li>
                  }
                </ul>
              }
            </div>
          }
        </section>
      }
    } @else if (!erro()) {
      <p class="vazio">Carregando…</p>
    }

    @if (foto(); as f) {
      <div class="foto" (click)="fecharFoto()"><img [src]="f" alt="Foto da refeição" /></div>
    }
  `,
  styleUrl: './dia.component.css',
})
export class DiaComponent implements OnInit {
  private api = inject(DietaApiService);
  readonly hoje = dataLocal();
  readonly arred = arred;
  readonly refeicoes = REFEICOES;

  readonly data = signal(this.hoje);
  readonly dia = signal<DiaResposta | null>(null);
  readonly erro = signal<string | null>(null);
  readonly adicionando = signal<Refeicao | null>(null);
  readonly resultados = signal<Alimento[]>([]);
  readonly escolhido = signal<Alimento | null>(null);
  readonly foto = signal<string | null>(null);
  busca = '';
  gramas = 100;
  pesoKg: number | null = null;
  private timerBusca: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    void this.carregar();
  }

  rotulo(): string {
    return rotuloData(this.data(), this.hoje);
  }

  barras() {
    const d = this.dia();
    return d ? barrasDoDia(d.totais, d.metas) : [];
  }

  grupos() {
    return porRefeicao(this.dia()?.registros ?? []);
  }

  async carregar(): Promise<void> {
    try {
      this.erro.set(null);
      const d = await this.api.dia(this.data());
      this.dia.set(d);
      this.pesoKg = d.peso;
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível carregar o dia — verifique sua conexão'));
    }
  }

  mudarDia(delta: number): void {
    this.irPara(somarDias(this.data(), delta));
  }

  irPara(data: string): void {
    this.data.set(data > this.hoje ? this.hoje : data);
    this.adicionando.set(null);
    void this.carregar();
  }

  abrirAdicionar(r: Refeicao): void {
    this.adicionando.set(this.adicionando() === r ? null : r);
    this.busca = '';
    this.resultados.set([]);
    this.escolhido.set(null);
    this.gramas = 100;
  }

  buscar(): void {
    if (this.timerBusca) clearTimeout(this.timerBusca);
    const q = this.busca.trim();
    this.timerBusca = setTimeout(async () => {
      if (q.length < 2) { this.resultados.set([]); return; }
      try { this.resultados.set(await this.api.buscarAlimentos(q)); } catch { this.resultados.set([]); }
    }, 250);
  }

  escolher(a: Alimento): void {
    this.escolhido.set(a);
    this.gramas = Math.round(a.porcaoG || 100);
  }

  previa(a: Alimento) {
    return valoresDaPorcao(a, this.gramas || 0);
  }

  async registrar(refeicao: Refeicao, a: Alimento): Promise<void> {
    if (!this.gramas || this.gramas <= 0) return;
    await this.acao(() => this.api.registrar(this.data(), refeicao, a, this.gramas));
    this.adicionando.set(null);
  }

  async mudarQuantidade(r: Registro, valor: string): Promise<void> {
    const g = Number(valor);
    if (!g || g <= 0 || g > 5000 || g === r.quantidadeG) return;
    await this.acao(() => this.api.atualizarRegistro(r, g));
  }

  async excluir(r: Registro): Promise<void> {
    await this.acao(() => this.api.atualizarRegistro(r, null));
  }

  async repetirOntem(refeicao: Refeicao): Promise<void> {
    await this.acao(async () => {
      const novos = await this.api.repetir(somarDias(this.data(), -1), this.data(), refeicao);
      if (novos.length === 0) this.erro.set('Nada registrado nessa refeição no dia anterior.');
    });
  }

  async addAgua(ml: number): Promise<void> {
    await this.acao(() => this.api.agua(this.data(), ml));
  }

  async desfazerAgua(): Promise<void> {
    const ultima = [...(this.dia()?.agua ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (ultima) await this.acao(() => this.api.excluirAgua(ultima));
  }

  async salvarPeso(): Promise<void> {
    const kg = Number(this.pesoKg);
    if (!kg || kg < 20 || kg > 400) { this.erro.set('Peso entre 20 e 400 kg.'); return; }
    await this.acao(() => this.api.salvarPeso(this.data(), kg));
  }

  async verFoto(id: string): Promise<void> {
    try { this.foto.set(await this.api.fotoUrl(id)); } catch { this.erro.set('Não foi possível abrir a foto.'); }
  }

  fecharFoto(): void {
    const f = this.foto();
    if (f) URL.revokeObjectURL(f);
    this.foto.set(null);
  }

  /** Grava, recarrega o dia e mostra o erro da API em português, sem fingir que salvou. */
  private async acao(fn: () => Promise<unknown>): Promise<void> {
    try {
      this.erro.set(null);
      await fn();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível salvar — verifique sua conexão'));
    }
    await this.carregar();
  }
}
