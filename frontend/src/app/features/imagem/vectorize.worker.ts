/// <reference lib="webworker" />

/** Vetorizar uma imagem de 1000 px em 12 cores leva de centenas de
 * milissegundos a alguns segundos — tempo demais pra segurar a interface. */

import { ImageStats, VectorizeParams, analyzeImage, vectorize } from './vectorize';

interface VectorizeRequest {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  params: VectorizeParams | null;
}

addEventListener('message', ({ data }: MessageEvent<VectorizeRequest>) => {
  try {
    const img = { data: new Uint8ClampedArray(data.buffer), w: data.width, h: data.height };
    if (!data.params) {
      const stats: ImageStats = analyzeImage(img);
      postMessage({ id: data.id, stats });
      return;
    }
    postMessage({ id: data.id, result: vectorize(img, data.params) });
  } catch (err) {
    postMessage({ id: data.id, error: err instanceof Error ? err.message : String(err) });
  }
});
