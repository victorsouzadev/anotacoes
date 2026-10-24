import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  Estimativa, EstudioConfig, Job, Midia, ModeloCatalogo, PedidoGeracao, Quadro, QuadroResumo, TipoMidia, TipoQuadro,
} from './estudio.models';

export interface FiltroMidias {
  tipo?: TipoMidia | TipoMidia[];
  q?: string;
  pasta?: string;
  favoritos?: boolean;
  origem?: string;
  limite?: number;
  antes?: string;
}

/** API do Estúdio. O catálogo é carregado uma vez e fica em memória. */
@Injectable({ providedIn: 'root' })
export class EstudioService {
  private readonly http = inject(HttpClient);
  private catalogoCache: Promise<ModeloCatalogo[]> | null = null;

  /** Avisa as telas abertas que a biblioteca mudou (upload, geração concluída, exclusão). */
  readonly versaoBiblioteca = signal(0);

  catalogo(): Promise<ModeloCatalogo[]> {
    this.catalogoCache ??= firstValueFrom(this.http.get<ModeloCatalogo[]>('/api/estudio/catalogo')).catch((e) => {
      this.catalogoCache = null;
      throw e;
    });
    return this.catalogoCache;
  }

  config(): Promise<EstudioConfig> {
    return firstValueFrom(this.http.get<EstudioConfig>('/api/estudio/config'));
  }

  salvarConfig(body: {
    chaveFal?: string | null; chaveWorldLabs?: string | null; limiteMensalCentavos?: number | null; semLimite?: boolean; confirmarAcimaCentavos?: number;
  }): Promise<EstudioConfig> {
    return firstValueFrom(this.http.put<EstudioConfig>('/api/estudio/config', body));
  }

  // ---------- biblioteca ----------

  midias(f: FiltroMidias = {}): Promise<Midia[]> {
    let params = new HttpParams();
    if (f.tipo) params = params.set('tipo', Array.isArray(f.tipo) ? f.tipo.join(',') : f.tipo);
    if (f.q) params = params.set('q', f.q);
    if (f.pasta) params = params.set('pasta', f.pasta);
    if (f.favoritos) params = params.set('favoritos', 'true');
    if (f.origem) params = params.set('origem', f.origem);
    if (f.limite) params = params.set('limite', f.limite);
    if (f.antes) params = params.set('antes', f.antes);
    return firstValueFrom(this.http.get<Midia[]>('/api/estudio/midias', { params }));
  }

  midia(id: string): Promise<Midia> {
    return firstValueFrom(this.http.get<Midia>(`/api/estudio/midias/${id}`));
  }

  pastas(): Promise<string[]> {
    return firstValueFrom(this.http.get<string[]>('/api/estudio/midias/pastas'));
  }

  async enviarArquivos(arquivos: File[] | FileList, pasta?: string, origem?: string): Promise<Midia[]> {
    const form = new FormData();
    for (const a of Array.from(arquivos)) form.append('arquivos', a, a.name);
    if (pasta) form.append('pasta', pasta);
    if (origem) form.append('origem', origem);
    const r = await firstValueFrom(this.http.post<Midia[]>('/api/estudio/midias', form));
    this.versaoBiblioteca.update((v) => v + 1);
    return r;
  }

  /** Bytes de um app (salvar do craft app, quadro tirado do vídeo, render do palco). */
  async enviarBytes(bytes: Blob, nome: string, origem = 'upload', pasta?: string): Promise<Midia> {
    const arquivo = new File([bytes], nome, { type: bytes.type || 'application/octet-stream' });
    return (await this.enviarArquivos([arquivo], pasta, origem))[0];
  }

  async substituirArquivo(id: string, bytes: Blob): Promise<Midia> {
    const r = await firstValueFrom(this.http.put<Midia>(`/api/estudio/midias/${id}/arquivo`, bytes, {
      headers: { 'Content-Type': bytes.type || 'application/octet-stream' },
    }));
    this.versaoBiblioteca.update((v) => v + 1);
    return r;
  }

  atualizarMidia(id: string, body: { nome?: string; pasta?: string; favorito?: boolean; thumb?: string }): Promise<Midia> {
    return firstValueFrom(this.http.patch<Midia>(`/api/estudio/midias/${id}`, body));
  }

  async apagarMidia(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`/api/estudio/midias/${id}`));
    this.versaoBiblioteca.update((v) => v + 1);
  }

  enviarAoEditor(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`/api/estudio/midias/${id}/editor`, {}));
  }

  async bytes(m: Midia): Promise<ArrayBuffer> {
    return firstValueFrom(this.http.get(m.url, { responseType: 'arraybuffer' }));
  }

  // ---------- gerações ----------

  estimar(p: PedidoGeracao): Promise<Estimativa> {
    return firstValueFrom(this.http.post<Estimativa>('/api/estudio/estimar', p));
  }

  gerar(p: PedidoGeracao): Promise<Job> {
    return firstValueFrom(this.http.post<Job>('/api/estudio/geracoes', p));
  }

  local(operacao: 'montar' | 'quadros', parametros: Record<string, unknown>, entradas: Record<string, string[]>, app?: string): Promise<Job> {
    return firstValueFrom(this.http.post<Job>('/api/estudio/local', { operacao, parametros, entradas, app }));
  }

  geracoes(f: { app?: string; ativos?: boolean; limite?: number; antes?: string } = {}): Promise<Job[]> {
    let params = new HttpParams();
    if (f.app) params = params.set('app', f.app);
    if (f.ativos) params = params.set('ativos', 'true');
    if (f.limite) params = params.set('limite', f.limite);
    if (f.antes) params = params.set('antes', f.antes);
    return firstValueFrom(this.http.get<Job[]>('/api/estudio/geracoes', { params }));
  }

  geracao(id: string): Promise<Job> {
    return firstValueFrom(this.http.get<Job>(`/api/estudio/geracoes/${id}`));
  }

  cancelar(id: string): Promise<Job> {
    return firstValueFrom(this.http.post<Job>(`/api/estudio/geracoes/${id}/cancelar`, {}));
  }

  ocultar(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/estudio/geracoes/${id}`));
  }

  /** Espera a geração terminar (consulta a cada 2,5 s). */
  async aguardar(id: string, aoMudar?: (j: Job) => void, sinal?: AbortSignal): Promise<Job> {
    for (;;) {
      if (sinal?.aborted) throw new DOMException('cancelado', 'AbortError');
      const j = await this.geracao(id);
      aoMudar?.(j);
      if (j.status === 'concluido' || j.status === 'falhou' || j.status === 'cancelado') {
        if (j.status === 'concluido') this.versaoBiblioteca.update((v) => v + 1);
        return j;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  // ---------- documentos das ferramentas ----------

  quadros(tipo: TipoQuadro): Promise<QuadroResumo[]> {
    return firstValueFrom(this.http.get<QuadroResumo[]>('/api/estudio/quadros', { params: { tipo } }));
  }

  quadro(id: string): Promise<Quadro> {
    return firstValueFrom(this.http.get<Quadro>(`/api/estudio/quadros/${id}`));
  }

  salvarQuadro(id: string, tipo: TipoQuadro, nome: string, data: unknown, thumb?: string | null): Promise<Quadro> {
    return firstValueFrom(this.http.put<Quadro>(`/api/estudio/quadros/${id}`, { tipo, nome, data: JSON.stringify(data), thumb: thumb ?? null }));
  }

  apagarQuadro(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/estudio/quadros/${id}`));
  }
}
