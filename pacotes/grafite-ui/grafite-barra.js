// @grafite/ui (spec 032): <grafite-barra> — a barra do hub em qualquer plug-in.
// Ferramentas (de /api/plugins), conta, tema e sair. Uso: <script type="module" src="/grafite/grafite-barra.js"></script>
// e <grafite-barra atual="dieta"></grafite-barra>.
// O hub (Angular) usa a mesma barra: os eventos "grafite-tema" e "grafite-sair" podem ser cancelados com
// preventDefault() para o app tratar (ThemeService, AuthService.logout).

const TEMA = 'theme'; // mesma chave do ThemeService do hub: 'system' | 'light' | 'dark'
const CICLO = { system: 'dark', dark: 'light', light: 'system' };
const ROTULO = { system: 'Tema: automático', dark: 'Tema: escuro', light: 'Tema: claro' };

export function aplicarTema(doc = document) {
  let t = 'system';
  try { t = localStorage.getItem(TEMA) || 'system'; } catch { /* sem storage: segue o sistema */ }
  if (t === 'light' || t === 'dark') doc.documentElement.setAttribute('data-theme', t);
  else doc.documentElement.removeAttribute('data-theme');
  return t;
}

export function proximoTema(atual) {
  return CICLO[atual] || 'dark';
}

function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Itens da barra: plug-ins abrem por link comum, módulos do núcleo pelo hub. Indisponível fica marcado. */
export function itensDaBarra(lista, atual) {
  return (lista || []).map((i) => ({
    id: i.id,
    nome: i.nome,
    href: i.origem === 'plugin' ? i.rota + '/' : i.rota,
    atual: i.id === atual,
    indisponivel: i.estado !== 'no-ar',
  }));
}

const ESTILO = `
.grafite-barra { display: flex; align-items: center; gap: 14px; padding: 12px 24px; background: var(--surface);
  border-bottom: 1px solid var(--border); font-size: 14px; flex-wrap: wrap; }
.grafite-barra a { text-decoration: none; color: var(--text-muted, var(--text)); }
.grafite-barra a[aria-current="page"] { color: var(--text); font-weight: 600; }
.grafite-barra a.off { opacity: .5; }
.grafite-barra .marca { font-family: var(--font-heading); font-size: 17px; color: var(--text); }
.grafite-barra .itens { display: flex; gap: 12px; flex: 1; flex-wrap: wrap; }
.grafite-barra .conta { color: var(--text-muted, var(--text)); font-size: 13px; }
.grafite-barra button { background: transparent; border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; }
.grafite-barra .config { font-size: 13px; }
`;

function garantirEstilo(doc) {
  if (doc.getElementById('grafite-barra-estilo')) return;
  const s = doc.createElement('style');
  s.id = 'grafite-barra-estilo';
  s.textContent = ESTILO;
  doc.head.appendChild(s);
}

export class GrafiteBarra extends HTMLElement {
  async connectedCallback() {
    garantirEstilo(this.ownerDocument);
    this.tema = aplicarTema();
    this.lista = [];
    this.render();
    const token = localStorage.getItem('notas.accessToken');
    if (!token) return;
    try {
      const r = await fetch('/api/plugins', { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) this.lista = await r.json();
    } catch { /* sem a lista, a barra mostra só o link do hub */ }
    this.render();
  }

  render() {
    let email = '';
    try { email = JSON.parse(localStorage.getItem('notas.user') || 'null')?.email || ''; } catch { /* ignora */ }
    const itens = itensDaBarra(this.lista, this.getAttribute('atual'))
      .map((i) => `<a href="${escapar(i.href)}"${i.atual ? ' aria-current="page"' : ''}${i.indisponivel ? ' class="off" title="Indisponível agora"' : ''}>${escapar(i.nome)}</a>`)
      .join('');
    this.innerHTML = `
      <nav class="grafite-barra">
        <a class="marca" href="/">Ferramentas</a>
        <div class="itens">${itens}</div>
        <a class="config" href="/configuracoes"${this.getAttribute('atual') === 'configuracoes' ? ' aria-current="page"' : ''}>Configurações</a>
        <span class="conta">${escapar(email)}</span>
        <button type="button" class="tema" title="${ROTULO[this.tema] || ''}">${this.tema === 'dark' ? '☾' : this.tema === 'light' ? '☀' : '◐'}</button>
        <button type="button" class="sair">Sair</button>
      </nav>`;
    this.querySelector('.tema').addEventListener('click', () => {
      const proximo = proximoTema(this.tema);
      if (!this.dispatchEvent(new CustomEvent('grafite-tema', { detail: proximo, cancelable: true }))) {
        this.tema = proximo;
        this.render();
        return;
      }
      this.tema = proximo;
      try { localStorage.setItem(TEMA, this.tema); } catch { /* ignora */ }
      aplicarTema();
      this.render();
    });
    this.querySelector('.sair').addEventListener('click', () => {
      if (!this.dispatchEvent(new CustomEvent('grafite-sair', { cancelable: true }))) return;
      for (const k of ['notas.accessToken', 'notas.refreshToken', 'notas.user']) localStorage.removeItem(k);
      location.assign('/login');
    });
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('grafite-barra')) {
  customElements.define('grafite-barra', GrafiteBarra);
}
