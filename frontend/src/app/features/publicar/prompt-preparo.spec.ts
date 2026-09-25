import { describe, expect, it } from 'vitest';
import { gerarPromptPreparo } from './prompt-preparo';

const modelo = 'http://{slug}.191-252-177-244.sslip.io:8090';
const site = (temPostgres: boolean) => ({ nome: 'Recados', slug: 'recados', url: 'http://recados.191-252-177-244.sslip.io:8090', temPostgres });

describe('gerarPromptPreparo', () => {
  it('genérico: usa a URL modelo e oferece os dois bancos quando há Postgres', () => {
    const p = gerarPromptPreparo({ site: null, postgresNoServidor: true, urlModelo: modelo });
    expect(p).toContain('http://<endereco>.191-252-177-244.sslip.io:8090');
    expect(p).toContain('ConnectionStrings:Postgres');
    expect(p).toContain('ConnectionStrings:Default');
    expect(p).toContain('Publicar → Novo site');
  });

  it('site com Postgres: fala do banco criado e usa a URL do site', () => {
    const p = gerarPromptPreparo({ site: site(true), postgresNoServidor: true, urlModelo: modelo });
    expect(p).toContain('http://recados.191-252-177-244.sslip.io:8090');
    expect(p).toContain('Este site **tem banco Postgres**');
    expect(p).toContain('Publicar → Recados');
  });

  it('site sem Postgres num servidor com Postgres: pede para escolher', () => {
    const p = gerarPromptPreparo({ site: site(false), postgresNoServidor: true, urlModelo: modelo });
    expect(p).toContain('ainda **não tem banco Postgres**');
  });

  it('servidor sem Postgres: só SQLite, sem dica de Postgres local', () => {
    const p = gerarPromptPreparo({ site: null, postgresNoServidor: false, urlModelo: modelo });
    expect(p).toContain('Postgres não está ligado');
    expect(p).not.toContain('ConnectionStrings:Postgres`. A plataforma cria');
    expect(p).not.toContain('--network host');
  });

  it('traz as regras que quebram apps comuns e o comando de validação', () => {
    const p = gerarPromptPreparo({ site: null, postgresNoServidor: true, urlModelo: modelo });
    for (const trecho of ['UseHttpsRedirection', '/data/keys', '/api/health', '--read-only', '--user 1000:1000', 'linux-x64 --self-contained false', 'publicar.json'])
      expect(p).toContain(trecho);
    // O docker run de exemplo não pode ter comentário no meio da continuação de linha.
    const bloco = p.split('```bash')[1].split('```')[0];
    expect(bloco).not.toMatch(/\\\n\s*#/);
  });
});
