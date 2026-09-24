/** Rastreamento de imagem do modo Ilustração (o "Image Trace" do Illustrator):
 * abre a imagem, mede, escolhe a leitura e refaz a prévia a cada ajuste. Mora
 * num serviço porque quem pede pode ser o palco (soltar/colar), o Print & Cut
 * ou o painel — e a aba do painel nem sempre está aberta. */

import { Injectable, signal } from '@angular/core';
import { IllustrationStore } from './illustration-store';
import { countNodes } from './illustration-model';
import { encodeCanvas } from './raster';
import { isHeicFile } from './social-mode';
import { PresetId, VectorizeParams, presetParams, suggestPreset } from './vectorize';
import { StaleRequest, VectorizeService, vectorizeCanvas } from './vectorize.service';

function readImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
    img.src = src;
  });
}

@Injectable()
export class IllustrationTracer {
  busy = signal(false);
  error = signal('');
  /** Sobe a cada imagem nova: o dock abre a aba Vetorizar. */
  opened = signal(0);

  private timer?: ReturnType<typeof setTimeout>;

  constructor(private store: IllustrationStore, private vectorizer: VectorizeService) {}

  async loadFile(file: File): Promise<void> {
    this.error.set('');
    try {
      let blob: Blob = file;
      if (isHeicFile(file)) {
        this.store.vecInfo.set('Convertendo a foto do iPhone…');
        const { heicTo } = await import('heic-to');
        blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
      }
      const url = URL.createObjectURL(blob);
      try {
        const img = await readImage(url);
        await this.loadCanvas(img, file.name.replace(/\.[^.]+$/, '') || 'imagem');
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Não consegui abrir essa imagem.');
    }
  }

  /** Começa um rastreamento novo: mede a imagem, escolhe a leitura e roda. */
  async loadCanvas(source: HTMLImageElement | HTMLCanvasElement, name: string): Promise<void> {
    this.error.set('');
    this.opened.update((v) => v + 1);
    const canvas = vectorizeCanvas(source);
    this.store.vecSource.set({ name, canvas, dataUrl: encodeCanvas(canvas) });
    this.store.vecGroupId.set(null);
    this.store.vecRefId.set(null);
    const W = this.store.widthMm(), H = this.store.heightMm();
    const aspect = canvas.width / canvas.height;
    this.store.vecWidthMm.set(Math.round(Math.min(W * 0.8, H * 0.8 * aspect)));
    this.busy.set(true);
    try {
      const stats = await this.vectorizer.analyze(canvas);
      const s = suggestPreset(stats);
      this.store.vecStats.set(stats);
      this.store.vecPreset.set(s.preset);
      this.store.vecSuggested.set(s.preset);
      this.store.vecReason.set(s.reason);
      this.store.vecParams.set(s.params);
      await this.run();
    } catch {
      this.busy.set(false);
      this.error.set('Não consegui analisar essa imagem.');
    }
  }

  choosePreset(id: PresetId): void {
    this.store.vecPreset.set(id);
    this.store.vecParams.set(presetParams(id, this.store.vecStats()));
    this.schedule(0);
  }

  setParam<K extends keyof VectorizeParams>(key: K, value: VectorizeParams[K]): void {
    const p = this.store.vecParams();
    if (!p) return;
    this.store.vecParams.set({ ...p, [key]: value });
    this.schedule(350);
  }

  setWidth(w: number): void {
    if (!(w > 0)) return;
    this.store.vecWidthMm.set(Math.min(2000, Math.max(5, w)));
    this.schedule(0);
  }

  /** Solta a imagem: o resultado fica como desenho comum, sem prévia viva. */
  release(): void {
    clearTimeout(this.timer);
    this.store.vecSource.set(null);
    this.store.vecParams.set(null);
    this.store.vecGroupId.set(null);
    this.store.vecInfo.set('');
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  private async run(): Promise<void> {
    const src = this.store.vecSource();
    const params = this.store.vecParams();
    if (!src || !params) return;
    this.busy.set(true);
    try {
      const result = await this.vectorizer.run(src.canvas, params);
      this.store.applyVectorization(result, this.store.vecWidthMm());
      const nodes = result.layers.reduce((s, l) => s + countNodes(l.paths), 0);
      const shapes = result.layers.reduce((s, l) => s + l.paths.length, 0);
      this.store.vecInfo.set(result.layers.length
        ? `${result.layers.length} camada(s) · ${shapes} forma(s) · ${nodes.toLocaleString('pt-BR')} nós${nodes > 40000 ? ' — é muito: baixe o detalhe ou as cores.' : ''}`
        : 'Nada foi encontrado com esses ajustes — mexa no limiar ou no detalhe.');
      this.busy.set(false);
    } catch (err) {
      if (err instanceof StaleRequest) return;
      this.busy.set(false);
      this.error.set('A vetorização falhou. Tente uma imagem menor ou menos cores.');
    }
  }
}
