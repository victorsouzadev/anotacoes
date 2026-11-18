import { describe, expect, it } from 'vitest';
import { alertaBackup, idadeTexto, tamanhoTexto } from './sistema.service';

describe('estado do backup', () => {
  it('escreve a idade em português', () => {
    expect(idadeTexto(0.4)).toBe('menos de 1 h');
    expect(idadeTexto(7.9)).toBe('7 h');
    expect(idadeTexto(24)).toBe('1 dia');
    expect(idadeTexto(50)).toBe('2 dias e 2 h');
  });

  it('só alerta quando está atrasado', () => {
    const base = { registrado: true, concluidoEm: '2026-11-18T04:00:00Z', arquivos: [], totalBytes: 0 };
    expect(alertaBackup(null)).toBeNull();
    expect(alertaBackup({ ...base, idadeHoras: 8, atrasado: false })).toBeNull();
    expect(alertaBackup({ ...base, idadeHoras: 40, atrasado: true })).toBe('Backup atrasado: o último terminou há 1 dia e 16 h.');
    expect(alertaBackup({ ...base, registrado: false, concluidoEm: null, idadeHoras: null, atrasado: true })).toContain('Nenhum backup');
  });

  it('formata tamanhos', () => {
    expect(tamanhoTexto(500)).toBe('500 B');
    expect(tamanhoTexto(1536)).toBe('1,5 KB');
    expect(tamanhoTexto(5 * 1024 * 1024)).toBe('5,0 MB');
  });
});
