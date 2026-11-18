const MAX_DIMENSION = 1600;

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/** Redimensiona (se preciso) e recodifica para manter o payload da nota (limite de 8 MB
 * no backend) razoável mesmo com fotos/screenshots grandes coladas do clipboard. Usa JPEG
 * para imagens opacas (menor payload) e preserva PNG quando há canal alfa, para não perder
 * a transparência do fundo. */
export function downscaleImageBlob(blob: Blob): Promise<{ dataUrl: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = hasTransparency(ctx, w, h)
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.85);
      resolve({ dataUrl, w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao carregar imagem colada.'));
    };
    img.src = url;
  });
}

/** Limite do conteúdo de uma nota no servidor (NotesEndpoints.MaxElementsBytes). */
export const LIMITE_NOTA_BYTES = 8 * 1024 * 1024;

/** Várias imagens soltas juntas descem em cascata a partir do ponto (24 unidades por imagem). */
export function cascata(ponto: { x: number; y: number }, indice: number): { x: number; y: number } {
  return { x: ponto.x + indice * 24, y: ponto.y + indice * 24 };
}

/** A nota continua dentro do limite do servidor com mais esta imagem? (com 2% de folga para o JSON) */
export function cabeNoLimite(bytesAtuais: number, dataUrl: string, limite = LIMITE_NOTA_BYTES): boolean {
  return bytesAtuais + dataUrl.length * 1.02 + 200 <= limite;
}

/** Só imagens entram no canvas (HEIC inclusive, convertido antes). */
export function ehImagem(file: { name: string; type: string }): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|hei[cf])$/i.test(file.name);
}
