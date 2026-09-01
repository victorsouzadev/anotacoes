import { HttpErrorResponse } from '@angular/common/http';

/**
 * Traduz uma falha HTTP para uma frase que ajuda a resolver o problema.
 *
 * Mensagens genéricas ("verifique a conexão") mandam procurar no lugar errado
 * quando o servidor respondeu 500 ou está fora do ar. O código sempre aparece,
 * para poder ser informado num relato de erro.
 */
export function mensagemDeErro(err: unknown, acao: string): string {
  const status = err instanceof HttpErrorResponse ? err.status : -1;
  const detalhe = detalheDoServidor(err);

  switch (true) {
    case status === 0:
      return `${acao}: sem resposta do servidor. Verifique a conexão ou se o serviço está no ar.`;

    case status === 401:
      return `${acao}: sua sessão expirou. Entre novamente.`;

    case status === 403:
      return `${acao}: sem permissão para esta operação.`;

    case status === 404:
      return `${acao}: recurso não encontrado (404). Se acabou de atualizar a aplicação, recarregue a página.`;

    case status === 429:
      return `${acao}: muitas requisições seguidas. Aguarde um pouco e tente de novo.`;

    case status === 502 || status === 503 || status === 504:
      return `${acao}: o servidor não respondeu (${status}). Ele pode estar reiniciando — tente de novo em instantes.`;

    case status >= 500:
      return `${acao}: erro interno do servidor (${status})${detalhe ? ` — ${detalhe}` : ''}.`;

    case status >= 400:
      return detalhe ? `${acao}: ${detalhe}` : `${acao}: requisição recusada (${status}).`;

    default:
      return `${acao}: falha inesperada.`;
  }
}

/** Mensagem que o próprio backend mandou, quando houver. */
function detalheDoServidor(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;

  const corpo = err.error as { erro?: string; detail?: string; title?: string } | string | null;
  if (typeof corpo === 'string' && corpo.trim() && !corpo.trim().startsWith('<')) {
    return corpo.trim().slice(0, 200);
  }
  if (corpo && typeof corpo === 'object') {
    return corpo.erro ?? corpo.detail ?? corpo.title ?? null;
  }
  return null;
}
