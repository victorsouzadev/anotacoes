import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NotePage } from '../data/models';

export interface NoteMetaDto {
  id: string;
  folderId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDto extends NoteMetaDto {
  elements: string;
  deletedAt: string | null;
}

export interface FolderDto {
  id: string;
  name: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  constructor(private http: HttpClient) {}

  listNoteMetas(): Promise<NoteMetaDto[]> {
    return firstValueFrom(this.http.get<NoteMetaDto[]>('/api/notes'));
  }

  listNoteChangesSince(since: string): Promise<NoteDto[]> {
    return firstValueFrom(this.http.get<NoteDto[]>('/api/notes', { params: { since } }));
  }

  upsertNote(id: string, body: {
    folderId: string | null;
    title: string;
    pages: NotePage[];
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }): Promise<NoteDto> {
    return firstValueFrom(
      this.http.put<NoteDto>(`/api/notes/${id}`, {
        id,
        folderId: body.folderId,
        title: body.title,
        elements: JSON.stringify(body.pages),
        createdAt: body.createdAt,
        updatedAt: body.updatedAt,
        deletedAt: body.deletedAt,
      }),
    );
  }

  listFolders(): Promise<FolderDto[]> {
    return firstValueFrom(this.http.get<FolderDto[]>('/api/folders'));
  }

  createFolder(name: string): Promise<FolderDto> {
    return firstValueFrom(this.http.post<FolderDto>('/api/folders', { name }));
  }

  renameFolder(id: string, name: string): Promise<FolderDto> {
    return firstValueFrom(this.http.put<FolderDto>(`/api/folders/${id}`, { name }));
  }

  deleteFolder(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/folders/${id}`));
  }
}
