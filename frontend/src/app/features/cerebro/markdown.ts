/**
 * Markdown do Obsidian → estrutura de dados, para a tela desenhar com o template (sem innerHTML).
 * Cobre o que aparece nas notas do Cérebro: títulos, parágrafos, listas, checklists, citações e
 * callouts (> [!summary]), blocos de código, linha horizontal, **negrito**, *itálico*, `código`,
 * [[wikilinks]], [links](https://…), URLs soltas e #tags. O resto aparece como texto.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; v: string }
  | { t: 'i'; v: string }
  | { t: 'code'; v: string }
  | { t: 'wiki'; alvo: string; rotulo: string }
  | { t: 'link'; href: string; v: string }
  | { t: 'tag'; v: string };

export type Block =
  | { t: 'h'; nivel: number; inl: Inline[] }
  | { t: 'p'; inl: Inline[] }
  | { t: 'ul'; itens: Inline[][] }
  | { t: 'ol'; itens: Inline[][] }
  | { t: 'todo'; itens: { feito: boolean; inl: Inline[] }[] }
  | { t: 'quote'; tipo: string | null; titulo: Inline[] | null; linhas: Inline[][] }
  | { t: 'code'; v: string }
  | { t: 'hr' };

const TOKEN = new RegExp(
  [
    '`([^`]+)`', // 1 código
    '\\[\\[([^\\]|#]+)(?:#[^\\]|]*)?(?:\\|([^\\]]+))?\\]\\]', // 2 alvo, 3 rótulo
    '\\[([^\\]]+)\\]\\(([^)\\s]+)\\)', // 4 texto, 5 href
    '\\*\\*([^*]+)\\*\\*', // 6 negrito
    '(?<![\\w*])\\*([^*\\s][^*]*)\\*(?!\\w)', // 7 itálico com *
    '(?<!\\w)_([^_\\s][^_]*)_(?!\\w)', // 8 itálico com _
    '(https?://[^\\s<>)]+)', // 9 URL solta
    '(?<![\\w&/])#([\\p{L}\\d_/-]*\\p{L}[\\p{L}\\d_/-]*)', // 10 tag (não só números)
  ].join('|'),
  'gu',
);

/** Só http(s) e mailto viram link clicável; o resto fica como texto. */
function hrefSeguro(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

export function inline(texto: string): Inline[] {
  const out: Inline[] = [];
  let ultimo = 0;
  const empurrarTexto = (v: string) => {
    if (!v) return;
    const anterior = out[out.length - 1];
    if (anterior?.t === 'text') anterior.v += v;
    else out.push({ t: 'text', v });
  };
  for (const m of texto.matchAll(TOKEN)) {
    empurrarTexto(texto.slice(ultimo, m.index));
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'wiki', alvo: m[2].trim(), rotulo: (m[3] ?? m[2]).trim() });
    else if (m[4] !== undefined) {
      const href = hrefSeguro(m[5]);
      if (href) out.push({ t: 'link', href, v: m[4] });
      else empurrarTexto(m[0]);
    } else if (m[6] !== undefined) out.push({ t: 'b', v: m[6] });
    else if (m[7] !== undefined) out.push({ t: 'i', v: m[7] });
    else if (m[8] !== undefined) out.push({ t: 'i', v: m[8] });
    else if (m[9] !== undefined) out.push({ t: 'link', href: m[9], v: m[9] });
    else if (m[10] !== undefined) out.push({ t: 'tag', v: m[10] });
    ultimo = (m.index ?? 0) + m[0].length;
  }
  empurrarTexto(texto.slice(ultimo));
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const linhas = md.replace(/\r\n?/g, '\n').split('\n');
  const blocos: Block[] = [];
  let paragrafo: string[] = [];

  const fecharParagrafo = () => {
    if (paragrafo.length) blocos.push({ t: 'p', inl: inline(paragrafo.join(' ')) });
    paragrafo = [];
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const semEspaco = linha.trim();

    if (/^(```|~~~)/.test(semEspaco)) {
      fecharParagrafo();
      const cerca = semEspaco.slice(0, 3);
      const corpo: string[] = [];
      for (i++; i < linhas.length && !linhas[i].trim().startsWith(cerca); i++) corpo.push(linhas[i]);
      blocos.push({ t: 'code', v: corpo.join('\n') });
      continue;
    }
    if (!semEspaco) {
      fecharParagrafo();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(semEspaco);
    if (h) {
      fecharParagrafo();
      blocos.push({ t: 'h', nivel: h[1].length, inl: inline(h[2]) });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(semEspaco)) {
      fecharParagrafo();
      blocos.push({ t: 'hr' });
      continue;
    }
    if (semEspaco.startsWith('>')) {
      fecharParagrafo();
      const conteudo: string[] = [];
      for (; i < linhas.length && linhas[i].trim().startsWith('>'); i++) conteudo.push(linhas[i].trim().replace(/^>\s?/, ''));
      i--;
      const callout = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(conteudo[0] ?? '');
      blocos.push({
        t: 'quote',
        tipo: callout ? callout[1].toLowerCase() : null,
        titulo: callout ? inline(callout[2] || callout[1]) : null,
        linhas: (callout ? conteudo.slice(1) : conteudo).filter((l) => l.trim()).map(inline),
      });
      continue;
    }
    const todo = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/;
    if (todo.test(semEspaco)) {
      fecharParagrafo();
      const itens: { feito: boolean; inl: Inline[] }[] = [];
      for (; i < linhas.length && todo.test(linhas[i].trim()); i++) {
        const m = todo.exec(linhas[i].trim())!;
        itens.push({ feito: m[1] !== ' ', inl: inline(m[2]) });
      }
      i--;
      blocos.push({ t: 'todo', itens });
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/;
    const ol = /^\d+[.)]\s+(.*)$/;
    if (ul.test(semEspaco) || ol.test(semEspaco)) {
      fecharParagrafo();
      const re = ul.test(semEspaco) ? ul : ol;
      const itens: Inline[][] = [];
      for (; i < linhas.length && re.test(linhas[i].trim()) && !todo.test(linhas[i].trim()); i++) {
        itens.push(inline(re.exec(linhas[i].trim())![1]));
      }
      i--;
      blocos.push({ t: re === ul ? 'ul' : 'ol', itens });
      continue;
    }
    paragrafo.push(semEspaco);
  }
  fecharParagrafo();
  return blocos;
}
