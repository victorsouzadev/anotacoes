# Specs

Especificações no formato do [Spec Kit](https://github.com/github/spec-kit). As de 001 a 014
são **retroativas**: descrevem o que já existe no código em novembro de 2026, para servir
de base às mudanças futuras. Não têm `plan.md` nem `tasks.md` porque já foram implementadas.

Feature nova começa com `/speckit-specify` e ganha o próximo número (038 em diante). Mudança
grande numa ferramenta que já existe pode ser uma spec nova que cita a retroativa dela.

| # | Ferramenta | Spec |
|---|---|---|
| 001 | Hub, contas e configurações de IA | [spec](001-hub-contas/spec.md) |
| 002 | Notas | [spec](002-notas/spec.md) |
| 003 | Finanças | [spec](003-financas/spec.md) |
| 004 | Tarefas (web, Android e MCP) | [spec](004-tarefas/spec.md) |
| 005 | Dieta | [spec](005-dieta/spec.md) |
| 006 | Treino | [spec](006-treino/spec.md) |
| 007 | Editor de Imagens (web e Windows) | [spec](007-editor-imagens/spec.md) |
| 008 | Moldes | [spec](008-moldes/spec.md) |
| 009 | Simulador de Bolo 3D | [spec](009-bolo-3d/spec.md) |
| 010 | Publicar | [spec](010-publicar/spec.md) |
| 011 | Segundo Cérebro | [spec](011-segundo-cerebro/spec.md) |
| 012 | Anotação | [spec](012-anotacao/spec.md) |
| 013 | Precificação | [spec](013-precificacao/spec.md) |
| 014 | MCPs dos apps e operação da VPS | [spec](014-mcps-e-operacao/spec.md) |

## Specs novas (015 a 028)

Cobrem as lacunas do levantamento e todo o Roadmap do README. Cada uma passou por
specify → clarify (respondido com o padrão recomendado, registrado em "Clarifications") →
plan → tasks → analyze → implement. **Todas implementadas em 2026-11-18**, na ordem abaixo, com as
tarefas marcadas em cada `tasks.md`. Decisões tomadas durante a implementação ficaram registradas na
própria spec (ex.: Alt+N na 020, critério de paisagem na 019).

| # | Feature | Origem | Backend? | Artefatos |
|---|---|---|---|---|
| 015 | [Recorrência de tarefas na web](015-tarefas-recorrencia-web/spec.md) | lacuna da 004 | não | spec, plan, research, quickstart, tasks |
| 016 | [Tela web da Dieta](016-dieta-web/spec.md) | etapa 8 do plano da Dieta | não | + contracts |
| 017 | [Tela web do Treino](017-treino-web/spec.md) | lacuna da 006 | não | spec, plan, research, quickstart, tasks |
| 018 | [Lixeira de notas](018-notas-lixeira/spec.md) | Roadmap | sim (coluna + worker) | + data-model, contracts |
| 019 | [Exportar nota em PDF](019-notas-exportar-pdf/spec.md) | Roadmap | não | spec, plan, research, quickstart, tasks |
| 020 | [Duplicar e navegar entre páginas](020-notas-paginas/spec.md) | Roadmap | não | spec, plan, research, quickstart, tasks |
| 021 | [Tags nas notas](021-notas-tags/spec.md) | Roadmap | sim (coluna) | + data-model, contracts |
| 022 | [Arrastar imagens para o canvas](022-notas-arrastar-imagens/spec.md) | Roadmap | não | spec, plan, research, quickstart, tasks |
| 023 | [Link somente leitura de nota](023-notas-link-publico/spec.md) | Roadmap | sim (tabela + rotas) | + data-model, contracts |
| 024 | [Modo leitura / apresentação](024-notas-modo-leitura/spec.md) | Roadmap | não | spec, plan, research, quickstart, tasks |
| 025 | [Backup monitorado](025-backup-monitorado/spec.md) | Roadmap (confiabilidade) | sim (endpoint) | + data-model, contracts |
| 026 | [Texto de PDFs e imagens no Cérebro](026-cerebro-texto-anexos/spec.md) | fora da PoC da 011 | sim (cerebro) | spec, plan, research, quickstart, tasks |
| 027 | [Busca semântica no Cérebro](027-cerebro-busca-semantica/spec.md) | fase 4 da 011 | sim (cerebro) | spec, plan, research, quickstart, tasks |
| 028 | [OAuth 2.1 no MCP do Cérebro](028-cerebro-mcp-oauth/spec.md) | fora da PoC da 011 | sim (cerebro + Caddy) | + data-model, contracts |

Todas têm `checklists/requirements.md`.

### Ordem de implementação (seguida)

1. **025** backup monitorado — protege os dados antes de mexer em schema.
2. **015** recorrência na web — corrige uma divergência real, pequena.
3. **018** lixeira de notas — pré-requisito da 023.
4. **024** modo leitura — pré-requisito da 023.
5. **023** link somente leitura.
6. **019**, **020**, **022** — melhorias do editor, independentes.
7. **021** tags.
8. **016** e **017** — telas web de Dieta e Treino.
9. **026**, **027**, **028** — Segundo Cérebro (custo de IA desligado por padrão em 026 e 027).

### Dependências entre specs

- 023 depende de 024 (leitor) e de 018 (`TrashedAt`).
- 021 e 023 consideram notas na lixeira (018) fora das contagens e dos links.
- 019 e 022 movem helpers do Editor de Imagens para `shared/` (`pdf.ts`, `heic.ts`), reexportando no lugar antigo.

### Resultado do analyze

- Toda história de usuário tem tarefa; nenhuma spec ficou com `[NEEDS CLARIFICATION]`.
- Corrigido: 026 prometia HEIC no requisito e a pesquisa decidiu não suportar (requisito ajustado); 023 não declarava a dependência da 018 (declarado).
- Corrigido: a página de consentimento da 028 não pode ficar sob `/cerebro`, porque o Caddy manda todo `/cerebro/*` para o serviço; ficou em `/autorizar`.
- Única exceção à constituição: 028 implementa um servidor OAuth próprio (Princípio VIII), justificada na tabela "Complexity Tracking" do plano.
- Fora de todas as specs, de propósito: cópia de backup fora da VPS, OAuth nos MCPs dos apps e no `/ops`, tombstone de categorias de tarefas (limitação aceita na 004).

## Lacunas encontradas no levantamento

- ~~**Tarefas**: a próxima ocorrência de tarefa recorrente só era gerada no Android~~ — resolvido pela 015.
- ~~**Dieta**: não havia tela web~~ — resolvido pela 016.
- ~~**Treino**: não havia tela web~~ — resolvido pela 017.
- ~~**Segundo Cérebro**: busca semântica, OAuth 2.1 no MCP e leitura de anexos ficaram fora da PoC~~ — 026, 027 e 028.

## Achados da implementação

- **Notas, sincronização**: dois problemas antigos que perdiam edições apareceram no teste das tags (021)
  e foram corrigidos: a resposta de um envio sobrescrevia, como já enviada, uma mudança feita durante a
  requisição; e duas gravações locais ao mesmo tempo (renomear + autosave) faziam a última apagar a
  outra. As operações de ler-alterar-gravar no IndexedDB agora correm numa fila única.
- **Notas, sincronização**: o estilo de papel (preferência local) se perdia a cada sincronização;
  corrigido na 018.
- **Cérebro**: o README dizia que o índice já separava trechos; não separava (o FTS é por nota). A 027
  passou a dividir as notas em trechos para os vetores.

## Divisão em plug-ins (029 a 035)

Pedido em 2026-11-19: dividir o hub em vários repositórios, com este como núcleo e as ferramentas
conectadas como plug-ins, **todas usando o mesmo banco**. Desenho:
[Hub e Plug-ins](https://claude.ai/artifact/T4ifWBSrGHX1ikcrpQ9Wfo). A constituição foi emendada
para a v2.0.0 (Princípio I: "Um hub, um login, um banco"). Status: a base (029 a 032) está no código com pendências; a 033 (Cérebro) está em produção desde 20/11/2026 (falta T011 e T012); a 034 (Criativo e Treino congelados) está em produção desde 21/11/2026; a 035 ainda não começou.

| # | Feature | Depende de | Artefatos |
|---|---|---|---|
| 029 | [Núcleo do hub e contrato de plug-ins](029-nucleo-plugins/spec.md) | 030, 032 | + data-model, contracts |
| 030 | [Login com chave assimétrica e OAuth no núcleo](030-login-assimetrico/spec.md) | 029, 031 | + data-model, contracts |
| 031 | [Banco compartilhado entre núcleo e plug-ins](031-banco-compartilhado/spec.md) | 029 | + data-model, contracts |
| 032 | [Pacotes compartilhados dos plug-ins](032-pacotes-compartilhados/spec.md) | 030, 031 | + contracts |
| 033 | [Extrair o Segundo Cérebro](033-extrair-cerebro/spec.md) | 029–032 | spec, plan, research, quickstart, tasks |
| 034 | [Extrair e congelar as ferramentas sem uso](034-extrair-congelados/spec.md) | 033 | spec, plan, research, quickstart, tasks |
| 035 | [Extrair as ferramentas em uso](035-extrair-ferramentas-ativas/spec.md) | 034 | spec, plan, research, quickstart, tasks |

### Ordem de implementação

1. **030 + 031 + 032 + 029 juntas, ainda neste repositório**: chave assimétrica e selos de login, regras do
   banco, SDK e `@grafite/ui`, registro de plug-ins. Validadas com o plug-in `hub-exemplo`.
2. **033** Cérebro (já é serviço à parte).
3. **034** Criativo (Imagens, Moldes, Bolo 3D, Precificação, app Windows) e Treino, congelados.
4. **035** Dieta → Tarefas → Anotação → Finanças → Notas, uma por vez.

### Decisões principais

- **Banco** (substituído pela 038, que pôs tudo no Postgres): o `notas.db` atual, montado em todos os containers. Cada plug-in é dono só das tabelas do
  seu prefixo e tem histórico de migração próprio; extrair uma ferramenta não copia nenhuma linha. O
  deployer copia o banco antes de cada migração e reverte se uma tabela de outro dono mudar.
- **Login**: só o núcleo emite tokens (ES256 + JWKS); plug-ins só validam e recebem token com a
  própria audiência. Como o banco é compartilhado, as linhas de login levam selo HMAC com chave só do
  núcleo, para que gravar direto no banco não permita entrar como outra pessoa.
- **URLs antigas** (`/api/dieta`, `/api/mcp/tarefas`, `/cerebro/oauth/*`, `/p/nota/...`) continuam
  funcionando: apps Android instalados e conectores do Claude não precisam ser refeitos.
- **Telas**: cada plug-in serve a própria, com o tema e a barra do `@grafite/ui`; sem Module Federation.

### Resultado do analyze

- Toda história de usuário tem tarefa; nenhuma spec ficou com `[NEEDS CLARIFICATION]`.
- Corrigido durante a revisão: o token do hub mudaria de audiência e quebraria os apps (mantido
  `notas-vps`); conectores OAuth antigos guardam `/cerebro/oauth/token` (rota legada no núcleo);
  `/api/core/ia` por id de usuário deixaria um plug-in colher a chave de todos (agora exige o token do
  usuário); o Estúdio já não existe e o ViihMimos é o backend da Precificação (vai para o criativo).
- Riscos aceitos e registrados: com SQLite, a separação entre plug-ins é por convenção conferida
  (teste do SDK + deployer), não por permissão do banco — Postgres com papel por plug-in fica como
  evolução; e as telas no mesmo domínio podem ler o token do hub (030, Assumptions).
- Exceções à constituição justificadas em "Complexity Tracking": registro e deploy por plug-in (029),
  pacotes publicados (032).

## Cópia do backup fora da VPS (036)

Pedido em 2026-11-20, depois de um achado de produção: o cron do backup disparava todo dia, mas o
`scripts/backup.sh` da VPS estava sem permissão de execução (`666`) e na versão de julho, porque o
`deploy.yml` não empacota `scripts/`. O último backup era de 2026-07-09 e a saída do cron era descartada.
Corrigido à mão no mesmo dia (script da `main`, `755`, log em `/var/log/notas-backup.log`); a 036 trata a
causa e o risco maior: todos os dados e todas as cópias estão no mesmo disco. Status: **concluída**.

| # | Feature | Depende de | Artefatos |
|---|---|---|---|
| 036 | [Cópia do backup fora da VPS](036-backup-externo/spec.md) | 025 | + data-model, contracts |

### Ordem

**036 vem antes da 029–035**: a 031 concentra todos os plug-ins no mesmo `notas.db`, e a cópia externa
precisa existir antes de qualquer migração de plug-in.

### Decisões principais

- `restic` para o Google Drive do Victor (via `rclone`, escopo `drive.file`; comparado com B2 e GitHub), cifrado na VPS,
  deduplicado, com retenção 7 diárias / 4 semanais / 6 mensais. A senha fica também fora da VPS.
- O instantâneo leva as cópias consistentes do dia, os dumps do Postgres, o restante de `data/` (cobre os
  plug-ins sem mudar o script) e o `.env`, porque sem as chaves do núcleo (030) os logins deixam de valer.
- Conferência semanal: `restic check` parcial e restauração do `notas.db` com `PRAGMA integrity_check`.
  Ensaio completo numa máquina que não é a VPS antes de dar a spec como concluída e a cada 6 meses.
- Estado em `data/db/backup-externo.json`, separado do `backup-status.json` da 025 (que não muda de formato).
  O hub alerta com 36 h sem cópia externa ou 8 dias sem conferência.
- O deploy passa a levar `scripts/` com `755 root:root`; a limpeza dos 14 dias só apaga os arquivos do script
  (a versão antiga apagou `backups/estudio-2026-10-25/` em 2026-11-20).

### Resultado do analyze

- Todo requisito (FR-001 a FR-012) tem tarefa; nenhum `[NEEDS CLARIFICATION]`.
- Corrigido: guardar o estado externo dentro do `backup-status.json` faria cada backup local apagar o
  registro da conferência semanal; virou um arquivo próprio.
- Corrigido: o modelo de dados tinha dois campos para "último sucesso"; ficou só `concluidoEm`, com
  `falhaEm`/`erro` para a falha mais recente.
- Exceção à constituição justificada em "Complexity Tracking": `restic` no host (Princípio VIII).
- Fora da spec, registrado: `/opt/financas-vps/scripts/backup.sh` está com o mesmo `666` sem execução
  (outro repositório); object lock e segundo destino externo.

## Esquema do núcleo sem migrações (037)

Pedido em 2026-11-21: o repositório principal fica só com o núcleo. As 84 migrações do EF (com o histórico de
tabelas das ferramentas que viraram plug-ins) saem, e o núcleo cria as próprias tabelas pelo modelo ao subir.
Fecha o SC-004 da 035 contando tudo. Status: **concluída**. Desenho da arquitetura em `docs/arquitetura-hub.html`.

| # | Feature | Depende de | Artefatos |
|---|---|---|---|
| 037 | [Esquema do núcleo sem migrações](037-esquema-nucleo-sem-migracoes/spec.md) | 035 | plan, tasks |

## Tudo no Postgres (038)

Pedido em 2026-11-21: núcleo e plug-ins saem do `notas.db` para o banco `hub` do `notas-postgres`, com o schema
`nucleo` e um schema e um papel por plug-in. Fecha o risco aceito na 029–035 (separação só por convenção): agora o
banco recusa o acesso às tabelas de outro dono. Janela feita em 2026-11-22, sem diferença na conferência. Status:
**em uso; falta a limpeza** (T019 tira o SQLite, T020 docs). A Anotação ainda está no `notas.db`.

| # | Feature | Depende de | Artefatos |
|---|---|---|---|
| 038 | [Tudo no Postgres](038-tudo-no-postgres/spec.md) | 037 | plan, tasks |

## Agente de plug-ins (039)

Pedido em 2026-11-23: um plug-in novo, o `hub-agente`, que diagnostica um plug-in só lendo e cria o esqueleto de uma
ferramenta nova (repositório `hub-<id>` e PR), com a skill `plugin-hub`. A IA vem da assinatura do Claude do dono
(`claude -p` com o token do `claude setup-token`), sem chave de API. Status: **no ar** desde 2026-11-23
(T001 a T030, imagem `hub-agente:ae82bde`); as ressalvas do teste estão no fim do `tasks.md`.

| # | Feature | Depende de | Artefatos |
|---|---|---|---|
| 039 | [Agente de plug-ins](039-hub-agente/spec.md) | 038 | plan, research, data-model, contracts, quickstart, tasks |

### Decisões principais

- **Ferramentas:** o CLI roda com `--tools ""` (nenhuma ferramenta interna) e só enxerga o MCP local do backend, em
  `/interno/mcp/<execução>`, fora da rota pública, só de 127.0.0.1 e com um segredo por execução. Chamada fora da lista vira
  um evento `recusa`.
- **Leituras da VPS:** rotas GET `/api/core/agente/*` no núcleo, só com o segredo de serviço do `agente` e só ids do lock;
  o deployer ganhou `GET /plugins/{id}/logs` e `/health`. Os logs chegam sem as linhas com segredo.
- **Regras do manifesto:** saíram do deployer para o SDK (`RegrasDoManifesto`, 1.6.0). O agente ainda usa o SDK 1.5.1, que
  confere o manifesto sozinho; com a 1.6.0 publicada, o `validar_manifesto` passa a conferir também os outros plug-ins.
- **GitHub:** Octokit, sempre filtrado pelo repositório criado na própria execução; não existe merge.

## Painel de plug-ins (040)

Pedido em 2026-11-24: uma interface para pôr no ar, atualizar, voltar e desligar plug-ins, sem dar poder à IA e com o
merge no GitHub como trava final. Status: **spec escrita**, falta o plano.

| # | Feature | Depende de | Artefatos |
|---|---|---|---|
| 040 | [Painel de plug-ins](040-painel-plugins/spec.md) | 039 | spec |
