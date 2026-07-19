import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FolderRecord, NoteRecord } from '../../data/models';
import { NotesRepoService } from '../../data/notes-repo.service';
import { AuthService } from '../../core/auth.service';
import { SyncService } from '../../data/sync.service';
import { ThemeService } from '../../core/theme.service';
import { FocusOnInitDirective } from '../../shared/focus-on-init.directive';
import { IconComponent, IconName } from '../../shared/icon';

type SortMode = 'updated' | 'created' | 'title';
type ViewMode = 'grid' | 'list';

const VIEW_MODE_KEY = 'notas.notesViewMode';
const MOBILE_BREAKPOINT = 760;

@Component({
  selector: 'app-notes-list-page',
  standalone: true,
  imports: [FormsModule, RouterLink, FocusOnInitDirective, IconComponent],
  template: `
    <div class="page">
      <aside class="sidebar">
        <div class="sidebar-head">
          <h2><span class="brand-mark"><app-icon name="pen" [size]="14" /></span> Notas</h2>
          <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()"><app-icon [name]="themeIconName()" [size]="16" /></button>
        </div>
        <button class="new-note" (click)="createNote()"><app-icon name="plus" [size]="16" /> Nova nota</button>
        <nav>
          <button class="folder-item" [class.active]="activeFolder === null" (click)="activeFolder = null">
            <app-icon name="folder" [size]="16" /> Todas as notas
          </button>
          @for (f of folders; track f.id) {
            <div class="folder-row" [class.active]="activeFolder === f.id">
              @if (editingFolderId === f.id) {
                <input
                  class="folder-name-input"
                  appFocusOnInit
                  [(ngModel)]="editingFolderName"
                  (blur)="commitRenameFolder(f)"
                  (keydown.enter)="$event.preventDefault(); commitRenameFolder(f)"
                  (keydown.escape)="cancelRenameFolder()"
                />
              } @else {
                <button class="folder-item" [class.active]="activeFolder === f.id" (click)="activeFolder = f.id">
                  <app-icon name="folder" [size]="16" /> {{ f.name }}
                </button>
              }
              <div class="folder-actions">
                <button (click)="startRenameFolder(f)" title="Renomear pasta"><app-icon name="edit" [size]="14" /></button>
                <button (click)="removeFolder(f)" title="Excluir pasta"><app-icon name="delete" [size]="14" /></button>
              </div>
            </div>
          }
        </nav>
        <div class="new-folder">
          <input [(ngModel)]="newFolderName" placeholder="Nova pasta" (keydown.enter)="createFolder()" />
          <button (click)="createFolder()">Criar</button>
        </div>
        <div class="user-box">
          <span class="user-email">{{ auth.user()?.email }}</span>
          <button class="logout" (click)="auth.logout()"><app-icon name="logout" [size]="14" /> Sair</button>
        </div>
      </aside>
      <main class="content">
        <div class="toolbar-row">
          <div class="search-wrap">
            <app-icon name="search" [size]="16" class="search-icon" />
            <input class="search" [(ngModel)]="search" placeholder="Buscar por título ou conteúdo…" />
          </div>
          <div class="toolbar-controls">
            <select [(ngModel)]="sortMode">
              <option value="updated">Última edição</option>
              <option value="created">Data de criação</option>
              <option value="title">Nome</option>
            </select>
            <div class="view-toggle">
              <button [class.active]="viewMode === 'grid'" (click)="setViewMode('grid')" title="Visão em grade"><app-icon name="grid-view" [size]="16" /></button>
              <button [class.active]="viewMode === 'list'" (click)="setViewMode('list')" title="Visão em lista"><app-icon name="list-view" [size]="16" /></button>
            </div>
            <span class="sync-indicator" [class]="sync.status()">
              <span class="dot"></span>{{ syncLabel() }}
            </span>
          </div>
        </div>

        @if (viewMode === 'grid') {
          <div class="grid">
            @for (note of filteredNotes(); track note.id) {
              <div class="card" [routerLink]="['/notes', note.id]">
                <div class="thumb">
                  @if (note.thumbnail) {
                    <img [src]="note.thumbnail" alt="" />
                  } @else {
                    <div class="thumb-empty">Sem conteúdo</div>
                  }
                </div>
                <div class="card-footer">
                  <div class="card-info">
                    @if (editingNoteId === note.id) {
                      <input
                        class="card-title-input"
                        appFocusOnInit
                        [(ngModel)]="editingNoteTitle"
                        (click)="$event.stopPropagation(); $event.preventDefault()"
                        (blur)="commitRenameNote(note)"
                        (keydown.enter)="$event.preventDefault(); commitRenameNote(note)"
                        (keydown.escape)="cancelRenameNote()"
                      />
                    } @else {
                      <span class="card-title">{{ note.title || 'Sem título' }}</span>
                      <span class="card-date">{{ formatDate(note.updatedAt) }}</span>
                    }
                  </div>
                  <div class="card-actions" (click)="$event.stopPropagation(); $event.preventDefault()">
                    <select class="move-select" title="Mover para pasta" [ngModel]="note.folderId ?? ''" (ngModelChange)="moveNote(note, $event)">
                      <option value="">Sem pasta</option>
                      @for (f of folders; track f.id) {
                        <option [value]="f.id">{{ f.name }}</option>
                      }
                    </select>
                    <button (click)="startRenameNote(note)" title="Renomear"><app-icon name="edit" [size]="14" /></button>
                    <button (click)="duplicate(note)" title="Duplicar"><app-icon name="duplicate" [size]="14" /></button>
                    <button (click)="remove(note)" title="Excluir"><app-icon name="delete" [size]="14" /></button>
                  </div>
                </div>
              </div>
            }
            @if (filteredNotes().length === 0) {
              <p class="empty">Nenhuma nota encontrada.</p>
            }
          </div>
        } @else {
          <div class="list">
            @for (note of filteredNotes(); track note.id) {
              <div class="list-row" [routerLink]="['/notes', note.id]">
                <div class="list-thumb">
                  @if (note.thumbnail) {
                    <img [src]="note.thumbnail" alt="" />
                  } @else {
                    <div class="list-thumb-empty"><app-icon name="text" [size]="16" /></div>
                  }
                </div>
                <div class="list-info">
                  @if (editingNoteId === note.id) {
                    <input
                      class="card-title-input"
                      appFocusOnInit
                      [(ngModel)]="editingNoteTitle"
                      (click)="$event.stopPropagation(); $event.preventDefault()"
                      (blur)="commitRenameNote(note)"
                      (keydown.enter)="$event.preventDefault(); commitRenameNote(note)"
                      (keydown.escape)="cancelRenameNote()"
                    />
                  } @else {
                    <span class="card-title">{{ note.title || 'Sem título' }}</span>
                    <span class="card-date">{{ formatDate(note.updatedAt) }}</span>
                  }
                </div>
                <div class="card-actions" (click)="$event.stopPropagation(); $event.preventDefault()">
                  <select class="move-select" title="Mover para pasta" [ngModel]="note.folderId ?? ''" (ngModelChange)="moveNote(note, $event)">
                    <option value="">Sem pasta</option>
                    @for (f of folders; track f.id) {
                      <option [value]="f.id">{{ f.name }}</option>
                    }
                  </select>
                  <button (click)="startRenameNote(note)" title="Renomear"><app-icon name="edit" [size]="14" /></button>
                  <button (click)="duplicate(note)" title="Duplicar"><app-icon name="duplicate" [size]="14" /></button>
                  <button (click)="remove(note)" title="Excluir"><app-icon name="delete" [size]="14" /></button>
                </div>
              </div>
            }
            @if (filteredNotes().length === 0) {
              <p class="empty">Nenhuma nota encontrada.</p>
            }
          </div>
        }
      </main>
    </div>
  `,
  styles: [`
    .page { display: flex; height: 100dvh; background: var(--bg); }
    .sidebar {
      width: 250px;
      flex-shrink: 0;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 18px 16px;
      gap: 16px;
      overflow-y: auto;
    }
    .sidebar-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .sidebar h2 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
    .theme-toggle {
      border: 1px solid var(--border);
      background: var(--bg);
      border-radius: var(--radius-sm);
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }
    .brand-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 8px;
      background: var(--accent); color: #fff;
      flex-shrink: 0;
    }
    .new-note {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--radius-sm);
      padding: 11px;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.15s, transform 0.1s;
    }
    .new-note:hover { background: var(--accent-dark); }
    .new-note:active { transform: scale(0.98); }
    nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
    .folder-item {
      display: flex;
      align-items: center;
      gap: 10px;
      text-align: left;
      background: none;
      border: none;
      padding: 9px 10px;
      border-radius: var(--radius-sm);
      font-size: 14px;
      color: var(--text);
      transition: background 0.12s;
    }
    .folder-item app-icon { color: var(--text-muted); flex-shrink: 0; }
    .folder-item:hover { background: var(--bg); }
    .folder-item.active { background: var(--accent-soft); color: var(--accent-dark); font-weight: 600; }
    .folder-item.active app-icon { color: var(--accent-dark); }
    .folder-row { display: flex; align-items: center; border-radius: var(--radius-sm); }
    .folder-row .folder-item { flex: 1; min-width: 0; }
    .folder-actions { display: flex; gap: 1px; opacity: 0; flex-shrink: 0; padding-right: 4px; }
    .folder-row:hover .folder-actions, .folder-row.active .folder-actions { opacity: 1; }
    .folder-actions button { border: none; background: none; padding: 6px; border-radius: 6px; color: var(--text-muted); display: flex; }
    .folder-actions button:hover { background: var(--bg); color: var(--text); }
    .new-folder { display: flex; gap: 6px; }
    .new-folder input { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--bg); font-size: 13px; }
    .new-folder input:focus { outline: none; border-color: var(--accent); }
    .folder-name-input {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      padding: 9px 10px;
      background: transparent;
      font-size: 14px;
      color: var(--text);
      font-family: inherit;
    }
    .new-folder button { border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 13px; font-weight: 600; }
    .new-folder button:hover { background: var(--bg); }
    .user-box { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-muted); padding-top: 10px; border-top: 1px solid var(--border); }
    .user-email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .logout { display: flex; align-items: center; gap: 5px; border: none; background: none; color: var(--text-muted); font-size: 12px; font-weight: 600; flex-shrink: 0; }
    .logout:hover { color: var(--danger); }
    .content { flex: 1; padding: 24px 28px; overflow: auto; }
    .toolbar-row { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
    .search-wrap { position: relative; flex: 1; min-width: 160px; display: flex; align-items: center; }
    .search-icon { position: absolute; left: 12px; color: var(--text-muted); pointer-events: none; }
    .search {
      width: 100%;
      padding: 9px 14px 9px 38px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      font-size: 14px;
    }
    .search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .toolbar-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    select {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 9px 10px;
      background: var(--surface);
      font-size: 13px;
      color: var(--text);
    }
    .view-toggle { display: flex; border: 1px solid var(--border); border-radius: var(--radius); padding: 2px; background: var(--surface); }
    .view-toggle button { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: none; background: none; border-radius: var(--radius-sm); color: var(--text-muted); }
    .view-toggle button:hover:not(.active) { background: var(--bg); }
    .view-toggle button.active { background: var(--accent); color: #fff; }
    .sync-indicator { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .sync-indicator .dot { width: 6px; height: 6px; border-radius: 50%; background: #2ea44f; }
    .sync-indicator.syncing .dot { background: var(--accent); animation: pulse 1s infinite; }
    .sync-indicator.offline .dot { background: #d85a30; }
    .sync-indicator.error .dot { background: var(--danger); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 18px; }
    .card {
      background: var(--surface);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      overflow: hidden;
      text-decoration: none;
      color: inherit;
      display: block;
      cursor: pointer;
      box-shadow: var(--shadow-sm);
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
    }
    .card:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: var(--accent); }
    .thumb { aspect-ratio: 4/3; background: var(--bg); display: flex; align-items: center; justify-content: center; }
    .thumb img { width: 100%; height: 100%; object-fit: contain; }
    .thumb-empty { color: var(--text-muted); font-size: 12px; }
    .card-footer { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; gap: 6px; border-top: 1px solid var(--border); }
    .card-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .card-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-date { font-size: 11px; color: var(--text-muted); }
    .card-title-input {
      font-size: 13px;
      font-weight: 500;
      min-width: 0;
      flex: 1;
      border: none;
      outline: none;
      padding: 0;
      background: transparent;
      color: var(--text);
      font-family: inherit;
    }
    .card-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .card-actions button { border: none; background: none; border-radius: 6px; padding: 5px; opacity: 0.7; display: flex; color: var(--text); }
    .card-actions button:hover { opacity: 1; background: var(--bg); }
    .move-select { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font-size: 11px; padding: 3px 4px; max-width: 70px; color: var(--text); }
    .empty { color: var(--text-muted); grid-column: 1 / -1; text-align: center; padding: 40px 0; }

    .list { display: flex; flex-direction: column; gap: 8px; }
    .list-row {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px 12px;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .list-row:hover { border-color: var(--accent); box-shadow: var(--shadow-sm); }
    .list-thumb { width: 40px; height: 40px; flex-shrink: 0; border-radius: var(--radius-sm); overflow: hidden; background: var(--bg); display: flex; align-items: center; justify-content: center; }
    .list-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .list-thumb-empty { color: var(--text-muted); }
    .list-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }

    @media (max-width: 760px) {
      .page { flex-direction: column; height: auto; min-height: 100dvh; }
      .sidebar {
        width: 100%;
        flex-direction: column;
        align-items: stretch;
        padding: 12px 16px;
        gap: 10px;
        border-right: none;
        border-bottom: 1px solid var(--border);
      }
      nav { flex-direction: row; overflow-x: auto; gap: 6px; flex: none; padding-bottom: 2px; }
      .folder-row { flex-shrink: 0; }
      .folder-item { flex-shrink: 0; white-space: nowrap; }
      .folder-actions { opacity: 1; padding-right: 0; }
      .new-folder { order: 3; }
      .user-box { border-top: none; padding-top: 0; }
      .content { padding: 16px; }
      .toolbar-row { flex-direction: column; align-items: stretch; }
      .toolbar-controls { justify-content: space-between; }
    }
  `],
})
export class NotesListPageComponent implements OnInit {
  notes: NoteRecord[] = [];
  folders: FolderRecord[] = [];
  activeFolder: string | null = null;
  search = '';
  sortMode: SortMode = 'updated';
  newFolderName = '';
  editingNoteId: string | null = null;
  editingNoteTitle = '';
  editingFolderId: string | null = null;
  editingFolderName = '';
  viewMode: ViewMode = 'grid';

  constructor(
    private repo: NotesRepoService,
    private router: Router,
    public auth: AuthService,
    public sync: SyncService,
    public theme: ThemeService,
    private cdr: ChangeDetectorRef,
  ) {}

  themeIconName(): IconName {
    switch (this.theme.pref()) {
      case 'dark': return 'moon';
      case 'light': return 'sun';
      default: return 'monitor';
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
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    this.viewMode = stored === 'grid' || stored === 'list'
      ? stored
      : (window.innerWidth < MOBILE_BREAKPOINT ? 'list' : 'grid');
    this.sync.start();
    await this.reload();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  /** Data relativa curta ("há 5 min", "há 2h") pros itens mais recentes, caindo pra
   * data absoluta depois de uma semana — evita "há 214h" pra notas antigas. */
  formatDate(iso: string): string {
    const d = new Date(iso);
    const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    const diffD = Math.round(diffH / 24);
    if (diffD < 7) return `há ${diffD}d`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  syncLabel(): string {
    switch (this.sync.status()) {
      case 'syncing': return 'sincronizando…';
      case 'offline': return 'offline';
      case 'error': return 'erro ao sincronizar';
      default: return 'tudo salvo';
    }
  }

  private async reload(): Promise<void> {
    this.notes = await this.repo.listNotes();
    this.folders = await this.repo.listFolders();
    // Sem isso, mudanças aplicadas depois de um `await` (ex: renomear/excluir pasta,
    // disparado por um prompt()/confirm() nativo) não repintam a tela sozinhas — só
    // apareceriam na próxima interação do usuário que disparasse outro ciclo de CD.
    this.cdr.markForCheck();
  }

  filteredNotes(): NoteRecord[] {
    let list = this.notes;
    if (this.activeFolder !== null) list = list.filter((n) => n.folderId === this.activeFolder);
    if (this.search.trim()) {
      const q = this.search.trim().toLowerCase();
      list = list.filter((n) => this.matchesSearch(n, q));
    }
    const sorted = [...list];
    switch (this.sortMode) {
      case 'updated': sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); break;
      case 'created': sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); break;
      case 'title': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
    }
    return sorted;
  }

  /** Busca não só no título mas também no conteúdo de texto/adesivo/checklist de
   * todas as páginas da nota — dá pra achar uma nota lembrando só de uma palavra
   * que foi escrita nela, sem precisar lembrar do título. */
  private matchesSearch(note: NoteRecord, q: string): boolean {
    if (note.title.toLowerCase().includes(q)) return true;
    for (const page of note.pages) {
      for (const el of page.elements) {
        if ((el.type === 'text' || el.type === 'sticky') && el.content.toLowerCase().includes(q)) return true;
        if (el.type === 'checklist' && el.items.some((it) => it.text.toLowerCase().includes(q))) return true;
      }
    }
    return false;
  }

  async createNote(): Promise<void> {
    const note = await this.repo.createNote(this.activeFolder);
    this.router.navigate(['/notes', note.id]);
  }

  async createFolder(): Promise<void> {
    const name = this.newFolderName.trim();
    if (!name) return;
    try {
      await this.repo.createFolder(name);
      this.newFolderName = '';
      await this.reload();
    } catch {
      alert('Não foi possível criar a pasta — verifique sua conexão.');
    }
  }

  startRenameFolder(f: FolderRecord): void {
    this.editingFolderId = f.id;
    this.editingFolderName = f.name;
  }

  async commitRenameFolder(f: FolderRecord): Promise<void> {
    if (this.editingFolderId !== f.id) return;
    this.editingFolderId = null;
    const trimmed = this.editingFolderName.trim();
    if (!trimmed || trimmed === f.name) return;
    try {
      await this.repo.renameFolder(f.id, trimmed);
      await this.reload();
    } catch {
      alert('Não foi possível renomear a pasta — verifique sua conexão.');
    }
  }

  cancelRenameFolder(): void {
    this.editingFolderId = null;
  }

  async removeFolder(f: FolderRecord): Promise<void> {
    if (!confirm(`Excluir a pasta "${f.name}"? As notas dela voltam para "sem pasta".`)) return;
    try {
      await this.repo.deleteFolder(f.id);
      if (this.activeFolder === f.id) this.activeFolder = null;
      await this.reload();
    } catch {
      alert('Não foi possível excluir a pasta — verifique sua conexão.');
    }
  }

  async moveNote(note: NoteRecord, folderId: string): Promise<void> {
    await this.repo.moveToFolder(note.id, folderId || null);
    await this.reload();
    this.sync.syncNow();
  }

  startRenameNote(note: NoteRecord): void {
    this.editingNoteId = note.id;
    this.editingNoteTitle = note.title;
  }

  async commitRenameNote(note: NoteRecord): Promise<void> {
    if (this.editingNoteId !== note.id) return;
    this.editingNoteId = null;
    const title = this.editingNoteTitle;
    if (title === note.title) return;
    await this.repo.renameNote(note.id, title);
    await this.reload();
    this.sync.syncNow();
  }

  cancelRenameNote(): void {
    this.editingNoteId = null;
  }

  async duplicate(note: NoteRecord): Promise<void> {
    await this.repo.duplicateNote(note.id);
    await this.reload();
    this.sync.syncNow();
  }

  async remove(note: NoteRecord): Promise<void> {
    if (!confirm(`Excluir a nota "${note.title || 'Sem título'}"? Esta ação não pode ser desfeita.`)) return;
    await this.repo.deleteNote(note.id);
    await this.reload();
    this.sync.syncNow();
  }
}
