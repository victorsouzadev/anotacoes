import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface BackupArquivo {
  nome: string;
  bytes: number;
}

export interface BackupEstado {
  registrado: boolean;
  concluidoEm: string | null;
  idadeHoras: number | null;
  atrasado: boolean;
  arquivos: BackupArquivo[];
  totalBytes: number;
}

/** Idade em português, como o backend escreve no resumo do MCP. */
export function idadeTexto(horas: number): string {
  if (horas < 1) return 'menos de 1 h';
  const h = Math.floor(horas);
  if (h < 24) return `${h} h`;
  const dias = Math.floor(h / 24);
  const resto = h % 24;
  return (dias === 1 ? '1 dia' : `${dias} dias`) + (resto > 0 ? ` e ${resto} h` : '');
}

/** Texto da faixa de alerta do hub; null quando está tudo em dia. */
export function alertaBackup(e: BackupEstado | null): string | null {
  if (!e || !e.atrasado) return null;
  if (!e.registrado) return 'Nenhum backup registrado. Confira o cron do scripts/backup.sh na VPS.';
  return `Backup atrasado: o último terminou há ${idadeTexto(e.idadeHoras ?? 0)}.`;
}

export function tamanhoTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

/** Estado do servidor: só responde para quem está em PUBLICADORES (403 para os outros). */
@Injectable({ providedIn: 'root' })
export class SistemaService {
  private http = inject(HttpClient);

  async backup(): Promise<BackupEstado | null> {
    try {
      return await firstValueFrom(this.http.get<BackupEstado>('/api/sistema/backup'));
    } catch {
      return null;
    }
  }
}
