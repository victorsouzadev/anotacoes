/** Desfazer/refazer por fotografias do estado, pros modos que não nasceram com
 * histórico (Print & Cut e Molde). Quem usa observa o próprio estado num
 * `effect` e chama `observe()` a cada mudança; o histórico guarda o estado de
 * antes. Mudanças em sequência rápida (arrastar um controle, várias
 * borrachadas) viram um passo só. */

import { computed, signal } from '@angular/core';

const MAX_STEPS = 80;

export class SnapshotHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private last: T | null = null;
  private lastAt = 0;
  private restoring = false;
  private readonly version = signal(0);

  readonly canUndo = computed(() => {
    this.version();
    return this.past.length > 0;
  });

  readonly canRedo = computed(() => {
    this.version();
    return this.future.length > 0;
  });

  /**
   * @param coalesceMs mudanças a menos disto da anterior entram no mesmo passo
   * @param same diz quando duas fotografias são o mesmo estado (padrão: mesma referência)
   * @param now relógio, trocável nos testes
   */
  constructor(
    private readonly coalesceMs = 700,
    private readonly same: (a: T, b: T) => boolean = (a, b) => a === b,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** O estado mudou (ou é o primeiro). */
  observe(current: T): void {
    if (this.restoring) {
      this.restoring = false;
      this.last = current;
      return;
    }
    if (this.last === null) {
      this.last = current;
      return;
    }
    if (this.same(this.last, current)) {
      this.last = current;
      return;
    }
    const t = this.now();
    if (!this.past.length || t - this.lastAt > this.coalesceMs) {
      this.past.push(this.last);
      if (this.past.length > MAX_STEPS) this.past.shift();
    }
    this.lastAt = t;
    this.future = [];
    this.last = current;
    this.version.update((v) => v + 1);
  }

  /** Estado pra onde voltar, ou null. Quem chama aplica o estado; a próxima
   * observação é reconhecida como a restauração e não vira passo novo. */
  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined || this.last === null) return null;
    this.future.push(this.last);
    return this.jump(prev);
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined || this.last === null) return null;
    this.past.push(this.last);
    return this.jump(next);
  }

  /** Esquece tudo (projeto novo, molde trocado): o próximo estado é a base. */
  reset(): void {
    this.past = [];
    this.future = [];
    this.last = null;
    this.restoring = false;
    this.version.update((v) => v + 1);
  }

  private jump(to: T): T {
    this.last = to;
    this.lastAt = 0;
    this.restoring = true;
    this.version.update((v) => v + 1);
    return to;
  }
}
