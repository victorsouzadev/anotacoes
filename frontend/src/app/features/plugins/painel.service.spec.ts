import { describe, expect, it } from 'vitest';
import { Etapa, PluginNoPainel, oQueFalta, ordenar, rotuloDaEtapa } from './painel.service';

const etapa = (nome: string, estado: Etapa['estado']): Etapa => ({ nome, estado, detalhe: null });
const plugin = (p: Partial<PluginNoPainel>): PluginNoPainel => ({
  id: 'x', nome: 'X', situacao: 'incompleto', versao: null, versaoAnterior: null, health: null, ultimaFalha: null,
  congelado: false, memoriaMb: null, limiteMb: null, etapas: [], ...p,
});

describe('painel de plug-ins (spec 040)', () => {
  it('ferramenta mesclada e sem banco diz que falta banco e registro', () => {
    expect(oQueFalta(plugin({
      etapas: [etapa('ci', 'feita'), etapa('imagem', 'feita'), etapa('papel', 'pendente'), etapa('schema', 'pendente'),
        etapa('conexao', 'pendente'), etapa('permissoes', 'pendente'), etapa('registro', 'pendente'), etapa('no-ar', 'pendente')],
    }))).toBe('Falta: banco, registro.');
  });

  it('separa o que não deu para conferir', () => {
    expect(oQueFalta(plugin({ etapas: [etapa('ci', 'nao-conferida'), etapa('imagem', 'nao-conferida'), etapa('registro', 'pendente')] })))
      .toBe('Falta: registro; sem conferir: CI, imagem.');
  });

  it('quem está no ar não tem falta, e falha de health também não', () => {
    expect(oQueFalta(plugin({ situacao: 'no-ar', etapas: [etapa('registro', 'pendente')] }))).toBeNull();
    expect(oQueFalta(plugin({ situacao: 'com-falha', etapas: [etapa('registro', 'feita'), etapa('no-ar', 'falhou')] }))).toBeNull();
  });

  it('o que pede atenção vem primeiro', () => {
    const l = ordenar([plugin({ id: 'a', situacao: 'no-ar' }), plugin({ id: 'b', situacao: 'desligado' }), plugin({ id: 'c', situacao: 'com-falha' })]);
    expect(l.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('etapa desconhecida mostra o próprio nome', () => {
    expect(rotuloDaEtapa('conexao')).toBe('Conexão');
    expect(rotuloDaEtapa('nova')).toBe('nova');
  });
});
