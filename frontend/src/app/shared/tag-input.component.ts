import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { normalizarTags } from '../features/notes/notes-filter';

/** Chips de tags com sugestão das já usadas (spec 021). Enter ou vírgula adiciona; Backspace no
 * campo vazio tira a última. */
@Component({
  selector: 'app-tag-input',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tags" (click)="$event.stopPropagation(); $event.preventDefault()">
      @for (t of tags; track t) {
        <span class="chip">{{ t }}<button type="button" (click)="remover(t)" [attr.aria-label]="'Tirar a tag ' + t">×</button></span>
      }
      <input [(ngModel)]="texto" [attr.list]="listaId" [placeholder]="tags.length ? '' : 'Adicionar tag'"
        (keydown)="onKey($event)" (blur)="adicionar()" (click)="$event.stopPropagation()" />
      <datalist [id]="listaId">
        @for (s of sugestoesFiltradas(); track s) { <option [value]="s"></option> }
      </datalist>
    </div>
  `,
  styles: [`
    .tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
    .chip { display: inline-flex; align-items: center; gap: 2px; background: var(--accent-soft); color: var(--accent-dark);
      border-radius: 999px; padding: 1px 4px 1px 8px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
    .chip button { border: none; background: none; color: inherit; font-size: 13px; line-height: 1; padding: 0 3px; }
    input { border: none; background: transparent; color: var(--text); font-size: 12px; min-width: 70px; flex: 1; padding: 3px 2px; outline: none; }
  `],
})
export class TagInputComponent {
  private static seq = 0;
  readonly listaId = `tags-sugestoes-${++TagInputComponent.seq}`;

  @Input() tags: string[] = [];
  @Input() sugestoes: string[] = [];
  @Output() tagsChange = new EventEmitter<string[]>();

  texto = '';

  sugestoesFiltradas(): string[] {
    return this.sugestoes.filter((s) => !this.tags.includes(s));
  }

  onKey(ev: KeyboardEvent): void {
    ev.stopPropagation();
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      this.adicionar();
    } else if (ev.key === 'Backspace' && !this.texto && this.tags.length) {
      this.mudar(this.tags.slice(0, -1));
    }
  }

  adicionar(): void {
    const novas = this.texto.split(',');
    this.texto = '';
    const tags = normalizarTags([...this.tags, ...novas]);
    if (tags.join('\u0000') !== this.tags.join('\u0000')) this.mudar(tags);
  }

  remover(tag: string): void {
    this.mudar(this.tags.filter((t) => t !== tag));
  }

  /** Atualiza a cópia local na hora: a próxima tecla não pode partir da lista antiga enquanto o
   * pai ainda não devolveu a nova pelo @Input (duas tags digitadas em sequência rápida). */
  private mudar(tags: string[]): void {
    this.tags = tags;
    this.tagsChange.emit(tags);
  }
}
