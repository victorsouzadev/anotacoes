import { Component, EventEmitter, Input, Output, computed, input } from '@angular/core';
import { IconComponent, IconName } from '../../../shared/icon';
import { Midia, TipoMidia, tamanhoLegivel } from '../estudio.models';
import { Visualizador3dComponent } from './visualizador-3d';

export const ICONE_DO_TIPO: Record<TipoMidia, IconName> = {
  imagem: 'image', video: 'film', audio: 'music', modelo3d: 'box', mundo: 'globe', documento: 'file',
};

export const NOME_DO_TIPO: Record<TipoMidia, string> = {
  imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', modelo3d: 'Modelo 3D', mundo: 'Mundo 3D', documento: 'Documento',
};

export function duracaoLegivel(seg: number | null): string {
  if (seg == null) return '';
  const m = Math.floor(seg / 60);
  const s = Math.round(seg % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Cartão de um arquivo da biblioteca (miniatura, nome, duração). */
@Component({
  selector: 'e-midia-card',
  standalone: true,
  imports: [IconComponent],
  template: `
    @let m = midia();
    <button type="button" class="mc" [class.mc-sel]="selecionada()" (click)="escolher.emit(m)" [title]="m.nome">
      <span class="mc-img">
        @if (m.thumb) {
          <img [src]="m.thumb" alt="" loading="lazy" />
        } @else if (m.tipo === 'imagem') {
          <img [src]="m.url" alt="" loading="lazy" />
        } @else {
          <app-icon [name]="icone()" [size]="30" />
        }
        @if (m.tipo === 'video' || m.tipo === 'audio') { <span class="mc-dur">{{ duracao() }}</span> }
        @if (m.tipo !== 'imagem') { <span class="mc-tipo"><app-icon [name]="icone()" [size]="11" /></span> }
        @if (selecionada()) { <span class="mc-check"><app-icon name="check" [size]="14" /></span> }
      </span>
      <span class="mc-nome">{{ m.nome }}</span>
    </button>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .mc { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 0; border: none; background: none; text-align: left; }
    .mc-img {
      position: relative; display: flex; align-items: center; justify-content: center; aspect-ratio: 1; width: 100%;
      border-radius: var(--radius-sm); overflow: hidden; background: var(--tag-bg); color: var(--text-muted);
      border: 2px solid transparent; transition: border-color .12s;
      background-image: linear-gradient(45deg, rgba(0,0,0,.04) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.04) 75%), linear-gradient(45deg, rgba(0,0,0,.04) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.04) 75%);
      background-size: 16px 16px; background-position: 0 0, 8px 8px;
    }
    .mc:hover .mc-img { border-color: var(--border); }
    .mc-sel .mc-img { border-color: var(--accent); }
    .mc-img img { width: 100%; height: 100%; object-fit: cover; }
    .mc-dur, .mc-tipo { position: absolute; bottom: 6px; padding: 2px 6px; border-radius: 6px; background: rgba(0,0,0,.6); color: #fff; font-size: 11px; font-weight: 600; display: flex; }
    .mc-dur { right: 6px; }
    .mc-tipo { left: 6px; padding: 3px; }
    .mc-check { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--accent-contrast); display: flex; align-items: center; justify-content: center; }
    .mc-nome { font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `],
})
export class MidiaCardComponent {
  readonly midia = input.required<Midia>();
  readonly selecionada = input(false);
  @Output() escolher = new EventEmitter<Midia>();
  readonly icone = computed(() => ICONE_DO_TIPO[this.midia().tipo]);
  readonly duracao = computed(() => duracaoLegivel(this.midia().duracaoSeg));
}

/** O arquivo em tamanho grande: imagem, player de vídeo/áudio, 3D ou ficha do documento. */
@Component({
  selector: 'e-midia-visor',
  standalone: true,
  imports: [IconComponent, Visualizador3dComponent],
  template: `
    @switch (midia.tipo) {
      @case ('imagem') { <img class="mv-img" [src]="midia.url" [alt]="midia.nome" /> }
      @case ('video') { <video class="mv-video" [src]="midia.url" controls playsinline [poster]="midia.thumb ?? ''"></video> }
      @case ('audio') {
        <div class="mv-audio"><app-icon name="music" [size]="40" /><audio [src]="midia.url" controls></audio></div>
      }
      @case ('modelo3d') { <e-visualizador-3d class="mv-3d" [url]="midia.url" tipo="modelo3d" [nome]="midia.nome" /> }
      @case ('mundo') { <e-visualizador-3d class="mv-3d" [url]="midia.url" tipo="mundo" [nome]="midia.nome" /> }
      @default {
        <div class="mv-doc">
          <app-icon name="file" [size]="44" />
          <strong>{{ midia.nome }}</strong>
          <span class="e-muted">{{ tamanho() }}</span>
        </div>
      }
    }
  `,
  styles: [`
    :host { display: flex; align-items: center; justify-content: center; min-height: 200px; }
    .mv-img, .mv-video { max-width: 100%; max-height: 70vh; border-radius: var(--radius-sm); display: block; }
    .mv-video { width: 100%; background: #000; }
    .mv-audio, .mv-doc { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 30px; color: var(--text-muted); width: 100%; }
    .mv-audio audio { width: 100%; max-width: 480px; }
    .mv-doc strong { color: var(--text); word-break: break-all; text-align: center; }
    .mv-3d { width: 100%; height: min(60vh, 520px); border-radius: var(--radius-sm); }
    .e-muted { color: var(--text-muted); font-size: 12px; }
  `],
})
export class MidiaVisorComponent {
  @Input({ required: true }) midia!: Midia;
  tamanho(): string {
    return tamanhoLegivel(this.midia.tamanho);
  }
}
