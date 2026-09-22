import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Tamanho da miniatura enviada pra IA nomear. A da lista (72 px) é pequena
 * demais pra ler o nome escrito numa faixa; a arte inteira seria desperdício de
 * banda e de token. */
const PREVIEW_PX = 256;

export interface NomesSugeridos {
  nomes: string[];
  usouIa: boolean;
  motivo: string | null;
}

/** Nomes dos elementos, dados por IA olhando as miniaturas. A chave do provedor
 * mora no servidor, então a chamada passa pelo backend — e o serviço nunca
 * lança: nomear é enfeite da exportação, não pode derrubá-la. */
@Injectable({ providedIn: 'root' })
export class ElementNamingService {
  constructor(private http: HttpClient) {}

  /** Miniatura em data URL, no formato que o backend aceita. */
  miniatura(source: HTMLCanvasElement): string {
    const escala = Math.min(PREVIEW_PX / source.width, PREVIEW_PX / source.height, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * escala));
    canvas.height = Math.max(1, Math.round(source.height * escala));
    const ctx = canvas.getContext('2d')!;
    // fundo branco: a arte é recortada e, em PNG com alpha, o modelo receberia
    // o desenho sobre preto — que não é como ele vai ser impresso
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  async nomear(imagens: string[]): Promise<NomesSugeridos> {
    if (!imagens.length) return { nomes: [], usouIa: false, motivo: null };
    try {
      return await firstValueFrom(
        this.http.post<NomesSugeridos>('/api/imagens/nomes', { imagens }),
      );
    } catch (err: unknown) {
      const erro = (err as { error?: { erro?: string } }).error?.erro;
      return { nomes: [], usouIa: false, motivo: erro ?? 'Não foi possível falar com o serviço de IA.' };
    }
  }
}
