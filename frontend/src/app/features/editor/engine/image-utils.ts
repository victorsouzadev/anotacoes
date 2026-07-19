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
