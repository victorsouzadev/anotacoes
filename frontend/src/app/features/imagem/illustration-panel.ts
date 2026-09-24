/** Painel lateral do modo Ilustração. As classes vêm do `app-illustration-mode`
 * (sem encapsulamento), então aqui só mora o que é próprio do painel. */

import { Component, ElementRef, ViewEncapsulation, computed, effect, output, signal, viewChild } from '@angular/core';
import { uuid } from '../../core/uuid';
import { IconComponent } from '../../shared/icon';
import { pngBlobWithDpi } from './contour';
import { FONT_CATEGORIES, FontCategory, FontError, FontFamily } from './fonts';
import { buildSvg, canvasToBlob, contentBounds, rasterizeSvg } from './illustration-export';
import { AlignMode, CUT_COLOR, IllustrationStore } from './illustration-store';
import { Layer, ShapeLayer, TextAlign, TextCurve, TextLayer, countNodes, normalizeHex } from './illustration-model';
import { encodeCanvas } from './raster';
import { jpegToPdf } from './sheet';
import { isHeicFile } from './social-mode';
import { downloadBlob } from './svg-template';
import { BoolOp, addNodeAfter, cornerNode, deleteNode, smoothNode } from './vector-ops';
import { PRESET_LABELS, PresetId, VectorizeParams, presetParams, suggestPreset } from './vectorize';
import { StaleRequest, VectorizeService, vectorizeCanvas } from './vectorize.service';

const EXPORT_DPI = 300;

type SectionId = 'documento' | 'vetorizar' | 'texto' | 'estilo' | 'forma' | 'organizar' | 'combinar' | 'nos' | 'camadas' | 'exportar';

const DOC_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'A4', w: 210, h: 297 },
  { label: 'A4 deitado', w: 297, h: 210 },
  { label: 'A3', w: 297, h: 420 },
  { label: '10 × 10 cm', w: 100, h: 100 },
  { label: '20 × 20 cm', w: 200, h: 200 },
  { label: '30 × 30 cm', w: 300, h: 300 },
];

const PRESET_ORDER: PresetId[] = ['logo', 'traco', 'clipart', 'foto', 'silhueta', 'centro'];

function num(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

function readImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
    img.src = src;
  });
}

@Component({
  selector: 'app-illustration-panel',
  standalone: true,
  imports: [IconComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <aside class="il-panel">
      <input #imageInput type="file" accept="image/*,.heic,.heif" hidden (change)="onImageInput($event)" />
      <input #fontInput type="file" accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff" hidden (change)="onFontInput($event)" />

      <!-- vetorizar -->
      <section class="il-section" [class.il-open]="isOpen('vetorizar')">
        <button class="il-section-head" (click)="toggle('vetorizar')">
          <span class="il-section-title"><app-icon name="image" [size]="13" /> Vetorizar imagem</span>
          <span class="il-section-summary">{{ store.vecSource()?.name ?? 'nenhuma' }}</span>
          <app-icon class="il-chevron" name="chevron" [size]="14" />
        </button>
        <div class="il-section-body">
          <button class="il-btn il-wide" (click)="imageInput.click()"><app-icon name="folder" [size]="13" /> {{ store.vecSource() ? 'Trocar imagem' : 'Escolher imagem' }}</button>
          @if (!store.vecSource()) {
            <p class="il-note">Ou solte / cole (Ctrl+V) a imagem no palco. PNG, JPG ou foto de iPhone.</p>
          }
          @if (vecError()) { <p class="il-error">{{ vecError() }}</p> }
          @if (store.vecSource() && store.vecParams(); as p) {
            @if (store.vecReason()) { <p class="il-note il-suggest">✦ {{ store.vecReason() }}</p> }
            <div class="il-chips">
              @for (id of presetOrder; track id) {
                <button class="il-chip" [class.il-active]="store.vecPreset() === id" (click)="choosePreset(id)">{{ presetLabels[id] }}</button>
              }
            </div>
            @if (p.mode === 'cores') {
              <label class="il-slider"><span>Cores <strong>{{ p.colors }}</strong></span>
                <input type="range" min="2" max="16" step="1" [value]="p.colors" (input)="setParam('colors', num($event))" /></label>
              <label class="il-slider"><span>Tirar textura <strong>{{ p.blur }}</strong></span>
                <input type="range" min="0" max="3" step="1" [value]="p.blur" (input)="setParam('blur', num($event))" /></label>
              <label class="il-check"><input type="checkbox" [checked]="p.removeBackground" (change)="setParam('removeBackground', !p.removeBackground)" /> Remover a cor do fundo</label>
            }
            @if (p.mode === 'traco' || p.mode === 'centro' || p.mode === 'silhueta') {
              <label class="il-slider">
                <span>{{ p.mode === 'silhueta' ? 'Tolerância do fundo' : 'Limiar' }} <strong>{{ p.threshold < 0 ? 'auto' : p.threshold }}</strong></span>
                <input type="range" min="-1" max="255" step="1" [value]="p.threshold" (input)="setParam('threshold', num($event))" />
              </label>
            }
            @if (p.mode === 'traco' || p.mode === 'centro') {
              <label class="il-check"><input type="checkbox" [checked]="p.invert" (change)="setParam('invert', !p.invert)" /> Traço claro em fundo escuro</label>
            }
            @if (p.mode === 'silhueta') {
              <label class="il-check"><input type="checkbox" [checked]="p.keepHoles" (change)="setParam('keepHoles', !p.keepHoles)" /> Manter vãos internos</label>
            }
            <label class="il-slider"><span>Detalhe <strong>{{ p.detail }}</strong></span>
              <input type="range" min="0" max="100" step="1" [value]="p.detail" (input)="setParam('detail', num($event))" /></label>
            <label class="il-slider"><span>Suavização <strong>{{ p.smoothing.toFixed(1) }}</strong></span>
              <input type="range" min="0" max="6" step="0.1" [value]="p.smoothing" (input)="setParam('smoothing', num($event))" /></label>
            <label class="il-check"><input type="checkbox" [checked]="p.keepCorners" (change)="setParam('keepCorners', !p.keepCorners)" /> Preservar cantos</label>
            <label class="il-field"><span>Largura na prancheta (mm)</span>
              <input type="number" min="5" max="2000" step="1" [value]="store.vecWidthMm()" (change)="setVecWidth(num($event))" /></label>
            <p class="il-note">{{ vecBusy() ? 'Vetorizando…' : store.vecInfo() }}</p>
          }
        </div>
      </section>

      <!-- texto -->
      <section class="il-section" [class.il-open]="isOpen('texto')">
        <button class="il-section-head" (click)="toggle('texto')">
          <span class="il-section-title"><app-icon name="text" [size]="13" /> Texto</span>
          <span class="il-section-summary">{{ text() ? store.fonts.family(text()!.fontId).name : 'fontes' }}</span>
          <app-icon class="il-chevron" name="chevron" [size]="14" />
        </button>
        <div class="il-section-body">
          @if (text(); as t) {
            <label class="il-field"><span>Texto</span>
              <textarea #textArea rows="2" [value]="t.text" (input)="patchText({ text: $any($event.target).value }, true)" (blur)="endTyping()"></textarea></label>
            <div class="il-font-cats">
              @for (c of categories(); track c) {
                <button class="il-chip" [class.il-active]="fontCategory() === c" (click)="fontCategory.set(c)">{{ c }}</button>
              }
            </div>
            <div class="il-font-list">
              @for (f of fontsOf(fontCategory()); track f.id) {
                <button class="il-font" [class.il-active]="t.fontId === f.id" [style.font-family]="store.fonts.previewFamily(f.id)" (click)="patchText({ fontId: f.id })" [title]="f.name">
                  <span class="il-font-sample">Abc</span><span class="il-font-name">{{ f.name }}</span>
                </button>
              }
            </div>
            @if (store.fonts.failed(t.fontId, t.weight)) { <p class="il-error">Não consegui carregar essa fonte.</p> }
            <div class="il-row">
              <button class="il-btn il-grow" [class.il-active]="t.weight < 600" (click)="patchText({ weight: 400 })">Normal</button>
              <button class="il-btn il-grow" [class.il-active]="t.weight >= 600" [disabled]="!hasBold(t)" (click)="patchText({ weight: 700 })"><strong>Negrito</strong></button>
            </div>
            <div class="il-row">
              <label class="il-field"><span>Tamanho (mm)</span><input type="number" min="1" max="1000" step="0.5" [value]="t.sizeMm" (change)="patchText({ sizeMm: clampNum(num($event), 1, 1000) })" /></label>
              <label class="il-field"><span>Entrelinha</span><input type="number" min="0.5" max="4" step="0.05" [value]="t.lineHeight" (change)="patchText({ lineHeight: clampNum(num($event), 0.5, 4) })" /></label>
            </div>
            <label class="il-slider"><span>Espaço entre letras <strong>{{ t.tracking }}</strong></span>
              <input type="range" min="-200" max="800" step="5" [value]="t.tracking" (input)="patchText({ tracking: num($event) }, true)" (change)="endTyping()" /></label>
            <div class="il-row">
              @for (a of aligns; track a.id) {
                <button class="il-btn il-grow" [class.il-active]="t.align === a.id" (click)="patchText({ align: a.id })">{{ a.label }}</button>
              }
            </div>
            <div class="il-row">
              @for (c of curves; track c.id) {
                <button class="il-btn il-grow" [class.il-active]="t.curve === c.id" [disabled]="c.id === 'caminho' && !t.guide && !guideCandidate()" (click)="setCurve(t, c.id)">{{ c.label }}</button>
              }
            </div>
            @if (t.curve === 'arco') {
              <label class="il-slider"><span>Curvatura <strong>{{ t.bend }}%</strong></span>
                <input type="range" min="-100" max="100" step="1" [value]="t.bend" (input)="patchText({ bend: num($event) }, true)" (change)="endTyping()" /></label>
            }
            @if (t.curve === 'caminho') {
              <label class="il-slider"><span>Início no caminho <strong>{{ (t.guideOffset * 100).toFixed(0) }}%</strong></span>
                <input type="range" min="0" max="100" step="1" [value]="t.guideOffset * 100" (input)="patchText({ guideOffset: num($event) / 100 }, true)" (change)="endTyping()" /></label>
              <button class="il-btn il-wide" (click)="store.flipGuide(t.id)">Inverter lado do caminho</button>
            }
            @if (!t.guide) {
              <p class="il-note">Texto em caminho: selecione o texto e um caminho ou forma (Shift+clique) e escolha "Caminho".</p>
            }
            <div class="il-row">
              <button class="il-btn il-grow" (click)="store.convertToPath([t.id])">Converter em curvas</button>
              <button class="il-btn il-grow" (click)="store.separateLetters(t.id)">Separar letras</button>
            </div>
          } @else {
            <button class="il-btn il-wide" (click)="addText()"><app-icon name="plus" [size]="13" /> Adicionar texto</button>
            <p class="il-note">{{ store.fonts.families().length }} fontes; o texto já aparece em curvas, igual ao arquivo final.</p>
          }
          <button class="il-btn il-wide" (click)="fontInput.click()"><app-icon name="plus" [size]="13" /> Enviar fonte (.ttf, .otf, .woff)</button>
          @if (fontStatus()) { <p class="il-note">{{ fontStatus() }}</p> }
        </div>
      </section>

      <!-- estilo -->
      @if (store.selection().length) {
        <section class="il-section" [class.il-open]="isOpen('estilo')">
          <button class="il-section-head" (click)="toggle('estilo')">
            <span class="il-section-title"><app-icon name="edit" [size]="13" /> Cor e traço</span>
            <span class="il-section-summary">{{ store.selection().length }} selecionada(s)</span>
            <app-icon class="il-chevron" name="chevron" [size]="14" />
          </button>
          <div class="il-section-body">
            @if (store.primary(); as l) {
              <div class="il-row">
                <label class="il-color"><span>Preenchimento</span>
                  <input type="color" [value]="l.fill ?? '#ffffff'" [disabled]="!l.fill" (input)="setPaint('fill', $any($event.target).value, true)" (change)="endTyping()" /></label>
                <label class="il-check"><input type="checkbox" [checked]="!!l.fill" (change)="setPaint('fill', l.fill ? null : store.currentFill())" /> usar</label>
              </div>
              <div class="il-row">
                <label class="il-color"><span>Traço</span>
                  <input type="color" [value]="l.stroke ?? '#222222'" [disabled]="!l.stroke" (input)="setPaint('stroke', $any($event.target).value, true)" (change)="endTyping()" /></label>
                <label class="il-check"><input type="checkbox" [checked]="!!l.stroke" (change)="setPaint('stroke', l.stroke ? null : '#222222')" /> usar</label>
                @if (l.stroke) {
                  <label class="il-field"><span>mm</span><input type="number" min="0.05" max="50" step="0.05" [value]="round(l.strokeWidth)" (change)="store.patchSelection({ strokeWidth: clampNum(num($event), 0.05, 50) })" /></label>
                }
              </div>
              <label class="il-slider"><span>Opacidade <strong>{{ (l.opacity * 100).toFixed(0) }}%</strong></span>
                <input type="range" min="0" max="100" step="1" [value]="l.opacity * 100" (input)="store.patchSelection({ opacity: num($event) / 100 }, false)" (pointerdown)="store.begin()" (change)="store.end()" /></label>
              <label class="il-check"><input type="checkbox" [checked]="l.cut" (change)="toggleCut(l)" /> Linha de corte (entra no SVG de corte)</label>
            }
            @if (store.palette().length) {
              <span class="il-note">Cores do documento — clique pra aplicar; o lápis troca a cor em tudo.</span>
              <div class="il-swatches">
                @for (c of store.palette(); track c) {
                  <span class="il-swatch-wrap">
                    <button class="il-swatch" [style.background]="c" [title]="c" (click)="setPaint('fill', c)"></button>
                    <label class="il-swatch-edit" title="Trocar esta cor em todo o documento">✎<input type="color" [value]="c" (change)="replaceColor(c, $any($event.target).value)" /></label>
                  </span>
                }
              </div>
            }
          </div>
        </section>
      }

      <!-- forma -->
      @if (shape(); as s) {
        <section class="il-section" [class.il-open]="isOpen('forma')">
          <button class="il-section-head" (click)="toggle('forma')">
            <span class="il-section-title"><app-icon name="rect" [size]="13" /> Forma</span>
            <span class="il-section-summary">{{ s.name }}</span>
            <app-icon class="il-chevron" name="chevron" [size]="14" />
          </button>
          <div class="il-section-body">
            <div class="il-row">
              <label class="il-field"><span>Largura (mm)</span><input type="number" min="0.5" step="0.5" [value]="round(s.w)" (change)="patchShape({ w: clampNum(num($event), 0.5, 5000) })" /></label>
              <label class="il-field"><span>Altura (mm)</span><input type="number" min="0.5" step="0.5" [value]="round(s.h)" (change)="patchShape({ h: clampNum(num($event), 0.5, 5000) })" /></label>
            </div>
            @if (s.shape === 'retangulo') {
              <label class="il-slider"><span>Cantos arredondados <strong>{{ s.radius.toFixed(1) }} mm</strong></span>
                <input type="range" min="0" [max]="Math.min(s.w, s.h) / 2" step="0.5" [value]="s.radius" (input)="patchShape({ radius: num($event) }, true)" (change)="endTyping()" /></label>
            }
            @if (s.shape === 'estrela' || s.shape === 'poligono') {
              <label class="il-slider"><span>{{ s.shape === 'estrela' ? 'Pontas' : 'Lados' }} <strong>{{ s.points }}</strong></span>
                <input type="range" min="3" max="24" step="1" [value]="s.points" (input)="patchShape({ points: num($event) }, true)" (change)="endTyping()" /></label>
            }
            @if (s.shape === 'estrela') {
              <label class="il-slider"><span>Miolo <strong>{{ (s.innerRatio * 100).toFixed(0) }}%</strong></span>
                <input type="range" min="10" max="90" step="1" [value]="s.innerRatio * 100" (input)="patchShape({ innerRatio: num($event) / 100 }, true)" (change)="endTyping()" /></label>
            }
          </div>
        </section>
      }

      <!-- organizar -->
      @if (store.selection().length) {
        <section class="il-section" [class.il-open]="isOpen('organizar')">
          <button class="il-section-head" (click)="toggle('organizar')">
            <span class="il-section-title"><app-icon name="grid" [size]="13" /> Posição e alinhamento</span>
            <app-icon class="il-chevron" name="chevron" [size]="14" />
          </button>
          <div class="il-section-body">
            @if (geometry(); as g) {
              <div class="il-row">
                <label class="il-field"><span>X (mm)</span><input type="number" step="0.5" [value]="round(g.x)" (change)="moveTo('x', num($event))" /></label>
                <label class="il-field"><span>Y (mm)</span><input type="number" step="0.5" [value]="round(g.y)" (change)="moveTo('y', num($event))" /></label>
              </div>
              <div class="il-row">
                <label class="il-field"><span>Largura</span><input type="number" min="0.1" step="0.5" [value]="round(g.w)" (change)="resizeTo('w', num($event))" /></label>
                <label class="il-field"><span>Altura</span><input type="number" min="0.1" step="0.5" [value]="round(g.h)" (change)="resizeTo('h', num($event))" /></label>
                @if (store.primary(); as l) {
                  <label class="il-field"><span>Giro (°)</span><input type="number" step="1" [value]="round(l.rotation)" (change)="rotateTo(num($event))" /></label>
                }
              </div>
              <label class="il-check"><input type="checkbox" [checked]="keepRatio()" (change)="keepRatio.set(!keepRatio())" /> Manter proporção</label>
            }
            <span class="il-note">{{ store.selection().length > 1 ? 'Alinhar entre si' : 'Alinhar à prancheta' }}</span>
            <div class="il-grid6">
              @for (a of alignModes; track a.id) {
                <button class="il-btn" [title]="a.label" (click)="store.align(a.id)">{{ a.glyph }}</button>
              }
            </div>
            <div class="il-row">
              <button class="il-btn il-grow" [disabled]="store.selection().length < 3" (click)="store.distribute('h')" title="Mesmo espaço na horizontal">⇹ Distribuir</button>
              <button class="il-btn il-grow" [disabled]="store.selection().length < 3" (click)="store.distribute('v')" title="Mesmo espaço na vertical">⇅ Distribuir</button>
            </div>
            <div class="il-row">
              <button class="il-btn il-grow" (click)="store.flip('h')">⇋ Espelhar</button>
              <button class="il-btn il-grow" (click)="store.flip('v')">⇵ Virar</button>
            </div>
            <div class="il-row">
              <button class="il-btn il-grow" (click)="store.reorder(store.selectedIds(), 'topo')" title="Trazer pra frente de tudo"><app-icon name="bring-to-front" [size]="13" /></button>
              <button class="il-btn il-grow" (click)="store.reorder(store.selectedIds(), 'frente')" title="Um passo pra frente">↑</button>
              <button class="il-btn il-grow" (click)="store.reorder(store.selectedIds(), 'tras')" title="Um passo pra trás">↓</button>
              <button class="il-btn il-grow" (click)="store.reorder(store.selectedIds(), 'fundo')" title="Mandar pro fundo"><app-icon name="send-to-back" [size]="13" /></button>
            </div>
            <div class="il-row">
              <button class="il-btn il-grow" [disabled]="store.selection().length < 2" (click)="store.group()">Agrupar</button>
              <button class="il-btn il-grow" [disabled]="!selectionGrouped()" (click)="store.ungroup()">Desagrupar</button>
            </div>
            <div class="il-row">
              <button class="il-btn il-grow" (click)="store.duplicate(store.selectedIds())"><app-icon name="duplicate" [size]="13" /> Duplicar</button>
              <button class="il-btn il-grow il-danger" (click)="store.remove(store.selectedIds())"><app-icon name="delete" [size]="13" /> Apagar</button>
            </div>
          </div>
        </section>
      }

      <!-- combinar -->
      <section class="il-section" [class.il-open]="isOpen('combinar')">
        <button class="il-section-head" (click)="toggle('combinar')">
          <span class="il-section-title"><app-icon name="duplicate" [size]="13" /> Soldar e contornos</span>
          <app-icon class="il-chevron" name="chevron" [size]="14" />
        </button>
        <div class="il-section-body">
          <div class="il-row">
            <button class="il-btn il-grow" [disabled]="vectorCount() < 1" (click)="combine('unir')" title="Solda tudo numa peça só (letras cursivas, peças encostadas)">Soldar</button>
            <button class="il-btn il-grow" [disabled]="vectorCount() < 2" (click)="combine('subtrair')" title="Tira da camada de baixo o que está por cima">Subtrair</button>
          </div>
          <div class="il-row">
            <button class="il-btn il-grow" [disabled]="vectorCount() < 2" (click)="combine('intersecao')">Interseção</button>
            <button class="il-btn il-grow" [disabled]="vectorCount() < 2" (click)="combine('excluir')">Excluir sobreposição</button>
          </div>
          <div class="il-row">
            <button class="il-btn il-grow" [disabled]="!canBreak()" (click)="store.breakApart()">Separar formas</button>
            <button class="il-btn il-grow" [disabled]="!canConvert()" (click)="store.convertToPath(store.selectedIds())">Converter em caminho</button>
          </div>
          <hr class="il-hr" />
          <label class="il-slider"><span>Contorno com margem <strong>{{ outlineMm().toFixed(1) }} mm</strong></span>
            <input type="range" min="0" max="20" step="0.5" [value]="outlineMm()" (input)="outlineMm.set(num($event))" /></label>
          <label class="il-check"><input type="checkbox" [checked]="outlineOuter()" (change)="outlineOuter.set(!outlineOuter())" /> Só o contorno de fora (fecha os vãos)</label>
          <button class="il-btn il-wide" [disabled]="!store.layers().length" (click)="outline()">
            Criar contorno {{ vectorCount() ? 'da seleção' : 'de tudo' }}
          </button>
          <p class="il-note">O contorno sai em vermelho, marcado como linha de corte e atrás da arte. Pra adesivo com fundo branco, dê preenchimento branco a ele.</p>
        </div>
      </section>

      <!-- nós -->
      @if (store.tool() === 'nos') {
        <section class="il-section il-open">
          <div class="il-section-head"><span class="il-section-title">◇ Nós</span></div>
          <div class="il-section-body">
            @if (pathLayer(); as pl) {
              <p class="il-note">{{ nodeTotal() }} nós. Clique num nó pra ver as alças.</p>
              <div class="il-row">
                <button class="il-btn il-grow" [disabled]="!store.nodeSel()" (click)="nodeOp('smooth')">Suavizar</button>
                <button class="il-btn il-grow" [disabled]="!store.nodeSel()" (click)="nodeOp('corner')">Canto</button>
              </div>
              <div class="il-row">
                <button class="il-btn il-grow" [disabled]="!store.nodeSel()" (click)="nodeOp('add')">+ Nó depois</button>
                <button class="il-btn il-grow il-danger" [disabled]="!store.nodeSel()" (click)="deleteNode()">Apagar nó</button>
              </div>
            } @else if (store.primary(); as l) {
              <p class="il-note">"{{ l.name }}" não é caminho.</p>
              @if (l.kind === 'texto' || l.kind === 'forma') {
                <button class="il-btn il-wide" (click)="store.convertToPath([l.id])">Converter em caminho</button>
              }
            } @else {
              <p class="il-note">Clique num caminho pra editar os nós dele.</p>
            }
          </div>
        </section>
      }

      <!-- camadas -->
      <section class="il-section" [class.il-open]="isOpen('camadas')">
        <button class="il-section-head" (click)="toggle('camadas')">
          <span class="il-section-title"><app-icon name="list-view" [size]="13" /> Camadas</span>
          <span class="il-section-summary">{{ store.layers().length }}</span>
          <app-icon class="il-chevron" name="chevron" [size]="14" />
        </button>
        <div class="il-section-body">
          @if (!store.layers().length) { <p class="il-note">Nada ainda.</p> }
          <div class="il-layers">
            @for (l of stack(); track l.id) {
              <div class="il-layer" [class.il-layer-sel]="isSelected(l.id)" [class.il-layer-off]="!l.visible" (click)="store.select(l.id, $any($event).shiftKey)">
                <span class="il-layer-dot" [style.background]="l.kind === 'imagem' ? 'transparent' : (l.fill ?? l.stroke ?? 'transparent')" [class.il-layer-img]="l.kind === 'imagem'"></span>
                <input class="il-layer-name" [value]="l.name" (click)="$event.stopPropagation()" (change)="store.patch(l.id, { name: $any($event.target).value })" />
                @if (l.groupId) { <span class="il-layer-tag" title="Em grupo">G</span> }
                @if (l.cut) { <span class="il-layer-tag il-cut" title="Linha de corte">✂</span> }
                <button class="il-icon-btn" [class.il-active]="!l.visible" [title]="l.visible ? 'Ocultar' : 'Mostrar'" (click)="$event.stopPropagation(); store.patch(l.id, { visible: !l.visible })"><app-icon name="eye" [size]="12" /></button>
                <button class="il-icon-btn" [class.il-active]="l.locked" [title]="l.locked ? 'Destravar' : 'Travar'" (click)="$event.stopPropagation(); store.patch(l.id, { locked: !l.locked })">{{ l.locked ? '🔒' : '🔓' }}</button>
              </div>
            }
          </div>
        </div>
      </section>

      <!-- documento -->
      <section class="il-section" [class.il-open]="isOpen('documento')">
        <button class="il-section-head" (click)="toggle('documento')">
          <span class="il-section-title"><app-icon name="fit-to-screen" [size]="13" /> Prancheta</span>
          <span class="il-section-summary">{{ store.widthMm() }} × {{ store.heightMm() }} mm</span>
          <app-icon class="il-chevron" name="chevron" [size]="14" />
        </button>
        <div class="il-section-body">
          <div class="il-chips">
            @for (d of docPresets; track d.label) {
              <button class="il-chip" [class.il-active]="store.widthMm() === d.w && store.heightMm() === d.h" (click)="store.setDocSize(d.w, d.h)">{{ d.label }}</button>
            }
          </div>
          <div class="il-row">
            <label class="il-field"><span>Largura (mm)</span><input type="number" min="10" max="3000" step="1" [value]="store.widthMm()" (change)="store.setDocSize(clampNum(num($event), 10, 3000), store.heightMm())" /></label>
            <label class="il-field"><span>Altura (mm)</span><input type="number" min="10" max="3000" step="1" [value]="store.heightMm()" (change)="store.setDocSize(store.widthMm(), clampNum(num($event), 10, 3000))" /></label>
          </div>
          <button class="il-btn il-wide" [disabled]="!store.layers().length" (click)="fitBoard()">Ajustar a prancheta ao desenho</button>
          <button class="il-btn il-wide il-danger" [disabled]="!store.layers().length" (click)="clearAll()"><app-icon name="delete" [size]="13" /> Começar do zero</button>
        </div>
      </section>

      <!-- exportar -->
      <section class="il-section" [class.il-open]="isOpen('exportar')">
        <button class="il-section-head" (click)="toggle('exportar')">
          <span class="il-section-title"><app-icon name="download" [size]="13" /> Exportar</span>
          <app-icon class="il-chevron" name="chevron" [size]="14" />
        </button>
        <div class="il-section-body">
          <label class="il-field"><span>Nome do arquivo</span><input [value]="fileName()" (input)="fileName.set($any($event.target).value)" /></label>
          <label class="il-check"><input type="checkbox" [checked]="textAsText()" (change)="textAsText.set(!textAsText())" /> Texto reto editável (fonte embutida)</label>
          <button class="il-btn il-wide il-primary" [disabled]="busy() || !store.layers().length" (click)="exportSvg(false)"><app-icon name="download" [size]="13" /> SVG completo</button>
          <button class="il-btn il-wide" [disabled]="busy() || !store.layers().length" (click)="exportSvg(true)"><app-icon name="download" [size]="13" /> SVG só de corte</button>
          <div class="il-row">
            <button class="il-btn il-grow" [disabled]="busy() || !store.layers().length" (click)="exportPng()">PNG {{ dpi }} DPI</button>
            <button class="il-btn il-grow" [disabled]="busy() || !store.layers().length" (click)="exportPdf()">PDF</button>
          </div>
          <hr class="il-hr" />
          <button class="il-btn il-wide" [disabled]="busy() || !store.layers().length" (click)="toCut()">Enviar pro Print &amp; Cut</button>
          <button class="il-btn il-wide" [disabled]="busy() || !store.layers().length" (click)="toTemplate()">Usar como Molde SVG</button>
          <p class="il-note">O SVG de corte leva só as camadas marcadas como linha de corte (ou todo o vetor, se nenhuma estiver), em vermelho e em mm — pronto pro CanvasWorkspace.</p>
          @if (exportStatus()) { <p class="il-note">{{ exportStatus() }}</p> }
        </div>
      </section>
    </aside>
  `,
  styles: [`
    app-illustration-panel { display: contents; }
    .il-chips, .il-font-cats { display: flex; flex-wrap: wrap; gap: 4px; }
    .il-chip {
      padding: 5px 9px; font-size: 11px; font-weight: 600; color: var(--text-muted);
      background: var(--bg); border: 1px solid var(--border); border-radius: 999px;
    }
    .il-chip:hover { border-color: var(--accent); color: var(--accent); }
    .il-chip.il-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .il-suggest { color: var(--accent); }
    .il-font-list { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; max-height: 208px; overflow-y: auto; padding-right: 2px; }
    .il-font {
      display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 7px; min-width: 0;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); text-align: left;
    }
    .il-font:hover { border-color: var(--accent); }
    .il-font.il-active { border-color: var(--accent); background: var(--accent-soft); }
    .il-font-sample { font-size: 19px; line-height: 1.15; }
    .il-font-name { font-family: var(--font-body, inherit); font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .il-color { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); flex: 1; }
    .il-color input { width: 38px; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none; }
    .il-color input:disabled { opacity: 0.35; }
    .il-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
    .il-swatch-wrap { position: relative; }
    .il-swatch { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border); padding: 0; }
    .il-swatch-edit {
      position: absolute; right: -5px; bottom: -5px; width: 15px; height: 15px; display: flex; align-items: center; justify-content: center;
      font-size: 9px; background: var(--surface); border: 1px solid var(--border); border-radius: 50%; cursor: pointer; color: var(--text-muted);
    }
    .il-swatch-edit input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
    .il-grid6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
    .il-grid6 .il-btn { padding: 7px 0; font-size: 14px; }
    .il-hr { border: none; border-top: 1px solid var(--border); margin: 2px 0; width: 100%; }
    .il-layers { display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow-y: auto; }
    .il-layer {
      display: flex; align-items: center; gap: 5px; padding: 4px 5px; cursor: pointer;
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg);
    }
    .il-layer.il-layer-sel { border-color: var(--accent); background: var(--accent-soft); }
    .il-layer.il-layer-off { opacity: 0.55; }
    .il-layer-dot { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--border); flex-shrink: 0; }
    .il-layer-img { background-image: linear-gradient(45deg, var(--border) 25%, transparent 25%, transparent 75%, var(--border) 75%); background-size: 6px 6px; }
    .il-layer-name { flex: 1; min-width: 0; font-size: 12px; color: var(--text); background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 2px 4px; }
    .il-layer-name:focus { border-color: var(--border); background: var(--surface); }
    .il-layer-tag { font-size: 10px; font-weight: 700; color: var(--text-muted); }
    .il-layer-tag.il-cut { color: #e53935; }
  `],
})
export class IllustrationPanelComponent {
  readonly dpi = EXPORT_DPI;
  readonly Math = Math;
  readonly presetOrder = PRESET_ORDER;
  readonly presetLabels = PRESET_LABELS;
  readonly docPresets = DOC_PRESETS;
  readonly num = num;
  readonly aligns: { id: TextAlign; label: string }[] = [
    { id: 'left', label: 'Esquerda' }, { id: 'center', label: 'Centro' }, { id: 'right', label: 'Direita' },
  ];
  readonly curves: { id: TextCurve; label: string }[] = [
    { id: 'reta', label: 'Reto' }, { id: 'arco', label: 'Arco' }, { id: 'caminho', label: 'Caminho' },
  ];
  readonly alignModes: { id: AlignMode; label: string; glyph: string }[] = [
    { id: 'left', label: 'Esquerda', glyph: '⇤' }, { id: 'hcenter', label: 'Centro horizontal', glyph: '↔' },
    { id: 'right', label: 'Direita', glyph: '⇥' }, { id: 'top', label: 'Topo', glyph: '⤒' },
    { id: 'vcenter', label: 'Centro vertical', glyph: '↕' }, { id: 'bottom', label: 'Base', glyph: '⤓' },
  ];

  readonly sendToCut = output<{ canvas: HTMLCanvasElement; name: string; widthMm: number }>();
  readonly sendToTemplate = output<{ svg: string; name: string }>();

  textArea = viewChild<ElementRef<HTMLTextAreaElement>>('textArea');

  open = signal<Record<string, boolean>>({ vetorizar: true, texto: true, estilo: true, forma: true, organizar: false, combinar: false, camadas: true, documento: false, exportar: false });
  vecBusy = signal(false);
  vecError = signal('');
  fontCategory = signal<FontCategory>('Sem serifa');
  fontStatus = signal('');
  outlineMm = signal(3);
  outlineOuter = signal(true);
  keepRatio = signal(true);
  textAsText = signal(false);
  busy = signal(false);
  exportStatus = signal('');
  fileName = signal('ilustracao');

  private runTimer?: ReturnType<typeof setTimeout>;
  private typing = false;

  constructor(public store: IllustrationStore, private vectorizer: VectorizeService) {
    // Texto novo (ferramenta Texto, duplo clique): foca o campo e seleciona tudo.
    effect(() => {
      if (!this.store.focusText()) return;
      this.open.update((o) => ({ ...o, texto: true }));
      setTimeout(() => {
        const el = this.textArea()?.nativeElement;
        el?.focus();
        el?.select();
      });
    });
  }

  isOpen(id: SectionId): boolean {
    return this.open()[id] ?? false;
  }

  toggle(id: SectionId): void {
    this.open.update((o) => ({ ...o, [id]: !o[id] }));
  }

  clampNum(v: number, lo: number, hi: number): number {
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
  }

  round(v: number): number {
    return Math.round(v * 100) / 100;
  }

  // ---------- seleção ----------

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
    return l?.kind === 'forma' ? l : null;
  });

  pathLayer = computed(() => {
    const l = this.store.primary();
    return l?.kind === 'caminho' ? l : null;
  });

  nodeTotal = computed(() => countNodes(this.pathLayer()?.paths ?? []));

  vectorCount = computed(() => this.store.selection().filter((l) => l.kind !== 'imagem').length);
  canBreak = computed(() => this.store.selection().some((l) => l.kind === 'caminho' || l.kind === 'forma'));
  canConvert = computed(() => this.store.selection().some((l) => l.kind === 'texto' || l.kind === 'forma'));
  selectionGrouped = computed(() => this.store.selection().some((l) => l.groupId));
  stack = computed(() => [...this.store.layers()].reverse());

  /** Caminho ou forma selecionado junto com o texto: vira a guia. */
  guideCandidate = computed(() => this.store.selection().find((l) => l.kind === 'caminho' || l.kind === 'forma') ?? null);

  geometry = computed(() => {
    this.store.fonts.version();
    const b = this.store.selectionBounds();
    if (!b) return null;
    const l = this.store.primary();
    if (this.store.selection().length === 1 && l) {
      const lb = this.store.localBounds(l);
      return { x: b.minX, y: b.minY, w: (lb.maxX - lb.minX) * Math.abs(l.scaleX), h: (lb.maxY - lb.minY) * Math.abs(l.scaleY) };
    }
    return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  });

  isSelected(id: string): boolean {
    return this.store.selectedIds().includes(id);
  }

  categories(): FontCategory[] {
    return FONT_CATEGORIES.filter((c) => c !== 'Enviadas' || this.store.fonts.uploads().length);
  }

  fontsOf(c: FontCategory): FontFamily[] {
    return this.store.fonts.families().filter((f) => f.category === c);
  }

  hasBold(t: TextLayer): boolean {
    return this.store.fonts.family(t.fontId).weights.includes(700);
  }

  // ---------- vetorização ----------

  onImageInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.loadFile(file);
    input.value = '';
  }

  async loadFile(file: File): Promise<void> {
    this.vecError.set('');
    this.open.update((o) => ({ ...o, vetorizar: true }));
    try {
      let blob: Blob = file;
      if (isHeicFile(file)) {
        this.store.vecInfo.set('Convertendo a foto do iPhone…');
        const { heicTo } = await import('heic-to');
        blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
      }
      const url = URL.createObjectURL(blob);
      try {
        const img = await readImage(url);
        await this.loadCanvas(img, file.name.replace(/\.[^.]+$/, '') || 'imagem');
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      this.vecError.set(err instanceof Error ? err.message : 'Não consegui abrir essa imagem.');
    }
  }

  /** Começa uma vetorização nova: mede a imagem, escolhe a leitura e roda. */
  async loadCanvas(source: HTMLImageElement | HTMLCanvasElement, name: string): Promise<void> {
    this.open.update((o) => ({ ...o, vetorizar: true }));
    this.vecError.set('');
    const canvas = vectorizeCanvas(source);
    this.store.vecSource.set({ name, canvas, dataUrl: encodeCanvas(canvas) });
    this.store.vecGroupId.set(null);
    this.store.vecRefId.set(null);
    const W = this.store.widthMm(), H = this.store.heightMm();
    const aspect = canvas.width / canvas.height;
    this.store.vecWidthMm.set(Math.round(Math.min(W * 0.8, H * 0.8 * aspect)));
    this.vecBusy.set(true);
    try {
      const stats = await this.vectorizer.analyze(canvas);
      const s = suggestPreset(stats);
      this.store.vecStats.set(stats);
      this.store.vecPreset.set(s.preset);
      this.store.vecReason.set(s.reason);
      this.store.vecParams.set(s.params);
      this.fileName.set(name);
      await this.run();
    } catch {
      this.vecBusy.set(false);
      this.vecError.set('Não consegui analisar essa imagem.');
    }
  }

  choosePreset(id: PresetId): void {
    this.store.vecPreset.set(id);
    this.store.vecParams.set(presetParams(id, this.store.vecStats()));
    this.schedule(0);
  }

  setParam<K extends keyof VectorizeParams>(key: K, value: VectorizeParams[K]): void {
    const p = this.store.vecParams();
    if (!p) return;
    this.store.vecParams.set({ ...p, [key]: value });
    this.schedule(350);
  }

  setVecWidth(w: number): void {
    if (!(w > 0)) return;
    this.store.vecWidthMm.set(this.clampNum(w, 5, 2000));
    this.schedule(0);
  }

  private schedule(ms: number): void {
    clearTimeout(this.runTimer);
    this.runTimer = setTimeout(() => void this.run(), ms);
  }

  private async run(): Promise<void> {
    const src = this.store.vecSource();
    const params = this.store.vecParams();
    if (!src || !params) return;
    this.vecBusy.set(true);
    try {
      const result = await this.vectorizer.run(src.canvas, params);
      this.store.applyVectorization(result, this.store.vecWidthMm());
      const nodes = result.layers.reduce((s, l) => s + countNodes(l.paths), 0);
      const shapes = result.layers.reduce((s, l) => s + l.paths.length, 0);
      this.store.vecInfo.set(result.layers.length
        ? `${result.layers.length} camada(s) · ${shapes} forma(s) · ${nodes.toLocaleString('pt-BR')} nós${nodes > 40000 ? ' — é muito: baixe o detalhe ou as cores.' : ''}`
        : 'Nada foi encontrado com esses ajustes — mexa no limiar ou no detalhe.');
      this.vecBusy.set(false);
    } catch (err) {
      if (err instanceof StaleRequest) return;
      this.vecBusy.set(false);
      this.vecError.set('A vetorização falhou. Tente uma imagem menor ou menos cores.');
    }
  }

  // ---------- texto ----------

  addText(): void {
    const t = this.store.newText(this.store.widthMm() / 2, this.store.heightMm() / 2);
    this.store.addLayers([t]);
    this.store.focusText.update((v) => v + 1);
  }

  /** Digitação e controles deslizantes viram um passo só no histórico. */
  patchText(patch: Partial<TextLayer>, continuous = false): void {
    const t = this.text();
    if (!t) return;
    if (continuous) {
      if (!this.typing) {
        this.typing = true;
        this.store.begin();
      }
      this.store.patch(t.id, patch, false);
    } else {
      this.store.patch(t.id, patch);
    }
  }

  endTyping(): void {
    if (!this.typing) return;
    this.typing = false;
    this.store.end();
  }

  setCurve(t: TextLayer, curve: TextCurve): void {
    if (curve === 'caminho' && !t.guide) {
      const guide = this.guideCandidate();
      if (!guide || !this.store.attachTextToPath(t.id, guide.id)) return;
      this.store.patch(guide.id, { visible: false }, false);
      this.store.select(t.id);
      return;
    }
    this.patchText({ curve });
  }

  onFontInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.fontStatus.set('Lendo a fonte…');
    this.store.fonts.addUpload(file, uuid().slice(0, 8))
      .then((up) => {
        this.fontStatus.set(`"${up.name}" adicionada em "Enviadas".`);
        this.fontCategory.set('Enviadas');
        const t = this.text();
        if (t) this.patchText({ fontId: this.store.fonts.uploadFontId(up.id) });
      })
      .catch((err) => this.fontStatus.set(err instanceof FontError ? err.message : 'Não consegui ler essa fonte.'));
  }

  // ---------- estilo ----------

  setPaint(which: 'fill' | 'stroke', value: string | null, continuous = false): void {
    if (value) this.store.currentFill.set(value);
    const ids = this.store.selection().filter((l) => l.kind !== 'imagem').map((l) => l.id);
    if (continuous) {
      if (!this.typing) {
        this.typing = true;
        this.store.begin();
      }
      this.store.patchMany(ids, () => ({ [which]: value }), false);
    } else {
      this.store.patchMany(ids, () => ({ [which]: value }));
    }
  }

  toggleCut(l: Layer): void {
    const cut = !l.cut;
    this.store.patchSelection(cut ? { cut, stroke: l.stroke ?? CUT_COLOR } : { cut });
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

  patchShape(patch: Partial<ShapeLayer>, continuous = false): void {
    const s = this.shape();
    if (!s) return;
    if (continuous) {
      if (!this.typing) {
        this.typing = true;
        this.store.begin();
      }
      this.store.patch(s.id, patch, false);
    } else {
      this.store.patch(s.id, patch);
    }
  }

  // ---------- posição ----------

  moveTo(axis: 'x' | 'y', value: number): void {
    const g = this.geometry();
    if (!g || !Number.isFinite(value)) return;
    const d = value - (axis === 'x' ? g.x : g.y);
    this.store.patchMany(this.store.selectedIds(), (l) => (l.locked ? null : axis === 'x' ? { x: l.x + d } : { y: l.y + d }));
  }

  resizeTo(axis: 'w' | 'h', value: number): void {
    const g = this.geometry();
    if (!g || !(value > 0)) return;
    const f = value / (axis === 'w' ? g.w : g.h);
    if (!Number.isFinite(f) || f <= 0) return;
    const fx = axis === 'w' || this.keepRatio() ? f : 1;
    const fy = axis === 'h' || this.keepRatio() ? f : 1;
    const sel = this.store.selection();
    if (sel.length === 1) {
      this.store.patch(sel[0].id, { scaleX: sel[0].scaleX * fx, scaleY: sel[0].scaleY * fy });
      return;
    }
    // Várias: escala a partir do canto de cima à esquerda da seleção.
    this.store.patchMany(sel.map((l) => l.id), (l) => ({
      x: g.x + (l.x - g.x) * fx, y: g.y + (l.y - g.y) * fy, scaleX: l.scaleX * fx, scaleY: l.scaleY * fy,
    }));
  }

  rotateTo(deg: number): void {
    const l = this.store.primary();
    if (!l || !Number.isFinite(deg)) return;
    this.store.patch(l.id, { rotation: ((deg + 180) % 360 + 360) % 360 - 180 });
  }

  // ---------- combinar ----------

  combine(op: BoolOp): void {
    if (!this.store.combine(op)) this.store.status.set('Selecione as formas primeiro.');
  }

  outline(): void {
    if (!this.store.outline(this.outlineMm(), this.outlineOuter())) this.store.status.set('Não há área pra contornar.');
  }

  // ---------- nós ----------

  nodeOp(op: 'smooth' | 'corner' | 'add'): void {
    const sel = this.store.nodeSel();
    const l = this.pathLayer();
    if (!sel || !l) return;
    const path = l.paths[sel.path];
    if (!path) return;
    const next = op === 'smooth' ? smoothNode(path, sel.node) : op === 'corner' ? cornerNode(path, sel.node) : addNodeAfter(path, sel.node);
    this.store.record();
    this.store.setPath(l.id, sel.path, next, false);
    if (op === 'add') this.store.nodeSel.set({ ...sel, node: sel.node + 1 });
  }

  deleteNode(): void {
    const sel = this.store.nodeSel();
    const l = this.pathLayer();
    if (!sel || !l) return;
    const path = l.paths[sel.path];
    if (!path) return;
    this.store.record();
    this.store.setPath(l.id, sel.path, deleteNode(path, sel.node), false);
    this.store.nodeSel.set(null);
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
    if (!confirm('Apagar tudo da ilustração? (dá pra desfazer só até salvar o projeto)')) return;
    this.store.record();
    this.store.layers.set([]);
    this.store.selectedIds.set([]);
    this.store.vecSource.set(null);
    this.store.vecParams.set(null);
    this.store.vecGroupId.set(null);
    this.store.vecRefId.set(null);
    this.store.vecInfo.set('');
  }

  // ---------- exportar ----------

  private baseName(): string {
    return (this.fileName().trim() || 'ilustracao').replace(/[\\/:*?"<>|]+/g, '-');
  }

  private async withBusy(label: string, job: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.exportStatus.set(label);
    try {
      await job();
    } catch {
      this.exportStatus.set('Falha ao exportar. Se houver imagens muito grandes, tente sem elas.');
    } finally {
      this.busy.set(false);
    }
  }

  exportSvg(cutOnly: boolean): Promise<void> {
    return this.withBusy('Gerando SVG…', async () => {
      const svg = await buildSvg(this.store, { cutOnly, textAsText: this.textAsText() });
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${this.baseName()}${cutOnly ? '-corte' : ''}.svg`);
      this.exportStatus.set(cutOnly ? 'SVG de corte salvo.' : 'SVG salvo.');
    });
  }

  private async raster(background: string | null): Promise<HTMLCanvasElement> {
    const svg = await buildSvg(this.store, { skipCut: true });
    return rasterizeSvg(svg, this.store.widthMm(), this.store.heightMm(), EXPORT_DPI, background);
  }

  exportPng(): Promise<void> {
    return this.withBusy('Gerando PNG…', async () => {
      const canvas = await this.raster(null);
      const blob = await pngBlobWithDpi(await canvasToBlob(canvas, 'image/png'), EXPORT_DPI);
      downloadBlob(blob, `${this.baseName()}.png`);
      this.exportStatus.set(`PNG ${canvas.width}×${canvas.height} px salvo (sem as linhas de corte).`);
    });
  }

  exportPdf(): Promise<void> {
    return this.withBusy('Gerando PDF…', async () => {
      const canvas = await this.raster('#ffffff');
      const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
      downloadBlob(jpegToPdf(jpeg, this.store.widthMm(), this.store.heightMm(), canvas.width, canvas.height), `${this.baseName()}.pdf`);
      this.exportStatus.set('PDF salvo no tamanho da prancheta.');
    });
  }

  /** A arte (sem as linhas de corte) vai recortada no próprio desenho: o
   * Print & Cut faz o contorno dele em volta. */
  toCut(): Promise<void> {
    return this.withBusy('Preparando…', async () => {
      const b = contentBounds(this.store, true);
      if (!b) {
        this.exportStatus.set('Nada pra enviar (só há linhas de corte).');
        return;
      }
      const svg = await buildSvg(this.store, { skipCut: true, bounds: b });
      const w = b.maxX - b.minX;
      const canvas = await rasterizeSvg(svg, w, b.maxY - b.minY, EXPORT_DPI, null, 9_000_000);
      this.sendToCut.emit({ canvas, name: this.baseName(), widthMm: Math.round(w * 10) / 10 });
      this.exportStatus.set('');
    });
  }

  toTemplate(): Promise<void> {
    return this.withBusy('Preparando…', async () => {
      const svg = await buildSvg(this.store, { skipCut: true });
      this.sendToTemplate.emit({ svg, name: `${this.baseName()}.svg` });
      this.exportStatus.set('');
    });
  }
}
