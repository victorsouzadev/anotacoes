# Research: Tela web do Treino

- **Decision**: agregações no cliente sobre `GET /api/treino/atividades` (uma pessoa, centenas de atividades por ano).
- **Rationale**: Princípio VIII; evita endpoint novo. O MCP já faz as mesmas contas no servidor — as fórmulas (ritmo = duração ÷ km; totais por janela de dias) são copiadas e testadas em `treino-calc.ts` com os mesmos casos.
- **Alternatives considered**: endpoint `/api/treino/resumo` (rejeitado por ora; reavaliar se o volume crescer).
- **Gráficos**: Chart.js, como em Finanças.
