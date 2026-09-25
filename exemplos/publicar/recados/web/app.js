const lista = document.getElementById('lista');
const erro = document.getElementById('erro');

async function carregar() {
  const r = await fetch('/api/recados');
  const recados = await r.json();
  lista.replaceChildren(...recados.map((x) => {
    const li = document.createElement('li');
    li.textContent = x.texto;
    const quando = document.createElement('small');
    quando.textContent = new Date(x.criadoEm).toLocaleString('pt-BR');
    li.append(quando);
    return li;
  }));
}

document.getElementById('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const campo = document.getElementById('texto');
  const r = await fetch('/api/recados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto: campo.value }),
  });
  erro.hidden = r.ok;
  if (!r.ok) { erro.textContent = (await r.json()).error ?? 'Falhou.'; return; }
  campo.value = '';
  carregar();
});

fetch('/api/health').then((r) => r.json()).then((s) => {
  document.getElementById('saude').textContent = `API ${s.status} · versão ${s.versao}`;
});
carregar();
