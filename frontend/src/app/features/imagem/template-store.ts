/** Estado do modo "Molde SVG". Fica num serviço, e não no componente, porque o
 * componente é destruído ao trocar de modo — e porque a page precisa ler tudo
 * isso pra salvar o projeto no backend. */

import { Injectable, computed, signal } from '@angular/core';
import { uuid } from '../../core/uuid';
import {
  ParsedTemplate,
  PhotoDepth,
  PhotoLayer,
  TemplateSlot,
  autoDetectSlots,
  ensureElementId,
  isSlotCandidate,
  parseTemplateSvg,
  slotGeometry,
  slotNameOf,
} from './svg-template';

export interface TemplateProjectData {
  version: number;
  svg: string;
  fileName: string;
  widthMm: number;
  slots: TemplateSlot[];
  photos: PhotoLayer[];
}

export const NEW_PHOTO_DEFAULTS = {
  fit: 'cover' as const,
  scale: 1,
  dx: 0,
  dy: 0,
  rotation: 0,
  flipX: false,
  opacity: 1,
  depth: 'frente' as PhotoDepth,
};

@Injectable()
export class TemplateStore {
  /** SVG já saneado — é o que vai pro backend, não o arquivo cru do usuário. */
  svgText = signal<string | null>(null);
  fileName = signal('');
  parsed = signal<ParsedTemplate | null>(null);
  slots = signal<TemplateSlot[]>([]);
  photos = signal<PhotoLayer[]>([]);
  selectedPhotoId = signal<string | null>(null);
  widthMm = signal(100);
  error = signal('');

  hasTemplate = computed(() => this.parsed() !== null);

  /** A pilha como o painel mostra: da frente pra trás. */
  stack = computed(() => [...this.photos()].sort((a, b) => b.z - a.z));

  selectedPhoto = computed(() => {
    const id = this.selectedPhotoId();
    return id ? (this.photos().find((p) => p.id === id) ?? null) : null;
  });

  emptySlotIds = computed(() => {
    const filled = new Set(this.photos().map((p) => p.slotId));
    return new Set(this.slots().filter((s) => !filled.has(s.id)).map((s) => s.id));
  });

  heightMm = computed(() => {
    const vb = this.parsed()?.viewBox;
    if (!vb || !(vb.w > 0)) return this.widthMm();
    return Math.round((this.widthMm() * vb.h) / vb.w * 100) / 100;
  });

  photosOfSlot(slotId: string): PhotoLayer[] {
    return this.photos().filter((p) => p.slotId === slotId).sort((a, b) => b.z - a.z);
  }

  slotOf(slotId: string): TemplateSlot | null {
    return this.slots().find((s) => s.id === slotId) ?? null;
  }

  // ---------- molde ----------

  /** Lê o arquivo. Os encaixes só são descobertos depois, em `detectSlots`, porque
   * medir uma forma exige o SVG montado na tela. */
  loadSvgText(text: string, fileName: string): ParsedTemplate {
    const parsed = parseTemplateSvg(text);
    this.parsed.set(parsed);
    this.svgText.set(text);
    this.fileName.set(fileName);
    this.widthMm.set(parsed.widthMm);
    this.slots.set([]);
    this.photos.set([]);
    this.selectedPhotoId.set(null);
    this.error.set('');
    return parsed;
  }

  clear(): void {
    this.parsed.set(null);
    this.svgText.set(null);
    this.fileName.set('');
    this.slots.set([]);
    this.photos.set([]);
    this.selectedPhotoId.set(null);
    this.widthMm.set(100);
    this.error.set('');
  }

  // ---------- encaixes ----------

  /** Auto-detecção por convenção de nome, feita uma vez, com o molde já na tela. */
  detectSlots(root: SVGSVGElement): number {
    const prefix = this.parsed()?.idPrefix ?? '';
    const found = autoDetectSlots(root, prefix);
    const slots: TemplateSlot[] = [];
    for (const el of found) {
      const slot = this.buildSlot(el, root, prefix, slots.length);
      if (slot) slots.push(slot);
    }
    this.slots.set(slots);
    return slots.length;
  }

  addSlotFromElement(el: Element, root: SVGSVGElement): TemplateSlot | null {
    if (!isSlotCandidate(el)) return null;
    const prefix = this.parsed()?.idPrefix ?? '';
    const elId = ensureElementId(el, prefix);
    const existing = this.slots().find((s) => s.elId === elId);
    if (existing) return existing;
    const slot = this.buildSlot(el as SVGGraphicsElement, root, prefix, this.slots().length);
    if (!slot) return null;
    this.slots.update((list) => [...list, slot]);
    return slot;
  }

  private buildSlot(el: SVGGraphicsElement, root: SVGSVGElement, prefix: string, index: number): TemplateSlot | null {
    const geometry = slotGeometry(el, root);
    if (!geometry) return null;
    const name = slotNameOf(el, prefix).trim();
    return {
      id: uuid(),
      elId: ensureElementId(el, prefix),
      label: name || `Encaixe ${index + 1}`,
      rect: geometry.rect,
      transform: geometry.transform,
    };
  }

  renameSlot(slotId: string, label: string): void {
    this.slots.update((list) => list.map((s) => (s.id === slotId ? { ...s, label } : s)));
  }

  removeSlot(slotId: string): void {
    this.slots.update((list) => list.filter((s) => s.id !== slotId));
    this.photos.update((list) => list.filter((p) => p.slotId !== slotId));
    if (!this.selectedPhoto()) this.selectedPhotoId.set(null);
  }

  /** Remede os encaixes contra o DOM — depois de abrir um projeto salvo ou de
   * o palco mudar de tamanho, as caixas guardadas podem não valer mais. */
  refreshRects(root: SVGSVGElement): void {
    this.slots.update((list) =>
      list.map((slot) => {
        const el = root.querySelector(`[id="${slot.elId}"]`) as SVGGraphicsElement | null;
        const geometry = el ? slotGeometry(el, root) : null;
        return geometry ? { ...slot, rect: geometry.rect, transform: geometry.transform } : slot;
      }),
    );
  }

  // ---------- fotos ----------

  /** Entra sempre no topo da pilha: quem acabou de soltar a foto espera vê-la. */
  addPhoto(slotId: string, photo: Omit<PhotoLayer, 'id' | 'z' | 'slotId'>): string {
    const id = uuid();
    const z = this.photos().reduce((max, p) => Math.max(max, p.z), 0) + 1;
    this.photos.update((list) => [...list, { ...photo, id, slotId, z }]);
    this.selectedPhotoId.set(id);
    return id;
  }

  patchPhoto(photoId: string, patch: Partial<PhotoLayer>): void {
    this.photos.update((list) => list.map((p) => (p.id === photoId ? { ...p, ...patch } : p)));
  }

  removePhoto(photoId: string): void {
    this.photos.update((list) => list.filter((p) => p.id !== photoId));
    if (this.selectedPhotoId() === photoId) this.selectedPhotoId.set(null);
  }

  /** Reordena a pilha inteira e renumera `z` de 1..n, pra nunca haver empate. */
  reorder(photoId: string, to: 'frente' | 'tras' | 'topo' | 'fundo'): void {
    const ascending = [...this.photos()].sort((a, b) => a.z - b.z);
    const from = ascending.findIndex((p) => p.id === photoId);
    if (from < 0) return;
    const target = to === 'frente' ? from + 1
      : to === 'tras' ? from - 1
      : to === 'topo' ? ascending.length - 1
      : 0;
    const clamped = Math.min(ascending.length - 1, Math.max(0, target));
    if (clamped === from) return;
    const [moved] = ascending.splice(from, 1);
    ascending.splice(clamped, 0, moved);
    const zById = new Map(ascending.map((p, i) => [p.id, i + 1]));
    this.photos.update((list) => list.map((p) => ({ ...p, z: zById.get(p.id) ?? p.z })));
  }

  /** Volta ao enquadramento automático sem mexer em opacidade nem em ordem. */
  reframe(photoId: string): void {
    this.patchPhoto(photoId, { scale: 1, dx: 0, dy: 0, rotation: 0, flipX: false });
  }

  // ---------- projeto ----------

  serialize(): TemplateProjectData | null {
    const svg = this.svgText();
    if (!svg) return null;
    return {
      version: 1,
      svg,
      fileName: this.fileName(),
      widthMm: this.widthMm(),
      slots: this.slots(),
      photos: this.photos(),
    };
  }

  /** Reabre um molde salvo. O SVG guardado já passou pelo saneamento, mas volta
   * a passar: o parse é a única porta de entrada e refaz o prefixo dos ids. */
  hydrate(data: TemplateProjectData): void {
    const parsed = this.loadSvgText(data.svg, data.fileName ?? '');
    this.widthMm.set(data.widthMm || parsed.widthMm);
    // O prefixo dos ids muda a cada parse; os encaixes salvos apontam pro antigo.
    const oldPrefix = detectPrefix(data.slots);
    const remap = (elId: string): string =>
      oldPrefix && elId.startsWith(oldPrefix) ? parsed.idPrefix + elId.slice(oldPrefix.length) : elId;
    this.slots.set((data.slots ?? []).map((s) => ({ ...s, transform: s.transform ?? '', elId: remap(s.elId) })));
    this.photos.set(data.photos ?? []);
    this.selectedPhotoId.set(null);
  }
}

/** O prefixo é `tpl` + 8 hex + `-`; todos os encaixes de um molde compartilham ele. */
function detectPrefix(slots: TemplateSlot[] | undefined): string | null {
  const match = /^tpl[0-9a-f]{8}-/.exec(slots?.[0]?.elId ?? '');
  return match ? match[0] : null;
}
