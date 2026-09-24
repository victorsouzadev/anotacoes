/** Ponte com o worker da vetorização. Um pedido novo torna o anterior
 * obsoleto: mexer no controle várias vezes seguidas só aplica o último. */

import { Injectable, OnDestroy } from '@angular/core';
import { ImageStats, VectorizeParams, VectorizeResult } from './vectorize';

/** Lado maior, em px, que a vetorização lê: acima disso o ganho de detalhe
 * não aparece em corte nem impressão e o tempo cresce com o quadrado. */
export const MAX_VECTORIZE_SIDE = 1200;

interface Reply {
  id: number;
  stats?: ImageStats;
  result?: VectorizeResult;
  error?: string;
}

export class StaleRequest extends Error {}

@Injectable()
export class VectorizeService implements OnDestroy {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  private latestRun = 0;

  ngOnDestroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  analyze(canvas: HTMLCanvasElement): Promise<ImageStats> {
    return this.send(canvas, null).then((r) => r.stats!);
  }

  /** Só o pedido mais recente resolve; os anteriores rejeitam com
   * `StaleRequest` quando voltam. */
  async run(canvas: HTMLCanvasElement, params: VectorizeParams): Promise<VectorizeResult> {
    const run = ++this.latestRun;
    const reply = await this.send(canvas, params);
    if (run !== this.latestRun) throw new StaleRequest();
    return reply.result!;
  }

  private send(canvas: HTMLCanvasElement, params: VectorizeParams | null): Promise<Reply> {
    this.worker ??= this.createWorker();
    const id = ++this.seq;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const buffer = data.buffer as ArrayBuffer;
    return new Promise<Reply>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker!.postMessage({ id, buffer, width: canvas.width, height: canvas.height, params }, [buffer]);
    });
  }

  private createWorker(): Worker {
    const w = new Worker(new URL('./vectorize.worker', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }: MessageEvent<Reply>) => {
      const job = this.waiting.get(data.id);
      if (!job) return;
      this.waiting.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data);
    };
    w.onerror = () => {
      for (const job of this.waiting.values()) job.reject(new Error('A vetorização falhou.'));
      this.waiting.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return w;
  }
}

/** Reduz a imagem pro tamanho que a vetorização lê. */
export function vectorizeCanvas(source: CanvasImageSource & { width: number; height: number }, maxSide = MAX_VECTORIZE_SIDE): HTMLCanvasElement {
  const w0 = (source as HTMLImageElement).naturalWidth || source.width;
  const h0 = (source as HTMLImageElement).naturalHeight || source.height;
  const f = Math.min(1, maxSide / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w0 * f));
  canvas.height = Math.max(1, Math.round(h0 * f));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
