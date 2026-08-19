# MCP de Tarefas

Servidor [MCP](https://modelcontextprotocol.io) que permite adicionar e gerenciar tarefas do hub
(ferramenta **Tarefas**) a partir de um LLM — Claude Desktop, Claude Code, ou qualquer outro
cliente MCP. Fala com o mesmo backend (`/api/auth/*`, `/api/tasks/*`) que o app web e o app Android
já usam, então uma tarefa criada por aqui aparece em ambos.

## Ferramentas expostas

| Tool | Descrição |
|---|---|
| `add_task` | Cria uma tarefa (título, descrição, prazo, prioridade, categoria — categoria é criada automaticamente se ainda não existir). |
| `list_tasks` | Lista tarefas do usuário (por padrão só as pendentes). |
| `complete_task` | Marca uma tarefa como concluída, pelo id ou por um trecho do título. |
| `list_categories` | Lista as categorias existentes. |

## Configuração

Requer uma conta já existente no hub (crie uma pelo próprio app web, se ainda não tiver).

Variáveis de ambiente:

- `HUB_EMAIL` — e-mail da conta no hub (obrigatório).
- `HUB_PASSWORD` — senha da conta (obrigatório).
- `HUB_API_URL` — URL do backend. Padrão: `http://191.252.177.244:8090` (produção).

O login é feito uma vez, na primeira chamada de ferramenta; o servidor guarda o token só em
memória do próprio processo (nada é persistido em disco) e renova sozinho quando expira.

## Build

```bash
cd mcp
npm install
npm run build
```

## Uso com Claude Desktop / Claude Code

Adicione ao `claude_desktop_config.json` (ou configuração equivalente de servidores MCP):

```json
{
  "mcpServers": {
    "anotacoes-tasks": {
      "command": "node",
      "args": ["/caminho/absoluto/para/anotacoes/mcp/dist/index.js"],
      "env": {
        "HUB_EMAIL": "seu-email@exemplo.com",
        "HUB_PASSWORD": "sua-senha"
      }
    }
  }
}
```

Reinicie o cliente MCP depois de configurar. As ferramentas `add_task`, `list_tasks`,
`complete_task` e `list_categories` ficam disponíveis para o LLM usar na conversa.
