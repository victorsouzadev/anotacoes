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

  private consulta: Promise<boolean> | null = null;

  constructor(private http: HttpClient) {}

  /** Pergunta ao servidor e guarda a resposta. Com `forcar`, pergunta de novo —
   * é o caso de quem acabou de cadastrar a chave em Configurações e voltou ao
   * editor sem recarregar a página. */
  verificar(forcar = false): Promise<boolean> {
    if (forcar) this.consulta = null;
    this.consulta ??= firstValueFrom(this.http.get<{ disponivel: boolean }>('/api/imagens/upscale'))
      .then((r) => {
        this.disponivel.set(r.disponivel);
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
      throw new Error(mensagemDe(err));
    }
  }
}

/** O backend manda texto pronto pro usuário nas falhas esperadas; o resto vira
 * uma frase honesta em vez de "Http failure response". */
function mensagemDe(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const doServidor = (err.error as { error?: string } | null)?.error;
    if (doServidor) return doServidor;
    if (err.status === 0) return 'Sem conexão com o servidor.';
    if (err.status === 413) return 'Foto grande demais para ampliar.';
    if (err.status === 504) return 'A ampliação demorou demais e foi cancelada.';
  }
  return 'Não consegui ampliar a foto agora.';
}
