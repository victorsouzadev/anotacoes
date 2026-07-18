import { Injectable, signal } from '@angular/core';
import { ApiClient } from '../core/api-client';
import { AuthService } from '../core/auth.service';
import { FolderRecord, NoteRecord, parseStoredPages } from './models';
import { LocalDbService } from './local-db.service';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

const LAST_SYNC_KEY = 'lastSyncAt';

@Injectable({ providedIn: 'root' })
export class SyncService {
  status = signal<SyncStatus>('idle');
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncInFlight: Promise<void> | null = null;
  private syncQueued = false;

  constructor(
    private api: ApiClient,
    private localDb: LocalDbService,
    private auth: AuthService,
  ) {
    window.addEventListener('online', () => this.syncNow());
    window.addEventListener('offline', () => this.status.set('offline'));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.syncNow(), 30_000);
    this.syncNow();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Nunca roda duas sincronizações em paralelo: chamadas concorrentes (autosave
   * disparando syncNow a cada ação + o timer periódico) poderiam, do contrário,
   * fazer duas requisições tentarem criar a MESMA nota nova ao mesmo tempo,
   * batendo na constraint de unicidade do id no servidor. Uma chamada durante uma
   * sincronização já em andamento apenas agenda mais uma rodada em seguida. */
  async syncNow(): Promise<void> {
    if (this.syncInFlight) {
      this.syncQueued = true;
      return this.syncInFlight;
    }
    this.syncInFlight = this.runSync().finally(() => {
      this.syncInFlight = null;
      if (this.syncQueued) {
        this.syncQueued = false;
        this.syncNow();
      }
    });
    return this.syncInFlight;
  }

  private async runSync(): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    if (!navigator.onLine) {
      this.status.set('offline');
      return;
    }
    this.status.set('syncing');
    try {
      await this.push();
      await this.pull();
      await this.pullFolders();
      this.status.set('idle');
    } catch {
      this.status.set('error');
    }
  }

  private async push(): Promise<void> {
    const dirty = await this.localDb.getDirtyNotes();
    for (const note of dirty) {
      const result = await this.api.upsertNote(note.id, {
        folderId: note.folderId,
        title: note.title,
        pages: note.pages,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        deletedAt: note.deletedAt,
      });
      // Servidor pode ter versão mais recente (LWW) — adota-a como fonte da verdade.
      const merged: NoteRecord = {
        id: result.id,
        folderId: result.folderId,
        title: result.title,
        pages: parseStoredPages(result.elements),
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        deletedAt: result.deletedAt,
        dirty: false,
        thumbnail: note.thumbnail,
      };
      await this.localDb.putNote(merged);
    }
  }

  private async pull(): Promise<void> {
    const since = (await this.localDb.getMeta<string>(LAST_SYNC_KEY)) ?? '1970-01-01T00:00:00.000Z';
    const changes = await this.api.listNoteChangesSince(since);
    let maxUpdatedAt = since;
    for (const remote of changes) {
      const local = await this.localDb.getNote(remote.id);
      // Não sobrescrever edições locais ainda não enviadas.
      if (local?.dirty) continue;
      const record: NoteRecord = {
        id: remote.id,
        folderId: remote.folderId,
        title: remote.title,
        pages: parseStoredPages(remote.elements),
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
        deletedAt: remote.deletedAt,
        dirty: false,
        thumbnail: local?.thumbnail,
      };
      if (remote.deletedAt) {
        await this.localDb.deleteNoteLocal(remote.id);
      } else {
        await this.localDb.putNote(record);
      }
      if (remote.updatedAt > maxUpdatedAt) maxUpdatedAt = remote.updatedAt;
    }
    await this.localDb.setMeta(LAST_SYNC_KEY, maxUpdatedAt);
  }

  /** Pastas não têm dirty-tracking/tombstone local (CRUD sempre passa direto pela API
   * — ver NotesRepoService) — aqui é só espelhar o servidor como fonte da verdade,
   * substituindo o cache local inteiro a cada sync. */
  private async pullFolders(): Promise<void> {
    const remoteFolders = await this.api.listFolders();
    const remoteIds = new Set(remoteFolders.map((f) => f.id));
    const localFolders = await this.localDb.getAllFolders();
    for (const local of localFolders) {
      if (!remoteIds.has(local.id)) await this.localDb.deleteFolderLocal(local.id);
    }
    for (const remote of remoteFolders) {
      const folder: FolderRecord = { id: remote.id, name: remote.name, createdAt: remote.createdAt };
      await this.localDb.putFolder(folder);
    }
  }
}
