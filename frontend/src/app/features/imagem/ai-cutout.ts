/** Remoção de fundo por IA, do lado do desenho: prepara a foto pro envio
 * (reduzida, achatada em JPEG) e devolve o recorte no tamanho de quem pediu,
 * pra entrar no lugar da arte sem mexer em largura, enquadramento ou cortes. */

import { ImageUpscaleService, UpscaleError } from './image-upscale.service';

/** O serviço não ganha nada com mais que isto, e o upload fica rápido. */
const MAX_PIXELS = 4_000_000;

export async function aiCutout(service: ImageUpscaleService, source: HTMLCanvasElement | HTMLImageElement): Promise<HTMLCanvasElement> {
  const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const h = 'naturalHeight' in source ? source.naturalHeight : source.height;
  let budget = MAX_PIXELS;
  for (let tentativa = 1; ; tentativa++) {
    const k = Math.min(1, Math.sqrt(budget / (w * h)));
    const send = document.createElement('canvas');
    send.width = Math.max(1, Math.round(w * k));
    send.height = Math.max(1, Math.round(h * k));
    const g = send.getContext('2d')!;
    // o que já era transparente vai como branco: o modelo trata como fundo
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, send.width, send.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(source, 0, 0, send.width, send.height);
    try {
      const url = await service.removerFundo(send.toDataURL('image/jpeg', 0.92));
      const img = await loadImage(url);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const o = out.getContext('2d')!;
      o.imageSmoothingQuality = 'high';
      o.drawImage(img, 0, 0, w, h);
      // O recorte vem da foto achatada; a cor sai da original, na resolução
      // cheia. Só a transparência do recorte é aproveitada.
      o.globalCompositeOperation = 'source-in';
      o.drawImage(source, 0, 0, w, h);
      o.globalCompositeOperation = 'source-over';
      return out;
    } catch (err) {
      if (!(err instanceof UpscaleError && err.tentarMenor) || tentativa >= 3) throw err;
      budget = Math.round(budget * 0.5);
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new UpscaleError('O recorte voltou num formato que não consegui abrir.'));
    img.src = url;
  });
}
