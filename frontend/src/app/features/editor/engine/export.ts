import { CanvasElement, PaperStyle } from '../../../data/models';
import { Renderer } from './renderer';
import { Viewport } from './viewport';

const EXPORT_PADDING = 40;

/** Renderiza os elementos de uma página inteira (não só o viewport visível) num
 * canvas offscreen do tamanho exato do conteúdo e baixa como PNG — reaproveita o
 * mesmo Renderer usado no editor e nas miniaturas, só com um Viewport dedicado que
 * enquadra tudo em vez de refletir o zoom/pan atual da tela. */
export function exportNoteToPng(elements: CanvasElement[], paperStyle: PaperStyle, filename: string, transparent = false): void {
  if (elements.length === 0) {
    alert('Esta página está vazia — não há nada para exportar.');
    return;
  }
  const box = Renderer.contentBBox(elements);
  const w = Math.max(100, box.maxX - box.minX + EXPORT_PADDING * 2);
  const h = Math.max(100, box.maxY - box.minY + EXPORT_PADDING * 2);

  const canvas = document.createElement('canvas');
  const viewport = new Viewport();
  viewport.scale = 1;
  viewport.offsetX = box.minX - EXPORT_PADDING;
  viewport.offsetY = box.minY - EXPORT_PADDING;

  const renderer = new Renderer(canvas, viewport);
  renderer.resize(w, h);
  renderer.render(elements, new Set(), null, null, paperStyle);

  // O canvas fica transparente onde nada foi desenhado (ex: fundo do checklist) — se o
  // usuário não pediu fundo transparente, preenche branco atrás de tudo que já foi
  // renderizado, sem precisar tocar no Renderer (que sempre começa com clearRect).
  if (!transparent) {
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(filename) || 'nota'}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function sanitizeFilename(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
}
