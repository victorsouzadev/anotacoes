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

  it('alerta da cópia externa e da conferência (spec 036)', () => {
    const local = { registrado: true, concluidoEm: '2026-11-18T04:00:00Z', idadeHoras: 8, atrasado: false, arquivos: [], totalBytes: 0 };
    const externo = { registrado: true, concluidoEm: '2026-11-18T04:01:00Z', idadeHoras: 8, atrasado: false, ultimaFalha: null, bytesTotal: 0 };
    const conferencia = { registrado: true, concluidoEm: '2026-11-15T05:00:00Z', idadeHoras: 80, atrasado: false, ok: true };
    expect(alertaBackup({ ...local, externo, conferencia })).toBeNull();
    expect(alertaBackup({ ...local, externo: { ...externo, idadeHoras: 40, atrasado: true }, conferencia }))
      .toBe('Cópia externa atrasada: a última terminou há 1 dia e 16 h.');
    expect(alertaBackup({ ...local, externo: { ...externo, registrado: false, concluidoEm: null, idadeHoras: null, atrasado: true }, conferencia }))
      .toBe('Cópia externa nunca registrada.');
    expect(alertaBackup({ ...local, externo, conferencia: { ...conferencia, ok: false, atrasado: true } }))
      .toBe('A última conferência da restauração falhou.');
    expect(alertaBackup({ ...local, externo, conferencia: { ...conferencia, idadeHoras: 200, atrasado: true } }))
      .toBe('Restauração não conferida há 8 dias e 8 h.');
    // resposta antiga (sem as partes da 036) continua funcionando
    expect(alertaBackup(local)).toBeNull();
  });

  it('formata tamanhos', () => {
    expect(tamanhoTexto(500)).toBe('500 B');
    expect(tamanhoTexto(1536)).toBe('1,5 KB');
    expect(tamanhoTexto(5 * 1024 * 1024)).toBe('5,0 MB');
  });
});
