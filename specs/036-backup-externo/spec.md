# Feature Specification: Cópia do backup fora da VPS

**Feature Branch**: `036-backup-externo` (sem branch própria; trabalho na branch da sessão)

**Created**: 2026-11-20

**Status**: Planejada (vem antes da 029)

**Input**: Pendência registrada na 025 ("cópia fora da VPS fica como próximo passo") e achado de produção de 2026-11-20: o cron do backup disparava todo dia, mas o `scripts/backup.sh` da VPS estava sem permissão de execução e numa versão de julho; o último backup era de 2026-07-09 e ninguém percebeu, porque a saída do cron era descartada. Hoje todos os dados do hub (e, depois da 031, de todos os plug-ins) estão num único disco de uma única VPS, e as cópias também.

## Clarifications

### Session 2026-11-20

Respondidas com a opção recomendada.

- Q: Para onde vai a cópia? → A: Um bucket de armazenamento de objetos compatível com S3, de um provedor diferente do da VPS (recomendado: Backblaze B2; Cloudflare R2 ou outro S3 servem sem mudar nada além da configuração).
- Q: A cópia é cifrada? → A: Sim, cifrada na VPS antes de sair. O provedor nunca vê o conteúdo. A senha da cópia fica também fora da VPS (gerenciador de senhas do Victor); sem ela a cópia não serve.
- Q: O que entra? → A: Tudo de que uma VPS nova precisa para voltar igual: a cópia consistente do `notas.db` e dos bancos dos sites feita pelo backup diário, os dumps do Postgres, o restante de `data/` (Cérebro, Anotação, sites, ops) sem os arquivos vivos de banco, e o `.env` (que guarda as chaves do núcleo; depois da 030, a chave de assinatura e a chave dos selos HMAC).
- Q: Com que frequência? → A: Uma vez por dia, logo depois do backup local das 4h, na mesma execução.
- Q: Quanto tempo guardar? → A: 7 diárias, 4 semanais e 6 mensais.
- Q: Como saber que a cópia restaura? → A: Toda semana a VPS confere a integridade da cópia remota e restaura o `notas.db` mais recente numa pasta temporária para rodar `PRAGMA integrity_check`. Além disso, uma restauração completa é ensaiada à mão numa máquina que não é a VPS ao terminar a implementação e depois a cada 6 meses.
- Q: E se a VPS for invadida e apagar a cópia remota? → A: A chave de acesso fica limitada ao bucket, e o bucket guarda as versões apagadas ou sobrescritas por 30 dias. Bloqueio de objeto (object lock) fica fora desta spec.
- Q: Onde aparece o estado? → A: No mesmo lugar da 025: um arquivo de estado irmão do `backup-status.json` (que não muda de formato) registra a cópia externa e a conferência; a faixa do hub e a seção "Servidor" mostram as duas idades, e o alerta usa o mesmo prazo de 36 h.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Os dados sobrevivem à perda da VPS (Priority: P1) 🎯 MVP

Todo dia, depois do backup local, uma cópia cifrada de tudo o que a VPS precisa para voltar vai para um armazenamento de outro provedor. Se a VPS sumir (disco, conta, provedor, invasão), o hub pode ser refeito numa máquina nova só com o repositório, a cópia e a senha.

**Why this priority**: É o maior risco do projeto. O backup local protege contra erro de software, não contra perder a máquina. A divisão em plug-ins (029–035) põe ainda mais ferramentas no mesmo `notas.db`.

**Independent Test**: Numa máquina que não é a VPS, com a senha e a chave do bucket, restaurar a cópia mais recente, subir o compose e entrar no hub com a conta de sempre, vendo notas, tarefas e finanças do dia anterior.

**Acceptance Scenarios**:

1. **Given** o backup local das 4h terminou sem erro, **When** a cópia externa roda, **Then** um novo instantâneo cifrado aparece no bucket com o `notas.db`, os bancos dos sites, os dumps do Postgres, o restante de `data/` e o `.env`.
2. **Given** o backup local falhou, **Then** a cópia externa não roda com dados velhos, e as duas idades aparecem atrasadas.
3. **Given** a rede ou o provedor fora do ar, **Then** a cópia falha, o local continua valendo, o erro vai para o log e a idade da cópia externa para de andar.
4. **Given** uma restauração numa máquina nova, **Then** os logins continuam válidos, porque o `.env` restaurado traz as mesmas chaves do núcleo, inclusive a dos selos HMAC da 030.

---

### User Story 2 - Saber que a cópia está em dia e restaura (Priority: P1)

O administrador vê no hub há quanto tempo foram a última cópia local, a última externa e a última conferência de restauração, e é avisado quando alguma passa do prazo.

**Why this priority**: O incidente de 2026-11-20 mostrou que um backup sem aviso de falha é o mesmo que nenhum backup.

**Independent Test**: Trocar a chave do bucket por uma inválida e rodar o script: a faixa "Cópia externa atrasada" aparece no prazo; corrigir a chave e rodar de novo: some.

**Acceptance Scenarios**:

1. **Given** a última cópia externa há 40 h, **Then** faixa "Cópia externa há 1 dia e 16 h", mesmo com o backup local em dia.
2. **Given** a cópia externa nunca rodou, **Then** faixa "Cópia externa nunca registrada".
3. **Given** a conferência semanal achou erro ou não roda há mais de 8 dias, **Then** faixa "Restauração não conferida".
4. **Given** um usuário comum, **Then** não vê nada disso (como na 025).
5. **Given** o `criativo_resumo`, **Then** a linha de backup traz as duas idades.

---

### User Story 3 - O que está na VPS é o que está no repositório (Priority: P2)

Os scripts de backup que rodam na VPS são os do repositório, executáveis, e chegam pelo deploy normal. A saída de cada execução fica num log.

**Why this priority**: A causa do incidente foi o deploy não levar `scripts/`; corrigir à mão não impede que aconteça de novo.

**Independent Test**: Mudar um comentário do `scripts/backup.sh`, fazer o deploy pela Actions e ver o arquivo novo na VPS com permissão de execução.

**Acceptance Scenarios**:

1. **Given** um deploy, **Then** `scripts/` é atualizado na VPS e os scripts ficam com permissão de execução, só o root podendo alterá-los.
2. **Given** uma execução do cron, **Then** a saída fica em `/var/log/notas-backup.log`, com rotação.
3. **Given** a limpeza dos 14 dias do backup local, **Then** só apaga arquivos que o próprio script criou (`notas-*`, `site-*`, `pg-*`), nunca outros arquivos ou pastas em `backups/`.

### Edge Cases

- Senha da cópia ausente ou errada na VPS: a cópia não roda, o status marca erro e nada é enviado sem cifrar.
- Bucket cheio ou conta suspensa: tratado como falha de rede (cenário 1.3).
- Duas execuções ao mesmo tempo (cron + manual): a segunda espera ou desiste, sem corromper a cópia.
- Disco da VPS quase cheio (hoje 77%): a cópia externa não cria arquivos temporários grandes em disco.
- Restauração parcial (só um site, só o Cérebro): possível a partir do mesmo instantâneo.
- Plug-ins da 029 com dados próprios em `data/<id>/`: entram sem mexer no script, porque a cópia leva todo o `data/`.
- Arquivos vivos do SQLite (`notas.db`, `-wal`, `-shm`, `app.db`) não são copiados direto: vale a cópia consistente feita pelo backup local.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O backup diário MUST enviar, depois do backup local e só se ele terminou sem erro, um instantâneo cifrado para um armazenamento de outro provedor.
- **FR-002**: O instantâneo MUST conter as cópias consistentes do dia, os dumps do Postgres, todo `data/` exceto os arquivos vivos de SQLite e do Postgres, e o `.env`.
- **FR-003**: A cifragem MUST acontecer na VPS; a senha MUST existir também fora da VPS, e o DEPLOY.md MUST dizer onde guardá-la.
- **FR-004**: A retenção MUST ser de 7 diárias, 4 semanais e 6 mensais.
- **FR-005**: Uma conferência semanal MUST checar a integridade da cópia remota e restaurar o `notas.db` mais recente para rodar `PRAGMA integrity_check`.
- **FR-006**: Um arquivo de estado ao lado do `backup-status.json` MUST registrar a última cópia externa e a última conferência (data, sucesso, tamanho), sem mudar o formato do arquivo da 025.
- **FR-007**: O hub, a seção "Servidor" e o `criativo_resumo` MUST mostrar as idades e alertar com 36 h sem cópia externa ou 8 dias sem conferência.
- **FR-008**: O deploy MUST levar `scripts/` para a VPS com permissão de execução, só o root podendo alterar.
- **FR-009**: A saída do backup MUST ir para `/var/log/notas-backup.log` com rotação.
- **FR-010**: A limpeza do backup local MUST apagar só os arquivos que o script criou.
- **FR-011**: O DEPLOY.md MUST ter o procedimento de restauração completa numa máquina nova, ensaiado pelo menos uma vez antes de a spec ser dada como concluída.
- **FR-012**: Nenhum segredo (senha da cópia, chave do bucket) MUST aparecer no repositório, no log, no `backup-status.json` ou na API.

### Key Entities

- **Instantâneo externo**: data, identificador, tamanho, arquivos incluídos.
- **Conferência de restauração**: data, resultado (ok/erro), mensagem.
- **Estado da cópia externa**: última cópia e última conferência; fica ao lado do estado do backup da 025, que não muda.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com a VPS inteira perdida, o hub volta numa máquina nova com no máximo 24 h de dados perdidos.
- **SC-002**: A restauração completa, seguindo o DEPLOY.md, leva menos de 1 hora.
- **SC-003**: Uma falha da cópia externa ou da conferência é percebida em até 36 h (cópia) ou 8 dias (conferência), sem ninguém entrar na VPS.
- **SC-004**: O custo mensal do armazenamento fica abaixo de US$ 1 com os dados atuais (cerca de 180 MB).

## Assumptions

- O Victor cria a conta e o bucket no provedor e guarda a senha da cópia no gerenciador de senhas; nada disso é feito pelo Claude.
- A VPS tem saída para a internet na porta 443.
- O backup local da 025 continua como está (diário, 14 dias), com o ajuste da limpeza (FR-010).
- O `/opt/financas-vps` e o `/opt/forge-vps` têm backups próprios com o mesmo defeito de permissão; ficam fora desta spec (outro repositório), mas o achado é registrado no `specs/README.md`.
- Object lock, segundo destino externo e backup do sistema operacional da VPS ficam fora desta spec.
- Vem antes da 029: a 031 passa a concentrar todos os plug-ins no mesmo `notas.db`, então a cópia externa precisa existir antes.
