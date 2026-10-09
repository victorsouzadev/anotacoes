/** Entrada de imagem dos Moldes, com três caminhos: escolher o arquivo, colar o
 * link (imagem direta ou página, como um pin do Pinterest — o servidor baixa,
 * porque o navegador não pode buscar em outro site) ou colar a própria imagem
 * (Ctrl+V no computador, "Colar" no campo, no celular). */

import { HttpClient } from '@angular/common/http';
import { Component, HostListener, Input, inject, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from '../../shared/icon';

/** Data URL → arquivo, pra seguir o mesmo caminho do arquivo escolhido. */
export async function dataUrlParaArquivo(dataUrl: string, nome: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  return new File([blob], `${nome}.${ext}`, { type: blob.type });
}

export function pareceLink(texto: string): boolean {
  return /^https?:\/\/\S+$/i.test(texto.trim());
}

/** Nome curto pro arquivo baixado: o último pedaço do caminho do link. */
export function nomeDoLink(url: string): string {
  try {
    const u = new URL(url);
    const ultimo = u.pathname.split('/').filter(Boolean).pop();
    if (!ultimo) return u.hostname;
    return decodeURIComponent(ultimo).replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || u.hostname;
  } catch {
    return 'imagem';
  }
}

@Component({
  selector: 'app-entrada-imagem',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="linha">
      <label class="btn">
        <app-icon name="upload" [size]="14" /> {{ rotulo }}
        <input type="file" accept="image/*" hidden (change)="escolher($event)" />
      </label>
      <ng-content />
    </div>
    <div class="linha">
      <input class="colar" type="text" inputmode="url" [value]="link()" [disabled]="baixando()"
             placeholder="…ou cole aqui o link (Pinterest, Google) ou a imagem"
             (input)="link.set($any($event.target).value)" (paste)="colar($event)" (keydown.enter)="baixar()" />
      <button type="button" class="btn" [disabled]="!link().trim() || baixando()" (click)="baixar()">
        <app-icon name="download" [size]="14" /> {{ baixando() ? 'Baixando…' : 'Baixar' }}
      </button>
    </div>
    @if (erro()) { <div class="erro">{{ erro() }}</div> }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 8px; }
    .linha { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .btn { padding: 7px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 12.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; }
    .btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .colar { flex: 1 1 200px; min-width: 0; padding: 7px 10px; border: 1px dashed var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font-size: 12.5px; }
    .colar:focus { border-style: solid; border-color: var(--accent); outline: none; }
    .erro { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 12px; }
  `],
})
export class EntradaImagemComponent {
  private readonly http = inject(HttpClient);
  @Input() rotulo = 'Escolher imagem';
  readonly arquivo = output<File>();
  readonly link = signal('');
  readonly baixando = signal(false);
  readonly erro = signal('');

  escolher(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.entregar(file);
  }

  /** Colar no campo: imagem vai direto; link vai pro download. */
  colar(ev: ClipboardEvent): void {
    if (this.tratarColagem(ev)) ev.preventDefault();
  }

  /** Ctrl+V em qualquer lugar da página (fora de outro campo de texto). */
  @HostListener('window:paste', ['$event'])
  colarNaPagina(ev: ClipboardEvent): void {
    const alvo = ev.target as HTMLElement | null;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    if (this.tratarColagem(ev)) ev.preventDefault();
  }

  private tratarColagem(ev: ClipboardEvent): boolean {
    const dados = ev.clipboardData;
    if (!dados) return false;
    const imagem = Array.from(dados.files).find((f) => f.type.startsWith('image/'))
      ?? Array.from(dados.items).find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
    if (imagem) {
      this.entregar(new File([imagem], imagem.name && imagem.name !== 'image.png' ? imagem.name : 'imagem-colada.png', { type: imagem.type }));
      return true;
    }
    const texto = dados.getData('text/plain').trim();
    if (pareceLink(texto)) {
      this.link.set(texto);
      void this.baixar();
      return true;
    }
    return false;
  }

  async baixar(): Promise<void> {
    const url = this.link().trim();
    if (!url || this.baixando()) return;
    if (!pareceLink(url)) {
      this.erro.set('Cole um link que comece com http:// ou https://.');
      return;
    }
    this.erro.set('');
    this.baixando.set(true);
    try {
      const r = await firstValueFrom(this.http.post<{ imagem: string }>('/api/moldes/imagem-do-link', { url }));
      this.entregar(await dataUrlParaArquivo(r.imagem, nomeDoLink(url)));
      this.link.set('');
    } catch (err: unknown) {
      const e = err as { status?: number; error?: { erro?: string } };
      this.erro.set(
        e.error?.erro
          ?? (e.status === 429 ? 'Muitos downloads seguidos; espere um minuto.' : 'Não consegui baixar a imagem desse link.'),
      );
    } finally {
      this.baixando.set(false);
    }
  }

  private entregar(file: File): void {
    this.erro.set('');
    this.arquivo.emit(file);
  }
}
