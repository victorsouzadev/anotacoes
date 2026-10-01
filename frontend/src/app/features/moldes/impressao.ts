/** Parte do topper com foto que depende do navegador: ler a imagem enviada
 * (com a silhueta do canal alfa, pro corte seguir o desenho) e gerar o PNG de
 * impressão em 300 DPI, do tamanho exato da folha do SVG de corte. */

import { Polygon, pngBlobWithDpi, polygonArea, traceCutPaths } from '../imagem/contour';
import { pathsToD } from '../imagem/illustration-model';
import { loadImageElement } from '../imagem/svg-template';
import { Folha } from './folha';
import { ImagemCarregada } from './modelo';

/** Foto embutida no SVG: 2000 px cobre 300 DPI em ~17 cm, mais que qualquer topper. */
const MAX_LADO = 2000;
/** Resolução do traçado da silhueta (o contorno é suavizado depois). */
const MAX_LADO_TRACADO = 900;
export const DPI_IMPRESSAO = 300;

function lerArquivo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    r.readAsDataURL(file);
  });
}

function temTransparencia(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const d = ctx.getImageData(0, 0, w, h).data;
  let transparentes = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) transparentes++;
  // ao menos 2% do quadro sem fundo: é recorte, não uma foto com um pixel apagado
  return transparentes > (w * h) / 50;
}

export async function carregarImagem(file: File): Promise<ImagemCarregada> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (PNG ou JPG).');
  const original = await loadImageElement(await lerArquivo(file));
  const s = Math.min(1, MAX_LADO / Math.max(original.naturalWidth, original.naturalHeight));
  const w = Math.max(1, Math.round(original.naturalWidth * s));
  const h = Math.max(1, Math.round(original.naturalHeight * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(original, 0, 0, w, h);
  const alfa = temTransparencia(ctx, w, h);
  const src = alfa ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);

  let contorno: Polygon | null = null;
  if (alfa) {
    const k = Math.min(1, MAX_LADO_TRACADO / Math.max(w, h));
    const tc = document.createElement('canvas');
    tc.width = Math.max(1, Math.round(w * k));
    tc.height = Math.max(1, Math.round(h * k));
    tc.getContext('2d')!.drawImage(canvas, 0, 0, tc.width, tc.height);
    const polys = traceCutPaths(tc, { fillHoles: true, smoothSigma: 2, minArea: (tc.width * tc.height) / 400 });
    const maior = polys.reduce<Polygon | null>((best, p) => (!best || Math.abs(polygonArea(p)) > Math.abs(polygonArea(best)) ? p : best), null);
    if (maior) contorno = maior.map(([x, y]) => [(x / tc.width) * w, (y / tc.height) * h]);
  }
  return { src, w, h, contorno };
}

/** PNG da folha só com o que é impresso (fotos e bordas), em 300 DPI. */
export async function pngDaFolha(folha: Folha): Promise<Blob> {
  const k = DPI_IMPRESSAO / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(folha.w * k);
  canvas.height = Math.round(folha.h * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const imagens = new Map<string, HTMLImageElement>();
  for (const item of folha.itens) {
    const arte = item.peca.arte;
    if (!arte) continue;
    const [a, b, c, d, e, f] = item.m;
    ctx.save();
    ctx.setTransform(a * k, b * k, c * k, d * k, e * k, f * k);
    if (arte.fundo) {
      ctx.fillStyle = arte.fundo.cor;
      ctx.fill(new Path2D(pathsToD(arte.fundo.paths)), 'nonzero');
    }
    if (arte.foto) {
      const ft = arte.foto;
      let img = imagens.get(ft.src);
      if (!img) {
        img = await loadImageElement(ft.src);
        imagens.set(ft.src, img);
      }
      if (ft.clip) ctx.clip(new Path2D(pathsToD(ft.clip)));
      if (ft.espelhar) {
        ctx.translate(2 * ft.x + ft.w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, ft.x, ft.y, ft.w, ft.h);
    }
    ctx.restore();
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('O navegador não gerou o PNG.'))), 'image/png'),
  );
  return pngBlobWithDpi(blob, DPI_IMPRESSAO);
}
