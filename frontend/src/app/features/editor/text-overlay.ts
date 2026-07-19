import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StickyElement, TextAlign, TextElement, TextFontFamily, TEXT_FONT_STACKS } from '../../data/models';
import { EditorStore } from './engine/editor-store';
import { STICKY_PADDING, stickyContentHeight } from './engine/sticky-layout';
import { textContentHeight } from './engine/text-layout';
import {
  INDENT_SPACES_PER_LEVEL,
  MAX_LIST_INDENT,
  ListMarkerKind,
  markerPrefixFor,
  parseListLine,
  selectedLineRange,
  textListLayout,
} from './engine/text-list-layout';

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
            <button (click)="toggleList('bullet')" title="Lista com marcadores">•</button>
            <button (click)="toggleList('number')" title="Lista numerada">1.</button>
            <button (click)="toggleList('checklist')" title="Lista de verificação">☑</button>
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
          (keydown)="onKeydown($event)"
          (blur)="onTextareaBlur()"
          [style.fontSize.px]="fontSize * scale"
          [style.fontWeight]="!isSticky && bold ? 'bold' : 'normal'"
          [style.fontStyle]="!isSticky && italic ? 'italic' : 'normal'"
          [style.textDecoration]="!isSticky && underline ? 'underline' : 'none'"
          [style.textAlign]="!isSticky ? align : 'left'"
          [style.fontFamily]="!isSticky ? fontStack : 'sans-serif'"
          [style.color]="isSticky ? '#1d1d1d' : color"
          [style.lineHeight.px]="fontSize * 1.3 * scale"
          [style.padding.px]="isSticky ? stickyPadding * scale : 0"
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
      outline: none;
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
export class TextOverlayComponent implements AfterViewInit, OnChanges {
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

  /** `fontSize`/`stickyPadding` são medidos em unidades de mundo (mesma unidade de
   * `target.w`/`target.h`); `screenX`/`screenY`/`screenW` já chegam multiplicados pelo
   * zoom (ver `updateOverlayPosition` em editor.page.ts). Sem aplicar esse mesmo fator
   * aqui, a caixa de edição cresce/encolhe com o zoom mas a fonte dentro dela não —
   * quebrando linha num ponto diferente do que o canvas desenha depois de terminar a
   * edição (zoom quase nunca fica em 100% porque `fitToScreen()` roda ao abrir a nota). */
  get scale(): number {
    return this.store?.viewport.scale ?? 1;
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

  /** `<app-text-overlay>` é instanciado uma única vez, com `target` ainda `null` — ou
   * seja, `ngAfterViewInit` roda antes da textarea sequer existir no DOM, e nunca é
   * chamado de novo depois. É `ngOnChanges` (dispara toda vez que `target` muda,
   * inclusive de null pra um elemento) quem garante o autofoco tanto pra criação
   * manual quanto pro texto "documento" auto-criado ao abrir uma página vazia. O
   * setTimeout ainda é necessário: `target` já mudou aqui, mas o Angular só cria a
   * textarea no DOM (e resolve `inputRef`) depois que este hook retorna. */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['target'] && this.target) {
      setTimeout(() => this.inputRef?.nativeElement.focus(), 0);
    }
  }

  onInput(value: string): void {
    this.contentChange.emit(value);
  }

  /** Enter/Tab ganham comportamento "esperto" só dentro de uma linha de lista — em
   * texto comum o navegador segue com o comportamento padrão (quebra de linha simples
   * / mover foco). Os marcadores em si (ex.: "- ", "1. ", "[ ] ") continuam visíveis
   * como texto puro na textarea enquanto edita — só viram bullet/número/checkbox
   * quando o canvas repinta o elemento após terminar a edição. */
  onKeydown(ev: KeyboardEvent): void {
    if (this.target?.type !== 'text') return;
    const textarea = ev.target as HTMLTextAreaElement;
    if (ev.key === 'Enter' && !ev.shiftKey) this.handleEnterKey(ev, textarea);
    else if (ev.key === 'Tab') this.handleTabKey(ev, textarea);
  }

  private handleEnterKey(ev: KeyboardEvent, textarea: HTMLTextAreaElement): void {
    if (textarea.selectionStart !== textarea.selectionEnd) return;
    const t = this.target as TextElement;
    const value = textarea.value;
    const caret = textarea.selectionStart;
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    const parsed = parseListLine(value.slice(lineStart, caret));
    if (parsed.marker === 'none') return;

    ev.preventDefault();
    const indentSpaces = ' '.repeat(parsed.indent * INDENT_SPACES_PER_LEVEL);

    if (parsed.text.trim() === '') {
      // Enter numa linha de lista vazia encerra a lista (igual Word) em vez de
      // continuar criando itens vazios.
      const newValue = value.slice(0, lineStart) + value.slice(caret);
      this.applyTextareaValue(textarea, newValue, lineStart);
      return;
    }

    let prefix: string;
    if (parsed.marker === 'number') {
      const paragraphIndex = value.slice(0, lineStart).split('\n').length - 1;
      const layout = textListLayout(value, 0, 0, t.w, t.fontSize, t.fontFamily, t.bold, t.italic);
      const currentLine = layout.find((l) => l.paragraphIndex === paragraphIndex && l.isMarkerLine);
      const currentNumber = currentLine?.numberLabel ? parseInt(currentLine.numberLabel, 10) : 0;
      prefix = markerPrefixFor('number', { number: currentNumber + 1 });
    } else if (parsed.marker === 'checklist') {
      prefix = markerPrefixFor('checklist', { checked: false });
    } else {
      prefix = markerPrefixFor('bullet');
    }
    const insertion = `\n${indentSpaces}${prefix}`;
    const newValue = value.slice(0, caret) + insertion + value.slice(caret);
    this.applyTextareaValue(textarea, newValue, caret + insertion.length);
  }

  private handleTabKey(ev: KeyboardEvent, textarea: HTMLTextAreaElement): void {
    const value = textarea.value;
    const caretStart = textarea.selectionStart;
    const caretEnd = textarea.selectionEnd;
    const { startLine, endLine } = selectedLineRange(value, caretStart, caretEnd);
    const lines = value.split('\n');
    const parsedAt = lines.map(parseListLine);
    const touchesList = Array.from({ length: endLine - startLine + 1 }, (_, i) => startLine + i).some(
      (i) => parsedAt[i].marker !== 'none',
    );
    if (!touchesList) return; // fora de uma linha de lista, mantém o Tab padrão do navegador

    ev.preventDefault();
    const delta = ev.shiftKey ? -1 : 1;

    // Offset (índice de caractere) de onde cada linha começa no valor ORIGINAL —
    // necessário pra recalcular onde o cursor deve cair depois, já que reindentar
    // insere/remove caracteres antes do texto de cada linha afetada.
    const lineStartOffsets: number[] = [];
    let acc = 0;
    for (const l of lines) {
      lineStartOffsets.push(acc);
      acc += l.length + 1;
    }

    let shiftStart = 0;
    let shiftEnd = 0;
    for (let i = startLine; i <= endLine; i++) {
      const p = parsedAt[i];
      if (p.marker === 'none') continue;
      const currentLevel = Math.floor(p.indentCharLen / INDENT_SPACES_PER_LEVEL);
      const nextLevel = Math.max(0, Math.min(MAX_LIST_INDENT, currentLevel + delta));
      const newIndentLen = nextLevel * INDENT_SPACES_PER_LEVEL;
      const diff = newIndentLen - p.indentCharLen;
      lines[i] = ' '.repeat(newIndentLen) + lines[i].slice(p.indentCharLen);
      // Cursor depois do início dessa linha (o caso comum: Tab com o cursor no fim
      // do que acabou de digitar) acompanha a mudança de tamanho da indentação.
      if (lineStartOffsets[i] < caretStart) shiftStart += diff;
      if (lineStartOffsets[i] < caretEnd) shiftEnd += diff;
    }
    const newValue = lines.join('\n');
    this.applyTextareaValue(
      textarea,
      newValue,
      Math.max(0, caretStart + shiftStart),
      Math.max(0, caretEnd + shiftEnd),
    );
  }

  /** Escreve direto no DOM (mutar `.value` reseta o cursor pro fim se não
   * restaurarmos manualmente) e emite pelo mesmo caminho de `onInput`, pra cair no
   * mesmo diff único de undo já feito ao terminar a edição. */
  private applyTextareaValue(textarea: HTMLTextAreaElement, newValue: string, caretStart: number, caretEnd: number = caretStart): void {
    textarea.value = newValue;
    textarea.setSelectionRange(caretStart, caretEnd);
    this.onInput(newValue);
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

  /** Aplica/remove um marcador de lista na linha do cursor ou em todas as linhas
   * cobertas pela seleção — se todas já tiverem esse marcador, remove (toggle); caso
   * contrário aplica (substituindo qualquer outro tipo de marcador presente). */
  toggleList(kind: Exclude<ListMarkerKind, 'none'>): void {
    if (this.target?.type !== 'text') return;
    const textarea = this.inputRef?.nativeElement;
    if (!textarea) return;
    const value = this.target.content;
    const { startLine, endLine } = selectedLineRange(value, textarea.selectionStart, textarea.selectionEnd);
    const lines = value.split('\n');
    const parsed = lines.map(parseListLine);
    const range = Array.from({ length: endLine - startLine + 1 }, (_, i) => startLine + i);
    const allAlready = range.every((i) => parsed[i].marker === kind);

    let n = 1;
    for (const i of range) {
      const p = parsed[i];
      const indentSpaces = ' '.repeat(p.indent * INDENT_SPACES_PER_LEVEL);
      lines[i] = allAlready
        ? indentSpaces + p.text
        : indentSpaces + markerPrefixFor(kind, { number: n++, checked: false }) + p.text;
    }
    this.patchAndKeepFocus({ content: lines.join('\n') } as Partial<TextElement>);
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
