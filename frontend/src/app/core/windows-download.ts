import { Injectable, signal } from '@angular/core';

export interface WindowsRelease {
  versao: string;
  url: string;
  /** Ex.: "390 MB". */
  tamanho: string;
}

const BASE = '/downloads/windows/';

/** O instalador do Editor de Imagens pra Windows, publicado no próprio site
 * pelo workflow "Desktop (Windows)". Enquanto nenhum foi publicado, o
 * versao.json não existe e o link simplesmente não aparece. */
@Injectable({ providedIn: 'root' })
export class WindowsDownloadService {
  readonly release = signal<WindowsRelease | null>(null);
  private asked = false;

  check(): void {
    if (this.asked) return;
    this.asked = true;
    fetch(BASE + 'versao.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { versao?: string; arquivo?: string; tamanho?: number } | null) => {
        if (!j?.versao || !j.arquivo) return;
        this.release.set({ versao: j.versao, url: BASE + j.arquivo, tamanho: formatSize(j.tamanho ?? 0) });
      })
      .catch(() => undefined);
  }
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
