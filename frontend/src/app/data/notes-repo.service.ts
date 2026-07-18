import { Injectable } from '@angular/core';
import { uuid } from '../core/uuid';
import { ApiClient } from '../core/api-client';
import { FolderRecord, NotePage, NoteRecord, PaperStyle } from './models';
import { LocalDbService } from './local-db.service';

@Injectable({ providedIn: 'root' })
export class NotesRepoService {
  constructor(private localDb: LocalDbService, private api: ApiClient) {}

  async listNotes(): Promise<NoteRecord[]> {
    const all = await this.localDb.getAllNotes();
    return all.filter((n) => !n.deletedAt).map((n) => this.ensurePages(n));
  }

  async getNote(id: string): Promise<NoteRecord | undefined> {
    const note = await this.localDb.getNote(id);
    return note ? this.ensurePages(note) : undefined;
  }

  /** Notas gravadas antes do conceito de páginas existir só têm o campo antigo
   * `elements` (sem `pages`) — preenche `pages` na leitura pra manter o resto do app
   * livre dessa checagem. */
  private ensurePages(note: NoteRecord): NoteRecord {
    if (note.pages && note.pages.length > 0) return note;
    const legacyElements = (note as unknown as { elements?: NotePage['elements'] }).elements ?? [];
    return { ...note, pages: [{ id: uuid(), elements: legacyElements }] };
  }

  async createNote(folderId: string | null = null): Promise<NoteRecord> {
    const now = new Date().toISOString();
    const note: NoteRecord = {
      id: uuid(),
      folderId,
      title: 'Nova nota',
      pages: [{ id: uuid(), elements: [] }],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dirty: true,
      paperStyle: 'blank',
    };
    await this.localDb.putNote(note);
    return note;
  }

  async savePages(id: string, pages: NotePage[]): Promise<void> {
    const note = await this.localDb.getNote(id);
    if (!note) return;
    note.pages = pages;
    note.updatedAt = new Date().toISOString();
    note.dirty = true;
    await this.localDb.putNote(note);
  }

  /** Preferência puramente local — não marca a nota como "dirty" nem mexe em
   * updatedAt, para não gerar tráfego de sync por causa só da aparência do papel. */
  async setPaperStyle(id: string, paperStyle: PaperStyle): Promise<void> {
    const note = await this.localDb.getNote(id);
    if (!note) return;
    note.paperStyle = paperStyle;
    await this.localDb.putNote(note);
  }

  async saveThumbnail(id: string, thumbnail: string): Promise<void> {
    const note = await this.localDb.getNote(id);
    if (!note) return;
    note.thumbnail = thumbnail;
    await this.localDb.putNote(note);
  }

  async renameNote(id: string, title: string): Promise<void> {
    const note = await this.localDb.getNote(id);
    if (!note) return;
    note.title = title;
    note.updatedAt = new Date().toISOString();
    note.dirty = true;
    await this.localDb.putNote(note);
  }

  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    const note = await this.localDb.getNote(id);
    if (!note) return;
    note.folderId = folderId;
    note.updatedAt = new Date().toISOString();
    note.dirty = true;
    await this.localDb.putNote(note);
  }

  async duplicateNote(id: string): Promise<NoteRecord | undefined> {
    const note = await this.getNote(id);
    if (!note) return undefined;
    const now = new Date().toISOString();
    const copy: NoteRecord = {
      ...note,
      id: uuid(),
      title: `${note.title} (cópia)`,
      pages: structuredClone(note.pages),
      createdAt: now,
      updatedAt: now,
      dirty: true,
    };
    await this.localDb.putNote(copy);
    return copy;
  }

  async deleteNote(id: string): Promise<void> {
    const note = await this.localDb.getNote(id);
    if (!note) return;
    note.deletedAt = new Date().toISOString();
    note.updatedAt = note.deletedAt;
    note.pages = [];
    note.dirty = true;
    await this.localDb.putNote(note);
  }

  async listFolders(): Promise<FolderRecord[]> {
    return this.localDb.getAllFolders();
  }

  /** Pastas não têm suporte a criação offline (o id é atribuído pelo servidor) — exige
   * estar online. O erro é propagado pra tela mostrar um aviso. */
  async createFolder(name: string): Promise<FolderRecord> {
    const dto = await this.api.createFolder(name);
    const folder: FolderRecord = { id: dto.id, name: dto.name, createdAt: dto.createdAt };
    await this.localDb.putFolder(folder);
    return folder;
  }

  async renameFolder(id: string, name: string): Promise<FolderRecord> {
    const dto = await this.api.renameFolder(id, name);
    const folder: FolderRecord = { id: dto.id, name: dto.name, createdAt: dto.createdAt };
    await this.localDb.putFolder(folder);
    return folder;
  }

  async deleteFolder(id: string): Promise<void> {
    await this.api.deleteFolder(id);
    await this.localDb.deleteFolderLocal(id);
    // Espelha o comportamento do servidor: notas da pasta excluída voltam a "sem pasta".
    const all = await this.localDb.getAllNotes();
    for (const note of all) {
      if (note.folderId === id) {
        note.folderId = null;
        await this.localDb.putNote(note);
      }
    }
  }
}
