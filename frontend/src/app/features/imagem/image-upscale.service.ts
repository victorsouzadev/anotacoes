import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Ampliação de foto por super-resolução. A chave do serviço externo vive só no
 * servidor, então tudo passa pelo backend — e o editor pergunta antes se o
 * recurso está ligado, pra não oferecer um botão que só falharia ao ser
 * clicado. */
@Injectable({ providedIn: 'root' })
export class ImageUpscaleService {
  /** `null` enquanto não se sabe; depois, ligado ou não. */
  readonly disponivel = signal<boolean | null>(null);

  /** Teto de pixels da foto de entrada, dito pelo servidor. O modelo roda numa
   * GPU e recusa acima disso — melhor reduzir antes de subir do que descobrir
   * depois de esperar o upload. */
  readonly maxPixelsEntrada = signal(2_000_000);

  private consulta: Promise<boolean> | null = null;

  constructor(private http: HttpClient) {}

  /** Pergunta ao servidor e guarda a resposta. Com `forcar`, pergunta de novo —
   * é o caso de quem acabou de cadastrar a chave em Configurações e voltou ao
   * editor sem recarregar a página. */
  verificar(forcar = false): Promise<boolean> {
    if (forcar) this.consulta = null;
    this.consulta ??= firstValueFrom(
      this.http.get<{ disponivel: boolean; maxPixelsEntrada: number }>('/api/imagens/upscale'),
    )
      .then((r) => {
        this.disponivel.set(r.disponivel);
        if (r.maxPixelsEntrada > 0) this.maxPixelsEntrada.set(r.maxPixelsEntrada);
        return r.disponivel;
      })
      .catch(() => {
        this.disponivel.set(false);
        return false;
      });
    return this.consulta;
  }

  async ampliar(imagem: string, escala: number): Promise<string> {
    try {
      const resposta = await firstValueFrom(
        this.http.post<{ imagem: string }>('/api/imagens/upscale', { imagem, escala }),
      );
      return resposta.imagem;
    } catch (err) {
      throw erroDe(err);
    }
  }

  /**
   * Amplia tentando de novo, menor, quando a GPU do serviço estiver sem
   * memória. O tamanho que cabe lá não é fixo: depende de quem mais está
   * usando o serviço no mesmo instante, então a mesma foto que falhou agora
   * passa daqui a pouco — e passa quase sempre se encolher um pouco.
   *
   * `gerarImagem` devolve a foto dentro de um orçamento de pixels; quem chama
   * é que sabe desenhar (isto aqui não conhece canvas, e é testável sem DOM).
   */
  async ampliarEncolhendo(
    gerarImagem: (maxPixels: number) => string,
    maxPixels: number,
    escala: number,
    aoTentarDeNovo?: (tentativa: number) => void,
  ): Promise<string> {
    let orcamento = maxPixels;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        return await this.ampliar(gerarImagem(orcamento), escala);
      } catch (err) {
        const podeEncolher = err instanceof UpscaleError && err.tentarMenor;
        if (!podeEncolher || tentativa === MAX_TENTATIVAS) throw err;
        // Um terço a menos de pixel por tentativa: encolher pouco repetiria a
        // falha, encolher muito jogaria fora a resolução que era o objetivo.
        orcamento = Math.round(orcamento * 0.65);
        aoTentarDeNovo?.(tentativa + 1);
      }
    }

    throw new UpscaleError('Não consegui ampliar a foto agora.');
  }
}

/** Três no total: além disso o que sobra de foto não justifica a ampliação. */
const MAX_TENTATIVAS = 3;

export class UpscaleError extends Error {
  constructor(mensagem: string, readonly tentarMenor = false) {
    super(mensagem);
    this.name = 'UpscaleError';
  }
}

/** O backend manda texto pronto pro usuário nas falhas esperadas, e diz quando
 * encolher a foto tem chance; o resto vira uma frase honesta em vez de "Http
 * failure response". */
function erroDe(err: unknown): UpscaleError {
  if (err instanceof HttpErrorResponse) {
    const corpo = err.error as { error?: string; tentarMenor?: boolean } | null;
    if (corpo?.error) return new UpscaleError(corpo.error, corpo.tentarMenor === true);
    if (err.status === 0) return new UpscaleError('Sem conexão com o servidor.');
    if (err.status === 413) return new UpscaleError('Foto grande demais para ampliar.', true);
    if (err.status === 504) return new UpscaleError('A ampliação demorou demais e foi cancelada.');
  }
  return new UpscaleError('Não consegui ampliar a foto agora.');
}
