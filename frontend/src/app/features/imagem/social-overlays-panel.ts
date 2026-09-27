/** Aba "Texto" do modo Redes sociais: textos e figurinhas por cima do post. */

import { Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { uuid } from '../../core/uuid';
import { FontLibrary } from './fonts';
import { IlIconComponent } from './illustration-icons';
import { ImageOverlay, STICKERS, TEXT_FONTS, TextOverlay, TextStyle, overlayKindLabel, overlayLabel } from './social-overlays';
import { BRAND_ASSETS, BRAND_COLORS, ensureBrandAssets } from './brand-assets';
import { SocialStore } from './social-store';

const STYLES: { id: TextStyle; label: string }[] = [
  { id: 'simples', label: 'Simples' },
  { id: 'fundo', label: 'Fundo' },
  { id: 'contorno', label: 'Contorno' },
  { id: 'sombra', label: 'Sombra' },
];

@Component({
  selector: 'sm-overlays-panel',
  standalone: true,
  imports: [IlIconComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (selected(); as o) {
      <section class="il-sec">
        <div class="il-sec-head il-sec-static">{{ kindTitle[o.kind] }}</div>
        <div class="il-sec-body">
          @if (o.kind === 'texto') {
            <p class="il-note">Dica: dois cliques no texto do palco editam ali mesmo.</p>
            <textarea class="il-textarea" rows="3" [value]="o.text" aria-label="Texto" (input)="patch({ text: $any($event.target).value })" (change)="store.commit()"></textarea>
            <div class="il-row">
              <select class="il-select il-grow" [value]="o.fontId" aria-label="Fonte" (change)="patch({ fontId: $any($event.target).value }, true)">
                @for (f of fontOptions; track f.id) { <option [value]="f.id" [selected]="f.id === o.fontId">{{ f.name }}</option> }
              </select>
              <button type="button" class="il-ib" [class.il-on]="o.bold" data-tip="Negrito" aria-label="Negrito" (click)="patch({ bold: !o.bold }, true)"><b>N</b></button>
              <input type="color" class="il-color-input" [value]="o.color" aria-label="Cor do texto" (input)="patch({ color: $any($event.target).value })" (change)="store.commit()" />
            </div>
            <div class="il-row">
              <div class="il-seg smo-seg">
                @for (st of styles; track st.id) {
                  <button type="button" [class.il-on]="o.style === st.id" (click)="patch({ style: st.id }, true)">{{ st.label }}</button>
                }
              </div>
              @if (o.style === 'fundo' || o.style === 'contorno') {
                <input type="color" class="il-color-input" [value]="o.accent" [attr.aria-label]="o.style === 'fundo' ? 'Cor do fundo' : 'Cor do contorno'" (input)="patch({ accent: $any($event.target).value })" (change)="store.commit()" />
              }
            </div>
            <div class="smo-swatches" role="group" aria-label="Cores da marca">
              @for (c of brandColors; track c.id) {
                <button type="button" class="smo-swatch" [style.background]="c.hex" [title]="c.label" [attr.aria-label]="'Texto ' + c.label" (click)="patch({ color: c.hex }, true)"></button>
              }
            </div>
          }
          @if (o.kind === 'forma') {
            <div class="il-row">
              <span class="il-cb-label">Preenchimento</span>
              <input type="color" class="il-color-input" [value]="o.fill || '#ffffff'" aria-label="Cor de preenchimento" (input)="patch({ fill: $any($event.target).value })" (change)="store.commit()" />
              <span class="il-cb-label">Contorno</span>
              <input type="color" class="il-color-input" [value]="o.stroke || '#ffffff'" aria-label="Cor do contorno" (input)="patch({ stroke: $any($event.target).value })" (change)="store.commit()" />
            </div>
            <div class="smo-swatches" role="group" aria-label="Cores da marca">
              @for (c of brandColors; track c.id) {
                <button type="button" class="smo-swatch" [style.background]="c.hex" [title]="c.label" [attr.aria-label]="'Preencher com ' + c.label" (click)="patch({ fill: c.hex }, true)"></button>
              }
            </div>
          }
          <label class="il-range"><span>Tamanho</span><input type="range" min="2" [attr.max]="o.kind === 'forma' ? 200 : 60" step="0.5" [value]="o.size * 100" (input)="patch({ size: $any($event.target).value / 100 })" (change)="store.commit()" /><b>{{ (o.size * 100).toFixed(0) }}</b></label>
          <label class="il-range"><span>Giro</span><input type="range" min="-180" max="180" step="1" [value]="o.rotation" (input)="patch({ rotation: +$any($event.target).value })" (change)="store.commit()" /><b>{{ o.rotation }}°</b></label>
          <div class="il-row">
            <button type="button" class="il-btn il-grow" (click)="center()">Centralizar</button>
            <button type="button" class="il-btn il-grow" [class.il-on]="o.locked" data-tip="Travada não é pega por clique no palco" (click)="patch({ locked: !o.locked }, true)">{{ o.locked ? 'Destravar' : 'Travar' }}</button>
          </div>
        </div>
      </section>
    }
    <section class="il-sec">
      <div class="il-sec-body il-sec-body-top">
        <button type="button" class="il-btn il-primary il-wide" (click)="addText()"><il-icon name="plus" [size]="13" /> Adicionar texto</button>
        <span class="il-mini-title">Figurinhas</span>
        <div class="smo-stickers">
          @for (st of stickers; track st.id) {
            <button type="button" class="smo-sticker" [class.smo-badge]="!st.emoji" [attr.aria-label]="'Figurinha ' + st.label" (click)="addSticker(st.id)">{{ st.label }}</button>
          }
        </div>
        <p class="il-note">Arraste no palco pra mover; com a camada selecionada, a roda do mouse muda o tamanho. Delete apaga.</p>
      </div>
    </section>
    <section class="il-sec">
      <div class="il-sec-head il-sec-static">Marca Viih Mimos</div>
      <div class="il-sec-body">
        <div class="smo-brand">
          @for (a of brandAssets; track a.id) {
            <button type="button" class="smo-brand-item" [attr.aria-label]="'Adicionar ' + a.label" [title]="a.label" (click)="addAsset(a.id)">
              <img [src]="'marca/viih-mimos/' + a.file" alt="" [class.smo-dark]="a.id === 'assinatura-branca'" />
            </button>
          }
        </div>
      </div>
    </section>
    @if (store.overlays().length) {
      <section class="il-sec">
        <div class="il-sec-head il-sec-static">Camadas <small>{{ store.overlays().length }}</small></div>
        @for (o of store.overlays(); track o.id) {
          <div class="il-item" [class.il-on]="store.selectedOverlay() === o.id">
            <button type="button" class="il-item-main" (click)="store.selectedOverlay.set(o.id)">
              <span class="il-item-text"><span class="il-item-name">{{ label(o) }}</span><span class="il-item-sub">{{ kindLabel(o) }}{{ o.locked ? ' · travada' : '' }}</span></span>
            </button>
            <button type="button" class="il-ib il-ib-sm" data-tip="Trazer pra frente" aria-label="Trazer pra frente" (click)="store.moveOverlay(o.id, 1)"><il-icon name="forward" [size]="13" /></button>
            <button type="button" class="il-ib il-ib-sm il-danger" data-tip="Remover" aria-label="Remover" (click)="store.removeOverlay(o.id)"><il-icon name="trash" [size]="13" /></button>
          </div>
        }
      </section>
    }
  `,
  styles: [`
    .smo-stickers { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
    .smo-sticker { height: 34px; border: 1px solid var(--il-line); border-radius: 6px; background: var(--il-field); font-size: 18px; cursor: pointer; padding: 0; color: var(--text); }
    .smo-sticker.smo-badge { font-size: 9px; font-weight: 700; grid-column: span 2; }
    .smo-sticker:hover { border-color: var(--il-blue); }
    .smo-seg button { width: auto; padding: 0 7px; font-size: 10.5px; }
    .smo-brand { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .smo-brand-item { height: 44px; padding: 4px; border: 1px solid var(--il-line); border-radius: 6px; background: #fff; cursor: pointer; }
    .smo-brand-item:hover { border-color: var(--il-blue); }
    .smo-brand-item img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .smo-brand-item img.smo-dark { background: #E7548C; border-radius: 3px; }
    .smo-swatches { display: flex; gap: 4px; flex-wrap: wrap; }
    .smo-swatch { width: 22px; height: 22px; padding: 0; border: 1px solid var(--il-line-strong); border-radius: 50%; cursor: pointer; }
    .smo-swatch:hover { outline: 2px solid var(--il-blue); outline-offset: 1px; }
  `],
})
export class SocialOverlaysPanelComponent {
  readonly store = inject(SocialStore);
  private fonts = inject(FontLibrary);
  readonly stickers = STICKERS;
  readonly styles = STYLES;
  readonly fontOptions = TEXT_FONTS.map((id) => ({ id, name: this.fonts.family(id).name }));

  readonly brandAssets = BRAND_ASSETS.filter((a) => a.palette);
  readonly brandColors = BRAND_COLORS;
  readonly label = overlayLabel;
  readonly kindLabel = overlayKindLabel;
  readonly kindTitle: Record<string, string> = { texto: 'Texto', figurinha: 'Figurinha', forma: 'Forma', imagem: 'Marca' };

  selected = computed(() => this.store.overlays().find((o) => o.id === this.store.selectedOverlay()) ?? null);

  addText(): void {
    const t: TextOverlay = {
      id: uuid(), kind: 'texto', text: 'Seu texto', x: 0.5, y: 0.5, size: 0.1, rotation: 0,
      fontId: 'poppins', bold: true, color: '#ffffff', style: 'sombra', accent: '#e63946',
    };
    this.store.addOverlay(t);
  }

  addSticker(sticker: string): void {
    const n = this.store.overlays().length;
    this.store.addOverlay({ id: uuid(), kind: 'figurinha', sticker, x: 0.75 - (n % 3) * 0.1, y: 0.2 + (n % 3) * 0.08, size: 0.16, rotation: 0 });
  }

  /** Arquivo da marca no meio do quadro, num tamanho que se enxerga sem
   * tomar o post. */
  addAsset(asset: string): void {
    const def = BRAND_ASSETS.find((a) => a.id === asset);
    if (!def) return;
    const o: ImageOverlay = { id: uuid(), kind: 'imagem', asset, aspect: def.aspect, x: 0.5, y: 0.5, size: def.aspect > 2 ? 0.08 : 0.18, rotation: 0 };
    void ensureBrandAssets([asset]).then(() => this.store.addOverlay(o));
  }

  patch(p: Record<string, unknown>, commit = false): void {
    const id = this.store.selectedOverlay();
    if (!id) return;
    this.store.patchOverlay(id, p);
    if (commit) this.store.commit();
  }

  center(): void {
    this.patch({ x: 0.5, y: 0.5 }, true);
  }
}
