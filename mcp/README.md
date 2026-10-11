# MCP de Tarefas

Servidor [MCP](https://modelcontextprotocol.io) que permite adicionar e gerenciar tarefas do hub
(ferramenta **Tarefas**) a partir de um LLM — Claude Desktop, Claude Code, ou qualquer outro
cliente MCP. Fala com o mesmo backend (`/api/auth/*`, `/api/tasks/*`) que o app web e o app Android
já usam, então uma tarefa criada por aqui aparece em ambos.

## Ferramentas expostas

| Tool | Descrição |
|---|---|
| `add_task` | Cria uma tarefa (título, descrição, prazo, prioridade, uma ou mais categorias — categorias são criadas automaticamente se ainda não existirem). |
| `list_tasks` | Lista tarefas do usuário (por padrão só as pendentes). |
| `search_tasks` | Busca tarefas por texto e/ou filtros de categoria, prioridade e prazo (`dueBefore`/`dueAfter`). |
| `get_task` | Detalhe completo de uma tarefa — inclui subtarefas e comentários. |
| `update_task` | Edita título, descrição, prazo, prioridade, categorias (substitui a lista atual) e/ou raia do Kanban de uma tarefa existente. |
| `complete_task` | Marca uma tarefa como concluída, pelo id ou por um trecho do título. |
| `reopen_task` | Desfaz `complete_task` — reabre uma tarefa concluída. |
| `delete_task` | Move uma tarefa pra lixeira (reversível). |
| `restore_task` | Restaura uma tarefa da lixeira. |
| `list_categories` | Lista as categorias existentes. |
| `rename_category` | Renomeia uma categoria. |
| `delete_category` | Apaga uma categoria (as tarefas nela ficam sem categoria, não são apagadas). |
| `list_kanban_lanes` | Lista as raias (colunas) do Kanban do usuário, em ordem. |
| `add_kanban_lane` | Cria uma raia (coluna) no Kanban, no fim da ordem atual. |
| `rename_kanban_lane` | Renomeia uma raia do Kanban. |
| `delete_kanban_lane` | Apaga uma raia (as tarefas nela ficam sem raia, não são apagadas). |
| `move_task_to_lane` | Move uma tarefa pra uma raia do Kanban (criada automaticamente se não existir). |
| `add_comment` | Adiciona um comentário a uma tarefa. |
| `list_comments` | Lista os comentários de uma tarefa. |

Uma tarefa pode ter **várias categorias ao mesmo tempo** — `add_task`/`update_task` aceitam nomes
separados por vírgula (ex.: `"Trabalho, Urgente"`).

Raia do Kanban é **independente de categoria** — é a organização própria do quadro Kanban da
ferramenta Tarefas (colunas como "A fazer"/"Em andamento"/"Feito", ou qualquer fluxo que o usuário
tenha montado lá), não tem relação com as categorias usadas na lista e nos filtros.

Todas as ferramentas que recebem `idOrTitle` aceitam tanto o id exato quanto um trecho do título
(busca case-insensitive); se mais de uma tarefa corresponder, a ferramenta retorna erro com a lista
de candidatas em vez de escolher uma arbitrariamente. Falhas de rede, HTTP ou validação voltam como
resultado de erro do MCP (`isError: true`) em vez de derrubar o processo do servidor.

## Viih Mimos: posts e site

O mesmo servidor traz ferramentas para a Viih Mimos: mandar fotos e contexto numa conversa,
gerar story, feed ou carrossel e alimentar o site.

| Tool | Descrição |
|---|---|
| `viih_listar_modelos` | Modelos de post (story, feed, carrossel), quantas fotos cada um recebe e os textos — inclui os salvos na galeria do editor. |
| `viih_gerar_post` | Fotos + contexto → a IA escolhe o modelo (ou usa o tipo/modelo pedido), reescreve os textos da arte, ordena as fotos, sugere filtro e escreve 3 legendas. Salva um **rascunho no Editor de Imagens** e devolve o link (`/imagens?projeto=<id>`): o editor abre com o post montado, pronto pra conferir e exportar. |
| `viih_gerar_legenda` | 3 legendas com hashtags, a partir do contexto e (opcional) de uma foto. |
| `viih_site_estado` | Resumo do site: produtos, depoimentos, quando foi publicado. |
| `viih_site_listar_produtos` | Catálogo do site. |
| `viih_site_enviar_fotos` | Envia fotos para a galeria do site. |
| `viih_site_criar_produto` / `viih_site_editar_produto` | Cria ou edita um produto do catálogo (nome, texto, itens, foto, destaque, visível). |
| `viih_site_adicionar_depoimento` | Depoimento de cliente. |
| `viih_site_listar_textos` / `viih_site_editar_textos` | Textos das páginas, por chave. |
| `viih_site_publicar` | Regera o site e põe no ar (pede confirmação explícita). |

**Fotos vão por caminho ou link**, não como anexo: o LLM vê a foto anexada na conversa mas não
consegue repassar o arquivo para a ferramenta. Diga, por exemplo, "as fotos estão em
`~/Fotos/alice/`" (o Claude Desktop/Code lista a pasta) ou passe links `https://`. JPG, PNG, WebP e
HEIC são aceitos — o MCP gira pelo EXIF e reduz antes de enviar.

Exemplo de conversa:

> As fotos do kit jardim encantado da Alice estão em ~/Fotos/alice (4 fotos). Gera um carrossel e
> um story, e põe o kit no catálogo do site com a melhor foto. Me mostra antes de publicar.

Os posts usam a IA configurada na sua conta do hub (Configurações). As ferramentas do site falam
com o painel da Viih Mimos (repositório `ViihMimos`, `admin/`) e só ficam ativas com as variáveis
`VIIH_PAINEL_*` abaixo. Nada vai ao ar sem `viih_site_publicar`.

O catálogo dos modelos do editor fica em `src/viih/modelos.ts`, gerado a partir do frontend. Um
teste do frontend (`social-mcp-catalog.spec.ts`) falha se ele ficar desatualizado; para regerar:

```bash
cd frontend
UPDATE_MCP_CATALOG=1 npx ng test --watch=false --include=src/app/features/imagem/social-mcp-catalog.spec.ts
```

## Configuração

Requer uma conta já existente no hub (crie uma pelo próprio app web, se ainda não tiver).

Variáveis de ambiente:

- `HUB_EMAIL` — e-mail da conta no hub (obrigatório).
- `HUB_PASSWORD` — senha da conta (obrigatório).
- `HUB_API_URL` — URL do backend. Padrão: `http://191.252.177.244:8090` (produção).
- `HUB_WEB_URL` — onde o app web abre, para o link do rascunho. Padrão: o mesmo de `HUB_API_URL`.
- `VIIH_PAINEL_URL` — endereço do painel do site da Viih Mimos (ex.: `https://viihmimos.com.br`). Opcional.
- `VIIH_PAINEL_LOGIN` / `VIIH_PAINEL_SENHA` — login do painel. Opcionais; sem os três, as ferramentas do site respondem que não estão configuradas.
- `VIIH_PERFIL_MARCA` — troca o perfil da marca que a IA segue (voz, contatos, hashtags). Opcional.

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
        "HUB_PASSWORD": "sua-senha",
        "VIIH_PAINEL_URL": "https://endereco-do-site-da-viih",
        "VIIH_PAINEL_LOGIN": "viih",
        "VIIH_PAINEL_SENHA": "senha-do-painel"
      }
    }
  }
}
```

Reinicie o cliente MCP depois de configurar. As ferramentas da tabela acima ficam disponíveis para
o LLM usar na conversa.

## Solução de problemas

- **`fetch is not defined`**: o servidor requer **Node 18 ou mais recente** (usa o `fetch` global).
  Aponte o `"command"` da configuração do cliente MCP pro caminho de um Node 18+ (`node --version`
  pra conferir) e reinicie o cliente. Esse é um problema do Node usado pra rodar o servidor MCP no
  seu computador — reiniciar a conversa com o LLM não resolve, é preciso reiniciar o processo do
  servidor MCP em si (reabrindo o Claude Desktop/Code, ou o que estiver hospedando os servidores
  MCP).
