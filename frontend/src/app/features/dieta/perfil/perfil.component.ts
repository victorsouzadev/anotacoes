import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../../core/erro-http';
import { IconComponent } from '../../../shared/icon';
import { DietaApiService } from '../dieta-api.service';
import { arred, nomeRefeicao } from '../dieta-calc';
import { Alimento, Metas, Perfil, PlanoItem, REFEICOES, Refeicao } from '../dieta.models';

/** DiaSemana da API: -1 = todos os dias, 0 = domingo … 6 = sábado. */
const DIAS: { valor: number; nome: string }[] = [
  { valor: -1, nome: 'Todos os dias' },
  ...['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((nome, valor) => ({ valor, nome })),
];

/** Aba "Perfil e plano" (spec 016): perfil, metas (com a sugestão ao lado) e plano da semana. */
@Component({
  selector: 'app-dieta-perfil',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (erro(); as e) { <p class="erro">{{ e }}</p> }
    @if (ok(); as m) { <p class="ok">{{ m }}</p> }
    <section class="card">
      <h3>Perfil</h3>
      <div class="grade">
        <label>Altura (cm)<input type="number" [(ngModel)]="f.alturaCm" min="0" max="260" /></label>
        <label>Nascimento<input type="date" [(ngModel)]="f.nascimento" /></label>
        <label>Sexo<select [(ngModel)]="f.sexo"><option value="F">Feminino</option><option value="M">Masculino</option></select></label>
        <label>Atividade<select [(ngModel)]="f.atividade">
          <option [ngValue]="1.2">Sedentário</option><option [ngValue]="1.375">Leve</option>
          <option [ngValue]="1.55">Moderado</option><option [ngValue]="1.725">Intenso</option><option [ngValue]="1.9">Muito intenso</option>
        </select></label>
        <label>Objetivo<select [(ngModel)]="f.objetivo"><option value="perder">Perder peso</option><option value="manter">Manter</option><option value="ganhar">Ganhar massa</option></select></label>
      </div>
      <h3>Metas do dia</h3>
      <p class="sub">Deixe em 0 para usar a sugestão calculada (Mifflin-St Jeor × atividade, ajustada pelo objetivo).</p>
      <div class="grade">
        @for (c of camposMeta; track c.campo) {
          <label>{{ c.nome }}
            <input type="number" min="0" [(ngModel)]="f[c.campo]" />
            @if (sugestao(); as s) { <span class="sub">sugestão: {{ arred(s[c.sug]) }}</span> }
          </label>
        }
      </div>
      <button type="button" class="primario" (click)="salvar()">Salvar perfil e metas</button>
    </section>

    <section class="card">
      <h3>Plano alimentar da semana</h3>
      @for (dia of dias; track dia.valor) {
        @if (itensDoDia(dia.valor).length) {
          <h4>{{ dia.nome }}</h4>
          @for (it of itensDoDia(dia.valor); track it.id) {
            <div class="item"><span>{{ nomeRefeicao(it.refeicao) }}</span><strong>{{ it.nome }}</strong><span>{{ arred(it.quantidadeG) }} g</span>
              <button type="button" class="icone" (click)="excluirItem(it)" title="Tirar do plano"><app-icon name="delete" [size]="14" /></button></div>
          }
        }
      }
      @if (plano().length === 0) { <p class="sub">Nenhum item no plano.</p> }
      <div class="novo">
        <select [(ngModel)]="novoDia">
          @for (dia of dias; track dia.valor) { <option [ngValue]="dia.valor">{{ dia.nome }}</option> }
        </select>
        <select [(ngModel)]="novaRefeicao">
          @for (r of refeicoes; track r.valor) { <option [ngValue]="r.valor">{{ r.nome }}</option> }
        </select>
        <input [(ngModel)]="busca" (ngModelChange)="buscar()" placeholder="Alimento" list="dieta-plano-alimentos" />
        <datalist id="dieta-plano-alimentos">
          @for (a of resultados(); track a.id) { <option [value]="a.nome"></option> }
        </datalist>
        <input type="number" min="1" [(ngModel)]="gramas" aria-label="Gramas" /> g
        <button type="button" (click)="adicionarItem()"><app-icon name="plus" [size]="14" /> Adicionar</button>
      </div>
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
    h3 { margin: 0 0 8px; font-size: 15px; } h4 { margin: 12px 0 4px; font-size: 13px; color: var(--text-muted); }
    .grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-bottom: 12px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; }
    input, select { border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 7px 8px; font-size: 13px; font-weight: 400; }
    button { border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
    .primario { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
    .sub { font-size: 12px; color: var(--text-muted); font-weight: 400; margin: 0 0 8px; }
    .item { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 4px 0; }
    .item strong { flex: 1; font-weight: 500; }
    .icone { border: none; background: none; padding: 4px; color: var(--text-muted); }
    .novo { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--border); font-size: 13px; }
    .novo input[type=number] { width: 80px; }
    .erro { color: var(--danger); font-size: 13px; margin: 0; } .ok { color: var(--positivo); font-size: 13px; margin: 0; }
  `],
})
export class PerfilComponent implements OnInit {
  private api = inject(DietaApiService);
  readonly arred = arred;
  readonly nomeRefeicao = nomeRefeicao;
  readonly dias = DIAS;
  readonly refeicoes = REFEICOES;
  readonly camposMeta: { campo: 'metaKcal' | 'metaProteinaG' | 'metaCarboG' | 'metaGorduraG' | 'metaAguaMl'; nome: string; sug: keyof Metas }[] = [
    { campo: 'metaKcal', nome: 'Calorias (kcal)', sug: 'kcal' },
    { campo: 'metaProteinaG', nome: 'Proteína (g)', sug: 'proteinaG' },
    { campo: 'metaCarboG', nome: 'Carboidrato (g)', sug: 'carboG' },
    { campo: 'metaGorduraG', nome: 'Gordura (g)', sug: 'gorduraG' },
    { campo: 'metaAguaMl', nome: 'Água (ml)', sug: 'aguaMl' },
  ];

  readonly sugestao = signal<Metas | null>(null);
  readonly plano = signal<PlanoItem[]>([]);
  readonly resultados = signal<Alimento[]>([]);
  readonly erro = signal<string | null>(null);
  readonly ok = signal<string | null>(null);

  f: Omit<Perfil, 'updatedAt'> = {
    alturaCm: 0, nascimento: null, sexo: 'F', atividade: 1.375, objetivo: 'manter',
    metaKcal: 0, metaProteinaG: 0, metaCarboG: 0, metaGorduraG: 0, metaAguaMl: 0,
  };
  novoDia = -1;
  novaRefeicao: Refeicao = 'almoco';
  busca = '';
  gramas = 100;
  private timer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.api.perfil();
      this.sugestao.set(r.sugestao);
      if (r.perfil) {
        const { updatedAt: _, ...resto } = r.perfil;
        this.f = { ...resto, nascimento: resto.nascimento ?? null };
      }
      await this.carregarPlano();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível carregar o perfil'));
    }
  }

  private async carregarPlano(): Promise<void> {
    this.plano.set((await this.api.plano()).filter((p) => !p.deletedAt));
  }

  itensDoDia(dia: number): PlanoItem[] {
    const ordem = REFEICOES.map((r) => r.valor);
    return this.plano().filter((p) => p.diaSemana === dia).sort((a, b) => ordem.indexOf(a.refeicao) - ordem.indexOf(b.refeicao));
  }

  async salvar(): Promise<void> {
    this.erro.set(null);
    this.ok.set(null);
    try {
      await this.api.salvarPerfil({ ...this.f, alturaCm: Number(this.f.alturaCm) || 0 });
      this.sugestao.set((await this.api.perfil()).sugestao);
      this.ok.set('Perfil e metas salvos.');
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível salvar o perfil'));
    }
  }

  buscar(): void {
    if (this.timer) clearTimeout(this.timer);
    const q = this.busca.trim();
    this.timer = setTimeout(async () => {
      if (q.length < 2) return;
      try { this.resultados.set(await this.api.buscarAlimentos(q, 15)); } catch { /* sem sugestões */ }
    }, 250);
  }

  async adicionarItem(): Promise<void> {
    const nome = this.busca.trim();
    if (!nome || !this.gramas) return;
    const alimento = this.resultados().find((a) => a.nome === nome);
    try {
      await this.api.salvarPlanoItem({
        diaSemana: this.novoDia, refeicao: this.novaRefeicao, alimentoId: alimento?.id ?? null, nome,
        quantidadeG: Number(this.gramas), opcao: 1, observacao: null,
      });
      this.busca = '';
      await this.carregarPlano();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível salvar o plano'));
    }
  }

  async excluirItem(it: PlanoItem): Promise<void> {
    try {
      await this.api.salvarPlanoItem(it, true);
      await this.carregarPlano();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível tirar do plano'));
    }
  }
}
