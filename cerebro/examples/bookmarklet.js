// Bookmarklet: salva a página atual (e o texto selecionado) na Inbox.
// 1. Troque HUB e KEY (use a chave API_KEY_NAVEGADOR).
// 2. Minifique numa linha e cole como URL de um favorito, começando com "javascript:".
//
// javascript:(()=>{const HUB='https://SUBDOMINIO/cerebro',KEY='SUA_CHAVE';const q=new URLSearchParams({key:KEY,url:location.href,title:document.title,text:String(getSelection()||'')});window.open(HUB+'/api/v1/quick?'+q,'cerebro','width=420,height=220');})();

(() => {
  const HUB = 'https://SUBDOMINIO/cerebro';
  const KEY = 'SUA_CHAVE';
  const q = new URLSearchParams({
    key: KEY,
    url: location.href,
    title: document.title,
    text: String(getSelection() || ''),
  });
  window.open(`${HUB}/api/v1/quick?${q}`, 'cerebro', 'width=420,height=220');
})();
