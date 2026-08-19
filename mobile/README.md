# Tarefas — app Android (Organizador)

App Android nativo (Kotlin + Jetpack Compose) de organização de tarefas: hoje/atrasadas/todas,
subtarefas, categorias, prioridade, recorrência, pomodoro, lembretes por horário e por localização
(geofence), sincronização com o calendário do aparelho, widget de tela inicial e interpretação de
texto livre por IA (OpenRouter). Local-first — funciona 100% offline (Room/SQLite), sem exigir
conta.

Portado do repositório original (`victorsouzadev/tasks-organization`) pra dentro deste monorepo,
como as demais ferramentas — ver [README.md](../README.md) na raiz.

## Sincronização com a versão web

Opcional: em **Configurações → Conta e sincronização**, logar com a mesma conta usada no hub (a
versão web da ferramenta "Tarefas" em [`frontend/src/app/features/tasks`](../frontend/src/app/features/tasks))
sincroniza tarefas e categorias entre o app e o navegador, contra os mesmos endpoints
`/api/tasks/*` do backend ([`backend/Notas.Api`](../backend/Notas.Api)).

- Sincronização **completa** (não incremental) a cada rodada: busca tudo do servidor, mescla no
  Room local por `remoteId`/`updatedAt` ("quem editou por último vence"), depois envia tudo que é
  local. Adequado pra escala pessoal — não tenta ser um sistema de sync incremental.
- Funcionalidades específicas do Android (geofence, sincronização com o calendário do aparelho,
  widget, notificações via `AlarmManager`) **não são sincronizadas** — são estado só do aparelho.
- Sem login, o app continua funcionando exatamente como antes: 100% local, sem nenhuma chamada de
  rede além da interpretação por IA (se configurada).
- O endereço do servidor é configurável em Configurações (padrão: a URL de produção do hub, ver
  [DEPLOY.md](../DEPLOY.md)).

## Build

```bash
# Precisa do Android SDK (compileSdk 34) — configurar local.properties:
echo "sdk.dir=/caminho/do/Android/sdk" > local.properties

./gradlew assembleDebug
# APK gerado em app/build/outputs/apk/debug/app-debug.apk
```

## Stack

| Camada | Tecnologia |
|---|---|
| UI | Jetpack Compose, Material 3, Navigation Compose |
| Armazenamento local | Room (SQLite) |
| DI | Container manual (`di/AppContainer.kt`), sem Hilt/Koin |
| Rede (sync + IA) | `HttpURLConnection` + `org.json`, sem Retrofit/OkHttp |
| Lembretes | `AlarmManager` (por horário), `FusedLocationProvider`/geofencing (por localização) |
| Widget | Jetpack Glance |
