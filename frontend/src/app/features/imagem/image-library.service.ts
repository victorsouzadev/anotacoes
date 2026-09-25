import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { uuid } from '../../core/uuid';

export interface LibraryItemMeta {
  id: string;
  name: string;
  origin: string;
  thumb: string;
  widthMm: number;
  createdAt: string;
}

export interface LibraryItem extends Omit<LibraryItemMeta, 'thumb'> {
  data: string;
}

const THUMB = 160;

/** Biblioteca da conta: artes guardadas pra reusar em qualquer projeto. A
 * lista mora aqui (e não no menu) pra quem salva, de qualquer modo, ver o
 * item novo aparecer. */
@Injectable({ providedIn: 'root' })
export class ImageLibraryService {
  readonly items = signal<LibraryItemMeta[]>([]);
  readonly loading = signal(false);

  constructor(private http: HttpClient) {}

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await firstValueFrom(this.http.get<LibraryItemMeta[]>('/api/imagens/biblioteca')));
    } finally {
      this.loading.set(false);
    }
  }

  get(id: string): Promise<LibraryItem> {
    return firstValueFrom(this.http.get<LibraryItem>(`/api/imagens/biblioteca/${id}`));
  }

  async save(canvas: HTMLCanvasElement, name: string, origin: string, widthMm = 0): Promise<LibraryItemMeta> {
    const saved = await firstValueFrom(this.http.put<LibraryItemMeta>(`/api/imagens/biblioteca/${uuid()}`, {
      name: name.slice(0, 200) || 'Arte', origin, widthMm,
      data: canvas.toDataURL('image/png'),
      thumb: thumbnail(canvas),
    }));
    this.items.update((l) => [saved, ...l]);
    return saved;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/imagens/biblioteca/${id}`));
    this.items.update((l) => l.filter((i) => i.id !== id));
  }
}

function thumbnail(canvas: HTMLCanvasElement): string {
  const k = Math.min(1, THUMB / Math.max(canvas.width, canvas.height));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(canvas.width * k));
  t.height = Math.max(1, Math.round(canvas.height * k));
  const ctx = t.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL('image/png');
}
