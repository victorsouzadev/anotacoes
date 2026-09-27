/** Aba "Modelos" do modo Redes sociais: os modelos da Viih Mimos que vêm no
 * editor e os do usuário, separados em story, feed e carrossel. A miniatura é
 * o próprio modelo desenhado pelo mesmo caminho da prévia, então o que se vê
 * aqui é o que entra no palco.
 *
 * Também é onde o post aberto vira modelo: salvar por cima de um modelo pronto
 * cria a versão editada dele (o original volta com "Restaurar"), e "Salvar
 * como novo" acrescenta um modelo à galeria. Tudo fica na conta. */

import {
  Component, ElementRef, ViewEncapsulation, computed, effect, inject, output, signal, untracked, viewChildren,
} from '@angular/core';
import { IlIconComponent } from './illustration-icons';
import { SocialStore, TemplateLook } from './social-store';
import { TemplateGroup } from './social-templates';
import { NEUTRAL, SOCIAL_FORMATS } from './social-model';
import { paintFrame } from './social-render';
import { drawOverlays, ensureOverlayAssets, ensureOverlayFonts } from './social-overlays';
import { ensureBrandAssets } from './brand-assets';
import { FontLibrary } from './fonts';
import { CustomTemplateData, GalleryEntry, SocialTemplatesService, groupFor } from './social-templates.service';

/** Largura de um post na miniatura; o carrossel ocupa a linha inteira. */
const THUMB_POST_W = 132;
const GROUPS: TemplateGroup[] = ['Story', 'Feed', 'Carrossel'];

@Component({
  selector: 'sm-template-gallery',
  standalone: true,
  imports: [IlIconComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (store.hasContent()) {
      <section class="il-sec">
        <div class="il-sec-head il-sec-static"><il-icon name="save" [size]="13" /> Salvar como modelo</div>
        <div class="il-sec-body">
          @if (current(); as c) {
            <button type="button" class="il-btn il-primary il-wide" [disabled]="busy()" (click)="saveOver(c)">
              Salvar alterações em "{{ c.label }}"
            </button>
          }
          @if (naming()) {
            <div class="il-row">
              <input #nameInput class="il-grow smt-name" type="text" maxlength="120" [value]="newName()" aria-label="Nome do modelo"
                (input)="newName.set($any($event.target).value)" (keydown.enter)="saveNew()" (keydown.escape)="naming.set(false)" />
              <button type="button" class="il-btn il-primary" [disabled]="busy() || !newName().trim()" (click)="saveNew()">Salvar</button>
              <button type="button" class="il-btn" (click)="naming.set(false)">Cancelar</button>
            </div>
            <p class="il-note">Vai para "{{ newGroup() }}".</p>
          } @else {
            <button type="button" class="il-btn il-wide" [disabled]="busy()" (click)="startNew()"><il-icon name="plus" [size]="13" /> Salvar como novo modelo</button>
          }
          <p class="il-note">
            @if (message()) { {{ message() }} }
            @else { O modelo guarda formato, fundo, espaço da foto e textos — a foto não vai junto. Fica na sua conta. }
          </p>
        </div>
      </section>
    } @else {
      <p class="il-note smt-intro">Modelos na identidade da Viih Mimos. Escolha um, troque os textos (duplo clique no palco) e salve as mudanças aqui mesmo — ou crie os seus.</p>
    }
    @if (service.error()) { <p class="il-note il-warn smt-intro">{{ service.error() }}</p> }

    @for (g of groups(); track g.name) {
      <section class="il-sec">
        <div class="il-sec-head il-sec-static">{{ g.name }} <small>{{ g.entries.length }}</small></div>
        <div class="il-sec-body">
          <div class="smt-grid">
            @for (t of g.entries; track t.id) {
              <div class="smt-card" [class.smt-wide]="t.slides > 1" [class.il-on]="store.templateId() === t.id">
                <button type="button" class="smt-main" [title]="t.help" [disabled]="busy()" (click)="apply(t)">
                  <canvas #thumb class="smt-thumb" [attr.data-template]="t.id"></canvas>
                  <span class="smt-label">
                    {{ t.label }}
                    @if (t.photo) { <il-icon name="photo-add" [size]="11" /> }
                    @if (t.kind === 'editado') { <em class="smt-badge">editado</em> }
                    @if (t.kind === 'meu') { <em class="smt-badge">seu</em> }
                  </span>
                </button>
                @if (t.custom) {
                  @if (confirming() === t.id) {
                    <div class="smt-confirm" role="alert">
                      <span>{{ t.kind === 'editado' ? 'Voltar ao original?' : 'Excluir este modelo?' }}</span>
                      <button type="button" class="il-btn il-danger" (click)="remove(t)">{{ t.kind === 'editado' ? 'Restaurar' : 'Excluir' }}</button>
                      <button type="button" class="il-btn" (click)="confirming.set(null)">Não</button>
                    </div>
                  } @else if (renaming() === t.id) {
                    <div class="smt-confirm">
                      <input class="il-grow smt-name" type="text" maxlength="120" [value]="t.label" aria-label="Novo nome"
                        (keydown.enter)="rename(t, $any($event.target).value)" (keydown.escape)="renaming.set(null)" (blur)="rename(t, $any($event.target).value)" />
                    </div>
                  } @else {
                    <div class="smt-actions">
                      @if (t.kind === 'meu') {
                        <button type="button" class="il-ib il-ib-sm" data-tip="Renomear" aria-label="Renomear" (click)="renaming.set(t.id)"><il-icon name="pencil" [size]="12" /></button>
                      }
                      <button type="button" class="il-ib il-ib-sm il-danger" [attr.data-tip]="t.kind === 'editado' ? 'Restaurar o original' : 'Excluir'" [attr.aria-label]="t.kind === 'editado' ? 'Restaurar o original' : 'Excluir'" (click)="confirming.set(t.id)">
                        <il-icon [name]="t.kind === 'editado' ? 'undo' : 'trash'" [size]="12" />
                      </button>
                    </div>
                  }
                }
              </div>
            }
          </div>
        </div>
      </section>
    }
  `,
  styles: [`
    .smt-intro { margin: 10px; }
    .smt-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; align-items: end; }
    .smt-card {
      position: relative; display: flex; flex-direction: column; gap: 2px; padding: 5px; border: 1px solid var(--il-line);
      border-radius: 6px; background: var(--il-field); color: var(--text);
    }
    .smt-card:hover { border-color: var(--il-line-strong); }
    .smt-card.il-on { border-color: var(--il-blue); background: var(--il-active); }
    .smt-card.smt-wide { grid-column: 1 / -1; }
    .smt-main { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0; border: none; background: none; color: inherit; cursor: pointer; }
    .smt-thumb { display: block; max-width: 100%; height: auto; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08); }
    .smt-label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); text-align: center; }
    .smt-badge { font-style: normal; font-size: 9px; font-weight: 700; padding: 0 4px; border-radius: 3px; background: #FFE6EE; color: #C2185B; }
    .smt-actions { position: absolute; top: 7px; right: 7px; display: flex; gap: 2px; background: var(--il-chrome); border-radius: 4px; }
    .smt-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 11px; }
    .smt-name {
      min-width: 0; height: 26px; padding: 0 7px; font: inherit; font-size: 12px; color: var(--text);
      background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px;
    }
    .smt-name:focus { outline: none; border-color: var(--il-blue); }
  `],
})
export class SocialTemplateGalleryComponent {
  readonly store = inject(SocialStore);
  readonly service = inject(SocialTemplatesService);
  private readonly fonts = inject(FontLibrary);
  private readonly thumbs = viewChildren<ElementRef<HTMLCanvasElement>>('thumb');
  readonly applied = output<GalleryEntry>();
  readonly busy = signal(false);
  readonly naming = signal(false);
  readonly newName = signal('');
  readonly message = signal('');
  readonly confirming = signal<string | null>(null);
  readonly renaming = signal<string | null>(null);

  readonly groups = computed(() => {
    const entries = this.service.entries();
    return GROUPS.map((name) => ({ name, entries: entries.filter((e) => e.group === name) }));
  });

  /** O modelo de onde o post aberto saiu, se ainda existe. */
  readonly current = computed(() => {
    const id = this.store.templateId();
    return id ? this.service.entry(id) ?? null : null;
  });

  readonly newGroup = computed(() => groupFor(this.store.format().id, this.store.slides()));

  constructor() {
    void this.service.load();
    // Miniaturas: redesenhadas quando a lista muda (modelo salvo, excluído).
    effect(() => {
      const refs = this.thumbs();
      const entries = this.service.entries();
      untracked(() => void this.paintThumbs(refs, entries));
    });
  }

  async apply(t: GalleryEntry): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const look = t.build();
      // Tudo carregado antes de aplicar: senão o primeiro desenho sai sem letra
      // e sem laço, e pisca quando eles chegam.
      await preload(look, this.fonts);
      this.store.applyTemplate(look);
      this.message.set('');
      this.applied.emit(t);
    } finally {
      this.busy.set(false);
    }
  }

  startNew(): void {
    const base = this.current()?.label;
    this.newName.set(base ? `${base} (cópia)` : '');
    this.naming.set(true);
    this.message.set('');
    setTimeout(() => (document.querySelector('.smt-name') as HTMLInputElement | null)?.focus());
  }

  /** Salva o post como a versão editada do modelo de onde ele saiu. */
  async saveOver(c: GalleryEntry): Promise<void> {
    await this.run(async () => {
      const saved = await this.service.save({
        id: c.custom?.id,
        name: c.custom?.name ?? c.label,
        group: c.custom?.group ?? c.group,
        replaces: c.kind === 'meu' ? '' : (c.builtin?.id ?? ''),
        data: this.currentData(),
        thumb: await this.thumbData(),
      });
      this.store.templateId.set(saved.id);
      this.message.set(c.kind === 'editor'
        ? `Pronto: "${c.label}" agora abre com as suas mudanças. O original volta com "Restaurar".`
        : `"${saved.name}" atualizado.`);
    });
  }

  async saveNew(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    await this.run(async () => {
      const saved = await this.service.save({
        name, group: this.newGroup(), replaces: '', data: this.currentData(), thumb: await this.thumbData(),
      });
      this.store.templateId.set(saved.id);
      this.naming.set(false);
      this.message.set(`Modelo "${saved.name}" salvo em ${saved.group}.`);
    });
  }

  async rename(t: GalleryEntry, name: string): Promise<void> {
    if (this.renaming() !== t.id) return;
    this.renaming.set(null);
    const clean = name.trim();
    if (!t.custom || !clean || clean === t.custom.name) return;
    await this.run(() => this.service.rename(t.custom!, clean));
  }

  async remove(t: GalleryEntry): Promise<void> {
    this.confirming.set(null);
    if (!t.custom) return;
    await this.run(async () => {
      await this.service.remove(t.custom!.id);
      // O post aberto continua. Se era a versão editada de um modelo pronto,
      // volta a apontar pro original (e "Salvar alterações" recria a versão).
      if (t.builtin && this.store.templateId() === t.id) this.store.templateId.set(t.builtin.id);
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await work();
    } catch (e) {
      const err = e as { error?: { error?: string } };
      this.message.set(err?.error?.error ?? 'Não consegui salvar agora — confira a conexão e tente de novo.');
    } finally {
      this.busy.set(false);
    }
  }

  /** O post aberto, sem a foto e sem a seleção. */
  private currentData(): CustomTemplateData {
    return {
      version: 1,
      formatId: this.store.format().id,
      slides: this.store.slides(),
      bgColor: this.store.bgColor(),
      bgPattern: this.store.bgPattern(),
      slot: this.store.slot(),
      // Fotos ficam fora do modelo: pesariam demais e são de cada post.
      overlays: this.store.overlays().filter((o) => o.kind !== 'foto'),
    };
  }

  private async thumbData(): Promise<string> {
    const d = this.currentData();
    const look: TemplateLook = { templateId: '', ...d };
    await preload(look, this.fonts);
    const canvas = document.createElement('canvas');
    paintLook(canvas, look, this.fonts, Math.min(480, 160 * d.slides), 1);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  private async paintThumbs(refs: readonly ElementRef<HTMLCanvasElement>[], entries: GalleryEntry[]): Promise<void> {
    const looks = new Map(entries.map((e) => [e.id, e.build()]));
    await Promise.all([...looks.values()].map((l) => preload(l, this.fonts)));
    for (const ref of refs) {
      const canvas = ref.nativeElement;
      const look = looks.get(canvas.dataset['template'] ?? '');
      if (look) paintLook(canvas, look, this.fonts, THUMB_POST_W * look.slides);
    }
  }
}

/** Fontes, arquivos da marca e padrão de fundo de um modelo. */
export async function preload(look: TemplateLook, fonts: FontLibrary): Promise<void> {
  await Promise.all([
    ensureOverlayFonts(look.overlays, fonts),
    ensureOverlayAssets(look.overlays),
    ensureBrandAssets(look.bgPattern ? [look.bgPattern] : []),
  ]);
}

/** Desenha o modelo (sem foto) num canvas da largura pedida. */
export function paintLook(canvas: HTMLCanvasElement, look: TemplateLook, fonts: FontLibrary, width: number, density?: number): void {
  const format = SOCIAL_FORMATS.find((f) => f.id === look.formatId) ?? SOCIAL_FORMATS[0];
  const dpr = density ?? Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round((width / look.slides / format.ratio) * dpr);
  canvas.style.width = `${width}px`;
  paintFrame(canvas, null, {
    adjust: { ...NEUTRAL }, fit: 'cover', scale: 1, dx: 0, dy: 0,
    bgMode: 'cor', bgColor: look.bgColor, bgPattern: look.bgPattern, slot: look.slot,
  });
  drawOverlays(canvas.getContext('2d')!, canvas.width, canvas.height, look.overlays, fonts, null);
}
