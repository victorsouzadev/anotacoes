/** Modelos de post criados pelo usuário, guardados na conta
 * (/api/imagens/modelos) pra valer no celular e no computador.
 *
 * Um modelo salvo é o post sem a foto: formato, carrossel, fundo, espaço da
 * foto e camadas. Pode ser novo ou substituir um modelo que vem no editor
 * (`replaces`) — é assim que "editar um modelo pronto" funciona sem perder o
 * original, que volta ao apagar a versão editada. */

import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { uuid } from '../../core/uuid';
import { PhotoSlot, SOCIAL_FORMATS } from './social-model';
import { Overlay } from './social-overlays';
import { TemplateLook } from './social-store';
import { SOCIAL_TEMPLATES, SocialTemplate, TemplateGroup } from './social-templates';

export interface CustomTemplateDto {
  id: string;
  name: string;
  group: TemplateGroup;
  replaces: string;
  data: string;
  thumb: string;
  createdAt: string;
  updatedAt: string;
}

/** O que vai no campo `data`. */
export interface CustomTemplateData {
  version: 1;
  formatId: string;
  slides: number;
  bgColor: string;
  bgPattern: string;
  slot: PhotoSlot | null;
  overlays: Overlay[];
}

/** Um modelo como a galeria mostra: o do editor, a versão editada dele, ou um
 * modelo novo do usuário. */
export interface GalleryEntry {
  /** Id que o post guarda como "modelo aplicado". */
  id: string;
  label: string;
  group: TemplateGroup;
  help: string;
  photo: boolean;
  slides: number;
  kind: 'editor' | 'editado' | 'meu';
  /** O modelo do editor por trás (nos dois primeiros tipos). */
  builtin?: SocialTemplate;
  custom?: CustomTemplateDto;
  build: () => TemplateLook;
}

/** Grupo em que um post cai, pelo formato. */
export function groupFor(formatId: string, slides: number): TemplateGroup {
  if (slides > 1) return 'Carrossel';
  return formatId === 'story' ? 'Story' : 'Feed';
}

export function parseCustom(t: CustomTemplateDto): CustomTemplateData | null {
  try {
    const d = JSON.parse(t.data) as Partial<CustomTemplateData>;
    if (!d || !Array.isArray(d.overlays)) return null;
    return {
      version: 1,
      formatId: SOCIAL_FORMATS.some((f) => f.id === d.formatId) ? d.formatId! : SOCIAL_FORMATS[0].id,
      slides: Math.min(10, Math.max(1, Math.round(d.slides ?? 1))),
      bgColor: d.bgColor || '#FFE6EE',
      bgPattern: d.bgPattern ?? '',
      slot: d.slot ?? null,
      overlays: d.overlays,
    };
  } catch {
    return null;
  }
}

/** Monta o post a partir do modelo salvo, com ids de camada novos: aplicar o
 * mesmo modelo duas vezes não pode gerar camadas com o mesmo id. */
export function lookFromCustom(t: CustomTemplateDto, data: CustomTemplateData): TemplateLook {
  return {
    templateId: t.id,
    formatId: data.formatId,
    slides: data.slides,
    bgColor: data.bgColor,
    bgPattern: data.bgPattern,
    slot: data.slot,
    overlays: data.overlays.map((o) => ({ ...o, id: uuid() })),
  };
}

/** Junta os modelos do editor com os do usuário: a versão editada toma o lugar
 * do original, e os novos entram no fim do grupo deles. */
export function galleryEntries(custom: CustomTemplateDto[]): GalleryEntry[] {
  const valid = custom
    .map((c) => ({ c, data: parseCustom(c) }))
    .filter((x): x is { c: CustomTemplateDto; data: CustomTemplateData } => x.data !== null);
  const fromCustom = (c: CustomTemplateDto, data: CustomTemplateData, kind: 'editado' | 'meu', builtin?: SocialTemplate): GalleryEntry => ({
    id: c.id, label: c.name, group: c.group, slides: data.slides, photo: data.slot !== null, kind, builtin, custom: c,
    help: kind === 'editado' ? `Sua versão de "${builtin?.label}"` : 'Modelo seu',
    build: () => lookFromCustom(c, data),
  });

  const entries: GalleryEntry[] = SOCIAL_TEMPLATES.map((t) => {
    const edited = valid.find((x) => x.c.replaces === t.id);
    if (edited) return fromCustom(edited.c, edited.data, 'editado', t);
    return { id: t.id, label: t.label, group: t.group, help: t.help, photo: t.photo, slides: t.slides, kind: 'editor', builtin: t, build: t.build };
  });
  for (const x of valid) {
    // Versão editada de um modelo que não existe mais no editor vira modelo comum.
    const replacesKnown = x.c.replaces && SOCIAL_TEMPLATES.some((t) => t.id === x.c.replaces);
    if (!replacesKnown) entries.push(fromCustom(x.c, x.data, 'meu'));
  }
  return entries;
}

@Injectable({ providedIn: 'root' })
export class SocialTemplatesService {
  readonly custom = signal<CustomTemplateDto[]>([]);
  readonly loaded = signal(false);
  readonly error = signal('');
  readonly entries = computed(() => galleryEntries(this.custom()));

  constructor(private http: HttpClient) {}

  async load(force = false): Promise<void> {
    if (this.loaded() && !force) return;
    try {
      this.custom.set(await firstValueFrom(this.http.get<CustomTemplateDto[]>('/api/imagens/modelos')));
      this.loaded.set(true);
      this.error.set('');
    } catch {
      // Sem conexão: a galeria segue com os modelos do editor.
      this.error.set('Não consegui carregar os seus modelos agora.');
    }
  }

  /** Acha a entrada da galeria pelo id guardado no post. */
  entry(id: string): GalleryEntry | undefined {
    return this.entries().find((e) => e.id === id);
  }

  async save(input: { id?: string; name: string; group: TemplateGroup; replaces: string; data: CustomTemplateData; thumb: string }): Promise<CustomTemplateDto> {
    const id = input.id ?? uuid();
    const saved = await firstValueFrom(this.http.put<CustomTemplateDto>(`/api/imagens/modelos/${id}`, {
      name: input.name.trim().slice(0, 120) || 'Modelo',
      group: input.group,
      replaces: input.replaces,
      data: JSON.stringify(input.data),
      thumb: input.thumb,
    }));
    this.custom.update((l) => (l.some((c) => c.id === saved.id) ? l.map((c) => (c.id === saved.id ? saved : c)) : [...l, saved]));
    return saved;
  }

  async rename(t: CustomTemplateDto, name: string): Promise<void> {
    const data = parseCustom(t);
    if (!data) return;
    await this.save({ id: t.id, name, group: t.group, replaces: t.replaces, data, thumb: t.thumb });
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/imagens/modelos/${id}`));
    this.custom.update((l) => l.filter((c) => c.id !== id));
  }
}
