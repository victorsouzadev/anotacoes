import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild, effect } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ChecklistElement, ChecklistItem, NotePage, PAGE_COLORS, PaperStyle, StickyElement, TextElement } from '../../data/models';
import { NotesRepoService } from '../../data/notes-repo.service';
import { SyncService } from '../../data/sync.service';
import { ThemeService } from '../../core/theme.service';
import { uuid } from '../../core/uuid';
import { FocusOnInitDirective } from '../../shared/focus-on-init.directive';
import { CanvasHostComponent } from './canvas-host';
import { CanvasCornerControlsComponent } from './canvas-corner-controls';
import { checklistHeight } from './engine/checklist-layout';
import { EditorStore } from './engine/editor-store';
import { exportNoteToPdf, exportNoteToPng } from './engine/export';
import { TamanhoPdf } from './engine/export-pdf-layout';
import { duplicatePage, movePage } from './engine/page-ops';
import { Renderer } from './engine/renderer';
import { stickyContentHeight } from './engine/sticky-layout';
import { Viewport } from './engine/viewport';
import { ToolbarComponent } from './toolbar';
import { PropertiesPanelComponent } from './properties-panel';
import { MoreActionsMenuComponent } from './more-actions-menu';
import { TextOverlayComponent } from './text-overlay';
import { ChecklistOverlayComponent } from './checklist-overlay';
import { NoteReaderComponent } from './note-reader';
import { ShareDialogComponent } from './share-dialog';
import { IconComponent } from '../../shared/icon';

@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [
    RouterLink, FormsModule, FocusOnInitDirective, CanvasHostComponent, ToolbarComponent,
    PropertiesPanelComponent, CanvasCornerControlsComponent, MoreActionsMenuComponent,
    TextOverlayComponent, ChecklistOverlayComponent, NoteReaderComponent, IconComponent, ShareDialogComponent,
  ],
  template: `
    <div class="editor-page">
      <header>
        <a routerLink="/notes" class="back">← Notas</a>
        <input class="title-input" [(ngModel)]="title" (change)="onTitleChange()" placeholder="Título da nota" />
        <span class="sync-indicator" [class]="syncService.status()">
          <span class="dot"></span>{{ syncLabel() }}
        </span>
        <button class="read-btn" (click)="openShare()" title="Compartilhar por link somente leitura">
          <app-icon name="share" [size]="15" /> <span class="btn-label">Compartilhar</span>
        </button>
        <button class="read-btn" (click)="openReader()" title="Modo leitura: esconde as ferramentas, ←/→ troca de página, F tela cheia">
          <app-icon name="book" [size]="15" /> Ler
        </button>
        <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()">{{ themeIcon() }}</button>
      </header>
      @if (pdfDialog) {
        <div class="pdf-fundo" (click)="pdfDialog = false">
          <div class="pdf-dialogo" role="dialog" aria-label="Exportar PDF" (click)="$event.stopPropagation()">
            <h2>Exportar PDF</h2>
            <fieldset>
              <label><input type="radio" name="pdf-paginas" [(ngModel)]="pdfPaginas" value="todas" /> Nota inteira ({{ pages.length }} página(s))</label>
              <label><input type="radio" name="pdf-paginas" [(ngModel)]="pdfPaginas" value="atual" /> Só a página atual</label>
            </fieldset>
            <fieldset>
              <label><input type="radio" name="pdf-tamanho" [(ngModel)]="pdfTamanho" value="a4" /> A4 (orientação automática)</label>
              <label><input type="radio" name="pdf-tamanho" [(ngModel)]="pdfTamanho" value="conteudo" /> Tamanho do conteúdo</label>
            </fieldset>
            <label><input type="checkbox" [(ngModel)]="pdfPapel" /> Incluir o estilo de papel (pautado/quadriculado)</label>
            <div class="pdf-acoes">
              <button type="button" (click)="pdfDialog = false">Cancelar</button>
              <button type="button" class="primario" (click)="onExportPdf()" [disabled]="gerandoPdf">{{ gerandoPdf ? 'Gerando PDF…' : 'Exportar' }}</button>
            </div>
          </div>
        </div>
      }
      @if (sharing) {
        <app-share-dialog [noteId]="noteId" [sincronizando]="syncService.status() !== 'idle'" (fechar)="sharing = false" />
      }
      @if (reading) {
        <app-note-reader [pages]="pages" [paperStyle]="store.paperStyle()" [inicio]="currentPageIndex" [titulo]="title"
          (fechar)="closeReader($event)" />
      }
      <div class="pages-bar">
        @for (p of pages; track p.id; let i = $index) {
          <div class="page-tab" [class.active]="i === currentPageIndex" [class.drop-alvo]="dropAlvo === i" (click)="switchPage(i)"
               draggable="true" (dragstart)="onTabDragStart(i, $event)" (dragover)="onTabDragOver(i, $event)"
               (dragleave)="dropAlvo = null" (drop)="onTabDrop(i, $event)" (dragend)="dragDe = null; dropAlvo = null"
               (contextmenu)="openPageMenu(i, $event)"
               (pointerdown)="onTabPointerDown(i, $event)" (pointerup)="cancelLongPress()" (pointerleave)="cancelLongPress()">
            <span
              class="page-color-dot"
              [style.background]="p.color || 'transparent'"
              (click)="toggleColorPicker(i, $event)"
              title="Cor da página"
            ></span>
            @if (editingPageId === p.id) {
              <input
                class="page-title-input"
                appFocusOnInit
                [(ngModel)]="editingPageTitle"
                (click)="$event.stopPropagation()"
                (blur)="commitRenamePage(i)"
                (keydown.enter)="$event.preventDefault(); commitRenamePage(i)"
                (keydown.escape)="cancelRenamePage()"
              />
            } @else {
              <span
                class="page-label"
                (dblclick)="$event.stopPropagation(); startRenamePage(p)"
                [title]="'Página ' + (i + 1) + ' — duplo clique para renomear'"
              >{{ p.title || ('Página ' + (i + 1)) }}</span>
            }
            @if (pages.length > 1) {
              <span class="page-close" (click)="$event.stopPropagation(); removePage(i)" title="Excluir página">×</span>
            }
          </div>
        }
        <button class="page-add" (click)="addPage()" title="Nova página (Alt+N)">+ Página</button>
      </div>
      @if (pageMenu) {
        <div class="page-menu" [style.top.px]="pageMenu.top" [style.left.px]="pageMenu.left" (click)="$event.stopPropagation()" role="menu">
          <button role="menuitem" (click)="startRenamePage(pages[pageMenu.index]); pageMenu = null">Renomear</button>
          <button role="menuitem" (click)="duplicatePageAt(pageMenu.index)">Duplicar página</button>
          <button role="menuitem" [disabled]="pageMenu.index === 0" (click)="movePageBy(pageMenu.index, -1)">Mover para a esquerda</button>
          <button role="menuitem" [disabled]="pageMenu.index === pages.length - 1" (click)="movePageBy(pageMenu.index, 1)">Mover para a direita</button>
          @if (pages.length > 1) {
            <button role="menuitem" class="perigo" (click)="removePage(pageMenu.index); pageMenu = null">Excluir página</button>
          }
        </div>
      }
      @if (removedPage) {
        <div class="page-toast" role="status">
          Página excluída
          <button (click)="undoRemovePage()">Desfazer</button>
        </div>
      }
      @if (colorPickerPage) {
        <div
          class="color-picker"
          [style.top.px]="colorPickerPos.top"
          [style.left.px]="colorPickerPos.left"
          (click)="$event.stopPropagation()"
        >
          @for (c of pageColors; track c) {
            <button class="swatch" [class.active]="colorPickerPage.color === c" [style.background]="c" (click)="setPageColor(colorPickerIndex!, c)"></button>
          }
          <button class="swatch swatch-none" [class.active]="!colorPickerPage.color" (click)="setPageColor(colorPickerIndex!, undefined)" title="Sem cor">✕</button>
        </div>
      }
      <div class="canvas-area">
        <app-canvas-host
          #canvasHost
          [store]="store"
          [hiddenElementId]="editingTarget?.id ?? editingChecklistTarget?.id ?? null"
          [inativo]="reading"
          (requestTextEdit)="onEditText($event)"
          (requestStickyEdit)="onEditSticky($event)"
          (requestChecklistEdit)="onEditChecklist($event)"
          (elementsChanged)="scheduleSave()"
          (requestImmediateSave)="flushSave()"
        />
        <app-toolbar [store]="store" />
        <app-properties-panel [store]="store" (elementsChanged)="scheduleSave()" />
        <app-canvas-corner-controls
          #cornerControls
          [store]="store"
          (undo)="onUndo()"
          (redo)="onRedo()"
          (zoomIn)="zoom(1.2)"
          (zoomOut)="zoom(1 / 1.2)"
          (fitToScreen)="canvasHost.fitToScreen()"
        />
        <app-more-actions-menu
          [store]="store"
          (duplicate)="store.duplicateSelection(); flushSave()"
          (deleteSelection)="onDeleteSelection()"
          (bringToFront)="onBringToFront()"
          (sendToBack)="onSendToBack()"
          (paperStyleChange)="onPaperStyleChange($event)"
          (exportPng)="onExportPng($event)"
          (exportPdf)="pdfDialog = true"
        />
        <app-text-overlay
          [store]="store"
          [target]="editingTarget"
          [screenX]="overlayX"
          [screenY]="overlayY"
          [screenW]="overlayW"
          [screenH]="overlayH"
          (contentChange)="onOverlayContent($event)"
          (finish)="onOverlayFinish()"
        />
        <app-checklist-overlay
          [store]="store"
          [target]="editingChecklistTarget"
          [screenX]="overlayX"
          [screenY]="overlayY"
          [screenW]="overlayW"
          (itemsChange)="onChecklistItemsChange($event)"
          (fontSizeChange)="onChecklistFontSizeChange($event)"
          (finish)="onChecklistFinish()"
        />
      </div>
    </div>
  `,
  styles: [`
    .editor-page { display: flex; flex-direction: column; height: 100dvh; background: var(--bg); }
    header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .back {
      text-decoration: none;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      transition: background 0.12s, color 0.12s;
    }
    .back:hover { background: var(--bg); color: var(--accent); }
    .title-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 16px;
      font-weight: 600;
      outline: none;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      min-width: 0;
      transition: background 0.12s;
    }
    .title-input:focus { background: var(--bg); }
    .sync-indicator { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .sync-indicator .dot { width: 6px; height: 6px; border-radius: 50%; background: #2ea44f; }
    .sync-indicator.syncing .dot { background: var(--accent); animation: pulse 1s infinite; }
    .sync-indicator.offline .dot { background: #d85a30; }
    .sync-indicator.error .dot { background: var(--danger); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    .pdf-fundo { position: fixed; inset: 0; background: rgb(0 0 0 / .35); z-index: 90; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pdf-dialogo { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px;
      width: min(380px, 100%); display: flex; flex-direction: column; gap: 10px; box-shadow: var(--shadow); font-size: 13px; }
    .pdf-dialogo h2 { margin: 0 0 4px; font-size: 16px; }
    .pdf-dialogo fieldset { border: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pdf-dialogo label { display: flex; align-items: center; gap: 8px; }
    .pdf-acoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
    .pdf-acoes button { border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: var(--radius-sm); padding: 7px 12px; font-weight: 600; }
    .pdf-acoes .primario { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
    .read-btn {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid var(--border); background: var(--bg); color: var(--text);
      border-radius: var(--radius-sm); padding: 6px 10px; font-size: 13px; font-weight: 600; flex-shrink: 0;
    }
    .read-btn:hover { border-color: var(--accent); color: var(--accent); }
    .theme-toggle {
      border: 1px solid var(--border);
      background: var(--bg);
      border-radius: var(--radius-sm);
      width: 30px; height: 30px;
      font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .theme-toggle:hover { border-color: var(--accent); }
    .canvas-area { position: relative; flex: 1; overflow: hidden; background: #fdfdfd; }
    .pages-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
    }
    .page-tab {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      border-radius: var(--radius-sm);
      padding: 5px 8px 5px 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      flex-shrink: 0;
      cursor: pointer;
    }
    .page-tab.drop-alvo { box-shadow: -3px 0 0 var(--accent); }
    .page-menu { position: fixed; z-index: 80; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
      box-shadow: var(--shadow); padding: 4px; display: flex; flex-direction: column; min-width: 190px; }
    .page-menu button { border: none; background: none; text-align: left; padding: 8px 10px; border-radius: 6px; font-size: 13px; color: var(--text); }
    .page-menu button:hover:not(:disabled) { background: var(--accent-soft); }
    .page-menu button:disabled { opacity: .4; }
    .page-menu .perigo { color: var(--danger); }
    .page-toast { position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%); z-index: 80; display: flex; align-items: center; gap: 14px;
      background: var(--text); color: var(--bg); padding: 10px 16px; border-radius: var(--radius-sm); font-size: 13px; box-shadow: var(--shadow); }
    .page-toast button { border: none; background: none; color: inherit; font-weight: 700; text-decoration: underline; }
    .page-tab.active { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
    .page-color-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 1px solid var(--border);
      flex-shrink: 0;
    }
    .page-tab.active .page-color-dot { border-color: rgba(255,255,255,0.6); }
    .page-label { white-space: nowrap; }
    .page-title-input {
      width: 90px;
      border: none;
      background: var(--surface);
      color: inherit;
      font: inherit;
      outline: none;
      border-radius: 4px;
      padding: 1px 4px;
    }
    .page-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px; height: 14px;
      border-radius: 50%;
      opacity: 0.7;
      font-size: 12px;
      line-height: 1;
    }
    .page-close:hover { opacity: 1; background: rgba(0,0,0,0.15); }
    .color-picker {
      position: fixed;
      z-index: 12;
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px;
      box-shadow: var(--shadow-lg);
    }
    .swatch {
      width: 22px; height: 22px;
      padding: 0;
      border-radius: 50%;
      border: 2px solid var(--border);
      flex-shrink: 0;
    }
    .swatch.active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .swatch-none {
      background: var(--bg);
      display: flex; align-items: center; justify-content: center;
      font-size: 10px;
      color: var(--text-muted);
    }
    .page-add {
      border: 1px dashed var(--border);
      background: none;
      border-radius: var(--radius-sm);
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .page-add:hover { border-color: var(--accent); color: var(--accent); }
    @media (max-width: 560px) {
      header { padding: 8px 10px; gap: 10px; }
      .title-input { font-size: 14px; }
      .sync-indicator span:last-child { display: none; }
      .btn-label { display: none; }
    }
  `],
})
export class EditorPageComponent implements OnInit, OnDestroy {
  @ViewChild('canvasHost') canvasHost!: CanvasHostComponent;
  @ViewChild('cornerControls') cornerControls!: CanvasCornerControlsComponent;

  store = new EditorStore();
  noteId = '';
  /** Modo leitura aberto (spec 024). */
  reading = false;
  /** Diálogo de link somente leitura aberto (spec 023). */
  sharing = false;
  /** Exportar PDF (spec 019). */
  pdfDialog = false;
  pdfPaginas: 'todas' | 'atual' = 'todas';
  pdfTamanho: TamanhoPdf = 'a4';
  pdfPapel = false;
  gerandoPdf = false;
  /** Abas de página (spec 020): menu de contexto, arrastar e desfazer exclusão. */
  pageMenu: { index: number; top: number; left: number } | null = null;
  removedPage: { page: NotePage; index: number } | null = null;
  private removedTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  dragDe: number | null = null;
  dropAlvo: number | null = null;
  title = '';
  pages: NotePage[] = [];
  currentPageIndex = 0;
  editingPageId: string | null = null;
  editingPageTitle = '';
  colorPickerIndex: number | null = null;
  colorPickerPos = { top: 0, left: 0 };
  pageColors = PAGE_COLORS;
  editingTarget: TextElement | StickyElement | null = null;
  editingChecklistTarget: ChecklistElement | null = null;
  private editingOriginalContent = '';
  private editingOriginalH = 0;
  private editingOriginalItemsJson = '';
  overlayX = 0;
  overlayY = 0;
  overlayW = 200;
  overlayH = 0;

  get colorPickerPage(): NotePage | null {
    return this.colorPickerIndex !== null ? this.pages[this.colorPickerIndex] ?? null : null;
  }

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private repo: NotesRepoService,
    public syncService: SyncService,
    public theme: ThemeService,
    private cdr: ChangeDetectorRef,
  ) {
    // Nota mandada para a lixeira em outro aparelho (spec 018): depois de cada sincronização,
    // se a cópia local ficou na lixeira ou foi excluída, volta para a lista.
    effect(() => {
      if (this.syncService.status() !== 'idle' || !this.noteId) return;
      void this.repo.getNote(this.noteId).then((n) => {
        if (!n || n.trashedAt || n.deletedAt) this.router.navigateByUrl('/notes');
      });
    });
  }

  themeIcon(): string {
    switch (this.theme.pref()) {
      case 'dark': return '🌙';
      case 'light': return '☀️';
      default: return '🖥️';
    }
  }

  themeLabel(): string {
    switch (this.theme.pref()) {
      case 'dark': return 'Tema: escuro (clique para claro)';
      case 'light': return 'Tema: claro (clique para automático)';
      default: return 'Tema: automático (clique para escuro)';
    }
  }

  async ngOnInit(): Promise<void> {
    this.noteId = this.route.snapshot.paramMap.get('id')!;
    const note = await this.repo.getNote(this.noteId);
    if (!note || note.trashedAt || note.deletedAt) {
      this.router.navigateByUrl('/notes');
      return;
    }
    this.title = note.title;
    this.pages = note.pages;
    this.currentPageIndex = 0;
    this.store.paperStyle.set(note.paperStyle ?? 'blank');
    this.store.loadElements(this.pages[0].elements);
    // Roda fora de qualquer evento do Angular (depois do await) — sem isso, numa nota
    // recém-criada o título muda de '' pra 'Nova nota' sem repintar a tela a tempo,
    // mesma classe de bug já tratada em maybeAutoStartText().
    this.cdr.markForCheck();
    setTimeout(() => { this.canvasHost?.fitToScreen(); this.cornerControls?.refreshZoomPercent(); this.maybeAutoStartText(); }, 50);
    // Um F5/fechar aba não passa pelo ngOnDestroy do Angular a tempo de terminar o
    // save assíncrono no IndexedDB — 'visibilitychange' dispara antes e de forma mais
    // confiável nesses casos (recomendado pelo próprio spec da Page Visibility API).
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onVisibilityChange);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onVisibilityChange);
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveNow();
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden' && this.saveTimeout) {
      this.flushSave();
    }
  };

  syncLabel(): string {
    switch (this.syncService.status()) {
      case 'syncing': return 'sincronizando…';
      case 'offline': return 'offline';
      case 'error': return 'erro ao sincronizar';
      default: return 'salvo';
    }
  }

  scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.saveNow(), 800);
  }

  /** Salva imediatamente, cancelando qualquer debounce pendente — usar após uma ação
   * "conclusiva" (fim de edição de texto, navegação para fora) em vez de scheduleSave,
   * que arrisca perder a mudança se a página fechar/recarregar antes dos 800ms. */
  flushSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = null;
    this.saveNow();
  }

  private async saveNow(): Promise<void> {
    this.captureCurrentPage();
    await this.repo.savePages(this.noteId, this.pages);
    await this.generateThumbnail();
    this.syncService.syncNow();
  }

  /** Grava o conteúdo atual do EditorStore de volta no array `pages` em memória —
   * o store só conhece a página que está aberta agora, então antes de salvar ou
   * trocar de página é preciso sincronizar essa cópia antes de sobrescrever `pages`. */
  private captureCurrentPage(): void {
    const current = this.pages[this.currentPageIndex];
    if (current) this.pages[this.currentPageIndex] = { ...current, elements: this.store.elements() };
  }

  switchPage(index: number): void {
    if (index === this.currentPageIndex || !this.pages[index]) return;
    this.captureCurrentPage();
    this.currentPageIndex = index;
    this.store.loadElements(this.pages[index].elements);
    setTimeout(() => { this.canvasHost?.fitToScreen(); this.cornerControls?.refreshZoomPercent(); this.maybeAutoStartText(); }, 0);
  }

  addPage(): void {
    this.captureCurrentPage();
    this.pages.push({ id: uuid(), elements: [] });
    this.currentPageIndex = this.pages.length - 1;
    this.store.loadElements([]);
    this.flushSave();
    setTimeout(() => { this.canvasHost?.fitToScreen(); this.cornerControls?.refreshZoomPercent(); this.maybeAutoStartText(); }, 0);
  }

  /** Exclui sem perguntar; o aviso oferece desfazer por 6 s (spec 020). */
  removePage(index: number): void {
    if (this.pages.length <= 1) return;
    this.captureCurrentPage();
    const [removida] = this.pages.splice(index, 1);
    if (this.currentPageIndex >= this.pages.length) this.currentPageIndex = this.pages.length - 1;
    else if (index < this.currentPageIndex) this.currentPageIndex--;
    this.store.loadElements(this.pages[this.currentPageIndex].elements);
    this.removedPage = { page: removida, index };
    if (this.removedTimer) clearTimeout(this.removedTimer);
    this.removedTimer = setTimeout(() => { this.removedPage = null; this.cdr.markForCheck(); }, 6000);
    this.flushSave();
  }

  undoRemovePage(): void {
    const r = this.removedPage;
    if (!r) return;
    this.removedPage = null;
    if (this.removedTimer) clearTimeout(this.removedTimer);
    this.captureCurrentPage();
    const indice = Math.min(r.index, this.pages.length);
    this.pages.splice(indice, 0, r.page);
    this.currentPageIndex = indice;
    this.store.loadElements(r.page.elements);
    this.flushSave();
    setTimeout(() => { this.canvasHost?.fitToScreen(); this.cornerControls?.refreshZoomPercent(); }, 0);
  }

  duplicatePageAt(index: number): void {
    this.pageMenu = null;
    this.captureCurrentPage();
    const copia = duplicatePage(this.pages[index]);
    this.pages.splice(index + 1, 0, copia);
    this.currentPageIndex = index + 1;
    this.store.loadElements(copia.elements);
    this.flushSave();
    setTimeout(() => { this.canvasHost?.fitToScreen(); this.cornerControls?.refreshZoomPercent(); }, 0);
  }

  movePageBy(index: number, delta: number): void {
    this.pageMenu = null;
    this.reorderPage(index, index + delta);
  }

  private reorderPage(de: number, para: number): void {
    if (para < 0 || para >= this.pages.length || de === para) return;
    this.captureCurrentPage();
    const atual = this.pages[this.currentPageIndex];
    this.pages = movePage(this.pages, de, para);
    this.currentPageIndex = this.pages.indexOf(atual);
    this.flushSave();
  }

  openPageMenu(index: number, ev: MouseEvent): void {
    ev.preventDefault();
    this.pageMenu = { index, top: ev.clientY + 4, left: Math.min(ev.clientX, window.innerWidth - 200) };
  }

  /** Toque longo (0,5 s) na aba abre o mesmo menu, para celular e tablet. */
  onTabPointerDown(index: number, ev: PointerEvent): void {
    if (ev.pointerType === 'mouse') return;
    this.cancelLongPress();
    const { clientX, clientY } = ev;
    this.longPressTimer = setTimeout(() => {
      this.pageMenu = { index, top: clientY + 8, left: Math.min(clientX, window.innerWidth - 200) };
      this.cdr.markForCheck();
    }, 500);
  }

  cancelLongPress(): void {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  onTabDragStart(index: number, ev: DragEvent): void {
    this.dragDe = index;
    ev.dataTransfer?.setData('text/plain', String(index));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }

  onTabDragOver(index: number, ev: DragEvent): void {
    if (this.dragDe === null) return;
    ev.preventDefault();
    this.dropAlvo = index;
  }

  onTabDrop(index: number, ev: DragEvent): void {
    ev.preventDefault();
    const de = this.dragDe;
    this.dragDe = null;
    this.dropAlvo = null;
    if (de !== null) this.reorderPage(de, index);
  }

  startRenamePage(p: NotePage): void {
    this.editingPageId = p.id;
    this.editingPageTitle = p.title ?? '';
  }

  commitRenamePage(index: number): void {
    const p = this.pages[index];
    if (!p || this.editingPageId !== p.id) return;
    this.editingPageId = null;
    const title = this.editingPageTitle.trim();
    if (title === (p.title ?? '')) return;
    this.pages[index] = { ...p, title: title || undefined };
    this.flushSave();
  }

  cancelRenamePage(): void {
    this.editingPageId = null;
  }

  toggleColorPicker(index: number, ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.colorPickerIndex === index) {
      this.colorPickerIndex = null;
      return;
    }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.colorPickerPos = { top: rect.bottom + 6, left: rect.left };
    this.colorPickerIndex = index;
  }

  setPageColor(index: number, color: string | undefined): void {
    const p = this.pages[index];
    if (!p) return;
    this.pages[index] = { ...p, color };
    this.colorPickerIndex = null;
    this.flushSave();
  }

  @HostListener('document:click')
  closeColorPicker(): void {
    this.colorPickerIndex = null;
    this.pageMenu = null;
  }

  onExportPng(transparent: boolean): void {
    this.captureCurrentPage();
    exportNoteToPng(this.store.elements(), this.store.paperStyle(), this.title || 'nota', transparent);
  }

  private async generateThumbnail(): Promise<void> {
    const elements = this.store.elements();
    if (elements.length === 0) return;
    const canvas = document.createElement('canvas');
    const cssW = 240;
    const cssH = 180;
    const viewport = new Viewport();
    viewport.fitToScreen(Renderer.contentBBox(elements), cssW, cssH);
    const renderer = new Renderer(canvas, viewport);
    renderer.resize(cssW, cssH);
    renderer.render(elements, new Set(), null, null);
    await this.repo.saveThumbnail(this.noteId, canvas.toDataURL('image/png'));
  }

  async onTitleChange(): Promise<void> {
    await this.repo.renameNote(this.noteId, this.title);
    this.syncService.syncNow();
  }

  onUndo(): void {
    if (this.store.history.undo()) this.flushSave();
  }

  onRedo(): void {
    if (this.store.history.redo()) this.flushSave();
  }

  onDeleteSelection(): void {
    const ids = [...this.store.selectedIds()];
    if (ids.length === 0) return;
    this.store.removeElements(ids);
    this.flushSave();
  }

  onBringToFront(): void {
    const ids = [...this.store.selectedIds()];
    if (ids.length) { this.store.bringToFront(ids); this.flushSave(); }
  }

  onSendToBack(): void {
    const ids = [...this.store.selectedIds()];
    if (ids.length) { this.store.sendToBack(ids); this.flushSave(); }
  }

  onPaperStyleChange(style: PaperStyle): void {
    this.store.paperStyle.set(style);
    this.repo.setPaperStyle(this.noteId, style);
  }

  zoom(factor: number): void {
    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.store.viewport.zoomAt(center, factor);
    this.canvasHost.scheduleRender();
  }

  onEditText(el: TextElement): void {
    this.editingTarget = el;
    this.editingOriginalContent = el.content;
    this.updateOverlayPosition(el.x, el.y, el.w);
  }

  /** Página vazia (nota nova, página nova, ou trocou pra uma página sem conteúdo)
   * já abre com um texto largo tipo "folha de documento" em edição, cursor piscando
   * — sem precisar escolher a ferramenta texto e clicar no canvas. Roda dentro de um
   * setTimeout (fora de qualquer evento do Angular), e essa app é zoneless — sem o
   * markForCheck no final, o estado muda mas a tela só atualiza no próximo clique
   * real do usuário. */
  private maybeAutoStartText(): void {
    if (this.store.elements().length > 0) return;
    const el: TextElement = {
      id: uuid(),
      type: 'text',
      x: 64,
      y: 64,
      w: 680,
      content: '',
      fontSize: 16,
      bold: false,
      italic: false,
      underline: false,
      align: 'left',
      fontFamily: 'sans',
      color: '#1d1d1d',
      zIndex: this.store.nextZIndex(),
      rotation: 0,
    };
    this.store.addElement(el);
    this.onEditText(el);
    this.cdr.markForCheck();
  }

  onEditSticky(el: StickyElement): void {
    this.editingTarget = el;
    this.editingOriginalContent = el.content;
    this.editingOriginalH = el.h;
    this.updateOverlayPosition(el.x, el.y, el.w);
    this.overlayH = el.h * this.store.viewport.scale;
  }

  private updateOverlayPosition(x: number, y: number, w: number): void {
    const screen = this.store.viewport.worldToScreen({ x, y });
    this.overlayX = screen.x;
    this.overlayY = screen.y;
    this.overlayW = w * this.store.viewport.scale;
  }

  onOverlayContent(value: string): void {
    if (!this.editingTarget) return;
    // Mantém editingTarget em sincronia — o overlay reaplica [value]="target.content" a
    // cada ciclo de detecção de mudanças, e sem isso o valor digitado seria sobrescrito
    // pelo conteúdo antigo (o store guarda uma cópia nova, não a mesma referência).
    this.editingTarget.content = value;
    // Nota adesiva cresce junto com o texto — nunca encolhe abaixo do necessário pra
    // não cortar o que já foi escrito, mas também não fica maior do que precisa.
    const patch: any = { content: value };
    if (this.editingTarget.type === 'sticky') {
      const h = stickyContentHeight(value, this.editingTarget.w, this.editingTarget.fontSize);
      this.editingTarget.h = h;
      patch.h = h;
      this.overlayH = h * this.store.viewport.scale;
    }
    this.store.updateElement(this.editingTarget.id, patch, { commit: false });
  }

  onOverlayFinish(): void {
    if (this.editingTarget) {
      const id = this.editingTarget.id;
      const finalContent = this.editingTarget.content;
      const originalContent = this.editingOriginalContent;
      const finalH = this.editingTarget.type === 'sticky' ? this.editingTarget.h : 0;
      const originalH = this.editingOriginalH;
      // Texto criado (auto ou manualmente) e abandonado sem digitar nada não fica
      // salvo pra sempre como um elemento fantasma invisível — remove em vez de
      // deixar o array de elementos acumulando caixas de texto vazias.
      const isEmptyText = this.editingTarget.type === 'text' && finalContent.trim() === '';
      // O conteúdo já foi aplicado ao vivo durante a digitação (commit:false a cada
      // tecla) — se déssemos commit:true aqui do jeito genérico, "antes" e "depois"
      // seriam iguais e o undo pareceria não fazer nada. Construímos o comando à mão
      // comparando com o conteúdo (e altura, no caso de sticky) capturados no início.
      if (isEmptyText) {
        this.store.removeElements([id]);
      } else if (finalContent !== originalContent || finalH !== originalH) {
        const doPatch: any = { content: finalContent };
        const undoPatch: any = { content: originalContent };
        if (this.editingTarget.type === 'sticky') {
          doPatch.h = finalH;
          undoPatch.h = originalH;
        }
        this.store.pushCommand({
          do: () => this.store.updateElement(id, doPatch, { commit: false }),
          undo: () => this.store.updateElement(id, undoPatch, { commit: false }),
        });
      }
    }
    this.editingTarget = null;
    this.flushSave();
  }

  onEditChecklist(el: ChecklistElement): void {
    this.editingChecklistTarget = el;
    this.editingOriginalItemsJson = JSON.stringify(el.items);
    this.editingOriginalH = el.h;
    this.updateOverlayPosition(el.x, el.y, el.w);
  }

  onChecklistItemsChange(items: ChecklistItem[]): void {
    if (!this.editingChecklistTarget) return;
    this.editingChecklistTarget.items = items;
    // Só cresce pra caber o conteúdo — nunca encolhe automaticamente, senão qualquer
    // digitação descartava um redimensionamento manual feito com a alça de resize.
    const minH = checklistHeight(items.length, this.editingChecklistTarget.fontSize);
    const h = Math.max(this.editingChecklistTarget.h, minH);
    this.editingChecklistTarget.h = h;
    this.store.updateElement(
      this.editingChecklistTarget.id,
      { items, h } as any,
      { commit: false },
    );
  }

  onChecklistFontSizeChange(fontSize: number): void {
    if (!this.editingChecklistTarget) return;
    this.editingChecklistTarget.fontSize = fontSize;
    const minH = checklistHeight(this.editingChecklistTarget.items.length, fontSize);
    const h = Math.max(this.editingChecklistTarget.h, minH);
    this.editingChecklistTarget.h = h;
    this.store.updateElement(
      this.editingChecklistTarget.id,
      { fontSize, h } as any,
      { commit: true },
    );
  }

  onChecklistFinish(): void {
    if (this.editingChecklistTarget) {
      const id = this.editingChecklistTarget.id;
      const finalItems = this.editingChecklistTarget.items;
      const finalH = this.editingChecklistTarget.h;
      const originalItems = JSON.parse(this.editingOriginalItemsJson) as ChecklistItem[];
      // Mesma lógica do texto/sticky: o conteúdo já foi aplicado ao vivo (commit:false)
      // durante a edição, então construímos o comando de undo/redo à mão comparando
      // com o estado capturado no início da edição.
      if (JSON.stringify(finalItems) !== this.editingOriginalItemsJson) {
        this.store.pushCommand({
          do: () => this.store.updateElement(id, { items: finalItems, h: finalH } as any, { commit: false }),
          undo: () => this.store.updateElement(id, { items: originalItems, h: this.editingOriginalH } as any, { commit: false }),
        });
      }
    }
    this.editingChecklistTarget = null;
    this.flushSave();
  }

  /** Abre o modo leitura na página atual, depois de confirmar o que estiver em edição. */
  openReader(): void {
    if (this.editingTarget) this.onOverlayFinish();
    this.editingChecklistTarget = null;
    this.flushSave();
    this.reading = true;
  }

  async onExportPdf(): Promise<void> {
    this.captureCurrentPage();
    const paginas = this.pdfPaginas === 'todas' ? this.pages : [this.pages[this.currentPageIndex]];
    this.gerandoPdf = true;
    this.cdr.markForCheck();
    try {
      await exportNoteToPdf(paginas, this.store.paperStyle(), this.title || 'nota', { tamanho: this.pdfTamanho, estiloPapel: this.pdfPapel });
      this.pdfDialog = false;
    } catch {
      alert('Não foi possível gerar o PDF.');
    } finally {
      this.gerandoPdf = false;
      this.cdr.markForCheck();
    }
  }

  openShare(): void {
    this.flushSave();
    this.sharing = true;
  }

  closeReader(pagina: number): void {
    this.reading = false;
    if (pagina !== this.currentPageIndex) this.switchPage(pagina);
  }

  /** Atalhos de página (spec 020). Vêm antes da trava de edição: confirmam o texto aberto e trocam. */
  private pageShortcut(ev: KeyboardEvent): boolean {
    const ctrl = ev.ctrlKey || ev.metaKey;
    let destino: number | null = null;
    if (ctrl && ev.key === 'PageDown') destino = this.currentPageIndex + 1;
    else if (ctrl && ev.key === 'PageUp') destino = this.currentPageIndex - 1;
    else if (ev.altKey && !ctrl && ev.key === 'ArrowRight') destino = this.currentPageIndex + 1;
    else if (ev.altKey && !ctrl && ev.key === 'ArrowLeft') destino = this.currentPageIndex - 1;
    const nova = ev.altKey && !ctrl && (ev.key === 'n' || ev.key === 'N');
    if (destino === null && !nova) return false;
    ev.preventDefault();
    if (this.editingTarget) this.onOverlayFinish();
    if (this.editingChecklistTarget) this.editingChecklistTarget = null;
    if (nova) this.addPage();
    else if (destino! >= 0 && destino! < this.pages.length) this.switchPage(destino!);
    this.cdr.markForCheck();
    return true;
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (this.reading || this.sharing || this.pdfDialog) return;
    if (this.pageShortcut(ev)) return;
    if (this.editingTarget || this.editingChecklistTarget) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      this.onUndo();
    } else if ((ctrl && ev.key.toLowerCase() === 'y') || (ctrl && ev.shiftKey && ev.key.toLowerCase() === 'z')) {
      ev.preventDefault();
      this.onRedo();
    } else if (ctrl && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      this.store.duplicateSelection();
      this.flushSave();
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if ((ev.target as HTMLElement)?.tagName !== 'INPUT' && (ev.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        ev.preventDefault();
        this.onDeleteSelection();
      }
    }
  }
}
