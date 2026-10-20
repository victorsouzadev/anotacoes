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
