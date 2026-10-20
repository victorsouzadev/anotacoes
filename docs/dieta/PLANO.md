# Plano — ferramenta "Dieta"

> Status: **planejamento**. Nova ferramenta do hub para acompanhar dieta e alimentação.

## 1. Decisões

| # | Pergunta | Decisão |
|---|---|---|
| D1 | Onde roda o back | **VPS**, dentro do hub: módulo novo no `backend/Notas.Api` (C#), mesmo login, Postgres e deploy |
| D2 | Domínio | **https://cerebro.vsitefy.com.br** (domínio do hub). API em `/api/dieta/*`, página pública em `/p/dieta/<token>` |
| D3 | App | **APK Android nativo, Kotlin + Jetpack Compose**, local-first (Room), sincroniza com a conta do hub |
| D4 | Fotos | Só registro (refeição e progresso corporal). **Sem IA na imagem** |
| D5 | MCP | Ferramentas da Dieta no MCP do hub + resumo do dia no Segundo Cérebro |
| D6 | Gamificação | XP, níveis, sequências, conquistas, desafios semanais, heatmap |
| D7 | Compartilhamento | Link público com escopos, cards de imagem e modo nutricionista |

## 2. Arquitetura

```
 APK Android (Kotlin/Compose)                 Hub web (Angular) — tela "Dieta" (fase 2)
   Room offline · CameraX · ML Kit barcode
   WorkManager (sync/lembretes) · Share
              │ HTTPS + token do hub
              ▼
 cerebro.vsitefy.com.br  (nginx-proxy-manager → Caddy)
   ├─ Notas.Api  /api/dieta/*        → regras, XP, compartilhamento
   ├─ Postgres (schema existente + tabelas dieta_*)
   ├─ Fotos em volume persistente (/data/dieta/fotos), servidas com URL assinada
   ├─ Job diário (HostedService)     → fecha o dia, XP, desafios, nota no Segundo Cérebro
   └─ MCP (mcp/)                     → tools dieta_* chamando /api/dieta
```

## 3. Funcionalidades

**Núcleo**
- Perfil e metas: kcal pela Mifflin-St Jeor + nível de atividade; divisão de macros editável; água.
- Diário: café/almoço/lanche/jantar; busca na base **TACO**, porção em g/unidade, totais do dia.
- Alimentos e receitas próprias, favoritos, "repetir refeição".
- Código de barras (ML Kit, no aparelho) → consulta Open Food Facts pelo back.
- Peso com média móvel de 7 dias; água.
- Plano alimentar (cardápio previsto × realizado, % de adesão).

**Fotos** (sem IA)
- Foto anexada à refeição (CameraX, compressão para ~1600px/JPEG 80 antes do upload).
- Galeria de progresso corporal (frente/lado/costas) com comparação lado a lado. Privada por padrão.

**Gamificação**
- XP: refeição registrada +10, meta de proteína +20, água +10, dia na meta +30, foto +5.
- Níveis com curva crescente; sequências (registro e meta) com 1 congelamento por semana.
- Conquistas: 7/30/100 dias, -5 kg, 100 refeições com foto, 1º mês completo…
- Desafio semanal gerado a partir do ponto mais fraco da semana anterior.
- Heatmap de adesão estilo GitHub.

**Compartilhamento**
- Página pública `/p/dieta/<token>` (HTML servido pela API), com escopos por item:
  peso, gráficos, macros, refeições, fotos de comida, fotos corporais, conquistas. Revogável e com validade.
- Cards de imagem gerados no app (Compose → Bitmap) e enviados pelo menu de compartilhar do Android.
- Modo nutricionista: link de leitura do diário completo + exportação CSV/PDF.

**Integração com o Segundo Cérebro / MCP**
- Tools: `dieta_registrar_refeicao`, `dieta_resumo_dia`, `dieta_resumo_periodo`, `dieta_metas`,
  `dieta_registrar_peso`, `dieta_registrar_agua`, `dieta_progresso`, `dieta_sugerir_refeicao`.
- Fechamento do dia: append na nota diária (kcal, macros, peso, conquistas, link das fotos).
- Revisão semanal em `Saúde/Dieta/Semana-AAAA-WW.md`.
- Lê `Saúde/Plano alimentar` como fonte do plano do nutricionista.

## 4. Modelo de dados (tabelas `dieta_*`, ligadas ao usuário do hub)

```
dieta_perfil(usuario_id, altura_cm, nascimento, sexo, atividade, objetivo)
dieta_meta(id, usuario_id, kcal, proteina_g, carbo_g, gordura_g, agua_ml, vigente_desde)
dieta_alimento(id, usuario_id?, nome, porcao_base_g, kcal, proteina, carbo, gordura, fibra, sodio,
               fonte[TACO|OFF|manual], codigo_barras?)
dieta_receita(id, usuario_id, nome, rendimento) + dieta_receita_item(receita_id, alimento_id, gramas)
dieta_registro(id, usuario_id, data, refeicao, alimento_id|receita_id, quantidade_g, foto_id?, updated_at)
dieta_peso(id, usuario_id, data, kg)      dieta_agua(id, usuario_id, data, ml)
dieta_foto(id, usuario_id, tipo[refeicao|corpo], caminho, data)
dieta_xp_evento(id, usuario_id, tipo, pontos, data)
dieta_conquista(codigo, nome, descricao) + dieta_usuario_conquista(usuario_id, codigo, data)
dieta_desafio(id, usuario_id, semana, regra_json, status)
dieta_compartilhamento(id, usuario_id, token, escopos_json, expira_em, revogado)
dieta_sync_cerebro(id, usuario_id, data, nota_path, status)
```
Sync do app no mesmo modelo das Tarefas: completo, por `remoteId`/`updatedAt`.

## 5. App Android

- Novo módulo `:dieta` no projeto `mobile/` (APK próprio, `applicationId` separado), reaproveitando
  o login/sync do hub do módulo `:app` — extrair um `:core` comum se compensar.
- Stack: Compose + Material 3, Room, Retrofit/OkHttp, WorkManager, CameraX, ML Kit Barcode, Coil.
- Telas: Hoje (painel + refeições), Adicionar alimento, Progresso (peso, heatmap, fotos),
  Conquistas, Compartilhar, Configurações.
- APK de release pelo GitHub Actions, publicado em `cerebro.vsitefy.com.br/downloads/android`.

## 6. Roteiro

1. **Back base**: tabelas, endpoints de perfil/metas/alimentos/registros, seed da TACO, testes.
2. **App base**: módulo `:dieta`, login do hub, Hoje + diário + sync offline.
3. **Peso, água, receitas, favoritos, código de barras.**
4. **Fotos**: upload, galeria, comparação.
5. **MCP + Segundo Cérebro**: tools `dieta_*`, fechamento diário e revisão semanal.
6. **Gamificação**: XP, níveis, sequências, conquistas, desafios, heatmap.
7. **Compartilhamento**: página pública, cards, modo nutricionista; APK de release.
8. (Depois) tela "Dieta" na versão web do hub.

## 7. Restrições

- VPS com 1.9 GiB de RAM: nada de serviço novo pesado; tudo dentro do `Notas.Api` e do Postgres existentes.
- Fotos ocupam disco: limite por usuário e entrada no backup.
