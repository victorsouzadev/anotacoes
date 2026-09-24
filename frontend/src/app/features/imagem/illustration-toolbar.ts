/** Barra de ferramentas vertical, à esquerda, como no Illustrator e no
 * Inkscape — com o widget de preenchimento/traço embaixo (dois quadrados
 * sobrepostos; X alterna qual está na frente, Shift+X troca, D volta ao padrão). */

import { Component, ElementRef, inject, output, viewChild } from '@angular/core';
import { IlIconComponent, IlIconName } from './illustration-icons';
import { IllustrationStore, PaintTarget, Tool } from './illustration-store';

export interface ToolDef {
  id: Tool;
  icon: IlIconName;
  label: string;
  key: string;
  help: string;
}

export const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: 'selecionar', icon: 'select', label: 'Seleção', key: 'V', help: 'Seleciona, move, escala e gira' },
    { id: 'nos', icon: 'direct', label: 'Seleção direta', key: 'A', help: 'Edita os nós e as alças de um caminho' },
  ],
  [
    { id: 'caneta', icon: 'pen', label: 'Caneta', key: 'P', help: 'Clique pra reta, arraste pra curva' },
    { id: 'lapis', icon: 'pencil', label: 'Lápis', key: 'N', help: 'Desenhe à mão livre; termine perto do início pra fechar' },
    { id: 'borracha', icon: 'vector-eraser', label: 'Borracha', key: 'Shift+E', help: 'Apaga pedaços dos vetores · [ e ] mudam o tamanho' },
    { id: 'texto', icon: 'text', label: 'Texto', key: 'T', help: 'Clique na prancheta pra escrever' },
  ],
  [
    { id: 'retangulo', icon: 'rect', label: 'Retângulo', key: 'R', help: 'Arraste; Shift deixa quadrado' },
    { id: 'elipse', icon: 'ellipse', label: 'Elipse', key: 'E', help: 'Arraste; Shift deixa círculo' },
    { id: 'estrela', icon: 'star', label: 'Estrela', key: 'S', help: 'Arraste pra desenhar' },
    { id: 'poligono', icon: 'polygon', label: 'Polígono', key: 'G', help: 'Arraste pra desenhar' },
  ],
  [
    { id: 'contagotas', icon: 'eyedropper', label: 'Conta-gotas', key: 'I', help: 'Copia a cor de onde clicar' },
  ],
  [
    { id: 'mao', icon: 'hand', label: 'Mão', key: 'H', help: 'Arrasta a vista (ou segure Espaço)' },
    { id: 'zoom', icon: 'zoom', label: 'Zoom', key: 'Z', help: 'Clique aproxima, Alt+clique afasta' },
  ],
];

@Component({
  selector: 'il-toolbar',
  standalone: true,
  imports: [IlIconComponent],
  host: { class: 'il-toolbar' },
  template: `
    @for (group of groups; track $index) {
      <div class="il-tb-group">
        @for (t of group; track t.id) {
          <button
            type="button"
            class="il-tb-btn"
            [class.il-on]="store.tool() === t.id"
            [attr.aria-label]="t.label"
            [attr.data-tip]="t.label + '  ' + t.key"
            [attr.data-help]="t.help"
            (click)="pick.emit(t.id)"
          ><il-icon [name]="t.icon" [size]="18" /></button>
        }
      </div>
    }

    <div class="il-paint" aria-label="Preenchimento e traço">
      <button
        type="button"
        class="il-paint-sq il-paint-stroke"
        [class.il-front]="store.paintTarget() === 'stroke'"
        [style.--c]="store.shownStroke() ?? 'transparent'"
        [class.il-paint-none]="!store.shownStroke()"
        data-tip="Traço  X" data-help="Clique pra escolher a cor do traço"
        aria-label="Cor do traço"
        (click)="choose('stroke')"
      ></button>
      <button
        type="button"
        class="il-paint-sq il-paint-fill"
        [class.il-front]="store.paintTarget() === 'fill'"
        [style.--c]="store.shownFill() ?? 'transparent'"
        [class.il-paint-none]="!store.shownFill()"
        data-tip="Preenchimento  X" data-help="Clique pra escolher a cor do preenchimento"
        aria-label="Cor do preenchimento"
        (click)="choose('fill')"
      ></button>
      <button type="button" class="il-paint-mini il-paint-swap" data-tip="Trocar  Shift+X" aria-label="Trocar preenchimento e traço" (click)="store.swapPaint()"><il-icon name="swap" [size]="11" /></button>
      <button type="button" class="il-paint-mini il-paint-default" data-tip="Cores padrão  D" aria-label="Cores padrão" (click)="store.defaultColors()"><il-icon name="default-colors" [size]="11" /></button>
      <input #color type="color" class="il-paint-input" tabindex="-1" aria-hidden="true" (input)="onColor($event)" (change)="store.commitLive()" />
    </div>
    <div class="il-tb-group il-tb-row">
      <button type="button" class="il-tb-mini" data-tip="Cor" aria-label="Escolher cor" (click)="choose(store.paintTarget())">
        <span class="il-tb-chip" [style.background]="(store.paintTarget() === 'fill' ? store.shownFill() : store.shownStroke()) ?? 'transparent'"></span>
      </button>
      <button type="button" class="il-tb-mini" data-tip="Nenhum  /" aria-label="Sem cor" (click)="store.setPaint(store.paintTarget(), null)"><il-icon name="none" [size]="14" /></button>
    </div>
  `,
  styles: [`
    :host {
      grid-area: tools; display: flex; flex-direction: column; align-items: center; gap: 0; padding: 6px 0;
      background: var(--il-chrome); border-right: 1px solid var(--il-line); z-index: 3;
    }
    .il-tb-group { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; border-bottom: 1px solid var(--il-line); }
    .il-tb-group:last-child { border-bottom: none; }
    .il-tb-row { flex-direction: row; }
    .il-tb-btn {
      position: relative; width: 32px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
      border: none; border-radius: 4px; background: none; color: var(--text);
    }
    .il-tb-btn:hover { background: var(--il-hover); }
    .il-tb-btn.il-on { background: var(--il-active); box-shadow: inset 0 0 0 1px var(--il-line-strong); }
    .il-tb-mini { position: relative; width: 20px; height: 20px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text); border-radius: 3px; }
    .il-tb-mini:hover { background: var(--il-hover); }
    .il-tb-chip { width: 12px; height: 12px; border: 1px solid var(--il-line-strong); }

    .il-paint { position: relative; width: 40px; height: 44px; margin: 8px 0 2px; }
    .il-paint-sq { position: absolute; width: 22px; height: 22px; padding: 0; border: 1px solid var(--il-line-strong); border-radius: 2px; }
    .il-paint-fill { left: 3px; top: 3px; background: var(--c); z-index: 1; }
    .il-paint-stroke { left: 14px; top: 16px; background: var(--il-chrome); box-shadow: inset 0 0 0 5px var(--c); z-index: 1; }
    .il-paint-sq.il-front { z-index: 2; }
    .il-paint-fill.il-paint-none, .il-paint-stroke.il-paint-none {
      background: #fff linear-gradient(to top left, transparent calc(50% - 1px), #e5484d calc(50% - 1px), #e5484d calc(50% + 1px), transparent calc(50% + 1px));
      box-shadow: none;
    }
    .il-paint-stroke.il-paint-none::after { content: ''; position: absolute; inset: 5px; background: var(--il-chrome); border: 1px solid var(--il-line-strong); }
    .il-paint-mini { position: absolute; width: 14px; height: 14px; padding: 0; border: none; background: none; color: var(--text-muted); display: inline-flex; }
    .il-paint-mini:hover { color: var(--text); }
    .il-paint-swap { right: 0; top: 0; }
    .il-paint-default { left: 0; bottom: 0; }
    .il-paint-input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  `],
})
export class IlToolbarComponent {
  store = inject(IllustrationStore);
  readonly groups = TOOL_GROUPS;
  pick = output<Tool>();

  private color = viewChild.required<ElementRef<HTMLInputElement>>('color');

  /** Primeiro clique traz o quadrado pra frente; clicar no que já está na
   * frente abre o seletor de cor. */
  choose(target: PaintTarget): void {
    if (this.store.paintTarget() !== target) {
      this.store.paintTarget.set(target);
      return;
    }
    const current = target === 'fill' ? this.store.shownFill() : this.store.shownStroke();
    const el = this.color().nativeElement;
    el.value = current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000';
    el.click();
  }

  onColor(event: Event): void {
    this.store.setPaint(this.store.paintTarget(), (event.target as HTMLInputElement).value, true);
  }
}
