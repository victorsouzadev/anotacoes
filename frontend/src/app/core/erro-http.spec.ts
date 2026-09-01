import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { mensagemDeErro } from './erro-http';

function erro(status: number, body: unknown = null): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

describe('mensagemDeErro', () => {
  it('distingue servidor fora do ar de erro de conexão', () => {
    // 502/503/504 não são "verifique sua conexão": a rede do usuário está boa e
    // o problema é o servidor.
    expect(mensagemDeErro(erro(502), 'Não foi possível carregar')).toContain('não respondeu (502)');
    expect(mensagemDeErro(erro(0), 'Não foi possível carregar')).toContain('sem resposta do servidor');
  });

  it('avisa que a sessão expirou num 401', () => {
    expect(mensagemDeErro(erro(401), 'Falhou')).toContain('sessão expirou');
  });

  it('sugere recarregar num 404, que costuma ser versão antiga em cache', () => {
    expect(mensagemDeErro(erro(404), 'Falhou')).toContain('recarregue a página');
  });

  it('mostra o código no erro interno', () => {
    expect(mensagemDeErro(erro(500), 'Falhou')).toContain('500');
  });

  it('aproveita a mensagem que o backend mandou', () => {
    expect(mensagemDeErro(erro(400, { erro: 'Mês inválido: 13.' }), 'Falhou'))
      .toContain('Mês inválido: 13.');
  });

  it('usa o campo detail de um ProblemDetails', () => {
    expect(mensagemDeErro(erro(502, { detail: 'Serviço de interpretação indisponível' }), 'Falhou'))
      .toContain('não respondeu (502)');
    expect(mensagemDeErro(erro(500, { detail: 'boom' }), 'Falhou')).toContain('boom');
  });

  it('ignora corpo em HTML, que costuma ser página de erro de proxy', () => {
    const msg = mensagemDeErro(erro(500, '<html><body>502 Bad Gateway</body></html>'), 'Falhou');
    expect(msg).not.toContain('<html>');
  });

  it('avisa sobre excesso de requisições num 429', () => {
    expect(mensagemDeErro(erro(429), 'Falhou')).toContain('Aguarde');
  });

  it('trata um erro que não é HttpErrorResponse', () => {
    expect(mensagemDeErro(new Error('qualquer'), 'Falhou')).toContain('falha inesperada');
  });
});
