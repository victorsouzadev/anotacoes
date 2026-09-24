/** Barra de controle, em cima do palco: muda conforme a seleção e a
 * ferramenta, como o "Control" do Illustrator e a barra de comandos do
 * Inkscape. O que se mexe o tempo todo (cor, traço, fonte, posição,
 * alinhamento, Pathfinder) fica aqui; o resto mora no painel Propriedades. */

import { Component, computed, inject, output } from '@angular/core';
import { nearestWeight } from './fonts';
import { IlFontPickerComponent } from './illustration-font-picker';
import { IlIconComponent, IlIconName } from './illustration-icons';
import { IlNumComponent, NumChange } from './illustration-num';
import { AlignMode, IllustrationStore, PaintTarget } from './illustration-store';
import { Layer, ShapeLayer, TextAlign, TextLayer, normalizeHex } from './illustration-model';
import { BoolOp } from './vector-ops';

export const ALIGN_BUTTONS: { id: AlignMode; icon: IlIconName; label: string }[] = [
  { id: 'left', icon: 'align-left', label: 'Alinhar à esquerda' },
  { id: 'hcenter', icon: 'align-hcenter', label: 'Centralizar na horizontal' },
  { id: 'right', icon: 'align-right', label: 'Alinhar à direita' },
  { id: 'top', icon: 'align-top', label: 'Alinhar ao topo' },
  { id: 'vcenter', icon: 'align-vcenter', label: 'Centralizar na vertical' },
  { id: 'bottom', icon: 'align-bottom', label: 'Alinhar à base' },
];

export const PATHFINDER: { id: BoolOp; icon: IlIconName; label: string; min: number }[] = [
  { id: 'unir', icon: 'unite', label: 'Unir / soldar', min: 1 },
  { id: 'subtrair', icon: 'minus-front', label: 'Subtrair a da frente', min: 2 },
  { id: 'intersecao', icon: 'intersect', label: 'Interseção', min: 2 },
  { id: 'excluir', icon: 'exclude', label: 'Excluir sobreposição', min: 2 },
];

const KIND_LABEL: Record<Layer['kind'], string> = { caminho: 'Caminho', forma: 'Forma', texto: 'Texto', imagem: 'Imagem' };

@Component({
  selector: 'il-controlbar',
  standalone: true,
  imports: [IlIconComponent, IlNumComponent, IlFontPickerComponent],
  host: { class: 'il-controlbar' },
  template: `
    <div class="il-cb-group">
      <button type="button" class="il-ib" [disabled]="!store.canUndo()" data-tip="Desfazer  Ctrl+Z" aria-label="Desfazer" (click)="store.undo()"><il-icon name="undo" /></button>
      <button type="button" class="il-ib" [disabled]="!store.canRedo()" data-tip="Refazer  Ctrl+Shift+Z" aria-label="Refazer" (click)="store.redo()"><il-icon name="redo" /></button>
    </div>
    <span class="il-cb-kind">{{ kindLabel() }}</span>

    @if (store.tool() === 'nos' && store.primary()?.kind === 'caminho') {
      <div class="il-cb-group">
        <span class="il-cb-label">Nó</span>
        <button type="button" class="il-ib" [disabled]="!store.nodeSel()" data-tip="Suavizar nó" aria-label="Suavizar nó" (click)="nodeOp.emit('smooth')"><il-icon name="node-smooth" /></button>
        <button type="button" class="il-ib" [disabled]="!store.nodeSel()" data-tip="Converter em canto" aria-label="Converter em canto" (click)="nodeOp.emit('corner')"><il-icon name="node-corner" /></button>
        <button type="button" class="il-ib" [disabled]="!store.nodeSel()" data-tip="Acrescentar nó depois" aria-label="Acrescentar nó" (click)="nodeOp.emit('add')"><il-icon name="node-add" /></button>
        <button type="button" class="il-ib" [disabled]="!store.nodeSel()" data-tip="Apagar nó  Delete" aria-label="Apagar nó" (click)="nodeOp.emit('delete')"><il-icon name="node-delete" /></button>
      </div>
    }

    @if (vector()) {
      <div class="il-cb-group">
        <button type="button" class="il-swatch-btn" data-tip="Preenchimento" aria-label="Preenchimento" (click)="openColor('fill')">
          <span class="il-sw" [class.il-sw-none]="!store.shownFill()" [style.background]="store.shownFill() ?? null"></span>
        </button>
        <button type="button" class="il-swatch-btn" data-tip="Traço" aria-label="Traço" (click)="openColor('stroke')">
          <span class="il-sw il-sw-stroke" [class.il-sw-none]="!store.shownStroke()" [style.--c]="store.shownStroke() ?? null"></span>
        </button>
        <il-num label="Traço" title="Espessura do traço" unit="mm" [value]="store.shownStroke() ? store.shownStrokeWidth() : 0" [step]="0.05" [min]="0" [max]="50" [decimals]="2" (valueChange)="onStroke($event)" (done)="store.commitLive()" />
        <il-num label="Opac." title="Opacidade" unit="%" [value]="(store.primary()?.opacity ?? 1) * 100" [step]="1" [min]="0" [max]="100" [decimals]="0" (valueChange)="onOpacity($event)" (done)="store.commitLive()" />
        <input #color type="color" class="il-hidden-color" tabindex="-1" aria-hidden="true" (input)="onColor($event)" (change)="store.commitLive()" />
      </div>
    }

    @if (text(); as t) {
      <div class="il-cb-group">
        <il-font-picker class="il-cb-font" [fontId]="t.fontId" [sample]="t.text.split('\\n')[0].slice(0, 24)" (picked)="store.patch(t.id, { fontId: $event })" />
        <select class="il-select" [value]="weightOf(t)" (change)="store.patch(t.id, { weight: +$any($event.target).value })" aria-label="Peso">
          <option value="400">Normal</option>
          @if (hasBold(t)) { <option value="700">Negrito</option> }
        </select>
        <il-num label="T" title="Tamanho do corpo" unit="mm" [value]="t.sizeMm" [step]="0.5" [min]="1" [max]="1000" (valueChange)="patchText(t, { sizeMm: $event.value }, $event)" (done)="store.commitLive()" />
        @for (a of textAligns; track a.id) {
          <button type="button" class="il-ib" [class.il-on]="t.align === a.id" [attr.data-tip]="a.label" [attr.aria-label]="a.label" (click)="store.patch(t.id, { align: a.id })"><il-icon [name]="a.icon" /></button>
        }
      </div>
    }

    @if (shape(); as s) {
      <div class="il-cb-group">
        @if (s.shape === 'retangulo') {
          <il-num label="Raio" title="Cantos arredondados" unit="mm" [value]="s.radius" [step]="0.5" [min]="0" [max]="Math.min(s.w, s.h) / 2" (valueChange)="patchShape(s, { radius: $event.value }, $event)" (done)="store.commitLive()" />
        }
        @if (s.shape === 'estrela' || s.shape === 'poligono') {
          <il-num [label]="s.shape === 'estrela' ? 'Pontas' : 'Lados'" [value]="s.points" [step]="1" [min]="3" [max]="60" [decimals]="0" (valueChange)="patchShape(s, { points: $event.value }, $event)" (done)="store.commitLive()" />
        }
      </div>
    }

    @if (store.geometry(); as g) {
      <div class="il-cb-group">
        <il-num label="X" unit="mm" [value]="g.x" [step]="0.5" (valueChange)="onGeom('x', $event)" (done)="store.commitLive()" />
        <il-num label="Y" unit="mm" [value]="g.y" [step]="0.5" (valueChange)="onGeom('y', $event)" (done)="store.commitLive()" />
        <il-num label="L" title="Largura" unit="mm" [value]="g.w" [step]="0.5" [min]="0.1" (valueChange)="onGeom('w', $event)" (done)="store.commitLive()" />
        <button type="button" class="il-ib il-ib-sm" [class.il-on]="store.keepRatio()" [attr.data-tip]="store.keepRatio() ? 'Proporção travada' : 'Proporção livre'" aria-label="Manter proporção" (click)="store.keepRatio.set(!store.keepRatio())"><il-icon [name]="store.keepRatio() ? 'link' : 'unlink'" [size]="14" /></button>
        <il-num label="A" title="Altura" unit="mm" [value]="g.h" [step]="0.5" [min]="0.1" (valueChange)="onGeom('h', $event)" (done)="store.commitLive()" />
        @if (store.primary(); as l) {
          <il-num label="⟳" title="Giro" unit="°" [value]="l.rotation" [step]="1" [decimals]="1" (valueChange)="onRotate($event)" (done)="store.commitLive()" />
        }
      </div>
      <div class="il-cb-group">
        @for (a of aligns; track a.id) {
          <button type="button" class="il-ib" [attr.data-tip]="a.label + (store.selection().length > 1 ? '' : ' (à prancheta)')" [attr.aria-label]="a.label" (click)="store.align(a.id)"><il-icon [name]="a.icon" /></button>
        }
      </div>
      @if (vectorCount() > 0) {
        <div class="il-cb-group">
          @for (p of pathfinder; track p.id) {
            <button type="button" class="il-ib" [disabled]="vectorCount() < p.min" [attr.data-tip]="p.label" [attr.aria-label]="p.label" (click)="store.combine(p.id)"><il-icon [name]="p.icon" /></button>
          }
        </div>
      }
    } @else if (store.tool() === 'selecionar' || store.tool() === 'mao' || store.tool() === 'zoom') {
      <div class="il-cb-group">
        <span class="il-cb-label">Prancheta</span>
        <il-num label="L" title="Largura da prancheta" unit="mm" [value]="store.widthMm()" [step]="1" [min]="10" [max]="3000" [decimals]="0" (valueChange)="setBoard('w', $event)" />
        <il-num label="A" title="Altura da prancheta" unit="mm" [value]="store.heightMm()" [step]="1" [min]="10" [max]="3000" [decimals]="0" (valueChange)="setBoard('h', $event)" />
        <button type="button" class="il-ib" [class.il-on]="store.snap()" data-tip="Guias inteligentes (atração)" aria-label="Guias inteligentes" (click)="store.snap.set(!store.snap())"><il-icon name="magnet" /></button>
      </div>
      <span class="il-cb-hint">{{ hint() }}</span>
    } @else if (store.tool() === 'borracha') {
      <div class="il-cb-group">
        <span class="il-cb-label">Borracha</span>
        <il-num label="⌀" title="Diâmetro da borracha" unit="mm" [value]="store.eraserMm() * 2" [step]="0.5" [min]="0.5" [max]="100" (valueChange)="store.eraserMm.set($event.value / 2)" />
      </div>
      <span class="il-cb-hint">{{ hint() }}</span>
    } @else {
      <span class="il-cb-hint">{{ hint() }}</span>
    }
  `,
})
export class IlControlbarComponent {
  store = inject(IllustrationStore);
  readonly Math = Math;
  readonly aligns = ALIGN_BUTTONS;
  readonly pathfinder = PATHFINDER;
  readonly textAligns: { id: TextAlign; icon: IlIconName; label: string }[] = [
    { id: 'left', icon: 'text-left', label: 'Texto à esquerda' },
    { id: 'center', icon: 'text-center', label: 'Texto centralizado' },
    { id: 'right', icon: 'text-right', label: 'Texto à direita' },
  ];

  nodeOp = output<'smooth' | 'corner' | 'add' | 'delete'>();

  private colorTarget: PaintTarget = 'fill';

  vector = computed(() => {
    const sel = this.store.selection();
    return !sel.length ? this.store.tool() !== 'nos' : sel.some((l) => l.kind !== 'imagem');
  });
  vectorCount = computed(() => this.store.selection().filter((l) => l.kind !== 'imagem').length);

  text = computed(() => {
    const l = this.store.primary();
    return l?.kind === 'texto' && this.store.selection().length === 1 ? l : null;
  });

  shape = computed(() => {
    const l = this.store.primary();
    return l?.kind === 'forma' && this.store.selection().length === 1 ? l : null;
  });

  kindLabel = computed(() => {
    const sel = this.store.selection();
    if (!sel.length) return this.store.tool() === 'nos' ? 'Seleção direta' : 'Nenhuma seleção';
    if (sel.length === 1) return KIND_LABEL[sel[0].kind];
    const groups = new Set(sel.map((l) => l.groupId ?? l.id));
    return groups.size === 1 ? `Grupo (${sel.length})` : `${sel.length} objetos`;
  });

  hint = computed(() => {
    switch (this.store.tool()) {
      case 'caneta': return 'Clique pra reta, arraste pra curva · clique no 1º ponto fecha · Enter termina · Esc cancela';
      case 'texto': return 'Clique na prancheta pra criar um texto';
      case 'contagotas': return 'Clique numa cor da arte';
      case 'mao': return 'Arraste pra mover a vista';
      case 'zoom': return 'Clique aproxima · Alt+clique afasta';
      case 'nos': return 'Clique num caminho pra ver os nós';
      case 'lapis': return 'Desenhe à mão livre · termine perto do início pra fechar · usa as cores atuais';
      case 'borracha': return 'Arraste sobre os vetores · [ e ] mudam o tamanho · com seleção, só apaga nela';
      case 'selecionar': return '';
      default: return 'Arraste na prancheta · Shift deixa proporcional';
    }
  });

  weightOf(t: TextLayer): number {
    return nearestWeight(this.store.fonts.family(t.fontId).weights, t.weight);
  }

  hasBold(t: TextLayer): boolean {
    return this.store.fonts.family(t.fontId).weights.includes(700);
  }

  openColor(target: PaintTarget): void {
    this.colorTarget = target;
    this.store.paintTarget.set(target);
    const el = document.querySelector<HTMLInputElement>('il-controlbar .il-hidden-color');
    if (!el) return;
    const current = normalizeHex(target === 'fill' ? this.store.shownFill() : this.store.shownStroke());
    el.value = current ?? '#000000';
    el.click();
  }

  onColor(event: Event): void {
    this.store.setPaint(this.colorTarget, (event.target as HTMLInputElement).value, true);
  }

  onStroke(e: NumChange): void {
    this.store.setStrokeWidth(e.value, e.live);
    if (!e.live) this.store.commitLive();
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

  patchText(t: TextLayer, patch: Partial<TextLayer>, e: NumChange): void {
    if (e.live) this.store.live(() => this.store.patch(t.id, patch, false));
    else this.store.patch(t.id, patch);
  }

  patchShape(s: ShapeLayer, patch: Partial<ShapeLayer>, e: NumChange): void {
    if (e.live) this.store.live(() => this.store.patch(s.id, patch, false));
    else this.store.patch(s.id, patch);
  }

  setBoard(axis: 'w' | 'h', e: NumChange): void {
    const v = Math.round(e.value);
    if (axis === 'w') this.store.setDocSize(v, this.store.heightMm());
    else this.store.setDocSize(this.store.widthMm(), v);
  }
}
