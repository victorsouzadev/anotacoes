# Feature Specification: Publicar (hospedagem de apps no mesmo servidor)

**Feature Branch**: `010-publicar` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/publicar`, `Endpoints/SitesEndpoints.cs`, `Services/Sites`, `deployer/`, `exemplos/publicar/recados`, `docs/poc-multi-app/DISCOVERY.md` e seção "Publicar" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publicar um app com um ZIP (Priority: P1)

Uma pessoa liberada envia um ZIP ou pasta com `api/` (saída de `dotnet publish`) e/ou `web/` (front estático), clica em Publicar e o app fica no ar em `http://<endereço>.<ip>.sslip.io:8090`, com SQLite próprio que sobrevive às republicações.

**Why this priority**: É a função da ferramenta.

**Independent Test**: Publicar o exemplo Recados e usar a API e a página na URL gerada.

**Acceptance Scenarios**:

1. **Given** um e-mail fora de `PUBLICADORES`, **When** abre o hub, **Then** não vê a ferramenta e a API recusa.
2. **Given** um ZIP só com `web/`, **When** publica, **Then** o Caddy serve o front estático, sem container.
3. **Given** um ZIP com `api/`, **When** publica, **Then** o `deployer` cria um container `aspnet` próprio para o site.

---

### User Story 2 - Versões, health check e volta (Priority: P1)

Cada envio vira uma versão. Antes da troca a plataforma copia o SQLite e faz `pg_dump` do Postgres. Versão que não responde ao health check volta sozinha para a anterior, com os bancos; a pessoa pode ativar qualquer versão guardada, com ou sem restaurar os bancos.

**Independent Test**: Publicar uma versão que não sobe e ver o site continuar na anterior.

---

### User Story 3 - Banco Postgres próprio (Priority: P2)

Opcionalmente a pessoa cria um banco no Postgres compartilhado, com usuário e senha só dele, entregues ao app como `ConnectionStrings__Postgres` e `PG*`; pode trocar a senha e excluir.

---

### User Story 4 - Controlar o app (Priority: P2)

Variáveis de ambiente cifradas, logs do container, parar/iniciar/reiniciar e excluir.

---

### User Story 5 - Preparar um app existente (Priority: P3)

O botão "Preparar um app" gera um prompt para um assistente de código, personalizado com a URL e o banco do site, que adapta o projeto ao contrato, cria os scripts de empacotar e valida com as mesmas restrições da plataforma.

### Edge Cases

- ZIP com caminho absoluto, `..` ou link simbólico (zip slip): recusado.
- Publicações, paradas, reinícios e exclusões passam por uma fila única (`FilaSites`, um leitor só): uma operação por vez.
- Banco de outro site nunca é acessível (usuário e banco por site; testado contra Postgres real no CI).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Só e-mails em `PUBLICADORES` MUST ver e usar a ferramenta.
- **FR-002**: Cada envio MUST gerar uma versão guardada, com backup dos bancos antes da troca.
- **FR-003**: Versão que falha no health check MUST voltar sozinha para a anterior.
- **FR-004**: Cada app C# MUST rodar em container próprio, com limite de memória e CPU, disco somente leitura exceto `/data` e rede separada do hub.
- **FR-005**: Só o serviço `deployer` MUST ter acesso ao `docker.sock`.
- **FR-006**: Variáveis de ambiente do app MUST ser guardadas cifradas.
- **FR-007**: O Postgres opcional MUST ter usuário e banco exclusivos por site.

### Key Entities

- **Site**: endereço (slug), dono, estado, versão ativa.
- **Versão (deployment)**: arquivos enviados, data, resultado do health check, backups dos bancos.
- **Variável**: nome e valor cifrado.
- **Banco Postgres do site**: usuário, senha, nome do banco.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Do ZIP enviado ao app no ar em menos de 1 minuto para um app pequeno.
- **SC-002**: Uma versão quebrada nunca deixa o site fora do ar por mais que o tempo do health check.
- **SC-003**: Nenhum app publicado alcança dados do hub ou de outro app.

## Assumptions

- Apps C# (.NET) e fronts estáticos; outras linguagens estão fora.
- Endereços em sslip.io sobre o IP da VPS, sem HTTPS próprio por site.
