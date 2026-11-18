# Feature Specification: MCPs dos apps e MCP de operação da VPS

**Feature Branch**: `014-mcps-e-operacao` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `backend/Notas.Api/Mcp/*` (`AppsMcpAuth.cs`, `TarefasMcpTools.cs`, `FinancasMcpTools.cs`, `CriativoMcpTools.cs`, `DietaMcpTools.cs`, `TreinoMcpTools.cs`), `ops/` e `cerebro/README.md`. O MCP de tarefas em Node (`mcp/`) está na spec 004.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Um agente consulta os dados dos apps do hub (Priority: P1)

O Claude (Code, web ou o próprio Segundo Cérebro) chama os MCPs do notas-api para ler resumos e dados da conta do dono do Cérebro.

**Why this priority**: É o que alimenta a rotina diária do Segundo Cérebro e permite perguntar sobre os apps.

**Independent Test**: Gerar o token em Conectar → Apps do hub, chamar `financas_resumo` pelo Claude Code e conferir com o painel.

**Acceptance Scenarios**:

1. **Given** sem o arquivo de token (`Mcp__TokenFile`), **When** qualquer MCP é chamado, **Then** responde 503.
2. **Given** chamada de fora da rede interna sem HTTPS, **Then** o Caddy recusa `/api/mcp`.
3. **Given** um token válido, **Then** os dados devolvidos são só os da conta com o e-mail registrado junto do token.

MCPs e ferramentas:

| MCP | Ferramentas |
|---|---|
| `/api/mcp/tarefas` | `tarefas_resumo`, `tarefas_listar` |
| `/api/mcp/financas` | `financas_resumo`, `financas_resumo_mes`, `financas_buscar_transacoes`, `financas_evolucao`, `financas_saude`, `financas_metas`, `financas_recorrentes`, `financas_compromissos` |
| `/api/mcp/criativo` | `criativo_resumo`, `criativo_sites`, `criativo_projetos_imagem` |
| `/api/mcp/dieta` | `dieta_resumo`, `dieta_dia`, `dieta_periodo`, `dieta_buscar_alimento`, `dieta_registrar_refeicao`, `dieta_registrar_peso`, `dieta_registrar_agua` |
| `/api/mcp/treino` | `treino_resumo`, `treino_atividades` |

---

### User Story 2 - Um agente opera a VPS (Priority: P2)

O serviço `ops` (.NET 10, profile `ops`, desligado por padrão) dá a um agente shell de root no host (`run_command`), status do sistema, lista, logs e ações de containers, leitura e escrita de arquivos.

**Why this priority**: Permite diagnosticar e corrigir a VPS sem SSH manual, mas é o recurso mais perigoso do repositório.

**Independent Test**: Com o token, chamar `system_status` e `container_logs` do `api`; conferir a linha no `audit.log`.

**Acceptance Scenarios**:

1. **Given** token com menos de 32 caracteres, **Then** o serviço não sobe; sem token, `/mcp` responde 503.
2. **Given** acesso pelo IP:8090, **Then** responde 403; só HTTPS no subdomínio do Cérebro, exceto `/ops/health`.
3. **Given** `write_file`, **Then** uma cópia `<arquivo>.bak-<data>` é guardada antes.
4. **Given** um token novo gerado na tela do Cérebro, **Then** o anterior para de valer sem reiniciar o serviço.

### Edge Cases

- Limites do ops: 60 chamadas/min, até 30 min por comando, saída cortada acima de ~100 KB, leitura até 200 KB.
- Os MCPs dos apps só escrevem nos registros rápidos da Dieta; todo o resto é somente leitura.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Os MCPs dos apps MUST autenticar por token cujo SHA-256 e e-mail ficam num arquivo montado só leitura, gerado pelo Cérebro.
- **FR-002**: Os MCPs dos apps MUST ser somente leitura, exceto `dieta_registrar_*`.
- **FR-003**: Cada app MUST expor `<app>_resumo` para a rotina do Segundo Cérebro.
- **FR-004**: O ops MUST exigir token de pelo menos 32 caracteres, só HTTPS, e registrar toda chamada em `data/ops/audit.log`.
- **FR-005**: O ops MUST ficar desligado por padrão (profile do compose).

### Key Entities

- **Token dos apps**: hash e e-mail do dono.
- **Token do ops**: hash.
- **Registro de auditoria**: ferramenta, argumentos, código de saída e duração.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Toda chamada ao ops aparece no log de auditoria.
- **SC-002**: Um token vazado é revogado em segundos, gerando outro na tela.

## Assumptions

- Quem tem o token do ops controla a VPS inteira; ele é tratado como senha de root.
- Respostas dos MCPs são Markdown em pt-BR, pensadas para leitura por LLM.
