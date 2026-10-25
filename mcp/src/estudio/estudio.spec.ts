import { describe, expect, it, vi } from 'vitest';

// api importa auth → config, que exige as credenciais já no import. vi.hoisted roda antes
// dos imports abaixo; os testes daqui não fazem chamadas de rede.
vi.hoisted(() => {
  process.env.HUB_EMAIL ??= 'teste@example.com';
  process.env.HUB_PASSWORD ??= 'teste';
});
import { homedir } from 'node:os';
import { join } from 'node:path';
import { caminhoLocal, nomeLivre, precisaConfirmar, textoDoJob } from './api.js';

describe('Estúdio no MCP local', () => {
  it('expande ~ e resolve caminhos relativos', () => {
    expect(caminhoLocal('~/Fotos/a.png')).toBe(join(homedir(), 'Fotos', 'a.png'));
    expect(caminhoLocal('~')).toBe(homedir());
  });

  it('não repete nome nem usa caractere proibido no Windows', () => {
    expect(nomeLivre('cena: final?.png', [])).toBe('cena_ final_.png');
    expect(nomeLivre('a.png', ['/x/a.png'])).toBe('a (2).png');
    expect(nomeLivre('a.png', ['/x/a.png', '/x/a (2).png'])).toBe('a (3).png');
  });

  it('pede confirmação só acima do limite e sem o aval do usuário', () => {
    expect(precisaConfirmar(150, 100, false)).toBe(true);
    expect(precisaConfirmar(150, 100, true)).toBe(false);
    expect(precisaConfirmar(50, 100, false)).toBe(false);
  });

  it('descreve a geração com os links e o que foi baixado', () => {
    const t = textoDoJob({
      id: 'j1', modeloId: 'veo-3.1', modeloNome: 'Veo 3.1', operacao: 'texto', provedor: 'fal', status: 'concluido', mensagem: null, erro: null,
      custoEstimadoCentavos: 320, linkExterno: null,
      resultado: [{ id: 'm1', tipo: 'video', nome: 'mar.mp4', url: '/api/estudio/arquivos/m1?exp=1&sig=x', tamanho: 1, duracaoSeg: 8, largura: null, altura: null, prompt: null, pasta: null, criadoEm: '' }],
    }, ['/tmp/mar.mp4']);
    expect(t).toContain('Veo 3.1 · texto · concluido · ~US$ 3.20');
    expect(t).toContain('/api/estudio/arquivos/m1?exp=1&sig=x');
    expect(t).toContain('Baixado em: /tmp/mar.mp4');
  });
});
