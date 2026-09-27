/** Aba "Modelos" do modo Redes sociais: os modelos prontos da Viih Mimos,
 * separados em story, feed e carrossel. A miniatura é o próprio modelo
 * desenhado pelo mesmo caminho da prévia, então o que se vê aqui é o que
 * entra no palco. */

import {
  Component, ElementRef, ViewEncapsulation, afterNextRender, inject, output, signal, viewChildren,
} from '@angular/core';
import { IlIconComponent } from './illustration-icons';
import { SocialStore, TemplateLook } from './social-store';
import { SOCIAL_TEMPLATES, SocialTemplate, TEMPLATE_GROUPS } from './social-templates';
import { NEUTRAL, SOCIAL_FORMATS } from './social-model';
import { paintFrame } from './social-render';
import { drawOverlays, ensureOverlayAssets, ensureOverlayFonts } from './social-overlays';
import { ensureBrandAssets } from './brand-assets';
import { FontLibrary } from './fonts';

/** Largura de um post na miniatura; o carrossel ocupa a linha inteira. */
const THUMB_POST_W = 132;

@Component({
  selector: 'sm-template-gallery',
  standalone: true,
  imports: [IlIconComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <p class="il-note smt-intro">Modelos na identidade da Viih Mimos. Tudo continua editável: troque os textos em "Texto" e ponha a foto no espaço tracejado. Ctrl+Z volta ao que estava.</p>
    @for (g of groups; track g.name) {
      <section class="il-sec">
        <div class="il-sec-head il-sec-static">{{ g.name }}</div>
        <div class="il-sec-body">
          <div class="smt-grid">
            @for (t of g.templates; track t.id) {
              <button
                type="button" class="smt-card" [class.smt-wide]="t.slides > 1" [class.il-on]="store.templateId() === t.id"
                [attr.data-help]="t.help" [title]="t.help" (click)="apply(t)"
              >
                <canvas #thumb class="smt-thumb" [attr.data-template]="t.id"></canvas>
                <span class="smt-label">{{ t.label }}@if (t.photo) { <il-icon name="photo-add" [size]="11" /> }</span>
              </button>
            }
          </div>
        </div>
      </section>
    }
  `,
  styles: [`
    .smt-intro { margin: 10px; }
    .smt-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; align-items: end; }
    .smt-card {
      display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 5px; border: 1px solid var(--il-line);
      border-radius: 6px; background: var(--il-field); color: var(--text); cursor: pointer;
    }
    .smt-card:hover { border-color: var(--il-line-strong); }
    .smt-card.il-on { border-color: var(--il-blue); background: var(--il-active); }
    .smt-card.smt-wide { grid-column: 1 / -1; }
    .smt-thumb { display: block; max-width: 100%; height: auto; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08); }
    .smt-label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); }
  `],
})
export class SocialTemplateGalleryComponent {
  readonly store = inject(SocialStore);
  private readonly fonts = inject(FontLibrary);
  private readonly thumbs = viewChildren<ElementRef<HTMLCanvasElement>>('thumb');
  readonly groups = TEMPLATE_GROUPS;
  readonly applied = output<SocialTemplate>();
  readonly busy = signal(false);

  constructor() {
    afterNextRender(() => void this.paintThumbs());
  }

  async apply(t: SocialTemplate): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const look = t.build();
      // Tudo carregado antes de aplicar: senão o primeiro desenho sai sem letra
      // e sem laço, e pisca quando eles chegam.
      await preload(look, this.fonts);
      this.store.applyTemplate(look);
      this.applied.emit(t);
    } finally {
      this.busy.set(false);
    }
  }

  private async paintThumbs(): Promise<void> {
    const looks = new Map(SOCIAL_TEMPLATES.map((t) => [t.id, t.build()]));
    await Promise.all([...looks.values()].map((l) => preload(l, this.fonts)));
    for (const ref of this.thumbs()) {
      const canvas = ref.nativeElement;
      const look = looks.get(canvas.dataset['template'] ?? '');
      if (look) paintLook(canvas, look, this.fonts, THUMB_POST_W * look.slides);
    }
  }
}

/** Fontes, arquivos da marca e padrão de fundo de um modelo. */
export async function preload(look: TemplateLook, fonts: FontLibrary): Promise<void> {
  await Promise.all([
    ensureOverlayFonts(look.overlays, fonts),
    ensureOverlayAssets(look.overlays),
    ensureBrandAssets(look.bgPattern ? [look.bgPattern] : []),
  ]);
}

/** Desenha o modelo (sem foto) num canvas da largura pedida. */
export function paintLook(canvas: HTMLCanvasElement, look: TemplateLook, fonts: FontLibrary, width: number): void {
  const format = SOCIAL_FORMATS.find((f) => f.id === look.formatId) ?? SOCIAL_FORMATS[0];
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round((width / look.slides / format.ratio) * dpr);
  canvas.style.width = `${width}px`;
  paintFrame(canvas, null, {
    adjust: { ...NEUTRAL }, fit: 'cover', scale: 1, dx: 0, dy: 0,
    bgMode: 'cor', bgColor: look.bgColor, bgPattern: look.bgPattern, slot: look.slot,
  });
  drawOverlays(canvas.getContext('2d')!, canvas.width, canvas.height, look.overlays, fonts, null);
}
