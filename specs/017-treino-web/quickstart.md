# Quickstart: Tela web do Treino

1. Com uma conta que tenha treinos (ou `PUT /api/treino/atividades/{id}` manual), abrir o hub: card "Treino".
2. `/treino` mostra plano, último treino e lista. Esperado: atividade apagada não aparece.
3. Comparar os totais de 30 dias com `treino_resumo` do MCP: iguais.
4. `cd frontend && npx ng test` — `treino-calc.spec.ts` passa.
