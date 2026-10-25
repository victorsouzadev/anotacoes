/**
 * Ponte entre o hub e um craft app num iframe (`?host=parent`). É o protocolo que GridCraft,
 * WordCraft, PdfCraft e CADCraft já falam, e que estudio/crafts/ponte-hub.js dá aos
 * outros nove: mensagens `{ type: '<app>:<evento>', … }` só entre janelas do mesmo endereço.
 *
 * - `<app>:ready`  (app → hub)  `{ version }`: pode mandar arquivo.
 * - `<app>:open`   (hub → app)  `{ name, bytes, modo? }`: abre como Arquivo › Abrir. Na ponte em
 *   JavaScript, `modo: 'inserir'` solta o arquivo no meio do documento aberto (vira camada, clipe…).
 * - `<app>:save`   (app → hub)  `{ name, bytes, saveAs? }`: tudo o que o app baixaria (salvar, exportar).
 * - `<app>:dirty`  (app → hub)  `{ dirty }`: alterações não salvas.
 * - `<app>:failed` (app → hub)  `{ error }`: o app não iniciou.
 */
export type EventoPonte =
  | { tipo: 'ready'; versao: string | null; ponteJs: boolean }
  | { tipo: 'save'; nome: string; bytes: ArrayBuffer; salvarComo: boolean | null }
  | { tipo: 'dirty'; sujo: boolean }
  | { tipo: 'failed'; erro: string };

/** Lê uma mensagem do app; null quando não é dele ou está malformada. */
export function lerMensagem(dados: unknown, appId: string): EventoPonte | null {
  if (!dados || typeof dados !== 'object') return null;
  const d = dados as Record<string, unknown>;
  if (typeof d['type'] !== 'string' || !d['type'].startsWith(appId + ':')) return null;
  switch (d['type'].slice(appId.length + 1)) {
    case 'ready':
      return { tipo: 'ready', versao: typeof d['version'] === 'string' ? d['version'] : null, ponteJs: d['ponte'] === 'js' };
    case 'dirty':
      return { tipo: 'dirty', sujo: d['dirty'] === true };
    case 'failed':
      return { tipo: 'failed', erro: typeof d['error'] === 'string' ? d['error'] : 'erro desconhecido' };
    case 'save': {
      const bytes = d['bytes'] instanceof ArrayBuffer ? d['bytes'] : ArrayBuffer.isView(d['bytes']) ? copiar(d['bytes'] as ArrayBufferView) : null;
      if (!bytes || typeof d['name'] !== 'string' || !d['name'].trim()) return null;
      return { tipo: 'save', nome: d['name'], bytes, salvarComo: typeof d['saveAs'] === 'boolean' ? d['saveAs'] : null };
    }
    default:
      return null;
  }
}

export function mensagemAbrir(appId: string, nome: string, bytes: ArrayBuffer, modo: 'abrir' | 'inserir' = 'abrir'): { type: string; name: string; bytes: ArrayBuffer; modo: 'abrir' | 'inserir' } {
  return { type: `${appId}:open`, name: nome, bytes, modo };
}

/**
 * O que fazer com um "salvar" do app:
 * - substituir: grava por cima do documento aberto (Salvar, mesmo nome);
 * - novo-documento: arquivo novo que passa a ser o documento (Salvar como, ou o primeiro salvar);
 * - copia: arquivo novo, mas o documento continua o mesmo (exportar PDF/PNG, salvar cópia).
 *
 * O WordCraft diz explicitamente (`saveAs`) se o arquivo vira o documento; os outros não, e aí
 * vale o nome: mesmo nome do aberto é salvar por cima; nome diferente é exportação.
 */
export function destinoDoSalvar(aberto: { nome: string } | null, nome: string, salvarComo: boolean | null): 'substituir' | 'novo-documento' | 'copia' {
  if (salvarComo === true) return 'novo-documento';
  if (aberto && aberto.nome === nome) return 'substituir';
  if (!aberto) return salvarComo === false ? 'copia' : 'novo-documento';
  return 'copia';
}

function copiar(v: ArrayBufferView): ArrayBuffer {
  const c = new Uint8Array(v.byteLength);
  c.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  return c.buffer;
}
