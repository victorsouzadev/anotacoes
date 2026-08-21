import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ImageProjectMetaDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageProjectDto extends ImageProjectMetaDto {
  data: string;
  deletedAt: string | null;
}

/** Projetos do Editor de Imagens no backend: o payload é um JSON opaco pro
 * servidor (artes em data URL + parâmetros), como o Elements das notas. */
@Injectable({ providedIn: 'root' })
export class ImageProjectsService {
  constructor(private http: HttpClient) {}

  list(): Promise<ImageProjectMetaDto[]> {
    return firstValueFrom(this.http.get<ImageProjectMetaDto[]>('/api/imagens/projetos'));
  }

  get(id: string): Promise<ImageProjectDto> {
    return firstValueFrom(this.http.get<ImageProjectDto>(`/api/imagens/projetos/${id}`));
  }

  save(id: string, name: string, data: string, createdAt: string): Promise<ImageProjectDto> {
    return firstValueFrom(
      this.http.put<ImageProjectDto>(`/api/imagens/projetos/${id}`, {
        id,
        name,
        data,
        createdAt,
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      }),
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/imagens/projetos/${id}`));
  }
}
