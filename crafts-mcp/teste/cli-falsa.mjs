// CLI de mentira: um MCP mínimo por stdio, para testar o adaptador sem as CLIs de verdade.
import { createInterface } from 'node:readline';
const [app, ...args] = process.argv.slice(2);
createInterface({ input: process.stdin }).on('line', (linha) => {
  const m = JSON.parse(linha);
  if (m.id === undefined) return;
  const resultado = {
    initialize: { protocolVersion: '2025-06-18', serverInfo: { name: `${app}-cli`, version: '0.0.0' }, capabilities: { tools: {} } },
    'tools/list': { tools: [{ name: 'eco', description: 'devolve cwd e args', inputSchema: { type: 'object' } }] },
    'tools/call': { content: [{ type: 'text', text: JSON.stringify({ app, args, cwd: process.cwd() }) }] },
  }[m.method];
  process.stdout.write(JSON.stringify(resultado ? { jsonrpc: '2.0', id: m.id, result: resultado } : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'método' } }) + '\n');
});
