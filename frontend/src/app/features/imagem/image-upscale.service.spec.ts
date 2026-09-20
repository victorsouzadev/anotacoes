import { HttpErrorResponse } from '@angular/common/http';
import { ImageUpscaleService } from './image-upscale.service';
import { of, throwError } from 'rxjs';

function criar(http: { get?: unknown; post?: unknown }): ImageUpscaleService {
  return new ImageUpscaleService(http as never);
}

describe('ampliação por IA', () => {
  it('pergunta ao servidor uma vez só', async () => {
    let chamadas = 0;
    const service = criar({
      get: () => {
        chamadas++;
        return of({ disponivel: true });
      },
    });

    expect(service.disponivel()).toBeNull();
    expect(await service.verificar()).toBe(true);
    expect(await service.verificar()).toBe(true);
    expect(chamadas).toBe(1);
    expect(service.disponivel()).toBe(true);
  });

  it('pergunta de novo quando mandado — a chave pode ter acabado de ser cadastrada', async () => {
    let chamadas = 0;
    const service = criar({
      get: () => {
        chamadas++;
        return of({ disponivel: chamadas > 1 });
      },
    });

    expect(await service.verificar()).toBe(false);
    expect(await service.verificar(true)).toBe(true);
    expect(chamadas).toBe(2);
  });

  it('servidor fora do ar não vira botão quebrado', async () => {
    const service = criar({ get: () => throwError(() => new HttpErrorResponse({ status: 0 })) });
    expect(await service.verificar()).toBe(false);
    expect(service.disponivel()).toBe(false);
  });

  it('devolve a imagem ampliada', async () => {
    const service = criar({ post: () => of({ imagem: 'data:image/png;base64,AAA' }) });
    expect(await service.ampliar('data:image/jpeg;base64,BBB', 2)).toBe('data:image/png;base64,AAA');
  });

  it('mostra o motivo que o servidor deu, não o erro cru de HTTP', async () => {
    const service = criar({
      post: () => throwError(() => new HttpErrorResponse({
        status: 502,
        error: { error: 'A conta do serviço de ampliação está sem crédito.' },
      })),
    });
    await expect(service.ampliar('data:image/png;base64,AAA', 2))
      .rejects.toThrow('sem crédito');
  });

  it('falha sem texto do servidor ainda diz algo compreensível', async () => {
    const service = criar({ post: () => throwError(() => new HttpErrorResponse({ status: 500 })) });
    await expect(service.ampliar('data:image/png;base64,AAA', 2))
      .rejects.toThrow('Não consegui ampliar a foto agora.');
  });
});
