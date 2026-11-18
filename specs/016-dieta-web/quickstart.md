# Quickstart: Tela web da Dieta

1. Backend e frontend locais (README → Desenvolvimento local). Entrar com uma conta que tenha registros da Dieta (ou criar alguns pelo app/MCP).
2. Abrir o hub: o card "Dieta" aparece. Clicar → `/dieta` mostra o dia de hoje.
3. Registrar "Arroz, tipo 1, cozido" 150 g no almoço. Esperado: totais sobem; `GET /api/dieta/registros?data=hoje` traz o item.
4. Sincronizar o app Android na mesma conta. Esperado: o item aparece no app.
5. Excluir o item pela web e sincronizar o app. Esperado: some nos dois.
6. Aba Progresso: nível e sequência iguais aos do app.
7. Criar link só com "peso", abrir em aba anônima: só o peso aparece. Revogar: o link para.
8. `cd frontend && npx ng build --configuration production && npx ng test`.
