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

describe('encolher e tentar de novo', () => {
  /** Serviço com um http que falha as `falhas` primeiras vezes com OOM. */
  function comFalhasDeMemoria(falhas: number) {
    const enviados: number[] = [];
    const service = criar({
      post: (_url: string, corpo: { imagem: string }) => {
        enviados.push(Number(corpo.imagem));
        if (enviados.length <= falhas) {
          return throwError(() => new HttpErrorResponse({
            status: 502,
            error: { error: 'A GPU do serviço ficou sem memória para esta foto.', tentarMenor: true },
          }));
        }
        return of({ imagem: 'data:image/png;base64,PRONTA' });
      },
    });
    // a "imagem" é o próprio orçamento, pra o teste ver quanto foi pedido
    const gerar = (maxPixels: number) => String(maxPixels);
    return { service, gerar, enviados };
  }

  it('insiste menor quando a GPU do serviço está cheia', async () => {
    const { service, gerar, enviados } = comFalhasDeMemoria(1);
    const r = await service.ampliarEncolhendo(gerar, 1_200_000, 2);

    expect(r).toBe('data:image/png;base64,PRONTA');
    expect(enviados.length).toBe(2);
    // a segunda tentativa manda menos pixel que a primeira
    expect(enviados[1]).toBeLessThan(enviados[0]);
    expect(enviados[1]).toBeGreaterThan(enviados[0] * 0.5);
  });

  it('avisa a cada nova tentativa', async () => {
    const { service, gerar } = comFalhasDeMemoria(2);
    const tentativas: number[] = [];
    await service.ampliarEncolhendo(gerar, 1_200_000, 2, (t) => tentativas.push(t));
    expect(tentativas).toEqual([2, 3]);
  });

  it('desiste depois de três tentativas, com o motivo', async () => {
    const { service, gerar, enviados } = comFalhasDeMemoria(99);
    await expect(service.ampliarEncolhendo(gerar, 1_200_000, 2)).rejects.toThrow('sem memória');
    // três no total: insistir mais deixaria a foto pequena demais pra valer a pena
    expect(enviados.length).toBe(3);
  });

  it('erro que não é de tamanho não vira retentativa', async () => {
    let chamadas = 0;
    const service = criar({
      post: () => {
        chamadas++;
        return throwError(() => new HttpErrorResponse({
          status: 502,
          error: { error: 'A chave de ampliação foi recusada pelo serviço.', tentarMenor: false },
        }));
      },
    });

    await expect(service.ampliarEncolhendo(() => 'x', 1_200_000, 2)).rejects.toThrow('recusada');
    expect(chamadas).toBe(1);
  });
});
