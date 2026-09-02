/**
 * Dispara o download de um blob no navegador.
 *
 * Dois detalhes que parecem supérfluos e não são: o link precisa estar no
 * documento (um elemento solto tem o clique ignorado em parte dos navegadores)
 * e a URL só pode ser revogada depois — revogar na mesma volta do laço de
 * eventos cancela o download antes de ele começar.
 */
export function baixarBlob(nomeArquivo: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
