# Research: 040 painel de plug-ins

Conferido no código e no GitHub em 2026-11-24.

## R1. Onde o painel mora
- **Decision**: no núcleo (`/plugins` e `/api/painel/plugins/*`).
- **Rationale**: o núcleo tem o login, o estado e o caminho até o deployer. O plug-in da IA fica fora do caminho de escrita.
- **Alternatives**: no `hub-agente`, colocaria as ações no container da IA; plug-in novo custaria até 256 MB.

## R2. Quem prepara o banco
- **Decision**: o deployer, com SQL por `docker exec -i notas-postgres psql` (stdin), como já faz com o dump e a restauração.
- **Rationale**: a senha nasce e é gravada no mesmo processo, sem passar pela API exposta. `data/plugins` é só leitura no núcleo.
- **Alternatives**: usar o acesso de administrador do núcleo (Publicar) obrigaria a mandar a senha ao deployer; rodar o `postgres-hub.sh papeis` redefine a senha do `nucleo` e exige todas as senhas.

## R3. Preparo repetível sem mudar senha
- **Decision**: ordem arquivo → papel e schema → permissões → teste de conexão, com estas regras:

| Arquivo `banco/<id>` | Papel | O que acontece |
|---|---|---|
| não | não | gera a senha, grava o arquivo (600), cria o papel |
| sim | não | cria o papel com a senha do arquivo |
| sim | sim | não mexe na senha; completa schema, permissões e testa |
| não | sim | recusa: papel criado à mão, senha desconhecida |

- O arquivo nasce num temporário e é movido, nunca por cima de outro. Nunca há `ALTER ROLE ... PASSWORD`.
- O arquivo leva `Maximum Pool Size=3`. O teste de conexão usa TCP, porque o socket local não confere senha.
- Plug-in ativo no registro sem arquivo `banco/<id>` é recusado: criar o arquivo mudaria o banco dele.
- Se o teste falhar com arquivo e papel existentes, a etapa falha e nada é corrigido sozinho.
- A sessão começa desligando o registro de comandos e de erros com SQL (`log_statement` e `log_min_error_statement`). A senha vai só por stdin, e a saída de erro é limpa antes de voltar.
- **Permissões**: as mesmas do `postgres-hub.sh` para um id (`USAGE` no schema `nucleo` e `REFERENCES ("Id")` em `nucleo.users`).
- **Alternatives**: gravar o arquivo no fim deixaria um papel sem senha conhecida numa interrupção.

## R4. Como abrir o PR sem poder de merge
- **Decision**: um workflow `plugins-lock.yml` (`workflow_dispatch`), na `main` do núcleo. Ele confere as entradas, muda só a linha, cria a branch `painel/<operacao>` e abre o PR. O token da VPS tem só **Actions: Read and write**, só no `anotacoes`.
- **Rationale**: no GitHub, quem pode escrever em código pode fazer merge, e a `main` não tem proteção (conferido). Sem a permissão Contents, o hub não faz merge nem toca outro arquivo: FR-008 e FR-014 valem pela permissão, não só pelo código.
- **Custos**:
  - O dono precisa ligar no repositório "Allow GitHub Actions to create and approve pull requests" (hoje desligado). O workflow não aprova nada.
  - PR aberto por workflow não dispara a CI. O workflow chama a CI por `workflow_dispatch` na branch do PR, então `ci.yml` ganha esse gatilho.
  - O repositório é público: o PR e o log do workflow só levam id, imagem, commit e o número da operação.
  - O token de disparo alcança qualquer workflow com gatilho manual do núcleo. Um teste lista os gatilhos manuais permitidos e falha se surgir outro.
- **Alternatives**: token com Contents; o dono editar o arquivo no GitHub por um link (mais cliques e erro de digitação); proteção da `main` (recomendada à parte, mas o token do dono a contornaria).

## R5. Ids perigosos
- **Decision**: o preparo recusa `postgres`, `nucleo`, `public`, `hub`, `information-schema` e ids começando com `pg-`, além das regras do `RegrasDoManifesto`. A lista entra no SDK, usada pelos dois lados.
- **Rationale**: o `RegrasDoManifesto` de hoje aceita `nucleo` e `postgres`; o preparo com esses nomes tocaria os papéis do sistema.

## R6. O que falta numa ferramenta
- **Decision**: cada etapa vem de uma fonte. Candidatas são os repositórios `hub-<id>` da conta, fora `hub-modelo` e `hub-exemplo`.

| Etapa | Fonte |
|---|---|
| CI da `main` verde | GitHub (Actions) |
| manifesto válido | `plugin.json` do commit, com `RegrasDoManifesto` contra os plug-ins ativos |
| imagem publicada | deployer: `docker manifest inspect` (a tag é o commit curto) |
| banco, conexão e permissões | deployer: conferência só de leitura |
| registro | `plugins.lock` da VPS e PR aberto |
| no ar | `GET /plugins` do deployer e health |

- A falha na primeira subida não entra em `core_plugins_estado` (o manifesto ainda é nulo), então o painel lê o `GET /plugins` do deployer, não a tabela.
- Uma fonte fora do ar vira "não deu para conferir"; as outras continuam.
- O deployer confere de novo o manifesto de dentro da imagem no deploy; a conferência pelo GitHub só antecipa a recusa.

## R7. Quem pode, e como a IA fica de fora
- **Decision**: variável `HUB_ADMINISTRADORES` (e-mails; vazia = ninguém). As rotas exigem sessão do hub; a audiência do token já é validada, então tokens de MCP e o segredo de serviço dos plug-ins não passam. Nenhuma ferramenta MCP nova. As ações pedem um código de confirmação de uso único, gerado na revisão.
- **Risco aceito**: uma tela de plug-in roda na mesma origem e poderia usar a sessão aberta do dono. Ela ainda não faria merge, e o código dela passou pela revisão do dono.
- **Alternatives**: reusar `PUBLICADORES` misturaria quem publica sites com quem administra o hub.

## R8. Recursos
- **Decision**: o deployer lê `/proc/meminfo` (mostra o host) e `docker stats --no-stream`, e conta as conexões em `pg_stat_activity`.
- Aviso quando a memória disponível for menor que 256 MB, ou quando a soma dos pools (3 por plug-in ligado, 10 do núcleo, mais o novo) passar de `max_connections` menos 6.
- O aviso não bloqueia.

## R9. Acompanhar o resultado
- **Decision**: a situação da operação é calculada na leitura: PR (aberto, mesclado, fechado) e o `GET /plugins` do deployer. Sem webhook e sem tarefa de fundo; a tela consulta a cada 10 s enquanto houver operação aberta.
- Operação aberta impede outra do mesmo id, com índice único parcial, que vale entre duas abas.

## R10. Tokens do GitHub
- **Decision**: dois tokens fine-grained, no `.env` da VPS: `PAINEL_GITHUB_LEITURA` (todos os repositórios: Contents e Actions, leitura) e `PAINEL_GITHUB_DISPARO` (só `anotacoes`: Actions, leitura e escrita). Validades em `PAINEL_GITHUB_LEITURA_VALIDADE` e `PAINEL_GITHUB_DISPARO_VALIDADE`, com aviso 7 dias antes.
- Sem o de leitura, a lista do registro continua; sem o de disparo, os botões explicam o que falta.
