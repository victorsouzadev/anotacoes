import { describe, expect, it } from 'vitest';
import {
  decodeRecurrence,
  nextOccurrence,
  encodeRecurrence,
  formatDuration,
  totalTimeSpent,
} from './task.model';

describe('encodeRecurrence / decodeRecurrence', () => {
  it('codifica e decodifica recorrência diária', () => {
    const encoded = encodeRecurrence('DAILY', 3);
    expect(encoded).toBe('DAILY:3');
    expect(decodeRecurrence(encoded)).toEqual({ kind: 'DAILY', intervalDays: 3 });
  });

  it('codifica e decodifica recorrência semanal', () => {
    const encoded = encodeRecurrence('WEEKLY', 'MONDAY,FRIDAY');
    expect(encoded).toBe('WEEKLY:MONDAY,FRIDAY');
    expect(decodeRecurrence(encoded)).toEqual({ kind: 'WEEKLY', daysOfWeek: ['MONDAY', 'FRIDAY'] });
  });

  it('recorrência semanal sem dias selecionados retorna null', () => {
    expect(encodeRecurrence('WEEKLY', '')).toBeNull();
  });

  it('codifica e decodifica recorrência mensal', () => {
    expect(encodeRecurrence('MONTHLY')).toBe('MONTHLY');
    expect(decodeRecurrence('MONTHLY')).toEqual({ kind: 'MONTHLY' });
  });

  it('decodeRecurrence retorna null para entrada nula', () => {
    expect(decodeRecurrence(null)).toBeNull();
  });
});

describe('totalTimeSpent / formatDuration', () => {
  it('calcula segundos totais a partir de pomodoros concluídos', () => {
    expect(totalTimeSpent(2)).toBe(2 * 25 * 60);
  });

  it('formata duração menor que uma hora', () => {
    expect(formatDuration(25 * 60)).toBe('25min');
  });

  it('formata duração em horas exatas', () => {
    expect(formatDuration(2 * 3600)).toBe('2h');
  });

  it('formata duração com horas e minutos', () => {
    expect(formatDuration(2 * 3600 + 10 * 60)).toBe('2h 10min');
  });
});

describe('nextOccurrence (mesma conta do RecurrenceRule.kt)', () => {
  const d = (y: number, m: number, dia: number, h = 8) => new Date(y, m - 1, dia, h, 0, 0);
  const ymd = (x: Date | null) => (x ? `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()} ${x.getHours()}h` : null);

  it('DAILY soma n dias', () => {
    expect(ymd(nextOccurrence(decodeRecurrence('DAILY:1'), d(2026, 11, 10)))).toBe('2026-11-11 8h');
    expect(ymd(nextOccurrence(decodeRecurrence('DAILY:3'), d(2026, 11, 30)))).toBe('2026-12-3 8h');
  });

  it('WEEKLY anda a partir de amanhã até um dia marcado', () => {
    const segQui = decodeRecurrence('WEEKLY:MONDAY,THURSDAY');
    // 16/11/2026 é segunda
    expect(ymd(nextOccurrence(segQui, d(2026, 11, 16)))).toBe('2026-11-19 8h');
    // sexta 20/11 → segunda 23/11
    expect(ymd(nextOccurrence(segQui, d(2026, 11, 20)))).toBe('2026-11-23 8h');
    // só segunda, partindo de segunda → semana seguinte
    expect(ymd(nextOccurrence(decodeRecurrence('WEEKLY:MONDAY'), d(2026, 11, 16)))).toBe('2026-11-23 8h');
  });

  it('MONTHLY soma um mês e fica no último dia quando falta', () => {
    expect(ymd(nextOccurrence(decodeRecurrence('MONTHLY'), d(2026, 3, 15)))).toBe('2026-4-15 8h');
    expect(ymd(nextOccurrence(decodeRecurrence('MONTHLY'), d(2026, 1, 31)))).toBe('2026-2-28 8h');
    expect(ymd(nextOccurrence(decodeRecurrence('MONTHLY'), d(2028, 1, 31)))).toBe('2028-2-29 8h');
    expect(ymd(nextOccurrence(decodeRecurrence('MONTHLY'), d(2026, 12, 31)))).toBe('2027-1-31 8h');
  });

  it('regra inválida não gera', () => {
    expect(nextOccurrence(decodeRecurrence('WEEKLY:'), d(2026, 11, 16))).toBeNull();
    expect(nextOccurrence(decodeRecurrence('WEEKLY:FOO'), d(2026, 11, 16))).toBeNull();
    expect(nextOccurrence(decodeRecurrence(null), d(2026, 11, 16))).toBeNull();
    expect(nextOccurrence(decodeRecurrence('YEARLY'), d(2026, 11, 16))).toBeNull();
  });
});
