/** "Enviar para…": qualquer modo manda a arte pra qualquer outro. Cada modo
 * sabe produzir um canvas do que tem; quem sabe receber é a página, que
 * conhece os quatro. Os modos que não estão na tela recebem pelo store, no
 * próximo momento em que abrirem. */

import { Injectable } from '@angular/core';

export type BridgeTarget = 'corte' | 'molde' | 'social' | 'ilustracao';

export interface BridgePayload {
  canvas: HTMLCanvasElement;
  name: string;
  /** Largura física, quando a origem sabe (Ilustração, Print & Cut). */
  widthMm?: number;
}

export const BRIDGE_TARGETS: { id: BridgeTarget; label: string; help: string }[] = [
  { id: 'corte', label: 'Print & Cut', help: 'Vira uma peça com contorno e linha de corte' },
  { id: 'molde', label: 'Molde SVG', help: 'Entra como foto no encaixe ativo do molde' },
  { id: 'social', label: 'Redes sociais', help: 'Vira a foto do post, com filtros e formatos' },
  { id: 'ilustracao', label: 'Ilustração', help: 'Vetoriza em curvas, cores ou linha central' },
];

@Injectable()
export class ModeBridge {
  private handler: ((target: BridgeTarget, payload: BridgePayload) => void) | null = null;

  register(handler: (target: BridgeTarget, payload: BridgePayload) => void): void {
    this.handler = handler;
  }

  send(target: BridgeTarget, payload: BridgePayload): void {
    this.handler?.(target, payload);
  }

  targetsFrom(source: BridgeTarget): typeof BRIDGE_TARGETS {
    return BRIDGE_TARGETS.filter((t) => t.id !== source);
  }
}

export function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Não consegui gerar a imagem.'));
        return;
      }
      resolve(new File([blob], `${name.replace(/\.[^.]+$/, '') || 'imagem'}.png`, { type: 'image/png' }));
    }, 'image/png');
  });
}
