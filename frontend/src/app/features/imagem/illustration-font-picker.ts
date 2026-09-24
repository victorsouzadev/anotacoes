/** Menu de fontes, como o do Illustrator: o botão mostra a família atual no
 * próprio desenho da fonte; aberto, lista todas com amostra, busca e filtro
 * por categoria, e tem o envio de fonte ali mesmo. */

import { Component, ElementRef, HostListener, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { uuid } from '../../core/uuid';
import { FONT_CATEGORIES, FontCategory, FontError } from './fonts';
import { IlIconComponent } from './illustration-icons';
import { IllustrationStore } from './illustration-store';

@Component({
  selector: 'il-font-picker',
  standalone: true,
  imports: [IlIconComponent],
  host: { class: 'il-fp' },
  template: `
    <button type="button" class="il-fp-btn" (click)="toggle()" [title]="'Fonte: ' + current().name">
      <span class="il-fp-current" [style.font-family]="store.fonts.previewFamily(fontId())">{{ current().name }}</span>
      <il-icon name="chevron" [size]="12" />
    </button>
    @if (open()) {
      <div class="il-fp-pop" role="listbox">
        <div class="il-fp-search">
          <il-icon name="search" [size]="13" />
          <input #search placeholder="Buscar fonte" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="open.set(false)" />
        </div>
        <div class="il-fp-cats">
          <button type="button" [class.il-on]="!category()" (click)="category.set(null)">Todas</button>
          @for (c of categories(); track c) {
            <button type="button" [class.il-on]="category() === c" (click)="category.set(c)">{{ c }}</button>
          }
        </div>
        <div class="il-fp-list">
          @for (f of list(); track f.id) {
            <button type="button" class="il-fp-item" [class.il-on]="f.id === fontId()" (click)="choose(f.id)">
              <span class="il-fp-sample" [style.font-family]="store.fonts.previewFamily(f.id)">{{ sample() || f.name }}</span>
              <span class="il-fp-meta">{{ f.name }} · {{ f.category }}{{ f.weights.includes(700) ? ' · negrito' : '' }}</span>
            </button>
          } @empty {
            <p class="il-fp-empty">Nenhuma fonte com esse nome.</p>
          }
        </div>
        <div class="il-fp-foot">
          <input #file type="file" accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff" hidden (change)="upload($event)" />
          <button type="button" class="il-btn il-grow" (click)="file.click()"><il-icon name="upload" [size]="13" /> Enviar fonte (.ttf, .otf, .woff)</button>
        </div>
        @if (status()) { <p class="il-fp-status">{{ status() }}</p> }
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; min-width: 0; }
    .il-fp-btn {
      display: inline-flex; align-items: center; gap: 6px; width: 100%; min-width: 0; height: 26px; padding: 0 7px;
      background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; color: var(--text);
    }
    .il-fp-btn:hover { border-color: var(--il-line-strong); }
    .il-fp-current { flex: 1; min-width: 0; text-align: left; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .il-fp-pop {
      position: absolute; z-index: 60; top: calc(100% + 4px); left: 0; width: 300px; max-width: 86vw;
      background: var(--il-chrome); border: 1px solid var(--il-line-strong); border-radius: 6px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22); padding: 8px; display: flex; flex-direction: column; gap: 6px;
    }
    .il-fp-search { display: flex; align-items: center; gap: 6px; padding: 0 8px; height: 28px; background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; color: var(--text-muted); }
    .il-fp-search input { flex: 1; min-width: 0; border: none; background: none; outline: none; color: var(--text); font: inherit; }
    .il-fp-cats { display: flex; flex-wrap: wrap; gap: 3px; }
    .il-fp-cats button { padding: 2px 7px; border-radius: 999px; border: 1px solid var(--il-line); background: none; color: var(--text-muted); font-size: 11px; }
    .il-fp-cats button.il-on { color: var(--text); border-color: var(--text); }
    .il-fp-list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; }
    .il-fp-item { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 8px; border: none; border-radius: 4px; background: none; color: var(--text); text-align: left; }
    .il-fp-item:hover { background: var(--il-hover); }
    .il-fp-item.il-on { background: var(--il-active); }
    .il-fp-sample { font-size: 19px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .il-fp-meta { font-size: 10px; color: var(--text-muted); }
    .il-fp-empty, .il-fp-status { margin: 4px; font-size: 11px; color: var(--text-muted); }
    .il-fp-foot { display: flex; }
  `],
})
export class IlFontPickerComponent {
  store = inject(IllustrationStore);
  private host = inject(ElementRef<HTMLElement>);

  fontId = input.required<string>();
  /** Texto de amostra: o do próprio texto selecionado, como no Illustrator. */
  sample = input('');
  picked = output<string>();

  open = signal(false);
  query = signal('');
  category = signal<FontCategory | null>(null);
  status = signal('');
  private search = viewChild<ElementRef<HTMLInputElement>>('search');

  current = computed(() => {
    this.store.fonts.uploads();
    return this.store.fonts.family(this.fontId());
  });

  categories = computed(() => FONT_CATEGORIES.filter((c) => c !== 'Enviadas' || this.store.fonts.uploads().length));

  list = computed(() => {
    this.store.fonts.uploads();
    const q = this.query().trim().toLowerCase();
    const c = this.category();
    return this.store.fonts.families().filter((f) => (!c || f.category === c) && (!q || f.name.toLowerCase().includes(q)));
  });

  toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) setTimeout(() => this.search()?.nativeElement.focus());
  }

  choose(id: string): void {
    this.picked.emit(id);
    this.open.set(false);
  }

  upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.status.set('Lendo a fonte…');
    this.store.fonts.addUpload(file, uuid().slice(0, 8))
      .then((up) => {
        this.status.set(`"${up.name}" adicionada.`);
        this.category.set('Enviadas');
        this.picked.emit(this.store.fonts.uploadFontId(up.id));
      })
      .catch((err) => this.status.set(err instanceof FontError ? err.message : 'Não consegui ler essa fonte.'));
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutside(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
