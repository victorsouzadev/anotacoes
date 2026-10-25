// Ponte entre o hub (Estúdio) e um craft app que ainda não tem a ponte nativa do GridCraft.
//
// Entra no index.html do build web (estudio/crafts/build.sh) e só age com ?host=parent dentro de um
// iframe do mesmo endereço. Fala o mesmo protocolo das pontes nativas (<app>:ready/open/save/dirty),
// sem mexer no Rust do app:
//
// - salvar: o app baixa arquivos criando um <a download> com uma URL de blob e clicando nele. A
//   ponte guarda os blobs criados (URL.createObjectURL) e troca o clique por um <app>:save ao hub.
// - abrir: o hub manda <app>:open com os bytes; a ponte solta o arquivo no canvas como um arrastar
//   e soltar de verdade (DragEvent com DataTransfer), que o app já trata como Arquivo › Abrir —
//   no canto da janela para abrir como documento, no meio para pôr dentro do documento aberto.
// - não salvo: quando o app avisa ao fechar a aba (beforeunload), a ponte pergunta de tempos em
//   tempos com um beforeunload de mentira e repassa o estado como <app>:dirty.
(function () {
  'use strict';
  var script = document.currentScript;
  var app = script && script.getAttribute('data-app');
  var versao = script && script.getAttribute('data-versao');
  var params = new URLSearchParams(location.search);
  if (!app || params.get('host') !== 'parent' || window.parent === window) return;
  var parent = window.parent;
  var origem = location.origin;

  function enviar(tipo, dados, transferir) {
    var msg = Object.assign({ type: app + ':' + tipo }, dados || {});
    try { parent.postMessage(msg, origem, transferir || []); } catch (e) { /* hub fechou */ }
  }

  // ---------- salvar ----------
  var blobs = new Map();
  var criar = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    var url = criar(obj);
    if (obj instanceof Blob) {
      blobs.set(url, obj);
      setTimeout(function () { blobs.delete(url); }, 60000);
    }
    return url;
  };

  function interceptar(a) {
    if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
    var href = a.href || '';
    var blob = blobs.get(href);
    if (!blob && href.indexOf('data:') !== 0) return false;
    var nome = a.getAttribute('download') || 'arquivo';
    var ler = blob ? blob.arrayBuffer() : fetch(href).then(function (r) { return r.arrayBuffer(); });
    ler.then(function (bytes) { enviar('save', { name: nome, bytes: bytes }, [bytes]); })
      .catch(function (e) { enviar('failed', { error: 'Não consegui ler o arquivo salvo: ' + e }); });
    return true;
  }

  var clicar = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (interceptar(this)) return;
    return clicar.call(this);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a && interceptar(a)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------- abrir ----------
  var pronto = false;
  var fila = [];

  function canvas() {
    var lista = Array.prototype.slice.call(document.querySelectorAll('canvas'));
    lista.sort(function (a, b) { return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight; });
    return lista[0] || null;
  }

  function soltar(nome, bytes, modo) {
    var alvo = canvas();
    if (!alvo) { fila.push([nome, bytes, modo]); return; }
    var arquivo = new File([bytes], nome, { type: tipoDe(nome) });
    var dt = new DataTransfer();
    dt.items.add(arquivo);
    var r = alvo.getBoundingClientRect();
    var x = modo === 'inserir' ? r.left + r.width / 2 : r.left + 4;
    var y = modo === 'inserir' ? r.top + r.height / 2 : r.top + 4;
    ['dragenter', 'dragover', 'drop'].forEach(function (tipo) {
      alvo.dispatchEvent(new DragEvent(tipo, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y }));
    });
  }

  function tipoDe(nome) {
    var ext = (nome.split('.').pop() || '').toLowerCase();
    var t = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
      pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
      ogg: 'audio/ogg', flac: 'audio/flac', json: 'application/json',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    return t[ext] || 'application/octet-stream';
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== origem || e.source !== parent || !e.data || e.data.type !== app + ':open') return;
    var bytes = e.data.bytes instanceof ArrayBuffer ? e.data.bytes : e.data.bytes && e.data.bytes.buffer;
    if (!bytes || !e.data.name) return;
    if (!pronto) fila.push([e.data.name, bytes, e.data.modo]);
    else soltar(e.data.name, bytes, e.data.modo);
  });

  // Pronto quando o canvas do app ocupa a janela e a tela de "carregando" sumiu.
  var tentativas = 0;
  var espera = setInterval(function () {
    tentativas++;
    var c = canvas();
    var carregando = Array.prototype.some.call(document.querySelectorAll('[id$="_loading"], [id$="-loading"], #loading'), function (el) {
      return el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    });
    if (c && c.clientWidth > 0 && !carregando) {
      clearInterval(espera);
      setTimeout(function () {
        pronto = true;
        enviar('ready', { version: versao || null, ponte: 'js' });
        fila.splice(0).forEach(function (f) { soltar(f[0], f[1], f[2]); });
      }, 600);
    } else if (tentativas > 600) {
      clearInterval(espera);
      enviar('failed', { error: 'o app não terminou de carregar em 5 minutos' });
    }
  }, 500);

  // ---------- não salvo ----------
  var ouvintes = 0;
  var adicionar = window.addEventListener.bind(window);
  window.addEventListener = function (tipo, fn, op) {
    if (tipo === 'beforeunload') ouvintes++;
    return adicionar(tipo, fn, op);
  };
  var ultimo = null;
  setInterval(function () {
    if (!pronto || ouvintes === 0) return;
    var ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    var sujo = ev.defaultPrevented;
    if (sujo !== ultimo) {
      ultimo = sujo;
      enviar('dirty', { dirty: sujo });
    }
  }, 1500);
})();
