/** Painel do "Molde de uma foto": envio da foto, os quatro cantos do papel
 * (arrastáveis) e a revisão das linhas — um clique troca corte → dobra →
 * ignorar. */

import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../../shared/icon';
import { pathsToD } from '../imagem/illustration-model';
import { DecalqueEstado } from './decalque-estado';
import { COR_CORTE, COR_DOBRA } from './folha';

@Component({
  selector: 'app-decalque-painel',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="envio">
      <label class="btn">
        <app-icon name="upload" [size]="14" /> {{ estado.foto() ? 'Trocar foto' : 'Escolher foto ou scan' }}
        <input type="file" accept="image/*" hidden (change)="escolher($event)" />
      </label>
      @if (estado.foto(); as f) {
        <span class="arquivo" [title]="f.nome">{{ f.nome }}</span>
        <button type="button" class="btn-remover" (click)="estado.limpar()" title="Tirar a foto"><app-icon name="x" [size]="14" /></button>
      }
    </div>
    @if (estado.erro()) { <div class="erro">{{ estado.erro() }}</div> }

    @if (estado.foto(); as f) {
      <div class="abas">
        <button type="button" [class.ativa]="aba() === 'cantos'" (click)="aba.set('cantos')">1. Cantos do papel</button>
        <button type="button" [class.ativa]="aba() === 'linhas'" (click)="aba.set('linhas')">
          2. Linhas
          @if (estado.processando()) { <span class="girando">…</span> }
        </button>
      </div>

      @if (aba() === 'cantos') {
        <p class="ajuda">Arraste as bolinhas até os cantos do papel. É deles que sai a escala e o endireitamento da foto.</p>
        <svg #palco class="palco" [attr.viewBox]="'0 0 ' + f.cinza.w + ' ' + f.cinza.h"
             (pointermove)="arrastar($event, palco)" (pointerup)="soltar()" (pointerleave)="soltar()">
          <image [attr.href]="f.src" x="0" y="0" [attr.width]="f.cinza.w" [attr.height]="f.cinza.h" />
          @if (estado.cantos(); as c) {
            <polygon [attr.points]="poligono()" class="quadro" [attr.stroke-width]="raio() / 4" />
            @for (p of c; track $index) {
              <circle [attr.cx]="p[0]" [attr.cy]="p[1]" [attr.r]="raio()" class="canto" [attr.stroke-width]="raio() / 4"
                      (pointerdown)="pegar($event, $index)" />
            }
          }
        </svg>
        <div class="linha-botoes">
          <button type="button" class="btn" (click)="estado.detectarCantos()">Procurar o papel</button>
          <button type="button" class="btn" (click)="estado.imagemInteira()">Usar a imagem inteira (scan)</button>
          <button type="button" class="btn destaque" (click)="aba.set('linhas')">Revisar linhas</button>
        </div>
      } @else {
        @if (estado.resultado(); as r) {
          <p class="ajuda">
            Clique numa linha para trocar: <b [style.color]="corCorte">corte</b> → <b [style.color]="corDobra">dobra</b> → <b class="cinza">ignorar</b>.
            {{ contagem().corte }} de corte, {{ contagem().dobra }} de dobra{{ contagem().ignorar ? ', ' + contagem().ignorar + ' ignoradas' : '' }}.
          </p>
          <svg class="palco" [attr.viewBox]="'0 0 ' + r.w + ' ' + r.h">
            @if (estado.retificada(); as src) {
              <image [attr.href]="src" x="0" y="0" [attr.width]="r.w" [attr.height]="r.h" opacity="0.45" />
            }
            @for (l of linhas(); track l.id) {
              <path [attr.d]="l.d" class="linha" [class.ignorada]="l.tipo === 'ignorar'" [attr.stroke]="l.cor"
                    [attr.stroke-dasharray]="l.tipo === 'dobra' ? '2 1.2' : null" />
              <path [attr.d]="l.d" class="alvo" (click)="estado.alternar(l.id, l.sugerido)">
                <title>{{ l.tipo }} (clique para trocar)</title>
              </path>
            }
          </svg>
          @for (a of r.avisos; track a) { <div class="aviso">{{ a }}</div> }
        } @else if (estado.processando()) {
          <p class="ajuda">Lendo as linhas…</p>
        }
      }
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 10px; }
    .envio, .linha-botoes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .arquivo { font-size: 12.5px; color: var(--text); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn { padding: 7px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 12.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    .btn:hover { border-color: var(--accent); color: var(--accent); }
    .btn.destaque { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
    .btn-remover { border: none; background: none; color: var(--text-muted); cursor: pointer; display: inline-flex; padding: 4px; }
    .btn-remover:hover { color: var(--danger); }
    .abas { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
    .abas button { border: none; background: none; padding: 7px 10px; font-size: 12.5px; font-weight: 600; color: var(--text-muted); border-bottom: 2px solid transparent; cursor: pointer; }
    .abas button.ativa { color: var(--text); border-bottom-color: var(--accent); }
    .girando { margin-left: 4px; }
    .ajuda { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 0; }
    .cinza { color: var(--text-muted); }
    .palco { width: 100%; height: auto; max-height: 60vh; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-sm); touch-action: none; display: block; }
    .quadro { fill: rgba(31, 111, 229, 0.08); stroke: #1f6fe5; }
    .canto { fill: #ffffff; stroke: #1f6fe5; cursor: grab; }
    .linha { fill: none; stroke-width: 0.6; pointer-events: none; }
    .linha.ignorada { stroke: #9a9a9a; stroke-dasharray: 0.8 1.2; }
    .alvo { fill: none; stroke: transparent; stroke-width: 4; cursor: pointer; pointer-events: stroke; }
    .alvo:hover { stroke: rgba(255, 200, 0, 0.35); }
    .aviso { background: color-mix(in srgb, var(--atencao) 12%, transparent); color: var(--atencao); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 12px; }
    .erro { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 12px; }
  `],
})
export class DecalquePainelComponent {
  readonly estado = inject(DecalqueEstado);
  readonly aba = signal<'cantos' | 'linhas'>('cantos');
  readonly corCorte = COR_CORTE;
  readonly corDobra = COR_DOBRA;
  private arrastando: number | null = null;

  readonly raio = computed(() => {
    const f = this.estado.foto();
    return f ? Math.max(f.cinza.w, f.cinza.h) / 70 : 10;
  });

  readonly poligono = computed(() => (this.estado.cantos() ?? []).map((p) => p.join(',')).join(' '));

  readonly linhas = computed(() => {
    const r = this.estado.resultado();
    if (!r) return [];
    return r.linhas.map((l) => {
      const tipo = this.estado.tipoDe(l.id, l.tipo);
      return { id: l.id, sugerido: l.tipo, tipo, d: pathsToD([l.path]), cor: tipo === 'corte' ? COR_CORTE : tipo === 'dobra' ? COR_DOBRA : '#9a9a9a' };
    });
  });

  readonly contagem = computed(() => {
    const c = { corte: 0, dobra: 0, ignorar: 0 };
    for (const l of this.linhas()) c[l.tipo]++;
    return c;
  });

  async escolher(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.estado.carregar(file);
    this.aba.set('cantos');
  }

  pegar(ev: PointerEvent, i: number): void {
    ev.preventDefault();
    this.arrastando = i;
  }

  arrastar(ev: PointerEvent, svg: Element): void {
    if (this.arrastando === null) return;
    const m = (svg as SVGSVGElement).getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    this.estado.moverCanto(this.arrastando, [p.x, p.y]);
  }

  soltar(): void {
    this.arrastando = null;
  }
}
