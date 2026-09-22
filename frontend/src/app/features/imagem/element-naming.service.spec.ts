import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ElementNamingService } from './element-naming.service';

function criar(post: unknown): ElementNamingService {
  return new ElementNamingService({ post } as never);
}

describe('nomes dos elementos por IA', () => {
  it('devolve os nomes que o servidor deu', async () => {
    const service = criar(() => of({ nomes: ['polvo-maria-clara', 'tartaruga'], usouIa: true, motivo: null }));
    const r = await service.nomear(['data:image/jpeg;base64,x', 'data:image/jpeg;base64,y']);
    expect(r.usouIa).toBe(true);
    expect(r.nomes).toEqual(['polvo-maria-clara', 'tartaruga']);
  });

  it('erro do servidor não vira exceção: a exportação não pode cair por causa do nome', async () => {
    const service = criar(() => throwError(() => new HttpErrorResponse({
      status: 400, error: { erro: 'No máximo 40 imagens por vez.' },
    })));
    const r = await service.nomear(['data:image/jpeg;base64,x']);
    expect(r.usouIa).toBe(false);
    expect(r.nomes).toEqual([]);
    expect(r.motivo).toBe('No máximo 40 imagens por vez.');
  });

  it('sem imagem não chama o servidor', async () => {
    let chamadas = 0;
    const service = criar(() => { chamadas++; return of({ nomes: [], usouIa: true, motivo: null }); });
    const r = await service.nomear([]);
    expect(chamadas).toBe(0);
    expect(r.usouIa).toBe(false);
  });
});
