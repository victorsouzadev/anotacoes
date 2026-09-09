import { Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, signal } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { TaskItem } from '../models/task.model';
import { TasksService } from '../services/tasks.service';
import { TasksStoreService } from '../services/tasks-store.service';
import { ATTACHMENT_ID_ATTR, attachmentIdsInNotes, sanitizeNotesHtml } from './notes-html';

const AUTOSAVE_DELAY_MS = 800;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Editor de anotações gerais da tarefa: texto rico simples + imagens inline.
 *
 * As imagens são anexos da própria tarefa (mesma API de anexos já usada no detalhe) e ficam no HTML
 * só como `data-attachment-id`; o `src` é um objectURL resolvido aqui, porque o endpoint de conteúdo
 * exige o token do usuário e portanto não pode ir direto num `src`. */
@Component({
  selector: 'app-notes-editor',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="notes-editor">
      <div class="toolbar">
        <button type="button" class="fmt bold" (mousedown)="format($event, 'bold')" title="Negrito (Ctrl+B)">B</button>
        <button type="button" class="fmt italic" (mousedown)="format($event, 'italic')" title="Itálico (Ctrl+I)">I</button>
        <button type="button" class="fmt strike" (mousedown)="format($event, 'strikeThrough')" title="Riscado">S</button>
        <span class="sep"></span>
        <button type="button" class="fmt" (mousedown)="format($event, 'insertUnorderedList')" title="Lista">&bull;&nbsp;—</button>
        <button type="button" class="fmt" (mousedown)="format($event, 'insertOrderedList')" title="Lista numerada">1.</button>
        <button type="button" class="fmt" (mousedown)="formatBlock($event, 'h3')" title="Título">H</button>
        <button type="button" class="fmt" (mousedown)="formatBlock($event, 'blockquote')" title="Citação">&rdquo;</button>
        <span class="sep"></span>
        <button type="button" class="fmt img" (mousedown)="pickImage($event)" title="Inserir imagem">
          <app-icon name="image" [size]="13" />
        </button>
        <input #fileInput type="file" accept="image/*" multiple hidden (change)="onFilePicked($event)" />

        <span class="state" [class.error]="saveState() === 'error'">
          @switch (saveState()) {
            @case ('saving') { salvando… }
            @case ('saved') { salvo }
            @case ('error') { erro ao salvar }
          }
        </span>
      </div>

      <div
        #host
        class="surface"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        [attr.data-placeholder]="placeholder"
        (input)="onInput()"
        (blur)="flush()"
        (paste)="onPaste($event)"
        (dragover)="onDragOver($event)"
        (drop)="onDrop($event)"
        (keydown)="onKeydown($event)"
      ></div>

      @if (uploading() > 0) {
        <p class="hint">Enviando imagem…</p>
      }
      @if (errorMessage(); as msg) {
        <p class="error-msg">{{ msg }}</p>
      }
    </div>
  `,
  styles: [`
    .notes-editor { display: flex; flex-direction: column; gap: 8px; }

    .toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .toolbar .fmt {
      min-width: 28px; height: 28px; padding: 0 7px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
      border-radius: var(--radius-sm); font-size: 12px; font-weight: 700;
    }
    .toolbar .fmt:hover { border-color: var(--accent); color: var(--accent); }
    .toolbar .fmt.italic { font-style: italic; }
    .toolbar .fmt.strike { text-decoration: line-through; }
    .toolbar .sep { width: 1px; height: 18px; background: var(--border); margin: 0 3px; }
    .toolbar .state { margin-left: auto; font-size: 11px; color: var(--text-muted); }
    .toolbar .state.error { color: var(--danger, #dc2626); }

    .surface {
      min-height: 160px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text);
      padding: 12px 14px;
      font-size: 14px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    .surface:focus { outline: none; border-color: var(--accent); }
    .surface:empty::before {
      content: attr(data-placeholder);
      color: var(--text-muted);
    }
    .surface p { margin: 0 0 8px; }
    .surface h3 { font-size: 15px; margin: 12px 0 6px; }
    .surface blockquote {
      margin: 8px 0; padding-left: 10px;
      border-left: 3px solid var(--border); color: var(--text-muted);
    }
    .surface ul, .surface ol { margin: 6px 0; padding-left: 22px; }
    .surface img {
      max-width: 100%; border-radius: var(--radius-sm);
      display: block; margin: 8px 0; border: 1px solid var(--border);
    }
    .surface img:not([src]) { min-height: 40px; background: var(--bg); }

    .hint { font-size: 12px; color: var(--text-muted); margin: 0; }
    .error-msg { font-size: 12px; color: var(--danger, #dc2626); margin: 0; }
  `],
})
export class NotesEditorComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) task!: TaskItem;
  @Input() placeholder = 'Anotações gerais desta tarefa…';

  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput', { static: true }) fileInputRef!: ElementRef<HTMLInputElement>;

  saveState = signal<SaveState>('idle');
  uploading = signal(0);
  errorMessage = signal<string | null>(null);

  /** Tarefa cujo conteúdo está na tela — o flush salva NELA, mesmo se o @Input já apontar pra outra. */
  private loadedTask: TaskItem | null = null;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private objectUrls = new Map<string, string>();

  constructor(private store: TasksStoreService, private api: TasksService) {}

  ngOnChanges(): void {
    if (!this.task || this.task.id === this.loadedTask?.id) return;
    void this.flush();
    this.loadedTask = this.task;
    this.errorMessage.set(null);
    this.saveState.set('idle');
    this.hostRef.nativeElement.innerHTML = sanitizeNotesHtml(this.task.notes);
    void this.resolveImages();
  }

  ngOnDestroy(): void {
    void this.flush();
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  onInput(): void {
    this.dirty = true;
    this.saveState.set('saving');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), AUTOSAVE_DELAY_MS);
  }

  onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b' || key === 'i') {
      event.preventDefault();
      document.execCommand(key === 'b' ? 'bold' : 'italic');
      this.onInput();
    }
  }

  format(event: MouseEvent, command: string): void {
    event.preventDefault();
    this.hostRef.nativeElement.focus();
    document.execCommand(command);
    this.onInput();
  }

  formatBlock(event: MouseEvent, tag: string): void {
    event.preventDefault();
    this.hostRef.nativeElement.focus();
    document.execCommand('formatBlock', false, tag);
    this.onInput();
  }

  pickImage(event: MouseEvent): void {
    event.preventDefault();
    this.fileInputRef.nativeElement.click();
  }

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.hostRef.nativeElement.focus();
    void this.insertImages(files);
  }

  onPaste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data) return;

    const images = Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (images.length > 0) {
      event.preventDefault();
      void this.insertImages(images);
      return;
    }

    // Colagem de fora vem com HTML arbitrário — passa pelo mesmo filtro do que é salvo.
    const html = data.getData('text/html');
    event.preventDefault();
    if (html) document.execCommand('insertHTML', false, sanitizeNotesHtml(html));
    else document.execCommand('insertText', false, data.getData('text/plain'));
    this.onInput();
  }

  onDragOver(event: DragEvent): void {
    if (Array.from(event.dataTransfer?.items ?? []).some((i) => i.kind === 'file')) event.preventDefault();
  }

  onDrop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    void this.insertImages(files);
  }

  /** Sobe cada imagem como anexo da tarefa e insere no ponto do cursor. */
  private async insertImages(files: File[]): Promise<void> {
    const images = files.filter((f) => f.type.startsWith('image/'));
    const target = this.loadedTask ?? this.task;
    if (images.length === 0 || !target) return;
    this.errorMessage.set(null);

    for (const file of images) {
      if (file.size > MAX_IMAGE_BYTES) {
        this.errorMessage.set(`"${file.name}" tem mais de 5MB.`);
        continue;
      }
      this.uploading.update((n) => n + 1);
      try {
        const base64 = await toBase64(file);
        const attachment = await this.api.addAttachment(target.id, file.name, file.type, base64);
        const url = URL.createObjectURL(file);
        this.objectUrls.set(attachment.id, url);
        const alt = escapeAttribute(file.name);
        document.execCommand(
          'insertHTML',
          false,
          `<img ${ATTACHMENT_ID_ATTR}="${attachment.id}" alt="${alt}" src="${url}"><p><br></p>`,
        );
        this.onInput();
      } catch {
        this.errorMessage.set(`Não deu pra enviar "${file.name}".`);
      } finally {
        this.uploading.update((n) => n - 1);
      }
    }
  }

  /** Baixa os anexos citados no HTML e aponta cada <img> pro objectURL correspondente. */
  private async resolveImages(): Promise<void> {
    const ids = attachmentIdsInNotes(this.loadedTask?.notes ?? null);
    for (const id of ids) {
      let url = this.objectUrls.get(id);
      if (!url) {
        try {
          const blob = await this.api.downloadAttachment(this.loadedTask!.id, id);
          url = URL.createObjectURL(blob);
          this.objectUrls.set(id, url);
        } catch {
          continue;
        }
      }
      for (const img of Array.from(
        this.hostRef.nativeElement.querySelectorAll(`img[${ATTACHMENT_ID_ATTR}="${cssEscape(id)}"]`),
      )) {
        img.setAttribute('src', url);
      }
    }
  }

  /** Grava agora o que estiver pendente — chamado no blur, na troca de tarefa e ao destruir. */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const loaded = this.loadedTask;
    if (!this.dirty || !loaded) return;

    // A versão do store é a mais fresca; o @Input pode estar defasado depois de um save anterior.
    const target = this.store.tasks().find((t) => t.id === loaded.id) ?? loaded;

    // sanitizeNotesHtml também derruba o src (objectURL), que é volátil e não pode ir pro banco.
    const html = sanitizeNotesHtml(this.hostRef.nativeElement.innerHTML);
    const notes = html.length > 0 ? html : null;
    this.dirty = false;
    if (notes === (target.notes ?? null)) {
      this.saveState.set('saved');
      return;
    }
    try {
      await this.store.updateTask(target, { notes });
      this.saveState.set('saved');
    } catch {
      this.dirty = true;
      this.saveState.set('error');
    }
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
