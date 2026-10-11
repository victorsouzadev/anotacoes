// O MCP do hub (pasta mcp/) monta posts sem rodar o editor: ele precisa saber,
// de cada modelo pronto, quantas fotos cabem e quais são os textos. Este teste
// garante que o catálogo guardado lá bate com os modelos daqui.
// Mudou um modelo? Rode `UPDATE_MCP_CATALOG=1 npx ng test --include=src/app/features/imagem/social-mcp-catalog.spec.ts`.
import { describeForAi } from './social-ai-post-panel';
import { SOCIAL_TEMPLATES } from './social-templates';
import { GalleryEntry } from './social-templates.service';

// O projeto não tem os tipos do Node (é código de navegador); o teste roda no
// Node, então o fs entra por import dinâmico sem tipo.
type Fs = { existsSync(p: string): boolean; readFileSync(p: string, e: string): string; writeFileSync(p: string, d: string): void };
const env = (globalThis as unknown as { process: { cwd(): string; env: Record<string, string | undefined> } }).process;
const FILE = `${env.cwd()}/../mcp/src/viih/modelos.ts`;

function catalog() {
  return SOCIAL_TEMPLATES.map((t) => {
    const entry = { id: t.id, label: t.label, group: t.group, help: t.help } as GalleryEntry;
    return describeForAi(entry, t.build());
  });
}

describe('catálogo de modelos do MCP', () => {
  it('bate com os modelos do editor', async () => {
    const { existsSync, readFileSync, writeFileSync } = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as Fs;
    const atual = '// Gerado por frontend/src/app/features/imagem/social-mcp-catalog.spec.ts — não edite à mão.\n'
      + "import type { ModeloIa } from './catalogo.js';\n\n"
      + `export const MODELOS_DO_EDITOR: ModeloIa[] = ${JSON.stringify(catalog(), null, 2)};\n`;
    if (env.env['UPDATE_MCP_CATALOG'] || !existsSync(FILE)) writeFileSync(FILE, atual);
    expect(readFileSync(FILE, 'utf8')).toBe(atual);
  });
});
