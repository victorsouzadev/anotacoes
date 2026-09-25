import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, NgZone, inject } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';

/** O que o programa desktop injeta na página antes de ela carregar. */
interface DesktopBridge {
  key: string;
  versao: string;
}

interface WebViewHost {
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    __editorDesktop?: DesktopBridge;
    /** O programa pergunta antes de fechar a janela. */
    __editorAlterado?: () => boolean;
    chrome?: { webview?: WebViewHost };
  }
}

/** Rodando dentro do programa do Windows (não no navegador). */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.__editorDesktop;
}

export function desktopKey(): string {
  return window.__editorDesktop?.key ?? '';
}

/** Avisos do programa pra página. */
export type DesktopEvent =
  | { tipo: 'abrir'; caminho: string }
  | { tipo: 'baixado'; caminho: string; nome: string }
  | { tipo: 'pasta-foto'; caminho: string };

export interface DesktopInfo {
  versao: string;
  motorIa: string;
  recorte: boolean;
  ampliacao: boolean;
  arquivoInicial: string | null;
}

export interface DesktopProjectFile {
  caminho: string;
  nome: string;
  dados: string;
}

export interface DesktopRecent {
  caminho: string;
  nome: string;
  alteradoEm: string | null;
  existe: boolean;
}

export interface DesktopPrinter {
  nome: string;
  padrao: boolean;
  calibracao: { dxMm: number; dyMm: number; escalaX: number; escalaY: number };
}

export interface DesktopFont {
  id: string;
  nome: string;
  bytes: number;
}

/** Os endpoints que só o programa desktop tem (/api/desktop), com a chave da janela. */
@Injectable({ providedIn: 'root' })
export class DesktopService {
  private http = inject(HttpClient);
  private zone = inject(NgZone);
  readonly enabled = isDesktop();
  readonly events = new Subject<DesktopEvent>();

  constructor() {
    if (this.enabled) {
      window.chrome?.webview?.addEventListener('message', (e) => this.zone.run(() => this.events.next(e.data as DesktopEvent)));
    }
  }

  private get headers(): HttpHeaders {
    return new HttpHeaders({ 'X-Desktop-Key': desktopKey() });
  }

  private get<T>(url: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(`/api/desktop/${url}`, { headers: this.headers }));
  }

  private post<T>(url: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(`/api/desktop/${url}`, body, { headers: this.headers }));
  }

  info(): Promise<DesktopInfo> {
    return this.get('info');
  }

  /** Diálogo "Abrir" do Windows; null se cancelou. */
  openDialog(): Promise<DesktopProjectFile | null> {
    return this.post('projeto/abrir');
  }

  read(caminho: string): Promise<DesktopProjectFile> {
    return this.post('projeto/ler', { caminho });
  }

  /** Sem caminho (ou comoNovo), abre o "Salvar como"; null se cancelou. */
  save(caminho: string | null, nome: string, dados: string, comoNovo = false): Promise<{ caminho: string; nome: string } | null> {
    return this.post('projeto/salvar', { caminho, nome, dados, comoNovo });
  }

  recents(): Promise<DesktopRecent[]> {
    return this.get('recentes');
  }

  forgetRecent(caminho: string): Promise<void> {
    return this.post('recentes/remover', { caminho });
  }

  /** Abre o Explorer com o arquivo selecionado. */
  reveal(caminho: string): Promise<void> {
    return this.post('mostrar', { caminho });
  }

  printers(): Promise<DesktopPrinter[]> {
    return this.get('impressoras');
  }

  print(impressora: string, imagem: string, larguraMm: number, alturaMm: number, copias: number): Promise<void> {
    return this.post('imprimir', { impressora, imagem, larguraMm, alturaMm, copias });
  }

  printCalibration(impressora: string, larguraMm: number, alturaMm: number): Promise<void> {
    return this.post('imprimir-calibracao', { impressora, larguraMm, alturaMm });
  }

  saveCalibration(impressora: string, c: DesktopPrinter['calibracao']): Promise<void> {
    return firstValueFrom(this.http.put<void>('/api/desktop/calibracao', { impressora, ...c }, { headers: this.headers }));
  }

  studioInstalled(): Promise<{ instalado: boolean }> {
    return this.get('studio');
  }

  openInStudio(titulo: string, arquivos: { nome: string; dados: string }[], abrir: string): Promise<{ pasta: string; studio: boolean }> {
    return this.post('abrir-studio', { titulo, arquivos, abrir });
  }

  fonts(): Promise<DesktopFont[]> {
    return this.get('fontes');
  }

  fontFile(id: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`/api/desktop/fontes/${id}`, { headers: this.headers, responseType: 'blob' }));
  }

  chooseFolder(): Promise<{ caminho: string } | null> {
    return this.post('pasta/escolher');
  }

  watchFolder(caminho: string): Promise<{ caminho: string; saida: string; pendentes: string[] }> {
    return this.post('pasta/monitorar', { caminho });
  }

  stopWatching(): Promise<void> {
    return this.post('pasta/parar');
  }

  readFromFolder(caminho: string): Promise<Blob> {
    return firstValueFrom(this.http.post('/api/desktop/pasta/ler', { caminho }, { headers: this.headers, responseType: 'blob' }));
  }

  writeToFolder(nome: string, dados: string): Promise<{ caminho: string }> {
    return this.post('pasta/gravar', { nome, dados });
  }
}

/** Bytes em base64 (pros arquivos que vão pro programa). */
export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export function bytesToBase64(buf: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
