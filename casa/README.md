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
