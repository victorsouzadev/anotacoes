import { baixarBlob } from './download';

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
  baixarBlob(nomeArquivo, new Blob(['\ufeff' + conteudo], { type: 'text/csv;charset=utf-8;' }));
}
