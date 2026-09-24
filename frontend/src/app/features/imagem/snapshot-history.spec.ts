import { describe, expect, it } from 'vitest';
import { SnapshotHistory } from './snapshot-history';

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('SnapshotHistory', () => {
  it('o primeiro estado é a base, sem nada pra desfazer', () => {
    const h = new SnapshotHistory<number>();
    h.observe(1);
    expect(h.canUndo()).toBe(false);
  });

  it('desfaz e refaz passo a passo', () => {
    const c = clock();
    const h = new SnapshotHistory<number>(500, undefined, c.now);
    h.observe(1);
    c.advance(1000); h.observe(2);
    c.advance(1000); h.observe(3);
    expect(h.undo()).toBe(2);
    h.observe(2); // quem chamou aplicou o estado
    expect(h.undo()).toBe(1);
    h.observe(1);
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toBe(2);
    h.observe(2);
    expect(h.redo()).toBe(3);
    expect(h.canRedo()).toBe(false);
  });

  it('mudanças rápidas viram um passo só', () => {
    const c = clock();
    const h = new SnapshotHistory<number>(500, undefined, c.now);
    h.observe(0);
    c.advance(1000); h.observe(1);
    c.advance(50); h.observe(2);
    c.advance(50); h.observe(3);
    expect(h.undo()).toBe(0);
  });

  it('um passo novo depois de desfazer descarta o refazer', () => {
    const c = clock();
    const h = new SnapshotHistory<number>(500, undefined, c.now);
    h.observe(1);
    c.advance(1000); h.observe(2);
    h.undo(); h.observe(1);
    c.advance(1000); h.observe(5);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe(1);
  });

  it('estado igual pelo critério não vira passo', () => {
    const c = clock();
    const h = new SnapshotHistory<{ v: number; ruido: number }>(500, (a, b) => a.v === b.v, c.now);
    h.observe({ v: 1, ruido: 0 });
    c.advance(1000); h.observe({ v: 1, ruido: 9 });
    expect(h.canUndo()).toBe(false);
  });

  it('reset esquece o histórico', () => {
    const c = clock();
    const h = new SnapshotHistory<number>(500, undefined, c.now);
    h.observe(1);
    c.advance(1000); h.observe(2);
    h.reset();
    h.observe(7);
    expect(h.canUndo()).toBe(false);
  });
});
