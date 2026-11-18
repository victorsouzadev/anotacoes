import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensagemDeErro } from '../../../core/erro-http';
import { baixarBlob } from '../../../shared/download';
import { DietaApiService } from '../dieta-api.service';
import { dataLocal, somarDias } from '../dieta-calc';
import { Compartilhamento, ESCOPOS, ESCOPOS_NUTRICIONISTA } from '../dieta.models';

/** Aba "Compartilhar" (spec 016): links públicos com escopos e validade, e o CSV. */
@Component({
  selector: 'app-dieta-compartilhar',
  standalone: true,
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (erro(); as e) { <p class="erro">{{ e }}</p> }
    <section class="card">
      <h3>Novo link de progresso</h3>
      <p class="sub">Quem tiver o link vê só o que você marcar abaixo, sem precisar de conta.</p>
      <input [(ngModel)]="titulo" placeholder="Título (ex.: Para a nutricionista)" maxlength="100" />
      <div class="escopos">
        @for (e of escopos; track e.valor) {
          <label><input type="checkbox" [checked]="marcados.has(e.valor)" (change)="alternar(e.valor)" /> {{ e.nome }}</label>
        }
      </div>
      <div class="acoes">
        <button type="button" (click)="nutricionista()">Modo nutricionista</button>
        <select [(ngModel)]="validade">
          <option [ngValue]="7">7 dias</option><option [ngValue]="30">30 dias</option>
          <option [ngValue]="90">90 dias</option><option [ngValue]="null">Sem validade</option>
        </select>
        <button type="button" class="primario" (click)="criar()" [disabled]="marcados.size === 0">Criar link</button>
      </div>
    </section>

    <section class="card">
      <h3>Links</h3>
      @for (c of lista(); track c.id) {
        <div class="link" [class.inativo]="!!c.revogadoEm">
          <div>
            <strong>{{ c.titulo }}</strong>
            <span class="sub">{{ nomes(c.escopos) }} · criado em {{ c.createdAt | date: 'dd/MM/yyyy' }}
              {{ c.revogadoEm ? '· revogado' : c.expiraEm ? '· até ' + (c.expiraEm | date: 'dd/MM/yyyy') : '· sem validade' }}</span>
          </div>
          @if (!c.revogadoEm) {
            <button type="button" (click)="copiar(c.url)">Copiar</button>
            <button type="button" class="perigo" (click)="revogar(c)">Revogar</button>
          }
        </div>
      } @empty { <p class="sub">Nenhum link.</p> }
    </section>

    <section class="card">
      <h3>Baixar CSV</h3>
      <div class="acoes">
        <label>De <input type="date" [(ngModel)]="inicio" /></label>
        <label>Até <input type="date" [(ngModel)]="fim" /></label>
        <button type="button" (click)="baixar()">Baixar</button>
      </div>
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
    h3 { margin: 0; font-size: 15px; }
    .sub { font-size: 12px; color: var(--text-muted); margin: 0; display: block; }
    .escopos { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px; font-size: 13px; }
    .escopos label { display: flex; align-items: center; gap: 6px; }
    .acoes { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; }
    input:not([type=checkbox]), select { border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 7px 8px; font-size: 13px; }
    button { border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 13px; font-weight: 600; }
    button:disabled { opacity: .5; }
    .primario { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
    .perigo { color: var(--danger); }
    .link { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border); font-size: 13px; }
    .link > div { flex: 1; min-width: 0; }
    .link.inativo { opacity: .5; }
    .erro { color: var(--danger); font-size: 13px; margin: 0; }
  `],
})
export class CompartilharComponent implements OnInit {
  private api = inject(DietaApiService);
  readonly escopos = ESCOPOS;
  readonly lista = signal<Compartilhamento[]>([]);
  readonly erro = signal<string | null>(null);
  titulo = '';
  marcados = new Set<string>(['peso']);
  validade: number | null = 30;
  fim = dataLocal();
  inicio = somarDias(dataLocal(), -30);

  ngOnInit(): void {
    void this.carregar();
  }

  private async carregar(): Promise<void> {
    try { this.lista.set(await this.api.compartilhamentos()); } catch (e) { this.erro.set(mensagemDeErro(e, 'Não foi possível carregar os links')); }
  }

  nomes(escopos: string[]): string {
    return escopos.map((e) => ESCOPOS.find((x) => x.valor === e)?.nome ?? e).join(', ');
  }

  alternar(v: string): void {
    const n = new Set(this.marcados);
    if (n.has(v)) n.delete(v); else n.add(v);
    this.marcados = n;
  }

  nutricionista(): void {
    this.marcados = new Set(ESCOPOS_NUTRICIONISTA);
    if (!this.titulo) this.titulo = 'Para a nutricionista';
  }

  async criar(): Promise<void> {
    try {
      const c = await this.api.compartilhar(this.titulo.trim(), [...this.marcados], this.validade);
      await this.copiar(c.url);
      this.titulo = '';
      await this.carregar();
    } catch (e) {
      this.erro.set(mensagemDeErro(e, 'Não foi possível criar o link'));
    }
  }

  async copiar(url: string): Promise<void> {
    try { await navigator.clipboard.writeText(url); } catch { prompt('Copie o link:', url); }
  }

  async revogar(c: Compartilhamento): Promise<void> {
    if (!confirm(`Revogar "${c.titulo}"? O link para de funcionar na hora.`)) return;
    try { await this.api.revogar(c.id); await this.carregar(); } catch (e) { this.erro.set(mensagemDeErro(e, 'Não foi possível revogar')); }
  }

  async baixar(): Promise<void> {
    try { baixarBlob(`dieta-${this.inicio}-a-${this.fim}.csv`, await this.api.csv(this.inicio, this.fim)); }
    catch (e) { this.erro.set(mensagemDeErro(e, 'Não foi possível baixar o CSV')); }
  }
}
