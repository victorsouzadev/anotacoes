import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from '../../shared/icon';

interface LinkNota {
  id: string;
  nome: string;
  expiraEm: string | null;
  revogadoEm: string | null;
  createdAt: string;
}

/** Diálogo "Compartilhar" do editor (spec 023): cria, lista e revoga links somente leitura. */
@Component({
  selector: 'app-share-dialog',
  standalone: true,
  imports: [FormsModule, DatePipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fundo" (click)="fechar.emit()">
      <div class="dialogo" role="dialog" aria-label="Compartilhar nota" (click)="$event.stopPropagation()">
        <header>
          <h2>Compartilhar por link</h2>
          <button type="button" class="x" (click)="fechar.emit()"><app-icon name="x" [size]="16" /></button>
        </header>
        <p class="ajuda">Quem tiver o link vê a nota em modo leitura, sem precisar de conta. O link mostra sempre a versão salva mais recente.</p>
        @if (sincronizando) {
          <p class="ajuda atencao">A nota ainda está sincronizando: o link mostra a última versão que chegou ao servidor.</p>
        }

        <div class="criar">
          <input [(ngModel)]="nome" placeholder="Para quem (ex.: Ana)" maxlength="80" />
          <select [(ngModel)]="validade">
            <option [ngValue]="7">7 dias</option>
            <option [ngValue]="30">30 dias</option>
            <option [ngValue]="90">90 dias</option>
            <option [ngValue]="null">Sem validade</option>
          </select>
          <button type="button" class="primario" (click)="criar()" [disabled]="criando()">Criar link</button>
        </div>

        @if (novo(); as url) {
          <div class="novo">
            <input readonly [value]="url" (focus)="$any($event.target).select()" />
            <button type="button" (click)="copiar(url)">{{ copiado() ? 'Copiado' : 'Copiar' }}</button>
          </div>
          <p class="ajuda">Copie agora: por segurança o link completo não fica guardado e não aparece de novo.</p>
        }
        @if (erro(); as e) { <p class="erro">{{ e }}</p> }

        <h3>Links desta nota</h3>
        @for (l of links(); track l.id) {
          <div class="link" [class.inativo]="!!l.revogadoEm || vencido(l)">
            <div>
              <strong>{{ l.nome }}</strong>
              <span class="meta">
                criado em {{ l.createdAt | date: 'dd/MM/yyyy' }} ·
                @if (l.revogadoEm) { revogado }
                @else if (vencido(l)) { vencido }
                @else if (l.expiraEm) { vale até {{ l.expiraEm | date: 'dd/MM/yyyy' }} }
                @else { sem validade }
              </span>
            </div>
            @if (!l.revogadoEm && !vencido(l)) {
              <button type="button" class="revogar" (click)="revogar(l)">Revogar</button>
            }
          </div>
        } @empty {
          <p class="ajuda">Nenhum link criado.</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .fundo { position: fixed; inset: 0; background: rgb(0 0 0 / .35); z-index: 90; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .dialogo { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); width: min(520px, 100%);
      max-height: 90dvh; overflow: auto; padding: 18px 20px; box-shadow: var(--shadow); }
    header { display: flex; align-items: center; justify-content: space-between; }
    h2 { font-size: 16px; margin: 0; }
    h3 { font-size: 13px; margin: 18px 0 8px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
    .x { border: none; background: none; color: var(--text-muted); }
    .ajuda { font-size: 12.5px; color: var(--text-muted); margin: 8px 0; line-height: 1.5; }
    .atencao { color: var(--atencao); }
    .erro { color: var(--danger); font-size: 13px; }
    .criar, .novo { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    input, select { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--bg); color: var(--text); font-size: 13px; }
    select { flex: 0 0 auto; }
    button { border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 13px; font-weight: 600; }
    .primario { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
    .link { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border); font-size: 13px; }
    .link.inativo { opacity: .55; }
    .meta { display: block; color: var(--text-muted); font-size: 12px; }
    .revogar { color: var(--danger); }
  `],
})
export class ShareDialogComponent implements OnInit {
  @Input({ required: true }) noteId!: string;
  @Input() sincronizando = false;
  @Output() fechar = new EventEmitter<void>();

  private http = inject(HttpClient);

  nome = '';
  validade: number | null = 30;
  readonly links = signal<LinkNota[]>([]);
  readonly novo = signal<string | null>(null);
  readonly copiado = signal(false);
  readonly criando = signal(false);
  readonly erro = signal<string | null>(null);

  ngOnInit(): void {
    void this.carregar();
  }

  private async carregar(): Promise<void> {
    try {
      this.links.set(await firstValueFrom(this.http.get<LinkNota[]>(`/api/notes/${this.noteId}/links`)));
    } catch {
      this.erro.set('Não foi possível carregar os links — verifique sua conexão (a nota precisa ter sido sincronizada).');
    }
  }

  vencido(l: LinkNota): boolean {
    return !!l.expiraEm && new Date(l.expiraEm).getTime() <= Date.now();
  }

  async criar(): Promise<void> {
    this.criando.set(true);
    this.erro.set(null);
    this.copiado.set(false);
    try {
      const r = await firstValueFrom(this.http.post<{ url: string }>(`/api/notes/${this.noteId}/links`,
        { nome: this.nome.trim() || null, diasValidade: this.validade }));
      // O servidor monta a URL com o host da requisição; no navegador vale a origem da página.
      const token = r.url.split('/p/nota/')[1];
      this.novo.set(`${location.origin}/p/nota/${token}`);
      this.nome = '';
      await this.carregar();
    } catch (e) {
      this.erro.set(e instanceof HttpErrorResponse && e.error?.error ? e.error.error : 'Não foi possível criar o link — verifique sua conexão.');
    } finally {
      this.criando.set(false);
    }
  }

  async copiar(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copiado.set(true);
    } catch { /* sem permissão: o campo já fica selecionável */ }
  }

  async revogar(l: LinkNota): Promise<void> {
    if (!confirm(`Revogar o link "${l.nome}"? Quem tiver esse link não conseguirá mais abrir a nota.`)) return;
    await firstValueFrom(this.http.delete(`/api/notes/${this.noteId}/links/${l.id}`));
    await this.carregar();
  }
}
