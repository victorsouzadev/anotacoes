// @grafite/ui (spec 032): <grafite-barra> — a barra do hub em qualquer plug-in.
// Ferramentas (de /api/plugins), conta, tema e sair. Uso: <script type="module" src="/grafite/grafite-barra.js"></script>
// e <grafite-barra atual="dieta"></grafite-barra>.

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

export class GrafiteBarra extends HTMLElement {
  async connectedCallback() {
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
        <span class="conta">${escapar(email)}</span>
        <button type="button" class="tema" title="${ROTULO[this.tema] || ''}">${this.tema === 'dark' ? '☾' : this.tema === 'light' ? '☀' : '◐'}</button>
        <button type="button" class="sair">Sair</button>
      </nav>`;
    this.querySelector('.tema').addEventListener('click', () => {
      this.tema = proximoTema(this.tema);
      try { localStorage.setItem(TEMA, this.tema); } catch { /* ignora */ }
      aplicarTema();
      this.render();
    });
    this.querySelector('.sair').addEventListener('click', () => {
      for (const k of ['notas.accessToken', 'notas.refreshToken', 'notas.user']) localStorage.removeItem(k);
      location.assign('/login');
    });
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('grafite-barra')) {
  customElements.define('grafite-barra', GrafiteBarra);
}
