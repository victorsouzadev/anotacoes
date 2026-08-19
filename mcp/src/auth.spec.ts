import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AUTH_RESPONSE = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: { id: 'u1', email: 'user@example.com' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function freshAuthModule() {
  vi.resetModules();
  return import('./auth.js');
}

describe('authedFetch', () => {
  beforeEach(() => {
    process.env.HUB_EMAIL = 'user@example.com';
    process.env.HUB_PASSWORD = 'secret';
    process.env.HUB_API_URL = 'http://api.test';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HUB_EMAIL;
    delete process.env.HUB_PASSWORD;
    delete process.env.HUB_API_URL;
  });

  it('faz login na primeira chamada e usa o token retornado', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/login')) return jsonResponse(AUTH_RESPONSE);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { authedFetch } = await freshAuthModule();
    const res = await authedFetch('/api/tasks/items');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1][1];
    expect((secondCallInit?.headers as Record<string, string>)['Authorization']).toBe('Bearer access-1');
  });

  it('reutiliza o token em chamadas seguintes sem logar de novo', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/login')) return jsonResponse(AUTH_RESPONSE);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { authedFetch } = await freshAuthModule();
    await authedFetch('/api/tasks/items');
    await authedFetch('/api/tasks/items');

    const loginCalls = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/api/auth/login'));
    expect(loginCalls).toHaveLength(1);
  });

  it('em 401, tenta refresh e repete a chamada com o novo token', async () => {
    let tasksCallCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/login')) return jsonResponse(AUTH_RESPONSE);
      if (url.endsWith('/api/auth/refresh')) {
        return jsonResponse({ ...AUTH_RESPONSE, accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      tasksCallCount += 1;
      if (tasksCallCount === 1) return jsonResponse({ error: 'expired' }, 401);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { authedFetch } = await freshAuthModule();
    const res = await authedFetch('/api/tasks/items');

    expect(res.status).toBe(200);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/api/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    expect(tasksCallCount).toBe(2);
  });

  it('se o refresh falhar, faz login de novo antes de repetir', async () => {
    let loginCallCount = 0;
    let tasksCallCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/login')) {
        loginCallCount += 1;
        return jsonResponse(AUTH_RESPONSE);
      }
      if (url.endsWith('/api/auth/refresh')) return jsonResponse({ error: 'invalid' }, 401);
      tasksCallCount += 1;
      if (tasksCallCount === 1) return jsonResponse({ error: 'expired' }, 401);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { authedFetch } = await freshAuthModule();
    const res = await authedFetch('/api/tasks/items');

    expect(res.status).toBe(200);
    expect(loginCallCount).toBe(2);
  });
});
