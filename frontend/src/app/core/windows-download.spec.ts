import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowsDownloadService, formatSize } from './windows-download';

describe('WindowsDownloadService', () => {
  afterEach(() => vi.unstubAllGlobals());

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('mostra o instalador publicado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ versao: '1.2.0', arquivo: 'EditorImagens-Setup.exe', tamanho: 409_000_000 }) }));
    const s = TestBed.inject(WindowsDownloadService);
    s.check();
    await flush();
    expect(s.release()).toEqual({ versao: '1.2.0', url: '/downloads/windows/EditorImagens-Setup.exe', tamanho: '390 MB' });
  });

  it('sem instalador publicado (404), não mostra nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const s = TestBed.inject(WindowsDownloadService);
    s.check();
    await flush();
    expect(s.release()).toBeNull();
  });

  it('formata o tamanho', () => {
    expect(formatSize(1.5 * 1024 ** 3)).toBe('1,5 GB');
    expect(formatSize(10)).toBe('1 MB');
  });
});
