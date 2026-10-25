import { describe, expect, it } from 'vitest';
import { DocumentoStoryboard, Plano, promptDoPlano, timelineDoStoryboard } from './storyboard.page';
import { promptDasNotas } from './moodboard.page';
import { duracaoClipe } from './montagem.page';
import { promptDoPalco } from './palco/palco.page';
import { JUNTAS, POSES, juntarPoses, poseDe } from './palco/boneco';

const plano = (p: Partial<Plano>): Plano => ({ id: 'x', titulo: 'P', descricao: '', camera: '', duracao: 5, imagem: null, video: null, notas: '', ...p });

describe('storyboard', () => {
  it('monta o prompt com descrição, câmera e estilo comum', () => {
    expect(promptDoPlano(plano({ descricao: 'Um gato pula a janela', camera: 'plano geral' }), 'stop motion'))
      .toBe('Um gato pula a janela Camera: plano geral. Style: stop motion.');
    expect(promptDoPlano(plano({ descricao: ' só isso ' }), '')).toBe('só isso');
  });

  it('vira linha do tempo: vídeo do plano (cortado na duração) ou a imagem pela duração', () => {
    const d: DocumentoStoryboard = {
      estilo: '', proporcao: '9:16',
      planos: [plano({ video: 'v1', duracao: 4 }), plano({ imagem: 'i2', duracao: 3 }), plano({})],
    };
    const tl = timelineDoStoryboard(d, new Map([['v1', 8]]));
    expect([tl.largura, tl.altura]).toEqual([1080, 1920]);
    expect(tl.clipes.map((c) => [c.midia, c.fim])).toEqual([['v1', 4], ['i2', 3]]);
  });
});

describe('moodboard e palco', () => {
  it('junta as notas do moodboard num prompt', () => {
    expect(promptDasNotas([
      { id: '1', tipo: 'nota', texto: 'tons pastel', x: 0, y: 0, w: 1 },
      { id: '2', tipo: 'imagem', midia: 'm', x: 0, y: 0, w: 1 },
      { id: '3', tipo: 'nota', texto: '  luz de manhã ', x: 0, y: 0, w: 1 },
      { id: '4', tipo: 'nota', texto: '   ', x: 0, y: 0, w: 1 },
    ])).toBe('tons pastel. luz de manhã');
  });

  it('o prompt do palco pede para manter a composição e fala dos personagens', () => {
    const sem = promptDoPalco('dois amigos num café', 'cinema', 0);
    expect(sem).toContain('Keep exactly the camera angle');
    expect(sem).toContain('dois amigos num café');
    expect(sem).toContain('Style: cinema.');
    expect(sem).not.toContain('mannequin');
    expect(promptDoPalco('', '', 1)).toContain('second image');
    expect(promptDoPalco('', '', 3)).toContain('other 3 images');
  });

  it('poses prontas usam só juntas que existem e voltam como cópia', () => {
    const ids = new Set(JUNTAS.map((j) => j.id));
    for (const p of POSES) for (const j of Object.keys(p.pose)) expect(ids.has(j as never)).toBe(true);
    const a = poseDe('correndo');
    a.coxaE![0] = 0;
    expect(poseDe('correndo').coxaE![0]).toBe(-60);
    expect(juntarPoses({ cabeca: [0, 0, 0] }, { cabeca: [0, 500, -500] }).cabeca).toEqual([0, 180, -180]);
  });

  it('duração do clipe nunca é zero', () => {
    expect(duracaoClipe({ id: 'c', midia: 'm', inicio: 2, fim: 2, volume: 1, fadeIn: 0, fadeOut: 0 })).toBe(0.1);
    expect(duracaoClipe({ id: 'c', midia: 'm', inicio: 1.5, fim: 4, volume: 1, fadeIn: 0, fadeOut: 0 })).toBe(2.5);
  });
});
