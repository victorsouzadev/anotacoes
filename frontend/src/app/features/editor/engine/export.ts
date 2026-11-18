import { CanvasElement, NotePage, PaperStyle } from '../../../data/models';
import { buildPdf, PdfPage } from '../../../shared/pdf';
import { TamanhoPdf, layoutPdf } from './export-pdf-layout';
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

/** Espera as imagens da página decodificarem no Renderer (o cache é por instância e cada imagem
 * nova chega no onload); sem isso a primeira renderização sairia sem as fotos. */
function esperarImagens(elements: CanvasElement[], carregadas: () => number, limiteMs = 4000): Promise<void> {
  const total = new Set(elements.filter((e) => e.type === 'image').map((e) => (e as { src: string }).src)).size;
  if (total === 0) return Promise.resolve();
  const inicio = performance.now();
  return new Promise((resolve) => {
    const checar = () => (carregadas() >= total || performance.now() - inicio > limiteMs ? resolve() : setTimeout(checar, 30));
    checar();
  });
}

export interface OpcoesPdf {
  tamanho: TamanhoPdf;
  estiloPapel: boolean;
}

/**
 * PDF da nota (spec 019): uma página do PDF por página da nota, cada uma renderizada pelo mesmo
 * Renderer do editor a ~200 DPI e embutida como JPEG. Página vazia sai em branco (mantém a
 * numeração). Tudo no navegador.
 */
export async function exportNoteToPdf(pages: NotePage[], paperStyle: PaperStyle, filename: string, opcoes: OpcoesPdf): Promise<void> {
  if (pages.every((p) => p.elements.length === 0)) {
    alert('A nota está vazia — não há nada para exportar.');
    return;
  }
  const canvas = document.createElement('canvas');
  const viewport = new Viewport();
  let carregadas = 0;
  const renderer = new Renderer(canvas, viewport, () => { carregadas++; });
  const paginas: PdfPage[] = [];

  for (const page of pages) {
    const caixa = page.elements.length ? Renderer.contentBBox(page.elements) : null;
    const l = layoutPdf(caixa, opcoes.tamanho);
    // O Renderer multiplica pelo devicePixelRatio: mede quanto é e compensa, para o canvas
    // ter exatamente pxW × pxH pixels.
    renderer.resize(l.pxW, l.pxH);
    const fator = canvas.width / l.pxW;
    renderer.resize(l.pxW / fator, l.pxH / fator);
    viewport.scale = l.escala / fator;
    viewport.offsetX = l.offsetX;
    viewport.offsetY = l.offsetY;
    const estilo = opcoes.estiloPapel ? paperStyle : 'blank';
    renderer.render(page.elements, new Set(), null, null, estilo);
    await esperarImagens(page.elements, () => carregadas);
    renderer.render(page.elements, new Set(), null, null, estilo);

    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Não foi possível gerar a imagem da página.');
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    paginas.push({ wMm: l.wMm, hMm: l.hMm, content: '', image: { jpeg, pxW: canvas.width, pxH: canvas.height } });
    // Devolve o controle ao navegador entre páginas para a aba não travar.
    await new Promise((r) => setTimeout(r, 0));
  }

  const pdf = buildPdf(paginas);
  const url = URL.createObjectURL(pdf);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(filename) || 'nota'}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
