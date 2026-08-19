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
| `search_tasks` | Busca tarefas por texto e/ou filtros de categoria, prioridade e prazo (`dueBefore`/`dueAfter`). |
| `get_task` | Detalhe completo de uma tarefa — inclui subtarefas e comentários. |
| `update_task` | Edita título, descrição, prazo, prioridade e/ou categoria de uma tarefa existente. |
| `complete_task` | Marca uma tarefa como concluída, pelo id ou por um trecho do título. |
| `reopen_task` | Desfaz `complete_task` — reabre uma tarefa concluída. |
| `delete_task` | Move uma tarefa pra lixeira (reversível). |
| `restore_task` | Restaura uma tarefa da lixeira. |
| `list_categories` | Lista as categorias existentes. |
| `rename_category` | Renomeia uma categoria. |
| `delete_category` | Apaga uma categoria (as tarefas nela ficam sem categoria, não são apagadas). |
| `add_comment` | Adiciona um comentário a uma tarefa. |
| `list_comments` | Lista os comentários de uma tarefa. |

Todas as ferramentas que recebem `idOrTitle` aceitam tanto o id exato quanto um trecho do título
(busca case-insensitive); se mais de uma tarefa corresponder, a ferramenta retorna erro com a lista
de candidatas em vez de escolher uma arbitrariamente. Falhas de rede, HTTP ou validação voltam como
resultado de erro do MCP (`isError: true`) em vez de derrubar o processo do servidor.

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

## Testes

```bash
cd mcp
npm test
```

Cobre a lógica pura (normalização de prioridade, resolução de tarefa/categoria por id-ou-título,
filtros de busca) e o fluxo de autenticação (login/refresh/retry em 401) e os payloads HTTP da
`tasksApi`, com `fetch` mockado — sem depender de um backend real rodando.

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

Reinicie o cliente MCP depois de configurar. As ferramentas da tabela acima ficam disponíveis para
o LLM usar na conversa.
