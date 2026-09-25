/** "Pacote do cliente": tudo o que o projeto produz, num ZIP só — o que se
 * manda pra gráfica ou pro cliente no fim do trabalho. Cada modo com conteúdo
 * entra na sua pasta; os desenhos saem dos stores (não dos componentes), então
 * o pacote sai completo mesmo com um modo nunca aberto nesta sessão. */

import { FontLibrary } from './fonts';
import { buildSvg, canvasToBlob, rasterizeSvg } from './illustration-export';
import { IllustrationStore } from './illustration-store';
import { drawOverlays, ensureOverlayFonts } from './social-overlays';
import { paintFrame, sourceOf } from './social-render';
import { SocialStore } from './social-store';
import {
  applyTextEdits, listTemplateTexts, renderAddedTexts, renderPhotos, serializeForExport,
} from './svg-template';
import { TemplateStore } from './template-store';
import { ZipEntry } from './zip';

const DPI = 300;

export interface PackageSection {
  folder: string;
  files: ZipEntry[];
  /** Linhas pro LEIAME. */
  notes: string[];
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function mm(v: number): string {
  return `${(v / 10).toFixed(1).replace('.', ',')} cm`;
}

export async function illustrationSection(store: IllustrationStore): Promise<PackageSection | null> {
  if (!store.hasContent()) return null;
  const files: ZipEntry[] = [];
  const boards = store.allBoards();
  const many = boards.length > 1;
  const hasCut = store.layers().some((l) => l.cut && l.visible);
  const notes: string[] = [];
  for (const [i, bd] of boards.entries()) {
    const bounds = { minX: bd.x, minY: bd.y, maxX: bd.x + bd.w, maxY: bd.y + bd.h };
    const base = many ? `ilustracao/prancheta-${i + 1}` : 'ilustracao/arte';
    const art = await buildSvg(store, { skipCut: true, bounds });
    files.push({ name: `${base}.svg`, content: art });
    const png = await rasterizeSvg(art, bd.w, bd.h, DPI, null, 40_000_000);
    files.push({ name: `${base}.png`, content: await bytes(await canvasToBlob(png, 'image/png')) });
    // Só quando alguma camada é linha de corte: sem isso o "corte" seria o
    // contorno de tudo, que não é o que se manda pra máquina.
    if (hasCut) files.push({ name: `${base}-corte.svg`, content: await buildSvg(store, { cutOnly: true, bounds }) });
    notes.push(`Ilustração — ${bd.name}: ${mm(bd.w)} × ${mm(bd.h)}.`);
  }
  notes.push(`  SVG (vetor, em mm) e PNG (300 DPI, fundo transparente)${hasCut ? ', mais o SVG só das linhas de corte' : ''}.`);
  return { folder: 'ilustracao', files, notes };
}

export async function templateSection(store: TemplateStore, fonts: FontLibrary): Promise<PackageSection | null> {
  const parsed = store.parsed();
  if (!parsed) return null;
  const root = parsed.root;
  renderPhotos(root, store.slots(), store.photos(), parsed.idPrefix);
  // Molde nunca montado na tela ainda não recebeu os textos editados.
  if (!root.querySelector('g[data-editor="textos"]')) {
    applyTextEdits(root, listTemplateTexts(root), store.textEdits());
    const families = Object.fromEntries(store.addedTexts().map((t) => [t.fontId, fonts.family(t.fontId).name]));
    renderAddedTexts(root, store.addedTexts(), parsed.viewBox, families, '');
  }
  const W = store.widthMm(), H = store.heightMm();
  const svg = serializeForExport(root, W, H);
  const png = await rasterizeSvg(svg, W, H, DPI, null, 40_000_000);
  return {
    folder: 'molde',
    files: [
      { name: 'molde/molde.svg', content: svg },
      { name: 'molde/molde.png', content: await bytes(await canvasToBlob(png, 'image/png')) },
    ],
    notes: [`Molde — ${mm(W)} × ${mm(H)}, ${store.photos().length} foto(s) em ${store.slots().length} encaixe(s).`, '  molde.svg (fotos embutidas) e molde.png (300 DPI).'],
  };
}

export async function socialSection(store: SocialStore, fonts: FontLibrary): Promise<PackageSection | null> {
  const photo = store.image();
  if (!photo) return null;
  const w = store.frameW(), h = store.exportH();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paintFrame(canvas, sourceOf(photo), {
    adjust: store.adjust(), fit: store.fit(), scale: store.scale(), dx: store.offsetX(), dy: store.offsetY(),
    bgMode: store.bgMode(), bgColor: store.bgColor(),
  });
  await ensureOverlayFonts(store.overlays(), fonts);
  drawOverlays(canvas.getContext('2d')!, w, h, store.overlays(), fonts, null);
  const n = store.slides();
  const files: ZipEntry[] = [];
  const sw = Math.round(w / n);
  for (let i = 0; i < n; i++) {
    const part = document.createElement('canvas');
    part.width = sw;
    part.height = h;
    part.getContext('2d')!.drawImage(canvas, i * sw, 0, sw, h, 0, 0, sw, h);
    const name = n > 1 ? `redes-sociais/post-${String(i + 1).padStart(2, '0')}.jpg` : 'redes-sociais/post.jpg';
    files.push({ name, content: await bytes(await canvasToBlob(part, 'image/jpeg', store.quality() / 100)) });
  }
  return {
    folder: 'redes-sociais',
    files,
    notes: [`Redes sociais — ${store.format().label}, ${sw} × ${h} px${n > 1 ? `, carrossel de ${n} posts` : ''}.`],
  };
}

export function readme(projectName: string, sections: PackageSection[]): string {
  const when = new Date().toLocaleString('pt-BR');
  return [
    `Projeto: ${projectName || 'sem nome'}`,
    `Gerado em ${when} pelo Editor de Imagens.`,
    '',
    ...sections.flatMap((s) => [...s.notes, '']),
    'Impressão: use sempre "tamanho real" (100%), sem "ajustar à página".',
    'Corte: os SVG estão em milímetros; abra no CanvasWorkspace, Silhouette Studio ou Inkscape.',
    '',
  ].join('\r\n');
}
