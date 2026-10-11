/** Post com IA, na aba Modelos do modo Redes sociais: a pessoa escolhe as
 * fotos, a IA olha cada uma, escolhe um modelo da Viih Mimos (story, feed ou
 * carrossel) e reescreve os textos dele pro que aparece nas fotos. O modo
 * aplica o modelo e põe as fotos nos espaços — tudo continua editável. */

import { HttpClient } from '@angular/common/http';
import { Component, ViewEncapsulation, inject, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IlIconComponent } from './illustration-icons';
import { CAPTION_TONES, readBrand } from './social-caption-panel';
import { FILTER_PRESETS } from './social-model';
import { isPlaceholder } from './social-photo-slots';
import { TemplateLook } from './social-store';
import { GalleryEntry, SocialTemplatesService } from './social-templates.service';

export const AI_POST_MAX_PHOTOS = 6;
/** Lado maior da foto que vai pra IA: dá pra ver o produto sem pesar no envio. */
const AI_PHOTO_SIDE = 768;

export const AI_POST_TYPES = [
  { id: 'auto', label: 'IA escolhe' },
  { id: 'Story', label: 'Story' },
  { id: 'Feed', label: 'Feed' },
  { id: 'Carrossel', label: 'Carrossel' },
] as const;

/** O que a IA precisa saber de um modelo: quantas fotos cabem e os textos. */
export interface TemplateForAi {
  id: string; nome: string; grupo: string; ajuda: string;
  fotos: number; cresce: boolean; textos: string[];
}

export function describeForAi(e: GalleryEntry, look: TemplateLook): TemplateForAi {
  const spots = look.overlays.filter(isPlaceholder).length;
  return {
    id: e.id, nome: e.label, grupo: e.group, ajuda: e.help,
    fotos: (look.slot ? 1 : 0) + spots, cresce: spots > 0,
    textos: look.overlays.flatMap((o) => (o.kind === 'texto' ? [o.text] : [])),
  };
}

/** Troca os textos do modelo pelos da IA, pelo índice entre as camadas de texto. */
export function rewriteTexts(look: TemplateLook, textos: { indice: number; texto: string }[]): TemplateLook {
  const novo = new Map(textos.map((t) => [t.indice, t.texto]));
  let i = 0;
  return {
    ...look,
    overlays: look.overlays.map((o) => {
      if (o.kind !== 'texto') return o;
      const t = novo.get(i++);
      return t ? { ...o, text: t } : o;
    }),
  };
}

export interface AiPost {
  entry: GalleryEntry;
  look: TemplateLook;
  /** Fotos na ordem que a IA escolheu: a primeira vai no espaço principal. */
  files: File[];
  preset: string | null;
  explicacao: string;
}

interface PostIaResponse {
  post: { modeloId: string; textos: { indice: number; texto: string }[]; ordemFotos: number[]; filtro: string | null; explicacao: string } | null;
  usouIa: boolean;
  motivo: string | null;
}

async function shrinkForAi(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, AI_PHOTO_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.8);
}

const lastContext = signal('');
const lastType = signal<string>('auto');
const lastTone = signal<string>('carinhoso');

@Component({
  selector: 'sm-ai-post-panel',
  standalone: true,
  imports: [IlIconComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="il-sec">
      <div class="il-sec-head il-sec-static"><il-icon name="sparkle" [size]="13" /> Post com IA</div>
      <div class="il-sec-body">
        <input #fotosInput type="file" accept="image/jpeg,image/png,image/webp" multiple hidden (change)="pick($any($event.target))" />
        <button type="button" class="il-btn il-wide" (click)="fotosInput.click()">
          <il-icon name="image" [size]="13" /> {{ files().length ? 'Trocar fotos (' + files().length + ')' : 'Escolher fotos' }}
        </button>
        @if (thumbs().length) {
          <div class="smp-thumbs">
            @for (t of thumbs(); track $index) { <img [src]="t" alt="" /> }
          </div>
        }
        <div class="il-seg smp-seg" role="group" aria-label="Tipo de post">
          @for (t of types; track t.id) {
            <button type="button" [class.il-on]="type() === t.id" (click)="type.set(t.id)">{{ t.label }}</button>
          }
        </div>
        <textarea class="il-textarea" rows="2" aria-label="Sobre o post" [value]="context()" (input)="context.set($any($event.target).value)"
          placeholder="opcional — ex.: kit festa jardim encantado da Alice, 5 anos"></textarea>
        <div class="il-seg smp-seg" role="group" aria-label="Tom dos textos">
          @for (t of tones; track t.id) {
            <button type="button" [class.il-on]="tone() === t.id" (click)="tone.set(t.id)">{{ t.label }}</button>
          }
        </div>
        <button type="button" class="il-btn il-primary il-wide" [disabled]="loading() || !files().length" (click)="generate()">
          <il-icon name="sparkle" [size]="13" /> {{ loading() ? 'Montando…' : 'Gerar post' }}
        </button>
        <p class="il-note">
          @if (loading()) { A IA está olhando as fotos e escolhendo o modelo. }
          @else if (error()) { <span class="il-warn">{{ error() }}</span> }
          @else if (done()) { {{ done() }} }
          @else { Até {{ max }} fotos. A IA escolhe o modelo da marca, reescreve os textos e põe as fotos no lugar. Ctrl+Z desfaz. }
        </p>
      </div>
    </section>
  `,
  styles: [`
    .smp-seg { display: flex; }
    .smp-seg button { flex: 1; width: auto; padding: 0 4px; font-size: 10.5px; }
    .smp-thumbs { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
    .smp-thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; }
  `],
})
export class SocialAiPostPanelComponent {
  readonly generated = output<AiPost>();

  private readonly http = inject(HttpClient);
  private readonly templates = inject(SocialTemplatesService);
  readonly max = AI_POST_MAX_PHOTOS;
  readonly types = AI_POST_TYPES;
  readonly tones = CAPTION_TONES;
  readonly context = lastContext;
  readonly type = lastType;
  readonly tone = lastTone;
  readonly files = signal<File[]>([]);
  readonly thumbs = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly done = signal('');

  async pick(input: HTMLInputElement): Promise<void> {
    const list = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
    input.value = '';
    if (!list.length) return;
    this.error.set(list.length > this.max ? `Usei as ${this.max} primeiras fotos.` : '');
    this.done.set('');
    const chosen = list.slice(0, this.max);
    try {
      this.thumbs.set(await Promise.all(chosen.map(shrinkForAi)));
      this.files.set(chosen);
    } catch {
      this.error.set('Não consegui abrir uma das fotos (HEIC? exporte como JPEG).');
    }
  }

  async generate(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.done.set('');
    try {
      await this.templates.load();
      const entries = this.templates.entries();
      const modelos = entries.map((e) => describeForAi(e, e.build())).filter((m) => m.fotos > 0);
      const r = await firstValueFrom(this.http.post<PostIaResponse>('/api/imagens/post-ia', {
        fotos: this.thumbs(), modelos,
        filtros: FILTER_PRESETS.map((p) => p.id),
        tipo: this.type(), tom: this.tone(), contexto: this.context(), marca: readBrand(),
      }));
      const entry = r.post && entries.find((e) => e.id === r.post!.modeloId);
      if (!r.usouIa || !r.post || !entry) {
        this.error.set(r.motivo || 'A IA não montou o post. Tente de novo.');
        return;
      }
      const files = this.files();
      this.generated.emit({
        entry,
        look: rewriteTexts(entry.build(), r.post.textos),
        files: r.post.ordemFotos.map((i) => files[i]).filter(Boolean),
        preset: r.post.filtro,
        explicacao: r.post.explicacao,
      });
      this.done.set(`${entry.group} "${entry.label}". ${r.post.explicacao} Gere de novo pra outra versão.`);
    } catch (e) {
      const err = e as { error?: { erro?: string } };
      this.error.set(err?.error?.erro ?? 'Não consegui falar com o servidor agora.');
    } finally {
      this.loading.set(false);
    }
  }
}
