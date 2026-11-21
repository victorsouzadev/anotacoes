import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _limpar, fetchDoPlugin, tokenDoPlugin } from './token-plugin.js';
import { aplicarTema, itensDaBarra, proximoTema } from './grafite-barra.js';

function resposta(status, corpo) {
  return { status, ok: status >= 200 && status < 300, json: async () => corpo };
}

describe('token do plug-in', () => {
  beforeEach(() => {
    localStorage.clear();
    _limpar();
    localStorage.setItem('notas.accessToken', 'hub-1');
    localStorage.setItem('notas.refreshToken', 'r-1');
  });
  afterEach(() => vi.restoreAllMocks());

  it('troca o token do hub pelo do plug-in e guarda até perto de vencer', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(200, { access_token: 'p-1', expires_in: 900 }));
    expect(await tokenDoPlugin('dieta')).toBe('p-1');
    expect(await tokenDoPlugin('dieta')).toBe('p-1');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/auth/token-plugin');
    expect(init.headers.Authorization).toBe('Bearer hub-1');
    expect(JSON.parse(init.body)).toEqual({ plugin: 'dieta' });
  });

  it('com o token do hub vencido, renova a sessão e tenta de novo', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(resposta(401, {}))
      .mockResolvedValueOnce(resposta(200, { accessToken: 'hub-2', refreshToken: 'r-2', user: { email: 'a@b.c' } }))
      .mockResolvedValueOnce(resposta(200, { access_token: 'p-2', expires_in: 900 }));
    expect(await tokenDoPlugin('dieta')).toBe('p-2');
    expect(localStorage.getItem('notas.accessToken')).toBe('hub-2');
    expect(localStorage.getItem('notas.refreshToken')).toBe('r-2');
    expect(f.mock.calls[2][1].headers.Authorization).toBe('Bearer hub-2');
  });

  it('sem sessão no hub não chama nada', async () => {
    localStorage.clear();
    const f = vi.spyOn(globalThis, 'fetch');
    expect(await tokenDoPlugin('dieta')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('fetchDoPlugin manda o Bearer do plug-in e troca o token num 401', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(resposta(200, { access_token: 'p-1', expires_in: 900 }))
      .mockResolvedValueOnce(resposta(401, {}))
      .mockResolvedValueOnce(resposta(200, { access_token: 'p-2', expires_in: 900 }))
      .mockResolvedValueOnce(resposta(200, { ok: true }));
    const r = await fetchDoPlugin('dieta', '/dieta/api/itens');
    expect(r.status).toBe(200);
    expect(f.mock.calls[3][1].headers.get('Authorization')).toBe('Bearer p-2');
  });
});

describe('barra do hub', () => {
  it('plug-in abre por link comum, núcleo pela rota do hub', () => {
    const itens = itensDaBarra([
      { id: 'notas', nome: 'Notas', rota: '/notes', origem: 'nucleo', estado: 'no-ar' },
      { id: 'dieta', nome: 'Dieta', rota: '/dieta', origem: 'plugin', estado: 'indisponivel' },
    ], 'dieta');
    expect(itens).toEqual([
      { id: 'notas', nome: 'Notas', href: '/notes', atual: false, indisponivel: false },
      { id: 'dieta', nome: 'Dieta', href: '/dieta/', atual: true, indisponivel: true },
    ]);
  });

  it('tema segue a chave do hub', () => {
    localStorage.setItem('theme', 'dark');
    expect(aplicarTema()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    localStorage.setItem('theme', 'system');
    aplicarTema();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect([proximoTema('system'), proximoTema('dark'), proximoTema('light')]).toEqual(['dark', 'light', 'system']);
  });

  it('desenha a barra com a conta e escapa nomes', async () => {
    localStorage.clear();
    localStorage.setItem('notas.user', JSON.stringify({ email: 'eu@x.y' }));
    const el = document.createElement('grafite-barra');
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.querySelector('.conta').textContent).toBe('eu@x.y');
    expect(el.querySelector('.marca').getAttribute('href')).toBe('/');
    expect(el.querySelector('.config').getAttribute('href')).toBe('/configuracoes');
    expect(document.getElementById('grafite-barra-estilo')).not.toBeNull();
  });

  it('o app pode tratar tema e sair (hub Angular)', async () => {
    localStorage.clear();
    localStorage.setItem('notas.accessToken', 'x');
    globalThis.fetch = async () => ({ ok: false });
    const el = document.createElement('grafite-barra');
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));
    let tema = null;
    el.addEventListener('grafite-tema', (e) => { tema = e.detail; e.preventDefault(); });
    el.addEventListener('grafite-sair', (e) => e.preventDefault());
    el.querySelector('.tema').click();
    expect(tema).toBe('dark');
    expect(localStorage.getItem('theme')).toBeNull();
    el.querySelector('.sair').click();
    expect(localStorage.getItem('notas.accessToken')).toBe('x');
  });
});
