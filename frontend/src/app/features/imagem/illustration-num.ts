/** Campo numérico da área de trabalho, como nos apps da Adobe: arrastar o
 * rótulo pra esquerda/direita muda o valor (Shift = 10×), setas do teclado
 * sobem e descem, Enter aplica. Enquanto arrasta, emite `live: true` — quem
 * usa aplica com `store.live()` e fecha o passo do histórico em `done`. */

import { Component, ElementRef, computed, input, output, viewChild } from '@angular/core';

export interface NumChange {
  value: number;
  live: boolean;
}

@Component({
  selector: 'il-num',
  standalone: true,
  host: { class: 'il-num', '[class.il-num-wide]': 'wide()' },
  template: `
    <span
      class="il-num-label"
      [title]="title() || 'Arraste pra ajustar'"
      (pointerdown)="startScrub($event)"
      (pointermove)="scrub($event)"
      (pointerup)="endScrub($event)"
      (pointercancel)="endScrub($event)"
    >{{ label() }}</span>
    <input
      #field
      type="text"
      inputmode="decimal"
      [value]="shown()"
      [disabled]="disabled()"
      [attr.aria-label]="title() || label()"
      (keydown)="onKey($event)"
      (change)="commit()"
      (focus)="field.select()"
    />
    @if (unit()) { <span class="il-num-unit">{{ unit() }}</span> }
  `,
})
export class IlNumComponent {
  label = input('');
  title = input('');
  value = input<number | null>(null);
  step = input(1);
  min = input(-1e6);
  max = input(1e6);
  decimals = input(1);
  unit = input('');
  disabled = input(false);
  wide = input(false);

  valueChange = output<NumChange>();
  done = output<void>();

  private field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private scrubbing: { x: number; base: number; id: number; moved: boolean } | null = null;

  shown = computed(() => {
    const v = this.value();
    if (v === null || !Number.isFinite(v)) return '';
    return String(Math.round(v * 10 ** this.decimals()) / 10 ** this.decimals()).replace('.', ',');
  });

  private clamp(v: number): number {
    return Math.min(this.max(), Math.max(this.min(), v));
  }

  private parse(): number | null {
    const raw = this.field().nativeElement.value.trim().replace(',', '.');
    if (!raw) return null;
    // aceita conta simples, como no Illustrator: "10+2,5" ou "40/2"
    if (!/^[-+*/().\d\s]+$/.test(raw)) return null;
    try {
      const v = Function(`"use strict"; return (${raw});`)() as number;
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  commit(): void {
    const v = this.parse();
    if (v === null) {
      this.field().nativeElement.value = this.shown();
      return;
    }
    this.valueChange.emit({ value: this.clamp(v), live: false });
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.commit();
      this.field().nativeElement.blur();
      return;
    }
    if (event.key === 'Escape') {
      this.field().nativeElement.value = this.shown();
      this.field().nativeElement.blur();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = this.parse() ?? this.value() ?? 0;
      const d = this.step() * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      this.valueChange.emit({ value: this.clamp(base + d), live: false });
    }
  }

  startScrub(event: PointerEvent): void {
    if (this.disabled() || event.button !== 0) return;
    (event.target as Element).setPointerCapture(event.pointerId);
    this.scrubbing = { x: event.clientX, base: this.value() ?? 0, id: event.pointerId, moved: false };
    event.preventDefault();
  }

  scrub(event: PointerEvent): void {
    const s = this.scrubbing;
    if (!s || s.id !== event.pointerId) return;
    const dx = event.clientX - s.x;
    if (!s.moved && Math.abs(dx) < 2) return;
    s.moved = true;
    const f = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const v = this.clamp(s.base + Math.round(dx / 2) * this.step() * f);
    this.valueChange.emit({ value: Math.round(v * 1e4) / 1e4, live: true });
  }

  endScrub(event: PointerEvent): void {
    const s = this.scrubbing;
    if (!s || s.id !== event.pointerId) return;
    this.scrubbing = null;
    if (s.moved) this.done.emit();
    else this.field().nativeElement.focus();
  }
}
