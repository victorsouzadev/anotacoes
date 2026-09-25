/** Dock de painéis à direita, com abas, como no Illustrator: Propriedades
 * (contextual — mostra só o que vale pra seleção), Camadas, Vetorizar (o
 * "Rastreamento de imagem") e Exportar. As classes compartilhadas vêm do
 * `app-illustration-mode`. */

import { Component, ElementRef, ViewEncapsulation, computed, effect, inject, output, signal, viewChild } from '@angular/core';
import { pngBlobWithDpi } from './contour';
import { nearestWeight } from './fonts';
import { ALIGN_BUTTONS, PATHFINDER } from './illustration-controlbar';
import { ModeBridge } from './mode-bridge';
import { IlEffectsComponent } from './illustration-effects';
import { buildSvg, canvasToBlob, contentBounds, rasterizeSvg } from './illustration-export';
import { IlFontPickerComponent } from './illustration-font-picker';
import { IlIconComponent, IlIconName } from './illustration-icons';
import { IlLayersComponent } from './illustration-layers';
import { IlNumComponent, NumChange } from './illustration-num';
import { CUT_COLOR, GridSettings, IllustrationStore, PaintTarget } from './illustration-store';
import { IllustrationTracer } from './illustration-tracer';
import { Layer, ShapeLayer, TextAlign, TextCurve, TextLayer, countNodes, normalizeHex } from './illustration-model';
import { jpegToPdf } from './sheet';
import { downloadBlob } from './svg-template';
import { PRESET_LABELS, PresetId, VectorizeParams } from './vectorize';

const EXPORT_DPI = 300;
const OPEN_KEY = 'imagem-ilustracao-paineis';

export type DockTab = 'props' | 'camadas' | 'vetorizar' | 'exportar';

const DOC_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'A4', w: 210, h: 297 },
  { label: 'A4 deitado', w: 297, h: 210 },
  { label: 'A3', w: 297, h: 420 },
  { label: 'Carta', w: 216, h: 279 },
  { label: '10 × 10 cm', w: 100, h: 100 },
  { label: '20 × 20 cm', w: 200, h: 200 },
  { label: '30 × 30 cm', w: 300, h: 300 },
];

/** Amostras fixas, como o painel Amostras: neutros e cores básicas. */
const SWATCHES = [
  '#000000', '#3a3a3a', '#7a7a7a', '#bdbdbd', '#ffffff',
  '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00897b',
  '#1e88e5', '#3949ab', '#8e24aa', '#d81b60', '#6d4c41',
  '#ffcdd2', '#ffe0b2', '#fff9c4', '#c8e6c9', '#bbdefb',
];

const PRESET_ORDER: PresetId[] = ['logo', 'traco', 'clipart', 'foto', 'silhueta', 'centro'];

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

@Component({
  selector: 'app-illustration-panel',
  standalone: true,
  imports: [IlIconComponent, IlNumComponent, IlFontPickerComponent, IlLayersComponent, IlEffectsComponent],
  encapsulation: ViewEncapsulation.None,
  host: { class: 'il-dock' },
  template: `
    <div class="il-tabs" role="tablist">
      @for (t of tabs; track t.id) {
        <button type="button" role="tab" class="il-tab" [class.il-on]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">
          <span>{{ t.label }}</span>
        </button>
      }
    </div>

    <div class="il-tab-body" [class.il-tab-fill]="tab() === 'camadas'">
      @switch (tab()) {
        @case ('props') {
          @if (!store.selection().length) {
            <section class="il-sec" [class.il-closed]="closed('doc')">
              <button type="button" class="il-sec-head" (click)="flip('doc')"><il-icon name="chevron" [size]="12" /> Documento</button>
              <div class="il-sec-body">
                <div class="il-grid2">
                  <il-num label="L" title="Largura" unit="mm" [value]="store.widthMm()" [min]="10" [max]="3000" [decimals]="0" (valueChange)="store.setDocSize(round0($event.value), store.heightMm())" />
                  <il-num label="A" title="Altura" unit="mm" [value]="store.heightMm()" [min]="10" [max]="3000" [decimals]="0" (valueChange)="store.setDocSize(store.widthMm(), round0($event.value))" />
                </div>
                <div class="il-chips">
                  @for (d of docPresets; track d.label) {
                    <button type="button" class="il-chip" [class.il-on]="store.widthMm() === d.w && store.heightMm() === d.h" (click)="store.setDocSize(d.w, d.h)">{{ d.label }}</button>
                  }
                </div>
                <label class="il-check"><input type="checkbox" [checked]="store.snap()" (change)="store.snap.set(!store.snap())" /> Guias inteligentes (atração)</label>
                <div class="il-row">
                  <label class="il-check il-grow"><input type="checkbox" [checked]="store.grid().show" (change)="patchGrid({ show: !store.grid().show })" /> <il-icon name="grid" [size]="13" /> Grade</label>
                  <il-num label="" title="Espaço da grade" unit="mm" [value]="store.grid().stepMm" [step]="1" [min]="1" [max]="200" [decimals]="1" (valueChange)="patchGrid({ stepMm: $event.value })" />
                </div>
                <label class="il-check"><input type="checkbox" [checked]="store.grid().snap" (change)="patchGrid({ snap: !store.grid().snap })" /> Atrair à grade  <small>Ctrl+Shift+'</small></label>
                <div class="il-row">
                  <label class="il-check il-grow"><input type="checkbox" [checked]="store.showGuides()" (change)="store.showGuides.set(!store.showGuides())" /> <il-icon name="guides" [size]="13" /> Guias ({{ store.guides().length }})</label>
                  <button type="button" class="il-btn" [disabled]="!store.guides().length" (click)="store.guides.set([])">Apagar guias</button>
                </div>
                <p class="il-note">Arraste de uma régua pra criar guia; solte de volta na régua pra apagar.</p>
                <div class="il-row">
                  <button type="button" class="il-btn il-grow" [disabled]="!store.layers().length" (click)="fitBoard()"><il-icon name="artboard" [size]="13" /> Ajustar ao desenho</button>
                  <button type="button" class="il-btn il-danger" [disabled]="!store.layers().length" (click)="clearAll()" data-tip="Apagar tudo"><il-icon name="trash" [size]="13" /></button>
                </div>
              </div>
            </section>
          }

          @if (store.selection().length) {
            <section class="il-sec" [class.il-closed]="closed('transform')">
              <button type="button" class="il-sec-head" (click)="flip('transform')"><il-icon name="chevron" [size]="12" /> Transformar</button>
              @if (store.geometry(); as g) {
                <div class="il-sec-body">
                  <div class="il-grid2">
                    <il-num label="X" unit="mm" [value]="g.x" [step]="0.5" (valueChange)="onGeom('x', $event)" (done)="store.commitLive()" />
                    <il-num label="Y" unit="mm" [value]="g.y" [step]="0.5" (valueChange)="onGeom('y', $event)" (done)="store.commitLive()" />
                    <il-num label="L" title="Largura" unit="mm" [value]="g.w" [step]="0.5" [min]="0.1" (valueChange)="onGeom('w', $event)" (done)="store.commitLive()" />
                    <il-num label="A" title="Altura" unit="mm" [value]="g.h" [step]="0.5" [min]="0.1" (valueChange)="onGeom('h', $event)" (done)="store.commitLive()" />
                  </div>
                  <div class="il-row">
                    @if (store.primary(); as l) {
                      <il-num class="il-grow" label="⟳" title="Giro" unit="°" [value]="l.rotation" [decimals]="1" (valueChange)="onRotate($event)" (done)="store.commitLive()" />
                    }
                    <button type="button" class="il-ib" [class.il-on]="store.keepRatio()" data-tip="Manter proporção" aria-label="Manter proporção" (click)="store.keepRatio.set(!store.keepRatio())"><il-icon [name]="store.keepRatio() ? 'link' : 'unlink'" /></button>
                    <button type="button" class="il-ib" data-tip="Espelhar na horizontal" aria-label="Espelhar na horizontal" (click)="store.flip('h')"><il-icon name="flip-h" /></button>
                    <button type="button" class="il-ib" data-tip="Espelhar na vertical" aria-label="Espelhar na vertical" (click)="store.flip('v')"><il-icon name="flip-v" /></button>
                  </div>
                </div>
              }
            </section>
          }

          @if (vectorSel().length || !store.selection().length) {
            <section class="il-sec" [class.il-closed]="closed('appearance')">
              <button type="button" class="il-sec-head" (click)="flip('appearance')"><il-icon name="chevron" [size]="12" /> Aparência{{ store.selection().length ? '' : ' (próximos objetos)' }}</button>
              <div class="il-sec-body">
                @for (p of paints; track p.id) {
                  <div class="il-paint-row" [class.il-on]="store.paintTarget() === p.id">
                    <button type="button" class="il-swatch-btn" [attr.aria-label]="p.label" (click)="openColor(p.id)">
                      <span class="il-sw" [class.il-sw-stroke]="p.id === 'stroke'" [class.il-sw-none]="!paintOf(p.id)" [style.background]="p.id === 'fill' ? paintOf('fill') : null" [style.--c]="p.id === 'stroke' ? paintOf('stroke') : null"></span>
                    </button>
                    <span class="il-paint-label" (click)="store.paintTarget.set(p.id)">{{ p.label }}</span>
                    <input class="il-hex" [value]="paintOf(p.id) ?? ''" placeholder="nenhum" spellcheck="false" [attr.aria-label]="p.label + ' em hexadecimal'" (change)="onHex(p.id, $event)" />
                    <button type="button" class="il-ib il-ib-sm" [class.il-on]="!paintOf(p.id)" data-tip="Sem cor" aria-label="Sem cor" (click)="store.setPaint(p.id, null)"><il-icon name="none" [size]="13" /></button>
                  </div>
                }
                <div class="il-grid2">
                  <il-num label="Traço" unit="mm" [value]="store.shownStroke() ? store.shownStrokeWidth() : 0" [step]="0.05" [min]="0" [max]="50" [decimals]="2" (valueChange)="onStroke($event)" (done)="store.commitLive()" />
                  @if (store.selection().length) {
                    <il-num label="Opac." unit="%" [value]="(store.primary()?.opacity ?? 1) * 100" [min]="0" [max]="100" [decimals]="0" (valueChange)="onOpacity($event)" (done)="store.commitLive()" />
                  }
                </div>
                @if (store.primary(); as l) {
                  <label class="il-check"><input type="checkbox" [checked]="l.cut" (change)="toggleCut(l)" /> <il-icon name="cut" [size]="13" /> Linha de corte (vai pro SVG de corte)</label>
                }
                <span class="il-mini-title">Amostras <small>(clique aplica em {{ store.paintTarget() === 'fill' ? 'preenchimento' : 'traço' }})</small></span>
                <div class="il-swatches">
                  @for (c of swatches; track c) {
                    <button type="button" class="il-swatch" [style.background]="c" [title]="c" (click)="store.setPaint(store.paintTarget(), c)"></button>
                  }
                </div>
                @if (store.palette().length) {
                  <span class="il-mini-title">Cores do documento <small>(✎ troca em tudo)</small></span>
                  <div class="il-swatches">
                    @for (c of store.palette(); track c) {
                      <span class="il-swatch-wrap">
                        <button type="button" class="il-swatch" [style.background]="c" [title]="c" (click)="store.setPaint(store.paintTarget(), c)"></button>
                        <label class="il-swatch-edit" title="Trocar esta cor em todo o documento">✎<input type="color" [value]="c" (change)="replaceColor(c, $any($event.target).value)" /></label>
                      </span>
                    }
                  </div>
                }
                <input #color type="color" class="il-hidden-color" tabindex="-1" aria-hidden="true" (input)="onColor($event)" (change)="store.commitLive()" />
              </div>
            </section>
          }

          <il-effects />

          @if (text(); as t) {
            <section class="il-sec" [class.il-closed]="closed('char')">
              <button type="button" class="il-sec-head" (click)="flip('char')"><il-icon name="chevron" [size]="12" /> Caractere</button>
              <div class="il-sec-body">
                <textarea #textArea class="il-textarea" rows="2" [value]="t.text" aria-label="Texto" (input)="liveText(t, { text: $any($event.target).value })" (blur)="store.commitLive()"></textarea>
                <il-font-picker [fontId]="t.fontId" [sample]="t.text.split('\\n')[0].slice(0, 24)" (picked)="store.patch(t.id, { fontId: $event })" />
                <div class="il-grid2">
                  <select class="il-select" [value]="weightOf(t)" (change)="store.patch(t.id, { weight: +$any($event.target).value })" aria-label="Peso">
                    <option value="400">Normal</option>
                    @if (hasBold(t)) { <option value="700">Negrito</option> }
                  </select>
                  <il-num label="T" title="Tamanho do corpo" unit="mm" [value]="t.sizeMm" [step]="0.5" [min]="1" [max]="1000" (valueChange)="numText(t, 'sizeMm', $event)" (done)="store.commitLive()" />
                  <il-num label="VA" title="Espaço entre letras (milésimos de em)" [value]="t.tracking" [step]="5" [min]="-200" [max]="800" [decimals]="0" (valueChange)="numText(t, 'tracking', $event)" (done)="store.commitLive()" />
                  <il-num label="Entre." title="Entrelinha (× corpo)" [value]="t.lineHeight" [step]="0.05" [min]="0.5" [max]="4" [decimals]="2" (valueChange)="numText(t, 'lineHeight', $event)" (done)="store.commitLive()" />
                </div>
                <div class="il-row">
                  <div class="il-seg">
                    @for (a of textAligns; track a.id) {
                      <button type="button" [class.il-on]="t.align === a.id" [attr.data-tip]="a.label" [attr.aria-label]="a.label" (click)="store.patch(t.id, { align: a.id })"><il-icon [name]="a.icon" /></button>
                    }
                  </div>
                  <div class="il-seg">
                    @for (c of curves; track c.id) {
                      <button type="button" [class.il-on]="t.curve === c.id" [disabled]="c.id === 'caminho' && !t.guide && !guideCandidate()" [attr.data-tip]="c.label" [attr.aria-label]="c.label" (click)="setCurve(t, c.id)"><il-icon [name]="c.icon" /></button>
                    }
                  </div>
                </div>
                @if (t.curve === 'arco') {
                  <label class="il-range"><span>Curvatura</span><input type="range" min="-100" max="100" step="1" [value]="t.bend" (input)="liveText(t, { bend: +$any($event.target).value })" (change)="store.commitLive()" /><b>{{ t.bend }}%</b></label>
                  <div class="il-row">
                    <button type="button" class="il-btn il-grow" [class.il-on]="t.bend === 100" data-tip="O texto dá a volta inteira, por cima" (click)="store.patch(t.id, { bend: 100 })">Círculo completo</button>
                    <button type="button" class="il-btn il-grow" [class.il-on]="t.bend === -100" data-tip="Volta inteira, lido por baixo" (click)="store.patch(t.id, { bend: -100 })">Por baixo</button>
                  </div>
                }
                @if (t.curve === 'caminho') {
                  <label class="il-range"><span>Início</span><input type="range" min="0" max="100" step="1" [value]="t.guideOffset * 100" (input)="liveText(t, { guideOffset: $any($event.target).value / 100 })" (change)="store.commitLive()" /><b>{{ (t.guideOffset * 100).toFixed(0) }}%</b></label>
                  <button type="button" class="il-btn" (click)="store.flipGuide(t.id)">Inverter lado do caminho</button>
                } @else if (!t.guide) {
                  <p class="il-note">Texto em caminho: selecione o texto e uma forma (Shift+clique) e escolha o terceiro modo.</p>
                }
                <div class="il-row">
                  <button type="button" class="il-btn il-grow" (click)="store.convertToPath([t.id])"><il-icon name="to-path" [size]="13" /> Criar contornos</button>
                  <button type="button" class="il-btn il-grow" (click)="store.separateLetters(t.id)"><il-icon name="letters" [size]="13" /> Separar letras</button>
                </div>
              </div>
            </section>
          }

          @if (shape(); as s) {
            <section class="il-sec" [class.il-closed]="closed('shape')">
              <button type="button" class="il-sec-head" (click)="flip('shape')"><il-icon name="chevron" [size]="12" /> {{ s.name }}</button>
              <div class="il-sec-body">
                <div class="il-grid2">
                  <il-num label="L" title="Largura da forma" unit="mm" [value]="s.w" [step]="0.5" [min]="0.5" [max]="5000" (valueChange)="numShape(s, 'w', $event)" (done)="store.commitLive()" />
                  <il-num label="A" title="Altura da forma" unit="mm" [value]="s.h" [step]="0.5" [min]="0.5" [max]="5000" (valueChange)="numShape(s, 'h', $event)" (done)="store.commitLive()" />
                  @if (s.shape === 'retangulo') {
                    <il-num label="Raio" title="Cantos arredondados" unit="mm" [value]="s.radius" [step]="0.5" [min]="0" [max]="Math.min(s.w, s.h) / 2" (valueChange)="numShape(s, 'radius', $event)" (done)="store.commitLive()" />
                  }
                  @if (s.shape === 'estrela' || s.shape === 'poligono') {
                    <il-num [label]="s.shape === 'estrela' ? 'Pontas' : 'Lados'" [value]="s.points" [min]="3" [max]="60" [decimals]="0" (valueChange)="numShape(s, 'points', $event)" (done)="store.commitLive()" />
                  }
                  @if (s.shape === 'estrela') {
                    <il-num label="Miolo" title="Raio interno" unit="%" [value]="s.innerRatio * 100" [min]="5" [max]="95" [decimals]="0" (valueChange)="numShape(s, 'innerRatio', { value: $event.value / 100, live: $event.live })" (done)="store.commitLive()" />
                  }
                </div>
              </div>
            </section>
          }

          @if (store.tool() === 'nos') {
            <section class="il-sec">
              <div class="il-sec-head il-sec-static">Nós</div>
              <div class="il-sec-body">
                @if (pathLayer(); as pl) {
                  <p class="il-note">{{ nodeTotal() }} nós em {{ pl.paths.length }} subcaminho(s). Arraste nós e alças no palco; Alt quebra a simetria.</p>
                  <div class="il-row">
                    <button type="button" class="il-btn il-grow" [disabled]="!store.nodeSel()" (click)="store.nodeOp('smooth')"><il-icon name="node-smooth" [size]="13" /> Suavizar</button>
                    <button type="button" class="il-btn il-grow" [disabled]="!store.nodeSel()" (click)="store.nodeOp('corner')"><il-icon name="node-corner" [size]="13" /> Canto</button>
                  </div>
                  <div class="il-row">
                    <button type="button" class="il-btn il-grow" [disabled]="!store.nodeSel()" (click)="store.nodeOp('add')"><il-icon name="node-add" [size]="13" /> Acrescentar</button>
                    <button type="button" class="il-btn il-grow il-danger" [disabled]="!store.nodeSel()" (click)="store.nodeOp('delete')"><il-icon name="node-delete" [size]="13" /> Apagar</button>
                  </div>
                } @else if (store.primary(); as l) {
                  <p class="il-note">"{{ l.name }}" não é caminho.</p>
                  @if (l.kind === 'texto' || l.kind === 'forma') {
                    <button type="button" class="il-btn" (click)="store.convertToPath([l.id])"><il-icon name="to-path" [size]="13" /> Converter em caminho</button>
                  }
                } @else {
                  <p class="il-note">Clique num caminho pra editar os nós dele.</p>
                }
              </div>
            </section>
          }

          @if (store.selection().length) {
            <section class="il-sec" [class.il-closed]="closed('align')">
              <button type="button" class="il-sec-head" (click)="flip('align')"><il-icon name="chevron" [size]="12" /> Alinhar <small>{{ store.selection().length > 1 ? 'à seleção' : 'à prancheta' }}</small></button>
              <div class="il-sec-body">
                <div class="il-row il-row-tight">
                  @for (a of aligns; track a.id) {
                    <button type="button" class="il-ib" [attr.data-tip]="a.label" [attr.aria-label]="a.label" (click)="store.align(a.id)"><il-icon [name]="a.icon" /></button>
                  }
                  <span class="il-sep"></span>
                  <button type="button" class="il-ib" [disabled]="store.selection().length < 3" data-tip="Distribuir na horizontal" aria-label="Distribuir na horizontal" (click)="store.distribute('h')"><il-icon name="dist-h" /></button>
                  <button type="button" class="il-ib" [disabled]="store.selection().length < 3" data-tip="Distribuir na vertical" aria-label="Distribuir na vertical" (click)="store.distribute('v')"><il-icon name="dist-v" /></button>
                </div>
              </div>
            </section>

            <section class="il-sec" [class.il-closed]="closed('pathfinder')">
              <button type="button" class="il-sec-head" (click)="flip('pathfinder')"><il-icon name="chevron" [size]="12" /> Pathfinder e contornos</button>
              <div class="il-sec-body">
                <div class="il-row il-row-tight">
                  @for (p of pathfinder; track p.id) {
                    <button type="button" class="il-ib il-ib-lg" [disabled]="vectorSel().length < p.min" [attr.data-tip]="p.label" [attr.aria-label]="p.label" (click)="combine(p.id)"><il-icon [name]="p.icon" [size]="18" /></button>
                  }
                  <span class="il-sep"></span>
                  <button type="button" class="il-ib il-ib-lg" [disabled]="!canBreak()" data-tip="Separar formas (ilhas)" aria-label="Separar formas" (click)="store.breakApart()"><il-icon name="break-apart" [size]="18" /></button>
                  <button type="button" class="il-ib il-ib-lg" [disabled]="!canConvert()" data-tip="Converter em caminho" aria-label="Converter em caminho" (click)="store.convertToPath(store.selectedIds())"><il-icon name="to-path" [size]="18" /></button>
                </div>
                <div class="il-row">
                  <il-num class="il-grow" label="Margem" title="Margem do contorno de corte" unit="mm" [value]="outlineMm()" [step]="0.5" [min]="0" [max]="50" (valueChange)="outlineMm.set($event.value)" />
                  <button type="button" class="il-btn" (click)="outline()"><il-icon name="offset" [size]="13" /> Contorno</button>
                </div>
                <label class="il-check"><input type="checkbox" [checked]="outlineOuter()" (change)="outlineOuter.set(!outlineOuter())" /> Só o de fora (fecha os vãos internos)</label>
              </div>
            </section>

            <section class="il-sec" [class.il-closed]="closed('arrange')">
              <button type="button" class="il-sec-head" (click)="flip('arrange')"><il-icon name="chevron" [size]="12" /> Organizar</button>
              <div class="il-sec-body">
                <div class="il-row il-row-tight">
                  <button type="button" class="il-ib" data-tip="Trazer pra frente  Ctrl+Shift+]" aria-label="Trazer pra frente" (click)="store.reorder(store.selectedIds(), 'topo')"><il-icon name="front" /></button>
                  <button type="button" class="il-ib" data-tip="Avançar  Ctrl+]" aria-label="Avançar" (click)="store.reorder(store.selectedIds(), 'frente')"><il-icon name="forward" /></button>
                  <button type="button" class="il-ib" data-tip="Recuar  Ctrl+[" aria-label="Recuar" (click)="store.reorder(store.selectedIds(), 'tras')"><il-icon name="backward" /></button>
                  <button type="button" class="il-ib" data-tip="Enviar pra trás  Ctrl+Shift+[" aria-label="Enviar pra trás" (click)="store.reorder(store.selectedIds(), 'fundo')"><il-icon name="back" /></button>
                  <span class="il-sep"></span>
                  <button type="button" class="il-ib" [disabled]="store.selection().length < 2" data-tip="Agrupar  Ctrl+G" aria-label="Agrupar" (click)="store.group()"><il-icon name="group" /></button>
                  <button type="button" class="il-ib" [disabled]="!grouped()" data-tip="Desagrupar  Ctrl+Shift+G" aria-label="Desagrupar" (click)="store.ungroup()"><il-icon name="ungroup" /></button>
                  <button type="button" class="il-ib" data-tip="Duplicar  Ctrl+D" aria-label="Duplicar" (click)="store.duplicate(store.selectedIds())"><il-icon name="copy" /></button>
                  <button type="button" class="il-ib il-danger" data-tip="Apagar  Delete" aria-label="Apagar" (click)="store.remove(store.selectedIds())"><il-icon name="trash" /></button>
                </div>
              </div>
            </section>
          }
          <button type="button" class="il-link" (click)="showShortcuts.emit()"><il-icon name="keyboard" [size]="13" /> Atalhos de teclado</button>
        }

        @case ('camadas') {
          <il-layers />
        }

        @case ('vetorizar') {
          <section class="il-sec">
            <div class="il-sec-body il-sec-body-top">
              <input #imageInput type="file" accept="image/*,.heic,.heif" hidden (change)="onImageInput($event)" />
              @if (store.vecSource(); as src) {
                <div class="il-trace-src">
                  <img [src]="src.dataUrl" alt="" />
                  <div class="il-trace-meta">
                    <strong>{{ src.name }}</strong>
                    <span>{{ src.canvas.width }} × {{ src.canvas.height }} px</span>
                    <div class="il-row il-row-tight">
                      <button type="button" class="il-btn" (click)="imageInput.click()">Trocar</button>
                      <button type="button" class="il-btn" data-tip="Finaliza: o resultado vira desenho comum" (click)="tracer.release()">Soltar</button>
                    </div>
                    @if (tracer.upscale.disponivel()) {
                      <button type="button" class="il-btn" [disabled]="tracer.aiBusy()" data-tip="Tira o fundo com IA antes de vetorizar" (click)="tracer.cutoutWithAi()"><il-icon name="sparkle" [size]="13" /> {{ tracer.aiBusy() ? 'Recortando…' : 'Tirar fundo (IA)' }}</button>
                    }
                  </div>
                </div>
              } @else {
                <button type="button" class="il-drop" (click)="imageInput.click()">
                  <il-icon name="trace" [size]="30" />
                  <strong>Abrir imagem pra vetorizar</strong>
                  <span>PNG, JPG ou foto de iPhone. Também dá pra soltar ou colar (Ctrl+V) direto no palco.</span>
                </button>
              }
              @if (tracer.error()) { <p class="il-error">{{ tracer.error() }}</p> }
            </div>
          </section>
          @if (store.vecSource() && store.vecParams(); as p) {
            <section class="il-sec">
              <div class="il-sec-head il-sec-static">Predefinição</div>
              <div class="il-sec-body">
                <select class="il-select" [value]="store.vecPreset() ?? ''" (change)="tracer.choosePreset($any($event.target).value)" aria-label="Predefinição">
                  @for (id of presetOrder; track id) {
                    <option [value]="id">{{ presetLabels[id] }}{{ id === suggested() ? '  ✦ sugerida' : '' }}</option>
                  }
                </select>
                @if (store.vecReason()) { <p class="il-note il-suggest">✦ {{ store.vecReason() }}</p> }
              </div>
            </section>
            <section class="il-sec">
              <div class="il-sec-head il-sec-static">Ajustes</div>
              <div class="il-sec-body">
                @if (p.mode === 'cores') {
                  <label class="il-range"><span>Cores</span><input type="range" min="2" max="16" step="1" [value]="p.colors" (input)="param('colors', $event)" /><b>{{ p.colors }}</b></label>
                  <label class="il-range"><span>Textura</span><input type="range" min="0" max="3" step="1" [value]="p.blur" (input)="param('blur', $event)" /><b>{{ p.blur }}</b></label>
                  <label class="il-check"><input type="checkbox" [checked]="p.removeBackground" (change)="tracer.setParam('removeBackground', !p.removeBackground)" /> Ignorar a cor do fundo</label>
                } @else {
                  <label class="il-range">
                    <span>{{ p.mode === 'silhueta' ? 'Tolerância' : 'Limiar' }}</span>
                    <input type="range" min="-1" max="255" step="1" [value]="p.threshold" (input)="param('threshold', $event)" /><b>{{ p.threshold < 0 ? 'auto' : p.threshold }}</b>
                  </label>
                  @if (p.mode !== 'silhueta') {
                    <label class="il-check"><input type="checkbox" [checked]="p.invert" (change)="tracer.setParam('invert', !p.invert)" /> Traço claro em fundo escuro</label>
                  } @else {
                    <label class="il-check"><input type="checkbox" [checked]="p.keepHoles" (change)="tracer.setParam('keepHoles', !p.keepHoles)" /> Manter vãos internos</label>
                  }
                }
                <label class="il-range"><span>Detalhe</span><input type="range" min="0" max="100" step="1" [value]="p.detail" (input)="param('detail', $event)" /><b>{{ p.detail }}</b></label>
                <label class="il-range"><span>Suavizar</span><input type="range" min="0" max="6" step="0.1" [value]="p.smoothing" (input)="param('smoothing', $event)" /><b>{{ p.smoothing.toFixed(1) }}</b></label>
                <label class="il-check"><input type="checkbox" [checked]="p.keepCorners" (change)="tracer.setParam('keepCorners', !p.keepCorners)" /> Preservar cantos</label>
                <il-num label="Largura" title="Largura do resultado na prancheta" unit="mm" [value]="store.vecWidthMm()" [min]="5" [max]="2000" [decimals]="0" (valueChange)="tracer.setWidth($event.value)" />
                @if (refLayer(); as ref) {
                  <label class="il-check"><input type="checkbox" [checked]="ref.visible" (change)="store.patch(ref.id, { visible: !ref.visible })" /> Mostrar a imagem original por baixo</label>
                }
              </div>
            </section>
            <p class="il-trace-status" [class.il-busy]="tracer.busy()">{{ tracer.busy() ? 'Vetorizando…' : store.vecInfo() }}</p>
          }
        }

        @case ('exportar') {
          <section class="il-sec">
            <div class="il-sec-body il-sec-body-top">
              <label class="il-field"><span>Nome do arquivo</span><input [value]="fileName()" (input)="fileName.set($any($event.target).value)" /></label>
              <label class="il-check"><input type="checkbox" [checked]="textAsText()" (change)="textAsText.set(!textAsText())" /> Texto reto editável (fonte embutida)</label>
            </div>
          </section>
          <div class="il-export-list">
            @for (e of exports; track e.id) {
              <button type="button" class="il-export" [disabled]="busy() || !store.layers().length" (click)="runExport(e.id)">
                <il-icon [name]="e.icon" [size]="20" />
                <span><strong>{{ e.label }}</strong><small>{{ e.help }}</small></span>
              </button>
            }
          </div>
          @if (exportStatus()) { <p class="il-trace-status">{{ exportStatus() }}</p> }
        }
      }
    </div>
  `,
  styles: [`
    .il-paint-row { display: flex; align-items: center; gap: 6px; }
    .il-paint-label { flex: 1; font-size: 12px; cursor: pointer; }
    .il-paint-row.il-on .il-paint-label { font-weight: 700; }
    .il-hex { width: 76px; height: 24px; padding: 0 6px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); background: var(--il-field); border: 1px solid var(--il-line); border-radius: 4px; }
    .il-mini-title { font-size: 11px; font-weight: 700; margin-top: 3px; }
    .il-mini-title small { font-weight: 400; color: var(--text-muted); }
    .il-swatch-wrap { position: relative; }
    .il-swatch-edit {
      position: absolute; right: -4px; bottom: -4px; width: 13px; height: 13px; display: flex; align-items: center; justify-content: center;
      font-size: 8px; background: var(--il-chrome); border: 1px solid var(--il-line-strong); border-radius: 50%; cursor: pointer; color: var(--text-muted);
    }
    .il-swatch-edit input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
    .il-trace-src { display: flex; gap: 8px; align-items: center; }
    .il-trace-src img { width: 72px; height: 72px; object-fit: contain; background: repeating-conic-gradient(#e6e6e6 0 25%, #fff 0 50%) 0 0 / 10px 10px; border: 1px solid var(--il-line); border-radius: 4px; }
    .il-trace-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 11px; color: var(--text-muted); }
    .il-trace-meta strong { color: var(--text); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `],
})
export class IllustrationPanelComponent {
  store = inject(IllustrationStore);
  tracer = inject(IllustrationTracer);
  private bridge = inject(ModeBridge, { optional: true });

  readonly Math = Math;
  readonly docPresets = DOC_PRESETS;
  readonly swatches = SWATCHES;
  readonly aligns = ALIGN_BUTTONS;
  readonly pathfinder = PATHFINDER;
  readonly presetOrder = PRESET_ORDER;
  readonly presetLabels = PRESET_LABELS;
  readonly tabs: { id: DockTab; label: string; icon: IlIconName }[] = [
    { id: 'props', label: 'Propriedades', icon: 'properties' },
    { id: 'camadas', label: 'Camadas', icon: 'layers' },
    { id: 'vetorizar', label: 'Vetorizar', icon: 'trace' },
    { id: 'exportar', label: 'Exportar', icon: 'export' },
  ];
  readonly paints: { id: PaintTarget; label: string }[] = [
    { id: 'fill', label: 'Preenchimento' },
    { id: 'stroke', label: 'Traço' },
  ];
  readonly textAligns: { id: TextAlign; icon: IlIconName; label: string }[] = [
    { id: 'left', icon: 'text-left', label: 'À esquerda' },
    { id: 'center', icon: 'text-center', label: 'Centralizado' },
    { id: 'right', icon: 'text-right', label: 'À direita' },
  ];
  readonly curves: { id: TextCurve; icon: IlIconName; label: string }[] = [
    { id: 'reta', icon: 'text-straight', label: 'Texto reto' },
    { id: 'arco', icon: 'text-arc', label: 'Texto em arco' },
    { id: 'caminho', icon: 'text-path', label: 'Texto em caminho' },
  ];
  readonly exports: { id: 'svg' | 'corte' | 'png' | 'pdf' | 'printcut' | 'molde' | 'social'; icon: IlIconName; label: string; help: string }[] = [
    { id: 'svg', icon: 'export', label: 'SVG', help: 'Vetor em mm, abre no Inkscape, Illustrator e CanvasWorkspace' },
    { id: 'corte', icon: 'cut', label: 'SVG de corte', help: 'Só as linhas de corte, em vermelho — pra ScanNCut' },
    { id: 'png', icon: 'image', label: `PNG ${EXPORT_DPI} DPI`, help: 'Imagem transparente no tamanho físico, sem as linhas de corte' },
    { id: 'pdf', icon: 'artboard', label: 'PDF', help: 'Página no tamanho da prancheta, pronta pra imprimir' },
    { id: 'printcut', icon: 'offset', label: 'Enviar pro Print & Cut', help: 'A arte entra como imagem nova, na largura do desenho' },
    { id: 'molde', icon: 'properties', label: 'Usar como Molde SVG', help: 'Abre a ilustração no modo de molde, pra encaixar fotos' },
    { id: 'social', icon: 'photo-add', label: 'Enviar pro Redes sociais', help: 'A prancheta vira a foto do post, com filtros e formatos' },
  ];

  readonly sendToCut = output<{ canvas: HTMLCanvasElement; name: string; widthMm: number }>();
  readonly sendToTemplate = output<{ svg: string; name: string }>();
  readonly showShortcuts = output<void>();

  tab = signal<DockTab>('props');
  open = signal<Record<string, boolean>>(loadOpen());
  outlineMm = signal(3);
  outlineOuter = signal(true);
  textAsText = signal(false);
  busy = signal(false);
  exportStatus = signal('');
  fileName = signal('ilustracao');

  private textArea = viewChild<ElementRef<HTMLTextAreaElement>>('textArea');
  private color = viewChild<ElementRef<HTMLInputElement>>('color');
  private colorTarget: PaintTarget = 'fill';

  constructor() {
    // Texto novo (ferramenta Texto, duplo clique): abre Propriedades e foca o campo.
    effect(() => {
      if (!this.store.focusText()) return;
      this.tab.set('props');
      this.open.update((o) => ({ ...o, char: true }));
      setTimeout(() => {
        const el = this.textArea()?.nativeElement;
        el?.focus();
        el?.select();
      });
    });
    // Imagem nova pra vetorizar: mostra a aba do rastreamento.
    effect(() => {
      if (this.tracer.opened()) this.tab.set('vetorizar');
    });
    effect(() => {
      const src = this.store.vecSource();
      if (src) this.fileName.set(src.name);
    });
  }

  closed(id: string): boolean {
    return this.open()[id] === false;
  }

  flip(id: string): void {
    this.open.update((o) => ({ ...o, [id]: o[id] === false }));
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(this.open()));
    } catch { /* preferência é só conveniência */ }
  }

  patchGrid(patch: Partial<GridSettings>): void {
    this.store.grid.update((g) => ({ ...g, ...patch }));
  }

  round0(v: number): number {
    return Math.round(v);
  }

  // ---------- seleção ----------

  vectorSel = computed(() => this.store.selection().filter((l) => l.kind !== 'imagem'));

  /** O texto em edição: o principal, ou o único texto da seleção — no "texto
   * em caminho" o último clique costuma ser na forma, não no texto. */
  text = computed(() => {
    const l = this.store.primary();
    if (l?.kind === 'texto') return l;
    const texts = this.store.selection().filter((x): x is TextLayer => x.kind === 'texto');
    return texts.length === 1 ? texts[0] : null;
  });

  shape = computed(() => {
    const l = this.store.primary();
    return l?.kind === 'forma' && this.store.selection().length === 1 ? l : null;
  });

  pathLayer = computed(() => {
    const l = this.store.primary();
    return l?.kind === 'caminho' ? l : null;
  });

  nodeTotal = computed(() => countNodes(this.pathLayer()?.paths ?? []));
  canBreak = computed(() => this.store.selection().some((l) => l.kind === 'caminho' || l.kind === 'forma'));
  canConvert = computed(() => this.store.selection().some((l) => l.kind === 'texto' || l.kind === 'forma'));
  grouped = computed(() => this.store.selection().some((l) => l.groupId));
  guideCandidate = computed(() => this.store.selection().find((l) => l.kind === 'caminho' || l.kind === 'forma') ?? null);
  suggested = computed(() => this.store.vecSuggested());
  refLayer = computed(() => {
    const id = this.store.vecRefId();
    const l = id ? this.store.layer(id) : null;
    return l?.kind === 'imagem' ? l : null;
  });

  weightOf(t: TextLayer): number {
    return nearestWeight(this.store.fonts.family(t.fontId).weights, t.weight);
  }

  hasBold(t: TextLayer): boolean {
    return this.store.fonts.family(t.fontId).weights.includes(700);
  }

  // ---------- transformar ----------

  onGeom(axis: 'x' | 'y' | 'w' | 'h', e: NumChange): void {
    const run = (record: boolean) => (axis === 'x' || axis === 'y'
      ? this.store.moveSelectionTo(axis, e.value, record)
      : this.store.resizeSelectionTo(axis, e.value, record));
    if (e.live) this.store.live(() => run(false));
    else run(true);
  }

  onRotate(e: NumChange): void {
    if (e.live) this.store.live(() => this.store.rotateSelectionTo(e.value, false));
    else this.store.rotateSelectionTo(e.value);
  }

  // ---------- aparência ----------

  paintOf(which: PaintTarget): string | null {
    return which === 'fill' ? this.store.shownFill() : this.store.shownStroke();
  }

  openColor(target: PaintTarget): void {
    this.colorTarget = target;
    this.store.paintTarget.set(target);
    const el = this.color()?.nativeElement;
    if (!el) return;
    el.value = normalizeHex(this.paintOf(target)) ?? '#000000';
    el.click();
  }

  onColor(event: Event): void {
    this.store.setPaint(this.colorTarget, (event.target as HTMLInputElement).value, true);
  }

  onHex(which: PaintTarget, event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.trim();
    const hex = normalizeHex(raw.startsWith('#') ? raw : `#${raw}`);
    if (!raw) this.store.setPaint(which, null);
    else if (hex) this.store.setPaint(which, hex);
    else input.value = this.paintOf(which) ?? '';
  }

  onStroke(e: NumChange): void {
    this.store.setStrokeWidth(e.value, e.live);
  }

  onOpacity(e: NumChange): void {
    const ids = this.store.selectedIds();
    const apply = () => this.store.patchMany(ids, () => ({ opacity: Math.max(0, Math.min(1, e.value / 100)) }), false);
    if (e.live) this.store.live(apply);
    else {
      this.store.record();
      apply();
    }
  }

  toggleCut(l: Layer): void {
    const cut = !l.cut;
    this.store.patchSelection(cut ? { cut, stroke: l.stroke ?? CUT_COLOR, strokeWidth: l.stroke ? l.strokeWidth : 0.3 } : { cut });
  }

  replaceColor(from: string, to: string): void {
    const target = normalizeHex(to);
    if (!target) return;
    this.store.patchMany(this.store.layers().map((l) => l.id), (l) => {
      const patch: Partial<Layer> = {};
      if (normalizeHex(l.fill) === from) patch.fill = target;
      if (normalizeHex(l.stroke) === from) patch.stroke = target;
      return Object.keys(patch).length ? patch : null;
    });
  }

  // ---------- texto e forma ----------

  liveText(t: TextLayer, patch: Partial<TextLayer>): void {
    this.store.live(() => this.store.patch(t.id, patch, false));
  }

  numText(t: TextLayer, key: 'sizeMm' | 'tracking' | 'lineHeight', e: NumChange): void {
    const patch = { [key]: e.value } as Partial<TextLayer>;
    if (e.live) this.liveText(t, patch);
    else this.store.patch(t.id, patch);
  }

  numShape(s: ShapeLayer, key: 'w' | 'h' | 'radius' | 'points' | 'innerRatio', e: NumChange): void {
    const patch = { [key]: key === 'points' ? Math.round(e.value) : e.value } as Partial<ShapeLayer>;
    if (e.live) this.store.live(() => this.store.patch(s.id, patch, false));
    else this.store.patch(s.id, patch);
  }

  setCurve(t: TextLayer, curve: TextCurve): void {
    if (curve === 'caminho' && !t.guide) {
      const guide = this.guideCandidate();
      if (!guide || !this.store.attachTextToPath(t.id, guide.id)) return;
      this.store.patch(guide.id, { visible: false }, false);
      this.store.select(t.id);
      return;
    }
    this.store.patch(t.id, { curve });
  }

  // ---------- combinar ----------

  combine(op: (typeof PATHFINDER)[number]['id']): void {
    if (!this.store.combine(op)) this.store.status.set('Selecione as formas primeiro.');
  }

  outline(): void {
    if (!this.store.outline(this.outlineMm(), this.outlineOuter())) this.store.status.set('Não há área pra contornar.');
  }

  // ---------- vetorizar ----------

  onImageInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.tracer.loadFile(file);
    input.value = '';
  }

  param<K extends keyof VectorizeParams>(key: K, event: Event): void {
    this.tracer.setParam(key, Number((event.target as HTMLInputElement).value) as VectorizeParams[K]);
  }

  // ---------- documento ----------

  /** Encosta a prancheta no desenho, com 5 mm de folga. */
  fitBoard(): void {
    const b = contentBounds(this.store, false);
    if (!b) return;
    const pad = 5;
    const dx = pad - b.minX, dy = pad - b.minY;
    this.store.record();
    this.store.widthMm.set(Math.ceil(b.maxX - b.minX + pad * 2));
    this.store.heightMm.set(Math.ceil(b.maxY - b.minY + pad * 2));
    this.store.patchMany(this.store.layers().map((l) => l.id), (l) => ({ x: l.x + dx, y: l.y + dy }), false);
  }

  clearAll(): void {
    if (!confirm('Apagar tudo da ilustração? Dá pra desfazer com Ctrl+Z.')) return;
    this.store.record();
    this.store.layers.set([]);
    this.store.selectedIds.set([]);
    this.tracer.release();
    this.store.vecRefId.set(null);
  }

  // ---------- exportar ----------

  private baseName(): string {
    return (this.fileName().trim() || 'ilustracao').replace(/[\\/:*?"<>|]+/g, '-');
  }

  async runExport(id: (typeof this.exports)[number]['id']): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.exportStatus.set('Gerando…');
    try {
      switch (id) {
        case 'svg':
        case 'corte': {
          const cutOnly = id === 'corte';
          const svg = await buildSvg(this.store, { cutOnly, textAsText: this.textAsText() });
          downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${this.baseName()}${cutOnly ? '-corte' : ''}.svg`);
          this.exportStatus.set(cutOnly ? 'SVG de corte salvo.' : 'SVG salvo.');
          break;
        }
        case 'png': {
          const canvas = await rasterizeSvg(await buildSvg(this.store, { skipCut: true }), this.store.widthMm(), this.store.heightMm(), EXPORT_DPI, null);
          downloadBlob(await pngBlobWithDpi(await canvasToBlob(canvas, 'image/png'), EXPORT_DPI), `${this.baseName()}.png`);
          this.exportStatus.set(`PNG ${canvas.width}×${canvas.height} px salvo.`);
          break;
        }
        case 'pdf': {
          const canvas = await rasterizeSvg(await buildSvg(this.store, { skipCut: true }), this.store.widthMm(), this.store.heightMm(), EXPORT_DPI, '#ffffff');
          const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
          downloadBlob(jpegToPdf(jpeg, this.store.widthMm(), this.store.heightMm(), canvas.width, canvas.height), `${this.baseName()}.pdf`);
          this.exportStatus.set('PDF salvo no tamanho da prancheta.');
          break;
        }
        case 'printcut': {
          // A arte vai recortada no próprio desenho: o Print & Cut faz o contorno em volta.
          const b = contentBounds(this.store, true);
          if (!b) {
            this.exportStatus.set('Nada pra enviar (só há linhas de corte).');
            break;
          }
          const w = b.maxX - b.minX;
          const canvas = await rasterizeSvg(await buildSvg(this.store, { skipCut: true, bounds: b }), w, b.maxY - b.minY, EXPORT_DPI, null, 9_000_000);
          this.sendToCut.emit({ canvas, name: this.baseName(), widthMm: Math.round(w * 10) / 10 });
          this.exportStatus.set('');
          break;
        }
        case 'social': {
          const canvas = await rasterizeSvg(await buildSvg(this.store, { skipCut: true }), this.store.widthMm(), this.store.heightMm(), EXPORT_DPI, '#ffffff', 9_000_000);
          this.bridge?.send('social', { canvas, name: this.baseName(), widthMm: this.store.widthMm() });
          this.exportStatus.set('');
          break;
        }
        case 'molde': {
          this.sendToTemplate.emit({ svg: await buildSvg(this.store, { skipCut: true }), name: `${this.baseName()}.svg` });
          this.exportStatus.set('');
          break;
        }
      }
    } catch {
      this.exportStatus.set('Falha ao exportar. Se houver imagens muito grandes, tente sem elas.');
    } finally {
      this.busy.set(false);
    }
  }
}
