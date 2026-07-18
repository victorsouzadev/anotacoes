import { Component, ElementRef, EventEmitter, Input, Output, ViewChild, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StickyElement, TextAlign, TextElement, TextFontFamily, TEXT_FONT_STACKS } from '../../data/models';
import { EditorStore } from './engine/editor-store';
import { STICKY_PADDING, stickyContentHeight } from './engine/sticky-layout';
import { textContentHeight } from './engine/text-layout';

@Component({
  selector: 'app-text-overlay',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (target) {
      <div
        #overlayRoot
        class="overlay"
        [class.sticky]="isSticky"
        [style.left.px]="screenX"
        [style.top.px]="screenY"
        [style.width.px]="screenW"
        [style.background]="isSticky ? (target.color) : 'transparent'"
      >
        <!-- Posicionada fora do fluxo (acima da caixa) pra não empurrar o textarea
             pra baixo do y real do elemento — senão o que se vê ao digitar fica
             deslocado do resultado final renderizado no canvas. -->
        <div class="text-tools">
          @if (!isSticky) {
            <button [class.active]="bold" (click)="toggle('bold')" title="Negrito"><b>B</b></button>
            <button [class.active]="italic" (click)="toggle('italic')" title="Itálico"><i>I</i></button>
            <button [class.active]="underline" (click)="toggle('underline')" title="Sublinhado"><u>U</u></button>
            <span class="sep"></span>
            <button [class.active]="align === 'left'" (click)="setAlign('left')" title="Alinhar à esquerda">⯇</button>
            <button [class.active]="align === 'center'" (click)="setAlign('center')" title="Centralizar">☰</button>
            <button [class.active]="align === 'right'" (click)="setAlign('right')" title="Alinhar à direita">⯈</button>
            <span class="sep"></span>
          }
          <button (click)="changeFontSize(-2)" title="Diminuir fonte">A−</button>
          <span class="size-label">{{ fontSize }}px</span>
          <button (click)="changeFontSize(2)" title="Aumentar fonte">A+</button>
          @if (!isSticky) {
            <span class="sep"></span>
            <select [ngModel]="fontFamily" (ngModelChange)="setFontFamily($event)" title="Estilo da fonte">
              <option value="sans">Normal</option>
              <option value="handwriting">Manuscrita</option>
            </select>
          }
        </div>
        <textarea
          #input
          [value]="target.content"
          (input)="onInput(input.value)"
          (keydown.escape)="finish.emit()"
          (blur)="onTextareaBlur()"
          [style.fontSize.px]="fontSize"
          [style.fontWeight]="!isSticky && bold ? 'bold' : 'normal'"
          [style.fontStyle]="!isSticky && italic ? 'italic' : 'normal'"
          [style.textDecoration]="!isSticky && underline ? 'underline' : 'none'"
          [style.textAlign]="!isSticky ? align : 'left'"
          [style.fontFamily]="!isSticky ? fontStack : 'sans-serif'"
          [style.color]="isSticky ? '#1d1d1d' : color"
          [style.lineHeight.px]="fontSize * 1.3"
          [style.padding.px]="isSticky ? stickyPadding : 0"
          [style.minHeight.px]="minHeightPx()"
        ></textarea>
      </div>
    }
  `,
  styles: [`
    .overlay { position: absolute; z-index: 10; }
    .overlay.sticky { border-radius: 6px; box-shadow: 0 8px 24px rgba(20,20,43,0.18); }
    textarea {
      display: block;
      width: 100%;
      border: none;
      background: transparent;
      resize: none;
      font-family: sans-serif;
      outline: 1.5px dashed var(--accent, #6d5ef8);
      outline-offset: 3px;
    }
    .text-tools {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 3px;
      flex-wrap: wrap;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e8e8f0);
      border-radius: var(--radius-sm, 8px);
      padding: 5px;
      box-shadow: var(--shadow, 0 6px 20px rgba(30,30,60,0.1));
      width: max-content;
      max-width: 320px;
    }
    .text-tools button {
      border: 1px solid var(--border, #e8e8f0);
      background: var(--bg, #f6f6fb);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 13px;
      line-height: 1;
    }
    .text-tools button.active { background: var(--accent, #6d5ef8); border-color: var(--accent, #6d5ef8); color: #fff; }
    .text-tools .sep { width: 1px; height: 18px; background: var(--border, #e8e8f0); margin: 0 2px; }
    .text-tools .size-label { font-size: 12px; color: var(--text-muted, #7a7a8c); width: 34px; text-align: center; }
    .text-tools select { border: 1px solid var(--border, #e8e8f0); border-radius: 6px; padding: 4px 6px; font-size: 12px; background: var(--bg, #f6f6fb); }
  `],
})
export class TextOverlayComponent implements AfterViewInit {
  @Input() store!: EditorStore;
  @Input() target: TextElement | StickyElement | null = null;
  @Input() screenX = 0;
  @Input() screenY = 0;
  @Input() screenW = 200;
  @Input() screenH = 0;
  @Output() contentChange = new EventEmitter<string>();
  @Output() finish = new EventEmitter<void>();

  @ViewChild('input') inputRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('overlayRoot') overlayRootRef?: ElementRef<HTMLElement>;

  stickyPadding = STICKY_PADDING;

  get isSticky(): boolean {
    return this.target?.type === 'sticky';
  }

  get fontSize(): number {
    return this.target ? this.target.fontSize : 14;
  }

  get bold(): boolean {
    return this.target?.type === 'text' && this.target.bold;
  }

  get italic(): boolean {
    return this.target?.type === 'text' && this.target.italic;
  }

  get underline(): boolean {
    return this.target?.type === 'text' && this.target.underline;
  }

  get align(): TextAlign {
    return this.target?.type === 'text' ? this.target.align : 'left';
  }

  get fontFamily(): TextFontFamily {
    return this.target?.type === 'text' ? this.target.fontFamily : 'sans';
  }

  get fontStack(): string {
    return TEXT_FONT_STACKS[this.fontFamily];
  }

  get color(): string {
    return this.target?.type === 'text' ? this.target.color : '#1d1d1d';
  }

  /** Sticky e texto calculam a altura mínima localmente a partir do próprio conteúdo
   * (em vez de depender de um `screenH` externo) — assim a caixa de edição já reflete
   * ao vivo qualquer mudança de fonte/estilo, sem precisar que o componente pai saiba
   * disso e recalcule por fora. */
  minHeightPx(): number {
    if (!this.target) return 60;
    const scale = this.store?.viewport.scale ?? 1;
    if (this.target.type === 'sticky') {
      return stickyContentHeight(this.target.content, this.target.w, this.target.fontSize) * scale;
    }
    if (this.target.type !== 'text') return 60;
    const worldH = textContentHeight(this.target.content, this.target.w, this.target.fontSize, this.target.fontFamily, this.target.bold, this.target.italic);
    return worldH * scale;
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.inputRef?.nativeElement.focus(), 0);
  }

  onInput(value: string): void {
    this.contentChange.emit(value);
  }

  /** Não fecha a edição se o foco só se moveu pra dentro da barra de ferramentas de
   * texto (botão ou <select>) — sem preventDefault no mousedown (que bloquearia o
   * <select> nativo de abrir no Chrome), o blur da textarea dispara nesses cliques, e
   * precisamos distinguir isso de um blur que realmente saiu do overlay inteiro. */
  onTextareaBlur(): void {
    setTimeout(() => {
      const active = document.activeElement;
      if (!this.overlayRootRef?.nativeElement.contains(active)) {
        this.finish.emit();
      }
    }, 0);
  }

  /** Cada clique de formatação vira seu próprio passo de undo (commit:true) — mais
   * simples e previsível do que tentar mesclar isso no diff de conteúdo do finish(). */
  private patchAndKeepFocus(patch: Partial<TextElement> | Partial<StickyElement>): void {
    if (!this.target) return;
    Object.assign(this.target, patch);
    this.store.updateElement(this.target.id, patch as any, { commit: true });
    this.inputRef?.nativeElement.focus();
  }

  toggle(prop: 'bold' | 'italic' | 'underline'): void {
    if (this.target?.type !== 'text') return;
    this.patchAndKeepFocus({ [prop]: !this.target[prop] } as Partial<TextElement>);
  }

  setAlign(align: TextAlign): void {
    this.patchAndKeepFocus({ align });
  }

  setFontFamily(fontFamily: TextFontFamily): void {
    this.patchAndKeepFocus({ fontFamily });
  }

  changeFontSize(delta: number): void {
    if (!this.target) return;
    const fontSize = Math.min(200, Math.max(8, this.target.fontSize + delta));
    if (this.target.type === 'sticky') {
      const h = stickyContentHeight(this.target.content, this.target.w, fontSize);
      this.patchAndKeepFocus({ fontSize, h });
    } else {
      this.patchAndKeepFocus({ fontSize });
    }
  }
}
