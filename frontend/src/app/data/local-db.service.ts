import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { FolderRecord, NoteRecord } from './models';

interface NotasDb extends DBSchema {
  notes: {
    key: string;
    value: NoteRecord;
    indexes: { 'by-updatedAt': string; 'by-folder': string };
  };
  folders: {
    key: string;
    value: FolderRecord;
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

@Injectable({ providedIn: 'root' })
export class LocalDbService {
  private dbPromise: Promise<IDBPDatabase<NotasDb>>;

  constructor() {
    this.dbPromise = openDB<NotasDb>('notas-vps', 1, {
      upgrade(db) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('by-updatedAt', 'updatedAt');
        notes.createIndex('by-folder', 'folderId');
        db.createObjectStore('folders', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }

  async getAllNotes(): Promise<NoteRecord[]> {
    const db = await this.dbPromise;
    return db.getAll('notes');
  }

  async getNote(id: string): Promise<NoteRecord | undefined> {
    const db = await this.dbPromise;
    return db.get('notes', id);
  }

  async putNote(note: NoteRecord): Promise<void> {
    const db = await this.dbPromise;
    await db.put('notes', note);
  }

  async deleteNoteLocal(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('notes', id);
  }

  async getDirtyNotes(): Promise<NoteRecord[]> {
    const all = await this.getAllNotes();
    return all.filter((n) => n.dirty);
  }

  async getAllFolders(): Promise<FolderRecord[]> {
    const db = await this.dbPromise;
    return db.getAll('folders');
  }

  async putFolder(folder: FolderRecord): Promise<void> {
    const db = await this.dbPromise;
    await db.put('folders', folder);
  }

  async deleteFolderLocal(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('folders', id);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const db = await this.dbPromise;
    const row = await db.get('meta', key);
    return row?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.dbPromise;
    await db.put('meta', { key, value });
  }
}
