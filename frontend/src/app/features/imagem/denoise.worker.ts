/// <reference lib="webworker" />

/** A redução de ruído leva centenas de milissegundos numa foto de 2000 px —
 * tempo demais pra segurar a interface. O worker devolve o mesmo buffer por
 * transferência, então nada é copiado. */

import { denoiseRgba } from './denoise';

interface DenoiseRequest {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  strength: number;
}

addEventListener('message', ({ data }: MessageEvent<DenoiseRequest>) => {
  const pixels = new Uint8ClampedArray(data.buffer);
  denoiseRgba(pixels, data.width, data.height, data.strength);
  postMessage({ buffer: pixels.buffer }, { transfer: [pixels.buffer] });
});
