# Contrato: endpoints usados pela tela web (já existentes)

Todos sob `/api/dieta`, com `Authorization: Bearer <access token>`.

| Uso | Método e rota | Observação |
|---|---|---|
| Dia | `GET /dia/{yyyy-MM-dd}` | `DietaDiaResposta(totais, metas, adesao, registros, agua, peso)` |
| Perfil e metas | `GET /perfil`, `PUT /perfil` | resposta traz `Metas` e `Sugestao` |
| Buscar alimento | `GET /alimentos?q=` e `GET /alimentos/meus` | TACO + próprios |
| Registrar item | `PUT /registros/{id}` | `DietaRegistroUpsert`; `Kcal=0,Proteina=0` + `AlimentoId` faz o servidor calcular |
| Repetir refeição | `POST /registros/repetir?de=&para=&refeicao=&paraRefeicao=` | |
| Peso | `GET /pesos`, `PUT /pesos/{id}` | |
| Água | `GET /agua`, `PUT /agua/{id}` | |
| Plano | `GET /plano`, `PUT /plano/{id}` | |
| Fotos | `GET /fotos`, `GET /fotos/{id}/arquivo` | só leitura na web |
| Progresso | `GET /progresso` | XP, nível, sequências, conquistas, desafio, heatmap |
| CSV | `GET /export.csv?inicio=&fim=` | |
| Compartilhar | `GET/POST /compartilhamentos`, `DELETE /compartilhamentos/{id}` | |
| Assistente | `POST /api/dieta/chat` | P3 |

Nenhuma rota nova.
