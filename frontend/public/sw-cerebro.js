/*
 * Service worker do app "Segundo Cérebro" (PWA, /capturar). Só existe para receber o que o Android
 * compartilha (Web Share Target, POST multipart): guarda texto e arquivos no Cache Storage e abre a
 * tela de captura, que mostra tudo para revisar antes de enviar. Não guarda páginas em cache:
 * todo o resto vai direto para a rede, então um deploy novo vale na hora.
 */
const CACHE = 'cerebro-compartilhado';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/capturar/compartilhar') {
    e.respondWith(receber(e.request));
  }
});

async function receber(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(CACHE);
    for (const k of await cache.keys()) await cache.delete(k);
    const arquivos = form.getAll('arquivos').filter((f) => f && typeof f !== 'string' && f.size > 0);
    const meta = {
      titulo: form.get('titulo') || '',
      texto: form.get('texto') || '',
      link: form.get('link') || '',
      arquivos: arquivos.map((f, i) => ({ chave: `/__compartilhado/${i}`, nome: f.name || `arquivo-${i}`, tipo: f.type || '' })),
      em: Date.now(),
    };
    for (let i = 0; i < arquivos.length; i++) {
      await cache.put(meta.arquivos[i].chave, new Response(arquivos[i], { headers: { 'Content-Type': meta.arquivos[i].tipo || 'application/octet-stream' } }));
    }
    await cache.put('/__compartilhado/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) {
    return Response.redirect('/capturar?compartilhado=erro', 303);
  }
  return Response.redirect('/capturar?compartilhado=1', 303);
}
