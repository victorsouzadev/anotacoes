import { config } from './config.js';

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

// Sessão mantida só em memória do processo do servidor MCP — nada é persistido em disco.
// Login é feito uma vez (lazy, na primeira chamada de ferramenta) e o refresh token rotaciona
// a cada renovação, igual ao fluxo já usado pelo web e pelo Android contra o mesmo backend.
let accessToken: string | null = null;
let refreshToken: string | null = null;

async function login(): Promise<void> {
  const res = await fetch(`${config.apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha no login (HTTP ${res.status}): ${body}`);
  }
  const data = (await res.json()) as AuthResponse;
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
}

async function refresh(): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch(`${config.apiUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    accessToken = null;
    refreshToken = null;
    return false;
  }
  const data = (await res.json()) as AuthResponse;
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
  return true;
}

async function ensureToken(): Promise<string> {
  if (!accessToken) await login();
  return accessToken!;
}

// Faz fetch autenticado, tentando refresh e depois login de novo em caso de 401 (token expirado
// ou primeira chamada do processo). No máximo uma nova tentativa por camada, pra não entrar em loop.
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureToken();
  const doFetch = (bearer: string) =>
    fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
    });

  let res = await doFetch(token);
  if (res.status === 401) {
    if (await refresh()) {
      res = await doFetch(accessToken!);
    } else {
      await login();
      res = await doFetch(accessToken!);
    }
  }
  return res;
}
