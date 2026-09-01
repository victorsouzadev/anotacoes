/** Escapa um campo para CSV: aspas duplicadas e o valor inteiro entre aspas. */
export function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Monta um CSV a partir de linhas já em texto. Separador `;` e quebra CRLF
 * porque o Excel em português espera exatamente isso — com vírgula ele joga a
 * linha inteira numa célula só.
 */
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
}

/**
 * Dispara o download de um CSV no navegador.
 *
 * O BOM não é decorativo: sem ele o Excel lê o arquivo como ANSI e "Alimentação"
 * vira "AlimentaÃ§Ã£o".
 */
export function baixarCsv(nomeArquivo: string, conteudo: string): void {
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  // O link precisa estar no documento: um elemento solto tem o clique ignorado
  // em parte dos navegadores.
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revogar na mesma volta do laço de eventos cancela o download antes de ele
  // começar; a liberação fica para depois que o navegador já leu o blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
