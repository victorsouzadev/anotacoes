import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FolderRecord, NoteRecord } from '../../data/models';
import { NotesRepoService } from '../../data/notes-repo.service';
import { AuthService } from '../../core/auth.service';
import { SyncService } from '../../data/sync.service';
import { ThemeService } from '../../core/theme.service';

type SortMode = 'updated' | 'created' | 'title';

@Component({
  selector: 'app-notes-list-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page">
      <aside class="sidebar">
        <div class="sidebar-head">
          <h2><span class="brand-mark">✎</span> Notas</h2>
          <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()">{{ themeIcon() }}</button>
        </div>
        <button class="new-note" (click)="createNote()">+ Nova nota</button>
        <nav>
          <button class="folder-item" [class.active]="activeFolder === null" (click)="activeFolder = null">
            <span class="icon">🗂️</span> Todas as notas
          </button>
          @for (f of folders; track f.id) {
            <div class="folder-row">
              <button class="folder-item" [class.active]="activeFolder === f.id" (click)="activeFolder = f.id">
                <span class="icon">📁</span> {{ f.name }}
              </button>
              <div class="folder-actions">
                <button (click)="renameFolder(f)" title="Renomear pasta">✏️</button>
                <button (click)="removeFolder(f)" title="Excluir pasta">🗑️</button>
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
          <button class="logout" (click)="auth.logout()">Sair</button>
        </div>
      </aside>
      <main class="content">
        <div class="toolbar-row">
          <input class="search" [(ngModel)]="search" placeholder="Buscar por título ou conteúdo…" />
          <select [(ngModel)]="sortMode">
            <option value="updated">Última edição</option>
            <option value="created">Data de criação</option>
            <option value="title">Nome</option>
          </select>
          <span class="sync-indicator" [class]="sync.status()">
            <span class="dot"></span>{{ syncLabel() }}
          </span>
        </div>
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
                <span class="card-title">{{ note.title || 'Sem título' }}</span>
                <div class="card-actions" (click)="$event.stopPropagation(); $event.preventDefault()">
                  <select class="move-select" title="Mover para pasta" [ngModel]="note.folderId ?? ''" (ngModelChange)="moveNote(note, $event)">
                    <option value="">Sem pasta</option>
                    @for (f of folders; track f.id) {
                      <option [value]="f.id">{{ f.name }}</option>
                    }
                  </select>
                  <button (click)="rename(note)" title="Renomear">✏️</button>
                  <button (click)="duplicate(note)" title="Duplicar">⧉</button>
                  <button (click)="remove(note)" title="Excluir">🗑️</button>
                </div>
              </div>
            </div>
          }
          @if (filteredNotes().length === 0) {
            <p class="empty">Nenhuma nota encontrada.</p>
          }
        </div>
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
      gap: 14px;
      overflow-y: auto;
    }
    .sidebar-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .sidebar h2 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
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
    .brand-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 8px; font-size: 13px;
      background: var(--accent); color: #fff;
    }
    .new-note {
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
      gap: 8px;
      text-align: left;
      background: none;
      border: none;
      padding: 9px 10px;
      border-radius: var(--radius-sm);
      font-size: 14px;
      color: var(--text);
      transition: background 0.12s;
    }
    .folder-item .icon { font-size: 13px; }
    .folder-item:hover { background: var(--bg); }
    .folder-item.active { background: var(--accent-soft); color: var(--accent-dark); font-weight: 600; }
    .folder-row { display: flex; align-items: center; }
    .folder-row .folder-item { flex: 1; }
    .folder-actions { display: flex; gap: 1px; opacity: 0; flex-shrink: 0; }
    .folder-row:hover .folder-actions { opacity: 1; }
    .folder-actions button { border: none; background: none; font-size: 11px; padding: 5px; border-radius: 6px; }
    .folder-actions button:hover { background: var(--bg); }
    .new-folder { display: flex; gap: 6px; }
    .new-folder input { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 9px; background: var(--bg); font-size: 13px; }
    .new-folder input:focus { outline: none; border-color: var(--accent); }
    .new-folder button { border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius-sm); padding: 7px 10px; font-size: 13px; font-weight: 600; }
    .new-folder button:hover { background: var(--bg); }
    .user-box { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-muted); padding-top: 8px; border-top: 1px solid var(--border); }
    .user-email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .logout { border: none; background: none; color: var(--text-muted); font-size: 12px; font-weight: 600; flex-shrink: 0; }
    .logout:hover { color: var(--danger); }
    .content { flex: 1; padding: 24px 28px; overflow: auto; }
    .toolbar-row { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
    .search {
      flex: 1;
      min-width: 160px;
      padding: 9px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      font-size: 14px;
    }
    .search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    select {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 9px 10px;
      background: var(--surface);
      font-size: 13px;
    }
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
    .card-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .card-actions button { border: none; background: none; font-size: 13px; border-radius: 6px; padding: 4px 5px; opacity: 0.7; }
    .card-actions button:hover { opacity: 1; background: var(--bg); }
    .move-select { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font-size: 11px; padding: 3px 4px; max-width: 70px; }
    .empty { color: var(--text-muted); grid-column: 1 / -1; text-align: center; padding: 40px 0; }

    @media (max-width: 760px) {
      .page { flex-direction: column; height: auto; min-height: 100dvh; }
      .sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; align-items: center; padding: 12px 16px; gap: 10px; border-right: none; border-bottom: 1px solid var(--border); }
      .sidebar h2 { margin: 0; flex-shrink: 0; }
      .new-note { padding: 8px 12px; }
      nav { flex-direction: row; overflow-x: auto; flex: 1; }
      .folder-item { flex-shrink: 0; white-space: nowrap; }
      .new-folder { flex-basis: 100%; order: 3; }
      .user-box { flex-shrink: 0; border-top: none; padding-top: 0; }
      .content { padding: 16px; }
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

  constructor(
    private repo: NotesRepoService,
    private router: Router,
    public auth: AuthService,
    public sync: SyncService,
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
    this.sync.start();
    await this.reload();
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

  async renameFolder(f: FolderRecord): Promise<void> {
    const name = prompt('Novo nome da pasta:', f.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await this.repo.renameFolder(f.id, trimmed);
      await this.reload();
    } catch {
      alert('Não foi possível renomear a pasta — verifique sua conexão.');
    }
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

  async rename(note: NoteRecord): Promise<void> {
    const title = prompt('Novo título da nota:', note.title);
    if (title === null) return;
    await this.repo.renameNote(note.id, title);
    await this.reload();
    this.sync.syncNow();
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
