# Dieta — app Android

App nativo (Kotlin + Jetpack Compose) da ferramenta **Dieta** do hub: diário alimentar com a base
**TACO**, metas de calorias/macros/água, peso, plano alimentar, fotos, gamificação e compartilhamento
do progresso. APK próprio (`com.organizador.dieta`), no mesmo projeto Gradle do app de Tarefas.

Plano e decisões: [docs/dieta/PLANO.md](../../docs/dieta/PLANO.md). Backend: `/api/dieta/*` em
[`backend/Notas.Api`](../../backend/Notas.Api) (`Endpoints/DietaEndpoints.cs`, `Services/Dieta`).

## Como funciona

- **Local-first (Room).** Tudo é gravado no aparelho e marcado como "sujo"; o `SyncWorker`
  (WorkManager, a cada hora e logo após cada mudança, com rede) envia com `PUT /{id}` e busca o que
  mudou com `?desde=`. "Quem editou por último vence", igual às Tarefas. Sem login o app funciona
  offline, só sem sync, progresso, código de barras e links.
- **TACO embutida.** O `taco.csv` é o mesmo arquivo que o backend carrega
  (`backend/Notas.Api/Data/Seed`), incluído como asset pelo `build.gradle.kts`.
- **Metas.** Mesma conta do backend (Mifflin-St Jeor × atividade, ajuste pelo objetivo), em
  `data/Calculos.kt`, para funcionar offline. Meta preenchida no perfil vence a sugestão.
- **Código de barras.** Leitor do Google Play services (`play-services-code-scanner`: tela de câmera
  própria, sem permissão de câmera no app) → `GET /api/dieta/alimentos/codigo/{codigo}`, que consulta a
  Open Food Facts e guarda o produto como alimento do usuário.
- **Fotos.** Câmera do sistema ou galeria; o app guarda um JPEG de até 1600 px e envia por multipart.
  Só registro: nenhuma análise da imagem. Fotos corporais têm pose e comparação lado a lado.
- **Gamificação.** XP, níveis, sequências (com um "congelamento" por semana), conquistas, desafio
  semanal e heatmap vêm de `GET /api/dieta/progresso` (calculados no servidor a partir dos registros) e
  ficam em cache para a tela abrir offline. Conquista nova ou nível novo geram notificação.
- **Compartilhar.** Links públicos com escopos escolhidos (peso, macros, diário, fotos de refeição,
  fotos corporais, conquistas, CSV), validade e revogação; "modo nutricionista" pré-seleciona diário,
  macros, peso e CSV. Também gera um card PNG da semana para redes sociais e exporta o CSV.
- **Lembretes.** 13:30 e 20:30, só se o almoço/jantar ainda não foi registrado (desligável em Conta).

## Build

```bash
cd mobile
./gradlew :dieta:assembleDebug          # dieta/build/outputs/apk/debug/dieta-debug.apk
./gradlew :dieta:testDebugUnitTest
```

O workflow **Android (Dieta)** (`.github/workflows/android-dieta.yml`, tag `dieta-v1.2.3` ou manual)
gera o APK de release e publica em `https://cerebro.vsitefy.com.br/downloads/android/Dieta.apk`.
