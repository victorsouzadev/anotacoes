import { describe, expect, it } from 'vitest';
import { destinoDoSalvar, lerMensagem, mensagemAbrir } from './ponte';
import { CRAFTS, craftsQueAbrem } from '../apps';

describe('ponte dos craft apps', () => {
  it('lê só as mensagens do próprio app', () => {
    expect(lerMensagem({ type: 'gridcraft:ready', version: '0.11.1' }, 'gridcraft')).toEqual({ tipo: 'ready', versao: '0.11.1', ponteJs: false });
    expect(lerMensagem({ type: 'photocraft:ready', ponte: 'js' }, 'photocraft')).toEqual({ tipo: 'ready', versao: null, ponteJs: true });
    expect(lerMensagem({ type: 'wordcraft:ready' }, 'gridcraft')).toBeNull();
    expect(lerMensagem('gridcraft:ready', 'gridcraft')).toBeNull();
    expect(lerMensagem({ type: 'gridcraft:dirty', dirty: true }, 'gridcraft')).toEqual({ tipo: 'dirty', sujo: true });
    expect(lerMensagem({ type: 'gridcraft:failed' }, 'gridcraft')).toEqual({ tipo: 'failed', erro: 'erro desconhecido' });
    expect(lerMensagem({ type: 'gridcraft:qualquer' }, 'gridcraft')).toBeNull();
  });

  it('aceita bytes em ArrayBuffer ou Uint8Array e recusa salvar sem nome', () => {
    const buf = new Uint8Array([1, 2, 3]);
    const ev = lerMensagem({ type: 'wordcraft:save', name: 'Carta.docx', bytes: buf, saveAs: true }, 'wordcraft');
    expect(ev?.tipo).toBe('save');
    if (ev?.tipo === 'save') {
      expect(new Uint8Array(ev.bytes)).toEqual(buf);
      expect(ev.salvarComo).toBe(true);
    }
    expect(lerMensagem({ type: 'wordcraft:save', name: '', bytes: buf.buffer }, 'wordcraft')).toBeNull();
    expect(lerMensagem({ type: 'wordcraft:save', name: 'x.docx' }, 'wordcraft')).toBeNull();
  });

  it('monta a mensagem de abrir no formato do app', () => {
    const b = new ArrayBuffer(2);
    expect(mensagemAbrir('cadcraft', 'planta.dxf', b)).toEqual({ type: 'cadcraft:open', name: 'planta.dxf', bytes: b, modo: 'abrir' });
    expect(mensagemAbrir('photocraft', 'logo.png', b, 'inserir').modo).toBe('inserir');
  });

  it('decide entre salvar por cima, documento novo e cópia', () => {
    const aberto = { nome: 'Orçamento.xlsx' };
    expect(destinoDoSalvar(aberto, 'Orçamento.xlsx', null)).toBe('substituir');
    expect(destinoDoSalvar(aberto, 'Orçamento.pdf', null)).toBe('copia');
    expect(destinoDoSalvar(aberto, 'Orçamento v2.xlsx', true)).toBe('novo-documento');
    expect(destinoDoSalvar(aberto, 'Orçamento.xlsx', false)).toBe('substituir');
    expect(destinoDoSalvar(null, 'Sem título.xlsx', null)).toBe('novo-documento');
    // WordCraft exportando PDF de um documento nunca salvo: é cópia, o documento segue sem arquivo.
    expect(destinoDoSalvar(null, 'Carta.pdf', false)).toBe('copia');
  });
});

describe('registro dos apps', () => {
  it('tem os 13 craft apps com rota própria', () => {
    expect(CRAFTS).toHaveLength(13);
    expect(new Set(CRAFTS.map((c) => c.rota)).size).toBe(13);
    for (const c of CRAFTS) expect(c.rota).toBe(`/estudio/apps/${c.id}`);
  });

  it('sabe que app abre cada arquivo', () => {
    expect(craftsQueAbrem('Orçamento.XLSX').map((c) => c.id)).toEqual(['gridcraft']);
    expect(craftsQueAbrem('planta.dwg').map((c) => c.id)).toEqual(['cadcraft']);
    expect(craftsQueAbrem('foto.CR2').map((c) => c.id)).toEqual(['lightcraft']);
    expect(craftsQueAbrem('arte.psd').map((c) => c.id)).toEqual(['photocraft']);
    expect(craftsQueAbrem('sem-extensao')).toEqual([]);
  });
});
