import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NotePage, parseStoredPages } from '../../data/models';
import { NoteReaderComponent } from '../editor/note-reader';

interface NotaPublica {
  title: string;
  elements: string;
  updatedAt: string;
}

/** Página pública de uma nota compartilhada por link (spec 023): só leitura, sem login. */
@Component({
  selector: 'app-public-note-page',
  standalone: true,
  imports: [NoteReaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pages(); as p) {
      <app-note-reader [pages]="p" [titulo]="titulo()" [podeFechar]="false" />
    } @else {
      <div class="aviso">
        <p>{{ erro() ?? 'Carregando…' }}</p>
      </div>
    }
  `,
  styles: [`
    .aviso { min-height: 100dvh; display: flex; align-items: center; justify-content: center; background: var(--bg);
      color: var(--text-muted); font-size: 15px; padding: 16px; text-align: center; }
  `],
})
export class PublicNotePageComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  readonly pages = signal<NotePage[] | null>(null);
  readonly titulo = signal('');
  readonly erro = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    try {
      const n = await firstValueFrom(this.http.get<NotaPublica>(`/api/notes/publico/${encodeURIComponent(token)}`));
      this.titulo.set(n.title || 'Nota');
      document.title = n.title || 'Nota';
      this.pages.set(parseStoredPages(n.elements));
    } catch (e) {
      const msg = e instanceof HttpErrorResponse && e.status === 429
        ? 'Muitos acessos seguidos. Tente de novo em um minuto.'
        : 'Este link não está mais disponível.';
      this.erro.set(msg);
    }
  }
}
