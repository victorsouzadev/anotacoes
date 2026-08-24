/** Molde SVG: o usuário sobe um .svg com "buracos" (encaixes) e encaixa fotos
 * neles, recortadas no contorno da forma. Aqui fica o que é parse, saneamento,
 * geometria e serialização — sem Angular, pra testar isolado, como raster.ts e
 * contour.ts. */

import { uuid } from '../../core/uuid';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';

/** Marca os elementos que o editor injeta — nunca saem na exportação nem viram encaixe. */
export const EDITOR_ATTR = 'data-editor';

/** Nomes que denunciam um encaixe num SVG feito no Inkscape/Illustrator. */
const SLOT_NAME_RE = /(foto|photo|slot|imagem|image|mask|placeholder)/i;

const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'polygon', 'polyline', 'path', 'text', 'use', 'g']);

const FORBIDDEN_TAGS = new Set([
  'script', 'foreignobject', 'animate', 'animatetransform', 'animatemotion',
  'set', 'handler', 'audio', 'video', 'iframe', 'a',
]);

/** Atributos zerados no clone que serve de área clicável do encaixe. */
const PAINT_ATTRS = [
  'id', 'class', 'style', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-opacity', 'fill-opacity', 'opacity', 'filter', 'mask',
  'marker-start', 'marker-mid', 'marker-end',
];

export class TemplateError extends Error {}

export interface SlotRect { x: number; y: number; w: number; h: number }
export interface ViewBox { x: number; y: number; w: number; h: number }

/** Um recorte do molde. O elemento original continua no SVG; o encaixe só aponta pra ele. */
export interface TemplateSlot {
  id: string;
  /** id (já prefixado) do elemento do molde usado como recorte. */
  elId: string;
  label: string;
  /** Caixa do encaixe no espaço de coordenadas da raiz. */
  rect: SlotRect;
  /** Transform dos ancestrais do elemento, já achatado em `matrix(...)`. Um
   * `<use>` copia só o elemento apontado — os transforms dos grupos acima dele
   * não vêm junto, então quem usa o recorte precisa reaplicá-los. */
  transform: string;
}

export interface SlotGeometry {
  rect: SlotRect;
  transform: string;
}

export type PhotoFit = 'cover' | 'contain';
export type PhotoDepth = 'frente' | 'atras';

/** Uma camada de foto. Várias podem apontar pro mesmo encaixe — é o que permite
 * sobrepor duas fotos no mesmo buraco, cada uma com sua opacidade. */
export interface PhotoLayer {
  id: string;
  slotId: string;
  name: string;
  /** data URL — nunca uma URL externa (não sobrevive à exportação). */
  src: string;
  naturalW: number;
  naturalH: number;
  fit: PhotoFit;
  /** 1 = exatamente o enquadramento automático. */
  scale: number;
  /** Deslocamento em unidades do viewBox. */
  dx: number;
  dy: number;
  rotation: number;
  flipX: boolean;
  opacity: number;
  /** Ordem entre as fotos — maior fica na frente. */
  z: number;
  depth: PhotoDepth;
}

export interface ParsedTemplate {
  /** Raiz saneada e com os ids prefixados; ainda fora do documento da página. */
  root: SVGSVGElement;
  viewBox: ViewBox;
  widthMm: number;
  idPrefix: string;
}

export interface ImagePlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  transform: string;
}

// ---------- unidades ----------

const UNIT_PX: Record<string, number> = {
  '': 1, px: 1, pt: 96 / 72, pc: 96 / 6, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6,
};

/** Comprimento SVG ("210mm", "8.5in", "800") em px CSS (96 dpi). `%` não dá. */
export function lengthToPx(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || !(unit in UNIT_PX)) return null;
  return n * UNIT_PX[unit];
}

/** Tamanho físico do molde: do atributo `width` quando ele traz unidade; senão
 * as unidades do viewBox valem como px a 96 dpi (o que o navegador faria). */
export function physicalWidthMm(widthAttr: string | null | undefined, viewBoxW: number): number {
  const px = lengthToPx(widthAttr) ?? viewBoxW;
  const mm = (px * 25.4) / 96;
  return Math.min(2000, Math.max(1, Math.round(mm * 100) / 100));
}

// ---------- parse e saneamento ----------

/** Lê o .svg do usuário: remove o que é executável ou externo, resolve o
 * `<style>` interno pra style inline, prefixa os ids e normaliza o viewBox. */
export function parseTemplateSvg(text: string): ParsedTemplate {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) throw new TemplateError('Não consegui ler esse SVG — o arquivo parece corrompido.');
  const root = doc.documentElement as unknown as SVGSVGElement;
  if (root.localName.toLowerCase() !== 'svg') throw new TemplateError('O arquivo não é um SVG.');

  inlineStyleBlocks(root);
  sanitize(root);
  const idPrefix = `tpl${uuid().replace(/-/g, '').slice(0, 8)}-`;
  prefixIds(root, idPrefix);

  const widthAttr = root.getAttribute('width');
  const heightAttr = root.getAttribute('height');
  const viewBox = normalizeViewBox(root, widthAttr, heightAttr);
  const widthMm = physicalWidthMm(widthAttr, viewBox.w);

  // Na tela quem manda no tamanho é o CSS do palco — o SVG ocupa o host inteiro.
  root.setAttribute('width', '100%');
  root.setAttribute('height', '100%');
  root.style.removeProperty('width');
  root.style.removeProperty('height');

  return { root, viewBox, widthMm, idPrefix };
}

interface CssRule { selectors: string; declarations: string }

/** Parser mínimo de `seletor { declarações }`. Existe porque o CSSOM não está
 * disponível em todo ambiente (nos testes, `<style>.sheet` vem nulo) e porque
 * montar um `<style>` de verdade só pra ler as regras arriscaria aplicá-las na
 * página. Cobre o que Illustrator e Inkscape emitem. */
export function parseCssRules(text: string): CssRule[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean)) !== null) {
    const selectors = match[1].trim();
    const declarations = match[2].trim();
    if (!selectors || selectors.startsWith('@') || !declarations) continue;
    rules.push({ selectors, declarations });
  }
  return rules;
}

/** Um `<style>` dentro de um SVG inline vale pro documento inteiro — aplicaria
 * `.borda{...}` do molde nos elementos da própria app. Vira style inline e sai. */
function inlineStyleBlocks(root: SVGSVGElement): void {
  const styleEls = Array.from(root.getElementsByTagName('style'));
  if (!styleEls.length) return;
  const collected = new Map<Element, string[]>();
  for (const styleEl of styleEls) {
    for (const rule of parseCssRules(styleEl.textContent ?? '')) {
      let targets: Element[];
      try {
        targets = Array.from(root.querySelectorAll(rule.selectors));
        if (safeMatches(root, rule.selectors)) targets.push(root);
      } catch {
        continue; // seletor que o querySelectorAll não engole
      }
      for (const el of targets) {
        const list = collected.get(el) ?? [];
        list.push(rule.declarations);
        collected.set(el, list);
      }
    }
    styleEl.remove();
  }
  for (const [el, declarations] of collected) {
    const own = el.getAttribute('style') ?? '';
    // A ordem é a mesma da cascata: regra depois de regra, e o style que já
    // estava no elemento por último, porque é o mais específico de todos.
    const style = [...declarations, own]
      .map((chunk) => chunk.trim().replace(/;\s*$/, ''))
      .filter(Boolean)
      .join(';');
    if (style) el.setAttribute('style', style);
  }
}

function safeMatches(el: Element, selectors: string): boolean {
  try {
    return el.matches(selectors);
  } catch {
    return false;
  }
}

function sanitize(root: SVGSVGElement): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (FORBIDDEN_TAGS.has(el.localName.toLowerCase())) el.remove();
  }
  for (const el of [root as Element, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.localName.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttributeNode(attr);
        continue;
      }
      if (name === 'href') {
        const v = attr.value.trim();
        // Só referência interna ou imagem embutida: nada de buscar arquivo na rede.
        if (!v.startsWith('#') && !v.startsWith('data:')) el.removeAttributeNode(attr);
        continue;
      }
      if (/url\(\s*['"]?\s*(?:https?:|\/\/)/i.test(attr.value) || /expression\s*\(/i.test(attr.value)) {
        el.removeAttributeNode(attr);
      }
    }
  }
}

/** O molde divide o documento com os ícones da app: um `id="a"` dele quebraria
 * um `url(#a)` alheio (e vice-versa). Prefixa tudo e reescreve as referências. */
function prefixIds(root: SVGSVGElement, prefix: string): void {
  const all = [root as Element, ...Array.from(root.querySelectorAll('*'))];
  const known = new Set<string>();
  for (const el of all) {
    const id = el.getAttribute('id');
    if (!id) continue;
    known.add(id);
    el.setAttribute('id', prefix + id);
  }
  if (!known.size) return;
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.localName.toLowerCase() === 'href') {
        const v = attr.value.trim();
        if (v.startsWith('#') && known.has(v.slice(1))) attr.value = `#${prefix}${v.slice(1)}`;
        continue;
      }
      if (!attr.value.includes('url(')) continue;
      attr.value = attr.value.replace(
        /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
        (whole, quote: string, id: string) => (known.has(id) ? `url(${quote}#${prefix}${id}${quote})` : whole),
      );
    }
  }
}

function normalizeViewBox(root: SVGSVGElement, widthAttr: string | null, heightAttr: string | null): ViewBox {
  const raw = root.getAttribute('viewBox');
  if (raw) {
    const n = raw.trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n.every((v) => Number.isFinite(v)) && n[2] > 0 && n[3] > 0) {
      return { x: n[0], y: n[1], w: n[2], h: n[3] };
    }
  }
  const w = lengthToPx(widthAttr);
  const h = lengthToPx(heightAttr);
  if (w && h) {
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
    return { x: 0, y: 0, w, h };
  }
  // Sem viewBox e sem tamanho não dá pra saber o quadro: 1000×1000 ao menos mostra o molde.
  root.setAttribute('viewBox', '0 0 1000 1000');
  return { x: 0, y: 0, w: 1000, h: 1000 };
}

// ---------- encaixes ----------

/** Formas que podem virar recorte. Fora: o que está em `<defs>`/`<clipPath>` (não
 * é desenhado) e o que o próprio editor injetou. */
export function isSlotCandidate(el: Element | null | undefined): el is SVGGraphicsElement {
  if (!el || !SHAPE_TAGS.has(el.localName.toLowerCase())) return false;
  if (el.closest(`[${EDITOR_ATTR}]`)) return false;
  if (el.closest('defs, clipPath, mask, marker, pattern, symbol')) return false;
  return true;
}

/** Encaixes por convenção de nome: `id="foto1"`, rótulo do Inkscape ou `data-slot`. */
export function autoDetectSlots(root: SVGSVGElement, idPrefix = ''): SVGGraphicsElement[] {
  const found: SVGGraphicsElement[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!isSlotCandidate(el)) continue;
    if (el.hasAttribute('data-slot')) {
      found.push(el);
      continue;
    }
    if (SLOT_NAME_RE.test(slotNameOf(el, idPrefix))) found.push(el);
  }
  // Um `<g>` marcado junto com os filhos marcados viraria encaixe duplicado.
  return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
}

/** Nome legível do elemento, pra casar com a convenção e pra rotular o encaixe. */
export function slotNameOf(el: Element, idPrefix = ''): string {
  const id = el.getAttribute('id') ?? '';
  const parts = [
    idPrefix && id.startsWith(idPrefix) ? id.slice(idPrefix.length) : id,
    el.getAttributeNS(INKSCAPE_NS, 'label') ?? el.getAttribute('inkscape:label') ?? '',
    el.getAttribute('data-slot') ?? '',
    el.getAttribute('data-name') ?? '',
    el.getAttribute('aria-label') ?? '',
  ];
  return parts.filter(Boolean).join(' ');
}

/** Garante um id no elemento pra que o `<clipPath>` consiga apontar pra ele. */
export function ensureElementId(el: Element, idPrefix: string): string {
  const existing = el.getAttribute('id');
  if (existing) return existing;
  const id = `${idPrefix}auto${uuid().replace(/-/g, '').slice(0, 8)}`;
  el.setAttribute('id', id);
  return id;
}

/** Caixa do elemento no espaço da raiz, mais o transform herdado dos ancestrais.
 * Exige o SVG montado e visível — em `display:none` as matrizes vêm zeradas e um
 * `<g>` vazio chega a lançar. */
export function slotGeometry(el: SVGGraphicsElement, root: SVGSVGElement): SlotGeometry | null {
  let box: DOMRect;
  let matrix: DOMMatrix;
  try {
    box = el.getBBox();
    const rootCtm = root.getScreenCTM();
    const elCtm = el.getScreenCTM();
    if (!rootCtm || !elCtm) return null;
    matrix = rootCtm.inverse().multiply(elCtm);
  } catch {
    return null;
  }
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const point = root.createSVGPoint();
  const xs: number[] = [];
  const ys: number[] = [];
  const corners: [number, number][] = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ];
  for (const [x, y] of corners) {
    point.x = x;
    point.y = y;
    const p = point.matrixTransform(matrix);
    xs.push(p.x);
    ys.push(p.y);
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const parent = el.parentNode as SVGGraphicsElement | null;
  return {
    rect: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY },
    transform: parent ? matrixAttribute(matrixToRoot(parent, root)) : '',
  };
}

function matrixAttribute(matrix: DOMMatrix | null): string {
  if (!matrix) return '';
  const identity = matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.e === 0 && matrix.f === 0;
  return identity ? '' : `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
}

// ---------- montagem das fotos ----------

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Onde o `<image>` cai dentro do encaixe: preenche (cover) ou cabe (contain),
 * depois aplica o zoom, o arrasto, o giro e o espelho do usuário. */
export function coverPlacement(rect: SlotRect, photo: PhotoLayer): ImagePlacement {
  const natW = Math.max(1, photo.naturalW);
  const natH = Math.max(1, photo.naturalH);
  const base = photo.fit === 'contain'
    ? Math.min(rect.w / natW, rect.h / natH)
    : Math.max(rect.w / natW, rect.h / natH);
  const scale = base * (photo.scale > 0 ? photo.scale : 1);
  const w = natW * scale;
  const h = natH * scale;
  const cx = rect.x + rect.w / 2 + photo.dx;
  const cy = rect.y + rect.h / 2 + photo.dy;
  const parts: string[] = [];
  if (photo.rotation) parts.push(`rotate(${r2(photo.rotation)} ${r2(cx)} ${r2(cy)})`);
  if (photo.flipX) parts.push(`translate(${r2(2 * cx)} 0) scale(-1 1)`);
  return { x: cx - w / 2, y: cy - h / 2, w, h, transform: parts.join(' ') };
}

function editorGroup(root: SVGSVGElement, kind: string, position: 'start' | 'end'): SVGGElement {
  const doc = root.ownerDocument!;
  let g = root.querySelector<SVGGElement>(`g[${EDITOR_ATTR}="${kind}"]`);
  if (!g) {
    g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.setAttribute(EDITOR_ATTR, kind);
  }
  // Reposiciona sempre: em SVG não há z-index, quem manda é a ordem no documento.
  if (position === 'start') root.insertBefore(g, root.firstChild);
  else root.appendChild(g);
  while (g.firstChild) g.removeChild(g.firstChild);
  return g;
}

/** (Re)desenha as fotos: um `<clipPath>` por encaixe e um `<g>` por camada, em
 * duas gavetas — atrás e na frente do desenho do molde — ordenadas por `z`. */
export function renderPhotos(root: SVGSVGElement, slots: TemplateSlot[], photos: PhotoLayer[], idPrefix: string): void {
  const doc = root.ownerDocument!;
  const defs = editorGroup(root, 'clips', 'start');
  const back = editorGroup(root, 'fotos-atras', 'start');
  const front = editorGroup(root, 'fotos-frente', 'end');
  const bySlot = new Map(slots.map((s) => [s.id, s]));
  const clipped = new Set<string>();

  for (const photo of [...photos].sort((a, b) => a.z - b.z)) {
    const slot = bySlot.get(photo.slotId);
    if (!slot) continue;
    const clipId = `${idPrefix}clip-${slot.id}`;
    if (!clipped.has(slot.id)) {
      clipped.add(slot.id);
      const clip = doc.createElementNS(SVG_NS, 'clipPath');
      clip.setAttribute('id', clipId);
      clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      const use = doc.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', `#${slot.elId}`);
      use.setAttributeNS(XLINK_NS, 'xlink:href', `#${slot.elId}`);
      // O `<use>` copia só o elemento: sem isto o recorte de uma forma dentro de
      // um `<g transform>` ficaria no canto errado do molde.
      if (slot.transform) use.setAttribute('transform', slot.transform);
      clip.appendChild(use);
      defs.appendChild(clip);
    }

    const placement = coverPlacement(slot.rect, photo);
    const image = doc.createElementNS(SVG_NS, 'image');
    image.setAttribute('x', String(r2(placement.x)));
    image.setAttribute('y', String(r2(placement.y)));
    image.setAttribute('width', String(r2(placement.w)));
    image.setAttribute('height', String(r2(placement.h)));
    image.setAttribute('preserveAspectRatio', 'none');
    // Só `href`: repetir a data URL em `xlink:href` dobraria o tamanho do arquivo.
    image.setAttribute('href', photo.src);
    if (placement.transform) image.setAttribute('transform', placement.transform);

    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('clip-path', `url(#${clipId})`);
    // A opacidade vai no grupo recortado pra desbotar tudo junto, sem soma de alfa na borda.
    if (photo.opacity < 1) g.setAttribute('opacity', String(Math.round(photo.opacity * 1000) / 1000));
    g.setAttribute('data-photo-id', photo.id);
    g.appendChild(image);
    (photo.depth === 'atras' ? back : front).appendChild(g);
  }
}

export interface HitOptions {
  selectedSlot: string | null;
  emptySlots: Set<string>;
}

/** Área clicável de cada encaixe, sempre por cima de tudo. É um clone da forma
 * sem pintura — não dá pra usar `<use>` aqui porque o `fill` do original venceria. */
export function renderSlotHits(root: SVGSVGElement, slots: TemplateSlot[], options: HitOptions): void {
  const doc = root.ownerDocument!;
  const layer = editorGroup(root, 'hits', 'end');
  for (const slot of slots) {
    const source = root.querySelector(`#${cssEscape(slot.elId)}`);
    if (!source) continue;
    const wrapper = doc.createElementNS(SVG_NS, 'g');
    wrapper.setAttribute('data-slot-id', slot.id);
    const classes = ['tm-hit'];
    if (options.emptySlots.has(slot.id)) classes.push('tm-hit-empty');
    if (options.selectedSlot === slot.id) classes.push('tm-hit-selected');
    wrapper.setAttribute('class', classes.join(' '));

    if (slot.transform) wrapper.setAttribute('transform', slot.transform);
    const clone = source.cloneNode(true) as Element;
    stripPaint(clone);
    wrapper.appendChild(clone);
    layer.appendChild(wrapper);
  }
}

function matrixToRoot(el: SVGGraphicsElement, root: SVGSVGElement): DOMMatrix | null {
  try {
    const rootCtm = root.getScreenCTM();
    const elCtm = el.getScreenCTM();
    if (!rootCtm || !elCtm) return null;
    return rootCtm.inverse().multiply(elCtm);
  } catch {
    return null;
  }
}

function stripPaint(el: Element): void {
  for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
    for (const attr of PAINT_ATTRS) node.removeAttribute(attr);
    node.setAttribute('fill', 'transparent');
    node.setAttribute('stroke', 'none');
    node.setAttribute('vector-effect', 'non-scaling-stroke');
  }
}

/** CSS.escape não existe em todo lugar e os ids aqui são gerados por nós. */
function cssEscape(id: string): string {
  return id.replace(/([^\w-])/g, '\\$1');
}

// ---------- exportação ----------

/** SVG final: sem nada do editor, com o tamanho físico de volta nos atributos. */
export function serializeForExport(root: SVGSVGElement, widthMm: number, heightMm: number): string {
  const clone = root.cloneNode(true) as SVGSVGElement;
  for (const node of Array.from(clone.querySelectorAll(`[${EDITOR_ATTR}="hits"]`))) node.remove();
  for (const node of Array.from(clone.querySelectorAll('[data-slot-id]'))) node.remove();
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', XLINK_NS);
  clone.setAttribute('width', `${widthMm.toFixed(2)}mm`);
  clone.setAttribute('height', `${heightMm.toFixed(2)}mm`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui carregar a imagem.'));
    img.src = src;
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
