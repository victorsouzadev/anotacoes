import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, QueryList, ViewChild, ViewChildren, AfterViewInit, OnChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChecklistElement, ChecklistItem } from '../../data/models';
import { uuid } from '../../core/uuid';
import { checklistBoxSize, checklistRowHeight, CHECKLIST_DEFAULT_FONT_SIZE, CHECKLIST_PADDING } from './engine/checklist-layout';
import { EditorStore } from './engine/editor-store';

@Component({
  selector: 'app-checklist-overlay',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (target) {
      <div #overlayRoot class="overlay" [style.left.px]="screenX" [style.top.px]="screenY" [style.width.px]="screenW" [style.padding.px]="overlayPadding">
        <div class="font-tools">
          <button (click)="changeFontSize(-2)" title="Diminuir fonte">A−</button>
          <span class="size-label">{{ target.fontSize }}px</span>
          <button (click)="changeFontSize(2)" title="Aumentar fonte">A+</button>
        </div>
        @for (item of items; track item.id; let i = $index) {
          <div class="row" [style.height.px]="rowHeight()">
            <input
              type="checkbox"
              [style.width.px]="boxSize()"
              [style.height.px]="boxSize()"
              [checked]="item.checked"
              (change)="toggle(i)"
              (keydown.escape)="finish.emit()"
            />
            <input
              #rowInput
              class="row-text"
              [class.checked]="item.checked"
              [style.fontSize.px]="target.fontSize * scale"
              [value]="item.text"
              (input)="onTextInput(i, $event)"
              (focus)="focusedIndex = i"
              (keydown.enter)="onEnter(i, $event)"
              (keydown.backspace)="onBackspace(i, $event)"
              (keydown.escape)="finish.emit()"
              (blur)="onBlur(i)"
            />
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .overlay {
      position: absolute;
      z-index: 10;
      background: transparent;
    }
    .font-tools {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .font-tools button {
      border: 1px solid var(--border, #e8e8f0);
      background: var(--bg, #f6f6fb);
      border-radius: 6px;
      padding: 3px 7px;
      font-size: 12px;
      line-height: 1;
    }
    .font-tools .size-label { font-size: 12px; color: var(--text-muted, #7a7a8c); width: 32px; text-align: center; }
    .row { display: flex; align-items: center; gap: 8px; }
    .row input[type=checkbox] { flex-shrink: 0; accent-color: var(--accent, #6d5ef8); }
    .row-text {
      flex: 1;
      border: none;
      outline: none;
      font-family: sans-serif;
      background: transparent;
    }
    .row-text.checked { text-decoration: line-through; color: rgba(29,29,29,0.45); }
  `],
})
export class ChecklistOverlayComponent implements AfterViewInit, OnChanges {
  @Input() store!: EditorStore;
  @Input() target: ChecklistElement | null = null;
  @Input() screenX = 0;
  @Input() screenY = 0;
  @Input() screenW = 220;
  @Output() itemsChange = new EventEmitter<ChecklistItem[]>();
  @Output() fontSizeChange = new EventEmitter<number>();
  @Output() finish = new EventEmitter<void>();

  @ViewChildren('rowInput') rowInputs!: QueryList<ElementRef<HTMLInputElement>>;
  @ViewChild('overlayRoot') overlayRootRef?: ElementRef<HTMLElement>;

  items: ChecklistItem[] = [];
  focusedIndex = 0;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(): void {
    if (this.target) this.items = this.target.items.map((it) => ({ ...it }));
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.focusRow(this.items.length - 1), 0);
  }

  /** Força a view a se atualizar sincronamente antes de focar — sem isso, a linha
   * recém-criada por Enter ainda não existe no DOM quando tentamos focá-la, e as
   * teclas seguintes vazam para o campo antigo (texto de itens diferentes se mistura). */
  private focusRowSync(index: number): void {
    this.cdr.detectChanges();
    this.rowInputs.get(index)?.nativeElement.focus();
  }

  private focusRow(index: number): void {
    this.rowInputs.get(index)?.nativeElement.focus();
  }

  /** `target.fontSize`/`CHECKLIST_PADDING` são medidos em unidades de mundo;
   * `screenX`/`screenY`/`screenW` já chegam multiplicados pelo zoom (ver
   * `updateOverlayPosition` em editor.page.ts). Sem aplicar esse mesmo fator aqui, a
   * caixa de edição acompanha o zoom mas a fonte/altura de linha dentro dela não —
   * ficando desalinhada do que o canvas desenha depois de terminar a edição. */
  get scale(): number {
    return this.store?.viewport.scale ?? 1;
  }

  get overlayPadding(): number {
    return CHECKLIST_PADDING * this.scale;
  }

  rowHeight(): number {
    return (checklistRowHeight(this.target?.fontSize ?? CHECKLIST_DEFAULT_FONT_SIZE) + 2) * this.scale;
  }

  boxSize(): number {
    return checklistBoxSize(this.target?.fontSize ?? CHECKLIST_DEFAULT_FONT_SIZE) * this.scale;
  }

  changeFontSize(delta: number): void {
    if (!this.target) return;
    const fontSize = Math.min(48, Math.max(9, this.target.fontSize + delta));
    this.fontSizeChange.emit(fontSize);
    // Sem isso, o foco fica preso no botão A+/A- — Escape e digitação param de
    // funcionar até o usuário clicar de volta manualmente numa linha.
    this.rowInputs.get(this.focusedIndex)?.nativeElement.focus();
  }

  toggle(index: number): void {
    this.items[index] = { ...this.items[index], checked: !this.items[index].checked };
    this.emitChange();
  }

  onTextInput(index: number, ev: Event): void {
    const value = (ev.target as HTMLInputElement).value;
    this.items[index] = { ...this.items[index], text: value };
    this.emitChange();
  }

  onEnter(index: number, ev: Event): void {
    ev.preventDefault();
    this.items.splice(index + 1, 0, { id: uuid(), text: '', checked: false });
    this.emitChange();
    this.focusRowSync(index + 1);
  }

  onBackspace(index: number, ev: Event): void {
    if (this.items[index].text.length > 0) return;
    if (this.items.length <= 1) return;
    ev.preventDefault();
    this.items.splice(index, 1);
    this.emitChange();
    this.focusRowSync(Math.max(0, index - 1));
  }

  onBlur(index: number): void {
    // Se o foco saiu do overlay inteiro (não só da linha, mas também não foi para os
    // botões de fonte etc.), termina a edição — checar só rowInputs fechava o overlay
    // no meio de um clique no botão A+/A- (mesmo bug já visto no text-overlay com o
    // <select> de fonte).
    setTimeout(() => {
      const active = document.activeElement;
      if (!this.overlayRootRef?.nativeElement.contains(active)) {
        this.finish.emit();
      }
    }, 0);
  }

  private emitChange(): void {
    this.itemsChange.emit(this.items.map((it) => ({ ...it })));
  }
}
