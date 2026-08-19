import { describe, expect, it } from 'vitest';
import {
  decodeRecurrence,
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
