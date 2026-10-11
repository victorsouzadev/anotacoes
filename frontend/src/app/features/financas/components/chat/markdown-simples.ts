// Markdown mínimo para as respostas do chat: negrito, itálico, código, listas,
// tabelas e parágrafos. Escapa o HTML antes de tudo, então o texto do modelo
// nunca vira marcação arbitrária.
function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:!?])/g, '$1<em>$2</em>');
}

const celulas = (linha: string) =>
  linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inline(c.trim()));

export function markdownSimples(texto: string): string {
  const linhas = escapar(texto).split('\n');
  const html: string[] = [];
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];
    if (/^\s*\|.*\|\s*$/.test(linha) && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(linhas[i + 1] ?? '')) {
      const cab = celulas(linha);
      i += 2;
      const corpo: string[][] = [];
      while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) corpo.push(celulas(linhas[i++]));
      html.push(
        '<table><thead><tr>' + cab.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
          corpo.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>',
      );
      continue;
    }
    const lista = /^\s*([-*]|\d+\.)\s+/;
    if (lista.test(linha)) {
      const ordenada = /^\s*\d+\./.test(linha);
      const itens: string[] = [];
      while (i < linhas.length && lista.test(linhas[i])) itens.push(`<li>${inline(linhas[i++].replace(lista, ''))}</li>`);
      html.push(ordenada ? `<ol>${itens.join('')}</ol>` : `<ul>${itens.join('')}</ul>`);
      continue;
    }
    const titulo = /^\s*#{1,6}\s+(.*)$/.exec(linha);
    if (titulo) {
      html.push(`<p><strong>${inline(titulo[1])}</strong></p>`);
      i++;
      continue;
    }
    if (linha.trim() === '') {
      i++;
      continue;
    }
    const paragrafo: string[] = [];
    while (i < linhas.length && linhas[i].trim() !== '' && !lista.test(linhas[i]) && !/^\s*\|/.test(linhas[i]) &&
      !/^\s*#/.test(linhas[i])) {
      paragrafo.push(inline(linhas[i++]));
    }
    html.push(`<p>${paragrafo.join('<br>')}</p>`);
  }
  return html.join('');
}
