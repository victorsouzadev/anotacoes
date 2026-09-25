/** Menu "Biblioteca" da barra do editor: as artes guardadas na conta. Clicar
 * numa arte manda ela pro modo aberto, como o "Enviar para…". */

import { Component, ElementRef, HostListener, ViewEncapsulation, inject, output, signal } from '@angular/core';
import { IlIconComponent } from './illustration-icons';
import { ImageLibraryService, LibraryItemMeta } from './image-library.service';

@Component({
  selector: 'il-library-menu',
  standalone: true,
  imports: [IlIconComponent],
  encapsulation: ViewEncapsulation.None,
  host: { class: 'lib-wrap' },
  template: `
    <button type="button" class="il-btn" [class.il-on]="open()" data-tip="Artes guardadas na sua conta" (click)="toggle()"><il-icon name="templates" [size]="13" /> Biblioteca</button>
    @if (open()) {
      <div class="lib-menu" role="dialog" aria-label="Biblioteca">
        <p class="lib-hint">Guarde artes pelo "Enviar para → Biblioteca" de cada modo. Clique numa pra usar no modo aberto.</p>
        @if (lib.loading() && !lib.items().length) { <p class="lib-hint">Carregando…</p> }
        @if (error()) { <p class="lib-hint il-warn">{{ error() }}</p> }
        <div class="lib-grid">
          @for (it of lib.items(); track it.id) {
            <div class="lib-card">
              <button type="button" class="lib-use" [disabled]="busy() === it.id" [title]="'Usar ' + it.name" (click)="use(it)">
                <img class="il-checker" [src]="it.thumb" [alt]="it.name" />
                <span>{{ busy() === it.id ? 'Abrindo…' : it.name }}</span>
              </button>
              <button type="button" class="il-ib il-ib-sm il-danger lib-del" aria-label="Apagar da biblioteca" data-tip="Apagar" (click)="remove(it, $event)"><il-icon name="trash" [size]="12" /></button>
            </div>
          } @empty {
            @if (!lib.loading()) { <p class="lib-hint">Nada guardado ainda.</p> }
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .lib-wrap { position: relative; }
    .lib-menu {
      position: absolute; z-index: 120; top: calc(100% + 4px); right: 0; width: 340px; max-height: 64vh; overflow-y: auto; padding: 8px;
      background: var(--il-chrome); border: 1px solid var(--il-line-strong); border-radius: 6px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
    }
    .lib-hint { margin: 0 0 8px; font-size: 11px; color: var(--text-muted); }
    .lib-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .lib-card { position: relative; }
    .lib-use { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 4px; border: 1px solid var(--il-line); border-radius: 6px; background: var(--il-field); color: var(--text); font-size: 10.5px; cursor: pointer; }
    .lib-use:hover { border-color: var(--il-blue); }
    .lib-use img { width: 80px; height: 64px; object-fit: contain; border-radius: 3px; }
    .lib-use span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lib-del { position: absolute; top: 3px; right: 3px; opacity: 0; }
    .lib-card:hover .lib-del, .lib-del:focus-visible { opacity: 1; }
  `],
})
export class ImageLibraryMenuComponent {
  readonly lib = inject(ImageLibraryService);
  private host = inject(ElementRef<HTMLElement>);
  readonly pick = output<{ canvas: HTMLCanvasElement; name: string; widthMm: number }>();
  open = signal(false);
  busy = signal<string | null>(null);
  error = signal('');

  toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) {
      this.error.set('');
      this.lib.refresh().catch(() => this.error.set('Não consegui carregar a biblioteca.'));
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  onDoc(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  async use(it: LibraryItemMeta): Promise<void> {
    this.busy.set(it.id);
    try {
      const full = await this.lib.get(it.id);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('imagem'));
        i.src = full.data;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      this.pick.emit({ canvas, name: full.name, widthMm: full.widthMm });
      this.open.set(false);
    } catch {
      this.error.set('Não consegui abrir essa arte.');
    } finally {
      this.busy.set(null);
    }
  }

  async remove(it: LibraryItemMeta, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await this.lib.remove(it.id);
    } catch {
      this.error.set('Não consegui apagar.');
    }
  }
}
