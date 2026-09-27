/** Legenda com IA, na aba Exportar do modo Redes sociais: a IA olha o post
 * como ele vai sair, lê os textos da arte e o perfil da marca, e devolve três
 * opções de legenda com hashtags, prontas pra editar e copiar.
 *
 * O perfil da marca fica guardado neste aparelho; vem preenchido com o da
 * Viih Mimos. */

import { HttpClient } from '@angular/common/http';
import { Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IlIconComponent } from './illustration-icons';
import { SocialStore } from './social-store';
import { VM_INSTAGRAM, VM_WHATSAPP } from './social-templates';

export interface CaptionOption {
  texto: string;
  hashtags: string[];
}

interface CaptionResponse {
  legendas: CaptionOption[];
  usouIa: boolean;
  motivo: string | null;
}

export const CAPTION_TONES = [
  { id: 'carinhoso', label: 'Carinhoso' },
  { id: 'divertido', label: 'Divertido' },
  { id: 'vendedor', label: 'Vendedor' },
  { id: 'informativo', label: 'Informativo' },
] as const;

export const DEFAULT_BRAND_PROFILE = [
  'Viih Mimos — papelaria personalizada feita à mão em Marabá-PA: topo de bolo, kit festa, caixinhas, convites e agendas.',
  'Voz: minúsculas, próxima e carinhosa; emojis 🎀 💕 com moderação.',
  `Instagram ${VM_INSTAGRAM} · WhatsApp ${VM_WHATSAPP} (wa.me/5591993731794).`,
  'Produção em até 5 dias úteis depois da arte aprovada.',
  'Hashtags da casa: #viihmimos #papelariapersonalizada #maraba #marabapa',
].join('\n');

const BRAND_KEY = 'imagem-legenda-marca';

/** Texto final pra colar no Instagram: legenda, linha em branco, hashtags. */
export function captionText(o: CaptionOption): string {
  return o.hashtags.length ? `${o.texto}\n\n${o.hashtags.join(' ')}` : o.texto;
}

/** Tipo de post que a IA precisa saber pra acertar o tamanho da legenda. */
export function captionFormat(formatId: string, slides: number): 'story' | 'feed' | 'carrossel' {
  if (slides > 1) return 'carrossel';
  return formatId === 'story' ? 'story' : 'feed';
}

function readBrand(): string {
  try {
    return localStorage.getItem(BRAND_KEY) ?? DEFAULT_BRAND_PROFILE;
  } catch {
    return DEFAULT_BRAND_PROFILE;
  }
}

// As opções sobrevivem à troca de aba: gerar custa, e perder o resultado por
// ter ido olhar os filtros seria desperdício.
const lastOptions = signal<string[]>([]);
const lastContext = signal('');
const lastTone = signal<string>('carinhoso');

@Component({
  selector: 'sm-caption-panel',
  standalone: true,
  imports: [IlIconComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="il-sec">
      <div class="il-sec-head il-sec-static"><il-icon name="sparkle" [size]="13" /> Legenda com IA</div>
      <div class="il-sec-body">
        <label class="smc-label" for="smc-contexto">Sobre o post <small>(opcional)</small></label>
        <textarea id="smc-contexto" class="il-textarea" rows="2" [value]="context()" (input)="context.set($any($event.target).value)"
          placeholder="ex.: topo de bolo de unicórnio pra festa da Alice, 5 anos"></textarea>
        <div class="il-seg smc-tones" role="group" aria-label="Tom da legenda">
          @for (t of tones; track t.id) {
            <button type="button" [class.il-on]="tone() === t.id" (click)="tone.set(t.id)">{{ t.label }}</button>
          }
        </div>
        <button type="button" class="il-link smc-more" (click)="showBrand.set(!showBrand())">
          <il-icon name="chevron" [size]="12" [class.smc-up]="showBrand()" /> Perfil da marca
        </button>
        @if (showBrand()) {
          <textarea class="il-textarea" rows="6" aria-label="Perfil da marca" [value]="brand()" (input)="setBrand($any($event.target).value)"></textarea>
          <div class="il-row">
            <p class="il-note il-grow">Fica salvo neste aparelho. A IA segue a voz e usa os contatos daqui.</p>
            <button type="button" class="il-btn" (click)="setBrand(defaultBrand)">Restaurar</button>
          </div>
        }
        <button type="button" class="il-btn il-primary il-wide" [disabled]="loading() || !store.hasContent()" (click)="generate()">
          <il-icon name="sparkle" [size]="13" /> {{ loading() ? 'Escrevendo…' : (options().length ? 'Gerar outras' : 'Gerar legendas') }}
        </button>
        <p class="il-note">
          @if (loading()) { A IA está olhando o post; leva alguns segundos. }
          @else if (error()) { <span class="il-warn">{{ error() }}</span> }
          @else if (!options().length) { A IA vê o post como vai sair e escreve {{ formatLabel() }}. Cada geração usa a chave de IA de Configurações. }
        </p>
        @for (o of options(); track $index) {
          <div class="smc-option">
            <textarea class="il-textarea smc-text" rows="7" [attr.aria-label]="'Legenda ' + ($index + 1)" [value]="o" (input)="edit($index, $any($event.target).value)"></textarea>
            <div class="il-row">
              <small class="il-note il-grow">{{ o.length }} / 2200</small>
              <button type="button" class="il-btn" (click)="copy($index)">{{ copied() === $index ? 'Copiada!' : 'Copiar' }}</button>
            </div>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .smc-label { font-size: 11px; font-weight: 600; color: var(--text-muted); }
    .smc-tones { display: flex; }
    .smc-tones button { flex: 1; width: auto; padding: 0 4px; font-size: 10.5px; }
    .smc-more { margin: 2px 0; justify-content: flex-start; }
    .smc-up { transform: rotate(180deg); }
    .smc-option { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; border-top: 1px solid var(--il-line); }
    .smc-text { font-size: 12px; line-height: 1.45; }
  `],
})
export class SocialCaptionPanelComponent {
  /** Prévia do post em JPEG (data URL), feita pelo modo — é o que a IA vê. */
  readonly preview = input.required<() => Promise<string | null>>();

  readonly store = inject(SocialStore);
  private readonly http = inject(HttpClient);
  readonly tones = CAPTION_TONES;
  readonly defaultBrand = DEFAULT_BRAND_PROFILE;
  readonly options = lastOptions;
  readonly context = lastContext;
  readonly tone = lastTone;
  readonly brand = signal(readBrand());
  readonly showBrand = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly copied = signal<number | null>(null);

  readonly formatLabel = computed(() => {
    const f = captionFormat(this.store.format().id, this.store.slides());
    return f === 'story' ? 'textos curtos de story' : f === 'carrossel' ? 'legendas de carrossel' : 'legendas de feed';
  });

  setBrand(value: string): void {
    this.brand.set(value);
    try {
      localStorage.setItem(BRAND_KEY, value);
    } catch { /* só conveniência */ }
  }

  async generate(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const imagem = await this.preview()();
      const textos = this.store.overlays().flatMap((o) => (o.kind === 'texto' ? [o.text] : []));
      const r = await firstValueFrom(this.http.post<CaptionResponse>('/api/imagens/legenda', {
        imagem, textos,
        formato: captionFormat(this.store.format().id, this.store.slides()),
        tom: this.tone(), contexto: this.context(), marca: this.brand(),
      }));
      if (!r.usouIa || !r.legendas.length) {
        this.error.set(r.motivo || 'A IA não devolveu legendas. Tente de novo.');
        return;
      }
      this.options.set(r.legendas.map(captionText));
      this.copied.set(null);
    } catch (e) {
      const err = e as { error?: { erro?: string } };
      this.error.set(err?.error?.erro ?? 'Não consegui falar com o servidor agora.');
    } finally {
      this.loading.set(false);
    }
  }

  edit(i: number, value: string): void {
    this.options.update((l) => l.map((o, k) => (k === i ? value : o)));
  }

  async copy(i: number): Promise<void> {
    const text = this.options()[i] ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Sem permissão de área de transferência (HTTP puro): cai no jeito antigo.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    this.copied.set(i);
    setTimeout(() => { if (this.copied() === i) this.copied.set(null); }, 1800);
  }
}
