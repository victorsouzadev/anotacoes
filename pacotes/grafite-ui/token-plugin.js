// @grafite/ui (spec 030/032): token do núcleo com a audiência do plug-in, trocado e renovado sozinho.
// O plug-in roda no mesmo domínio do hub, então lê a sessão que o hub guardou no localStorage.

const ACESSO = 'notas.accessToken';
const RENOVACAO = 'notas.refreshToken';
const USUARIO = 'notas.user';
const MARGEM_MS = 60_000;

const guardados = new Map(); // plugin -> { token, expiraEm }
const pendentes = new Map();

function sessao() {
  return { acesso: localStorage.getItem(ACESSO), renovacao: localStorage.getItem(RENOVACAO) };
}

/** Sem sessão do hub: manda para o login dele, voltando para a página atual depois. */
export function irParaLogin() {
  const volta = encodeURIComponent(location.pathname + location.search);
  location.assign('/login?volta=' + volta);
}

async function renovarSessao() {
  const { renovacao } = sessao();
  if (!renovacao) return false;
  const r = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: renovacao }),
  });
  if (!r.ok) return false;
  const c = await r.json();
  localStorage.setItem(ACESSO, c.accessToken);
  localStorage.setItem(RENOVACAO, c.refreshToken);
  localStorage.setItem(USUARIO, JSON.stringify(c.user));
  return true;
}

async function trocar(plugin, tentarRenovar = true) {
  const { acesso } = sessao();
  if (!acesso) return null;
  const r = await fetch('/api/auth/token-plugin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + acesso },
    body: JSON.stringify({ plugin }),
  });
  if (r.status === 401 && tentarRenovar && (await renovarSessao())) return trocar(plugin, false);
  if (!r.ok) return null;
  const c = await r.json();
  const novo = { token: c.access_token, expiraEm: Date.now() + c.expires_in * 1000 };
  guardados.set(plugin, novo);
  return novo.token;
}

/** Token com aud=<plugin>, renovado um minuto antes de vencer. Null quando não há sessão no hub. */
export async function tokenDoPlugin(plugin) {
  const g = guardados.get(plugin);
  if (g && g.expiraEm - MARGEM_MS > Date.now()) return g.token;
  if (!pendentes.has(plugin)) pendentes.set(plugin, trocar(plugin).finally(() => pendentes.delete(plugin)));
  return pendentes.get(plugin);
}

/** fetch com o token do plug-in; num 401 troca o token uma vez e repete. Sem sessão, vai para o login. */
export async function fetchDoPlugin(plugin, url, init = {}) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const token = await tokenDoPlugin(plugin);
    if (!token) {
      irParaLogin();
      throw new Error('sem sessão no hub');
    }
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    const r = await fetch(url, { ...init, headers });
    if (r.status !== 401) return r;
    guardados.delete(plugin);
  }
  irParaLogin();
  throw new Error('sessão recusada');
}

/** Só para os testes. */
export function _limpar() {
  guardados.clear();
  pendentes.clear();
}
