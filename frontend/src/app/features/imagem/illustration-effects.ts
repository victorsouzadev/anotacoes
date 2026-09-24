/** Seções do painel Propriedades pra pintura além da cor: preenchimento em
 * degradê ou padrão, efeitos (contorno, contorno duplo, sombra) e máscara de
 * recorte. Separadas do painel pra ele não virar um arquivo só. */

import { Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { IlIconComponent } from './illustration-icons';
import { EffectStroke, FillPaint, Layer, LayerEffects, PatternKind } from './illustration-model';
import { IlNumComponent, NumChange } from './illustration-num';
import { PATTERNS } from './illustration-paint';
import { IllustrationStore } from './illustration-store';

type FillMode = 'solido' | 'degrade' | 'padrao';

const GRADIENTS: [string, string][] = [
  ['#ff9a9e', '#fad0c4'], ['#a18cd1', '#fbc2eb'], ['#f6d365', '#fda085'], ['#84fab0', '#8fd3f4'],
  ['#fccb90', '#d57eeb'], ['#e0c3fc', '#8ec5fc'], ['#f093fb', '#f5576c'], ['#c79081', '#dfa579'],
];

@Component({
  selector: 'il-effects',
  standalone: true,
  imports: [IlIconComponent, IlNumComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (layer(); as l) {
      <section class="il-sec">
        <div class="il-sec-head il-sec-static">Preenchimento</div>
        <div class="il-sec-body">
          <div class="il-seg ilx-seg">
            <button type="button" [class.il-on]="mode() === 'solido'" (click)="setMode('solido')">Cor sólida</button>
            <button type="button" [class.il-on]="mode() === 'degrade'" (click)="setMode('degrade')">Degradê</button>
            <button type="button" [class.il-on]="mode() === 'padrao'" (click)="setMode('padrao')">Padrão</button>
          </div>
          @if (l.paint; as p) {
            @if (p.type !== 'pattern') {
              <div class="il-row">
                <div class="il-seg ilx-seg">
                  <button type="button" [class.il-on]="p.type === 'linear'" (click)="patchPaint({ type: 'linear' })">Linear</button>
                  <button type="button" [class.il-on]="p.type === 'radial'" (click)="patchPaint({ type: 'radial' })">Radial</button>
                </div>
                <input type="color" class="il-color-input" [value]="p.stops[0].color" aria-label="Cor inicial" (input)="stopColor(0, $event)" (change)="store.commitLive()" />
                <input type="color" class="il-color-input" [value]="p.stops[p.stops.length - 1].color" aria-label="Cor final" (input)="stopColor(1, $event)" (change)="store.commitLive()" />
              </div>
              @if (p.type === 'linear') {
                <il-num label="Ângulo" unit="°" [value]="p.angle" [min]="-360" [max]="360" [decimals]="0" (valueChange)="num('angle', $event)" (done)="store.commitLive()" />
              }
              <div class="il-swatches">
                @for (g of gradients; track $index) {
                  <button type="button" class="il-swatch" [style.background]="'linear-gradient(135deg,' + g[0] + ',' + g[1] + ')'" [attr.aria-label]="'Degradê ' + ($index + 1)" (click)="pickGradient(g)"></button>
                }
              </div>
            } @else {
              <div class="il-grid2">
                <select class="il-select" [value]="p.pattern" aria-label="Padrão" (change)="patchPaint({ pattern: $any($event.target).value })">
                  @for (pt of patterns; track pt.id) { <option [value]="pt.id">{{ pt.label }}</option> }
                </select>
                <div class="il-row il-row-tight">
                  <input type="color" class="il-color-input" [value]="p.color" aria-label="Cor do padrão" (input)="patternColor('color', $event)" (change)="store.commitLive()" />
                  <input type="color" class="il-color-input" [value]="p.bg ?? '#ffffff'" aria-label="Fundo do padrão" (input)="patternColor('bg', $event)" (change)="store.commitLive()" />
                  <button type="button" class="il-ib il-ib-sm" [class.il-on]="!p.bg" data-tip="Fundo transparente" aria-label="Fundo transparente" (click)="patchPaint({ bg: null })"><il-icon name="none" [size]="13" /></button>
                </div>
                <il-num label="Tam." title="Tamanho da célula" unit="mm" [value]="p.sizeMm" [step]="0.5" [min]="0.5" [max]="200" (valueChange)="num('sizeMm', $event)" (done)="store.commitLive()" />
                <il-num label="Giro" unit="°" [value]="p.angle" [min]="-360" [max]="360" [decimals]="0" (valueChange)="num('angle', $event)" (done)="store.commitLive()" />
              </div>
            }
          }
        </div>
      </section>

      <section class="il-sec">
        <div class="il-sec-head il-sec-static">Efeitos</div>
        <div class="il-sec-body">
          <div class="il-row ilx-fx">
            <label class="il-check"><input type="checkbox" [checked]="!!l.effects?.outline" (change)="toggleStroke('outline', '#ffffff', 1.2)" /> Contorno</label>
            @if (l.effects?.outline; as o) {
              <input type="color" class="il-color-input" [value]="o.color" aria-label="Cor do contorno" (input)="strokeColor('outline', o, $event)" (change)="store.commitLive()" />
              <il-num label="" title="Espessura do contorno" unit="mm" [value]="o.widthMm" [step]="0.1" [min]="0.1" [max]="30" [decimals]="1" (valueChange)="strokeWidth('outline', o, $event)" (done)="store.commitLive()" />
            }
          </div>
          <div class="il-row ilx-fx">
            <label class="il-check"><input type="checkbox" [checked]="!!l.effects?.outline2" (change)="toggleStroke('outline2', '#3b2a4a', 1)" /> Contorno duplo</label>
            @if (l.effects?.outline2; as o) {
              <input type="color" class="il-color-input" [value]="o.color" aria-label="Cor do segundo contorno" (input)="strokeColor('outline2', o, $event)" (change)="store.commitLive()" />
              <il-num label="" title="Espessura do segundo contorno" unit="mm" [value]="o.widthMm" [step]="0.1" [min]="0.1" [max]="30" [decimals]="1" (valueChange)="strokeWidth('outline2', o, $event)" (done)="store.commitLive()" />
            }
          </div>
          <div class="il-row ilx-fx">
            <label class="il-check"><input type="checkbox" [checked]="!!l.effects?.shadow" (change)="toggleShadow()" /> Sombra</label>
            @if (l.effects?.shadow; as sh) {
              <input type="color" class="il-color-input" [value]="sh.color" aria-label="Cor da sombra" (input)="shadow({ color: $any($event.target).value }, true)" (change)="store.commitLive()" />
            }
          </div>
          @if (l.effects?.shadow; as sh) {
            <div class="il-grid2">
              <il-num label="X" title="Deslocamento horizontal da sombra" unit="mm" [value]="sh.dx" [step]="0.1" [min]="-50" [max]="50" (valueChange)="shadow({ dx: $event.value }, $event.live)" (done)="store.commitLive()" />
              <il-num label="Y" title="Deslocamento vertical da sombra" unit="mm" [value]="sh.dy" [step]="0.1" [min]="-50" [max]="50" (valueChange)="shadow({ dy: $event.value }, $event.live)" (done)="store.commitLive()" />
              <il-num label="Opac." unit="%" [value]="sh.opacity * 100" [min]="5" [max]="100" [decimals]="0" (valueChange)="shadow({ opacity: $event.value / 100 }, $event.live)" (done)="store.commitLive()" />
            </div>
          }
          <button type="button" class="il-btn il-wide" data-help="Contorno branco e um segundo contorno escuro, como em topo de bolo e adesivo" (click)="cakeTopper()"><il-icon name="sparkle" [size]="13" /> Estilo topo de bolo</button>
        </div>
      </section>
    }

    @if (store.clipCandidate() || store.canReleaseClip()) {
      <section class="il-sec">
        <div class="il-sec-head il-sec-static">Máscara de recorte</div>
        <div class="il-sec-body">
          @if (store.clipCandidate(); as m) {
            <button type="button" class="il-btn il-wide" (click)="store.makeClip()"><il-icon name="clip" [size]="13" /> Recortar com "{{ m.name }}"</button>
            <p class="il-note">A camada de cima vira a moldura: só o que estiver dentro dela aparece — foto dentro do coração, textura dentro da letra.</p>
          }
          @if (store.canReleaseClip()) {
            <button type="button" class="il-btn il-wide" (click)="store.releaseClip()">Soltar máscara</button>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .ilx-seg button { width: auto; padding: 0 9px; font-size: 11px; }
    .ilx-fx { min-height: 26px; }
    .ilx-fx .il-check { flex: 1; }
    .ilx-fx il-num { width: 84px; }
  `],
})
export class IlEffectsComponent {
  readonly store = inject(IllustrationStore);
  readonly patterns = PATTERNS;
  readonly gradients = GRADIENTS;

  /** A camada que o painel mostra (a principal), se for vetor. */
  layer = computed<Layer | null>(() => {
    const l = this.store.primary();
    return l && l.kind !== 'imagem' && !l.mask ? l : null;
  });

  mode = computed<FillMode>(() => {
    const p = this.layer()?.paint;
    return !p ? 'solido' : p.type === 'pattern' ? 'padrao' : 'degrade';
  });

  setMode(mode: FillMode): void {
    const l = this.layer();
    if (!l || mode === this.mode()) return;
    const base = l.fill ?? '#6d5ef8';
    if (mode === 'solido') this.store.setFillPaint(null);
    else if (mode === 'degrade') this.store.setFillPaint({ type: 'linear', angle: 90, stops: [{ offset: 0, color: base }, { offset: 1, color: '#ffffff' }] });
    else this.store.setFillPaint({ type: 'pattern', pattern: 'bolinhas', color: base, bg: '#ffffff', sizeMm: 6, angle: 0 });
  }

  patchPaint(patch: Partial<FillPaint> & { pattern?: PatternKind }, live = false): void {
    const p = this.layer()?.paint;
    if (!p) return;
    this.store.setFillPaint({ ...p, ...patch } as FillPaint, live);
  }

  num(key: 'angle' | 'sizeMm', e: NumChange): void {
    this.patchPaint({ [key]: e.value } as Partial<FillPaint>, e.live);
  }

  stopColor(i: 0 | 1, event: Event): void {
    const p = this.layer()?.paint;
    if (!p || p.type === 'pattern') return;
    const color = (event.target as HTMLInputElement).value;
    const stops = p.stops.map((s, k) => (k === (i === 0 ? 0 : p.stops.length - 1) ? { ...s, color } : s));
    this.patchPaint({ stops }, true);
  }

  pickGradient(g: [string, string]): void {
    const p = this.layer()?.paint;
    if (!p || p.type === 'pattern') return;
    this.patchPaint({ stops: [{ offset: 0, color: g[0] }, { offset: 1, color: g[1] }] });
  }

  patternColor(key: 'color' | 'bg', event: Event): void {
    this.patchPaint({ [key]: (event.target as HTMLInputElement).value } as Partial<FillPaint>, true);
  }

  toggleStroke(key: 'outline' | 'outline2', color: string, widthMm: number): void {
    const cur = this.layer()?.effects?.[key];
    this.store.setEffects({ [key]: cur ? null : { color, widthMm } });
  }

  strokeColor(key: 'outline' | 'outline2', o: EffectStroke, event: Event): void {
    this.store.setEffects({ [key]: { ...o, color: (event.target as HTMLInputElement).value } }, true);
  }

  strokeWidth(key: 'outline' | 'outline2', o: EffectStroke, e: NumChange): void {
    this.store.setEffects({ [key]: { ...o, widthMm: e.value } }, e.live);
  }

  toggleShadow(): void {
    const cur = this.layer()?.effects?.shadow;
    this.store.setEffects({ shadow: cur ? null : { color: '#000000', dx: 0.8, dy: 0.8, opacity: 0.35 } });
  }

  shadow(patch: Partial<NonNullable<LayerEffects['shadow']>>, live: boolean): void {
    const cur = this.layer()?.effects?.shadow;
    if (!cur) return;
    this.store.setEffects({ shadow: { ...cur, ...patch } }, live);
    if (!live) this.store.commitLive();
  }

  cakeTopper(): void {
    this.store.setEffects({ outline: { color: '#ffffff', widthMm: 1.5 }, outline2: { color: '#3b2a4a', widthMm: 1 } });
  }
}
