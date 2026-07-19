import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
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
import { exportNoteToPng } from './engine/export';
import { Renderer } from './engine/renderer';
import { stickyContentHeight } from './engine/sticky-layout';
import { Viewport } from './engine/viewport';
import { ToolbarComponent } from './toolbar';
import { PropertiesPanelComponent } from './properties-panel';
import { MoreActionsMenuComponent } from './more-actions-menu';
import { TextOverlayComponent } from './text-overlay';
import { ChecklistOverlayComponent } from './checklist-overlay';

@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [
    RouterLink, FormsModule, FocusOnInitDirective, CanvasHostComponent, ToolbarComponent,
    PropertiesPanelComponent, CanvasCornerControlsComponent, MoreActionsMenuComponent,
    TextOverlayComponent, ChecklistOverlayComponent,
  ],
  template: `
    <div class="editor-page">
      <header>
        <a routerLink="/notes" class="back">← Notas</a>
        <input class="title-input" [(ngModel)]="title" (change)="onTitleChange()" placeholder="Título da nota" />
        <span class="sync-indicator" [class]="syncService.status()">
          <span class="dot"></span>{{ syncLabel() }}
        </span>
        <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()">{{ themeIcon() }}</button>
      </header>
      <div class="pages-bar">
        @for (p of pages; track p.id; let i = $index) {
          <div class="page-tab" [class.active]="i === currentPageIndex" (click)="switchPage(i)">
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
        <button class="page-add" (click)="addPage()" title="Nova página">+ Página</button>
      </div>
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
    .page-tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
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
    }
  `],
})
export class EditorPageComponent implements OnInit, OnDestroy {
  @ViewChild('canvasHost') canvasHost!: CanvasHostComponent;
  @ViewChild('cornerControls') cornerControls!: CanvasCornerControlsComponent;

  store = new EditorStore();
  noteId = '';
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
  ) {}

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
    if (!note) {
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

  removePage(index: number): void {
    if (this.pages.length <= 1) return;
    if (!confirm(`Excluir a página ${index + 1}? Esta ação não pode ser desfeita.`)) return;
    this.captureCurrentPage();
    this.pages.splice(index, 1);
    if (this.currentPageIndex >= this.pages.length) this.currentPageIndex = this.pages.length - 1;
    this.store.loadElements(this.pages[this.currentPageIndex].elements);
    this.flushSave();
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

  @HostListener('window:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
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
