# Casa — divisão de tarefas domésticas

- `server/`: API em Node 22 (node:sqlite, sem dependências). Na VPS fica em `/opt/casa`, publicado em **https://casa.vsitefy.com.br** (nginx-proxy-manager → `casa-api:8080` na rede `proxy`, certificado Let's Encrypt)
  (`docker compose up -d --build`). Os dados ficam no volume `casa-data`.
- `android/`: app Kotlin + Compose. `echo sdk.dir=... > local.properties && ./gradlew assembleDebug`.

Funções: criar casa ou entrar com código de convite; tarefas com pontos (esforço) e frequência;
divisão por **pontos equilibrados** (peso por pessoa, 👍/👎 por tarefa, variedade, saldo de quem
ficou devendo na semana anterior) ou **rodízio**; responsável fixo; ausência por N dias;
assumir a tarefa de outra pessoa; placar semanal.

Lembretes: notificação local de manhã (tarefas do dia) e à noite (pendentes), com horários
ajustáveis na aba Casa. O alarme consulta o servidor na hora, e é reagendado após reiniciar o aparelho.

Download: **https://casa.vsitefy.com.br** (página) ou direto **https://casa.vsitefy.com.br/casa.apk**.
Para publicar uma nova versão (o token está em `/opt/casa/.env` na VPS):
```bash
curl -X PUT https://casa.vsitefy.com.br/admin/apk -H "X-Upload-Token: $UPLOAD_TOKEN" \
  --data-binary @android/app/build/outputs/apk/debug/app-debug.apk
```

## Identidade visual (Grafite)

Segue a skill `aplicar-grafite` (`.claude/skills/aplicar-grafite/SKILL.md` na `main`).
- App: tokens e mapeamento para o Material 3 em `android/.../Tema.kt` (`GrafiteCores.Dia`/`Noite`, segue o
  modo do sistema), janela em `res/values*/temas.xml` e `cores.xml`, fontes Newsreader, Figtree e IBM Plex Mono
  em `res/font/` (Google Fonts, licença SIL OFL 1.1), ícone adaptável gerado do símbolo em `res/mipmap-anydpi-v26/`.
- Página de download e `/favicon.svg`: mesmas variáveis em `server/server.mjs`.
- Nanquim é o acento único de cada tela; ações secundárias ficam em grafite (`AcaoNeutra`).

## Regras da casa

- **Condições** (`condicoes`): "Água" dia sim, dia não (`tipo: alternado`, com uma data em que vale) ou
  só em certos dias da semana (`tipo: semana`). Uma tarefa ligada a uma condição só cai nos dias em que ela vale.
- **Disponibilidade** por pessoa e dia da semana (`membros.disponibilidade`, segunda a domingo):
  1 = livre, 0.4 = pouco, 0 = nada. A divisão escolhe os dias das tarefas puxando para os dias com mais gente
  livre, evita dar tarefa (sobretudo pesada) a quem tem pouco no dia e, no fim, devolve o equilíbrio da semana
  passando tarefas de quem ficou acima da sua parte para quem ficou abaixo, nos dias livres desta pessoa.
- O servidor usa `TZ=America/Sao_Paulo`: "hoje" e a virada da semana seguem o horário de Brasília.

## Horário e agenda

- Cada tarefa pode ter **horário de preferência** (`horario` HH:MM) e **duração** (`duracao`, minutos). As listas
  mostram o horário e ordenam por ele.
- **Agenda do celular** (app, aba Casa → Agenda): escolhe uma agenda do aparelho e põe as minhas tarefas da semana
  como eventos (com horário = evento com hora; sem horário = dia inteiro), atualizados a cada mudança da divisão e
  nos alarmes de lembrete. Eventos de semanas passadas ficam como histórico. Código em `android/.../Agenda.kt`.
- **Link .ics** (`POST /api/agenda` cria ou troca, `DELETE` desliga): `GET /agenda/<token>.ics` com esta semana e a
  próxima, para assinar no Google Agenda/Apple. O token não aparece no log de requisições do servidor.

## Não feita, comentários e painel

- **Não feita**: no detalhe da tarefa (toque na linha), a pessoa marca "não deu para fazer" (com motivo) ou outra
  pessoa sinaliza que não foi feita (`POST /api/atribuicoes/:id/nao-feita`; `.../reabrir` desfaz). Vira comentário.
- **Comentários**: qualquer pessoa da casa comenta em qualquer tarefa (`POST /api/atribuicoes/:id/comentarios`,
  `DELETE /api/comentarios/:id` para quem escreveu ou o admin). Tarefas com comentário ou marcadas como não feitas
  não são apagadas na redistribuição. Os lembretes avisam de comentários novos nas minhas tarefas.
- **Painel** (`server/painel.mjs`): no app (aba Casa → Abrir painel, WebView autenticado pelo token) e em PC/TV por
  link `/p/<link>` + código de 6 dígitos (5 erros bloqueiam 15 min). Cada aparelho que acerta o código fica
  conectado por 90 dias (cookie); "Trocar" gera link e código novos e desconecta todos. O link e o código não vão
  para o log de requisições.

## Logs

- **Requisições**: uma linha JSON por chamada (rota, status, tempo, casa, membro, versão do app) no
  stdout: `docker logs -f casa-api` (rotação: 3 × 10 MB). Tokens e corpos nunca são registrados.
- **Eventos e erros** (casa criada, membro entrou/saiu, APK publicado, erros 500 do servidor e
  erros/travamentos enviados pelo app) também ficam na tabela `logs`, guardados por 30 dias (`LOG_DIAS`):
  ```bash
  curl -H "X-Upload-Token: $UPLOAD_TOKEN" "https://casa.vsitefy.com.br/admin/logs?nivel=erro&limite=50"
  # filtros: nivel=info|aviso|erro, origem=app|servidor, casa=<id>, evento=<nome>, desde=<data ISO>
  ```
- O app guarda erros numa fila local (até 50) e envia para `POST /api/logs` quando há conexão;
  um travamento é gravado na hora e enviado na próxima abertura.

## MCP (Claude agindo na casa)

`https://casa.vsitefy.com.br/mcp` — Streamable HTTP, implementado em `server/mcp.mjs` sobre as mesmas
rotas do app. Age em nome do membro `MCP_MEMBRO_ID`; token `MCP_TOKEN` (>= 32 caracteres) no `.env`.

- **Claude Code:** `claude mcp add --transport http casa https://casa.vsitefy.com.br/mcp --header "Authorization: Bearer <MCP_TOKEN>"`
- **Claude web/app (conector personalizado):** `https://casa.vsitefy.com.br/mcp?key=<MCP_TOKEN>` — a URL vale como senha.

Ferramentas: `casa_resumo`, `listar_semana`, `listar_tarefas`, `concluir_tarefa`, `passar_tarefa`,
`criar_tarefa`, `editar_tarefa`, `remover_tarefa`, `definir_ausencia`, `definir_peso`, `definir_modo`,
`redistribuir_semana`, `resumo_semana` (Markdown para salvar no Segundo Cérebro) e `ver_logs`.
Cada ação que altera algo fica registrada nos logs (`mcp_acao`); token recusado vira `mcp_token_recusado`.
Trocar o token: `sed -i "s/^MCP_TOKEN=.*/MCP_TOKEN=$(openssl rand -hex 32)/" /opt/casa/.env && docker compose up -d`.
