/** Galeria de modelos prontos, no painel Propriedades quando nada está
 * selecionado. */

import { Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { IlIconComponent } from './illustration-icons';
import { IllustrationStore } from './illustration-store';
import { IllustrationTemplate, TEMPLATES, applyTemplate } from './illustration-templates';

@Component({
  selector: 'il-template-gallery',
  standalone: true,
  imports: [IlIconComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="il-sec">
      <div class="il-sec-head il-sec-static"><il-icon name="templates" [size]="13" /> Modelos prontos</div>
      <div class="il-sec-body">
        <div class="ilt-grid">
          @for (t of items; track t.tpl.id) {
            <button type="button" class="ilt-card" [disabled]="busy()" [attr.data-help]="t.tpl.help" (click)="apply(t.tpl)">
              <svg viewBox="0 0 60 60" aria-hidden="true" [innerHTML]="t.preview"></svg>
              <span>{{ t.tpl.label }}</span>
            </button>
          }
        </div>
        @if (confirming(); as t) {
          <div class="ilt-confirm" role="alert">
            <span>Trocar o desenho atual por "{{ t.label }}"? (Ctrl+Z desfaz)</span>
            <div class="il-row">
              <button type="button" class="il-btn il-primary il-grow" (click)="run(t)">Trocar</button>
              <button type="button" class="il-btn il-grow" (click)="confirming.set(null)">Cancelar</button>
            </div>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .ilt-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .ilt-card { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 4px; border: 1px solid var(--il-line); border-radius: 6px; background: var(--il-field); color: var(--text); font-size: 10.5px; cursor: pointer; }
    .ilt-card:hover { border-color: var(--il-blue); }
    .ilt-card svg { width: 52px; height: 52px; background: #fff; border-radius: 4px; }
    .ilt-confirm { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding: 8px; border: 1px solid var(--il-line); border-radius: 6px; font-size: 11.5px; }
  `],
})
export class IlTemplateGalleryComponent {
  readonly store = inject(IllustrationStore);
  private sanitizer = inject(DomSanitizer);
  busy = signal(false);
  confirming = signal<IllustrationTemplate | null>(null);

  /** As miniaturas são marcação fixa daqui mesmo, não entrada de usuário. */
  readonly items = TEMPLATES.map((tpl) => ({ tpl, preview: this.sanitizer.bypassSecurityTrustHtml(tpl.preview) as SafeHtml }));

  apply(t: IllustrationTemplate): void {
    if (this.store.layers().length) this.confirming.set(t);
    else void this.run(t);
  }

  async run(t: IllustrationTemplate): Promise<void> {
    this.confirming.set(null);
    this.busy.set(true);
    try {
      await applyTemplate(this.store, t);
    } finally {
      this.busy.set(false);
    }
  }
}
