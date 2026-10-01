import { CAIXA_BOMBOM, CAIXA_MILK, CONE, PIRAMIDE, SACOLINHA } from './caixas';
import { Categoria, TipoMolde } from './modelo';
import { MOLDE_DE_FOTO } from './decalque-tipo';
import { CAIXA_SILHUETA } from './silhueta';
import { TOPO_DE_BOLO, TOPPER_FOTO } from './toppers';

export const TIPOS: TipoMolde[] = [CAIXA_MILK, CAIXA_BOMBOM, SACOLINHA, PIRAMIDE, CONE, TOPO_DE_BOLO, TOPPER_FOTO, CAIXA_SILHUETA, MOLDE_DE_FOTO];

export const CATEGORIAS: Categoria[] = ['Caixas e embalagens', 'Toppers', 'A partir de imagem'];

export function tipoPorId(id: string): TipoMolde {
  return TIPOS.find((t) => t.id === id) ?? TIPOS[0];
}
