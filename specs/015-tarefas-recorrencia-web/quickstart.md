# Quickstart: Recorrência de tarefas na web

1. `cd frontend && npx ng test` — os testes de `nextOccurrence` passam (diária, semanal, mensal, 31/01, sem prazo).
2. `npm start` e entrar no hub.
3. Criar "Regar plantas", semanal seg/qui, prazo na próxima segunda 08:00. Concluir. Esperado: nova tarefa com prazo na quinta 08:00, subtarefas desmarcadas, mesmas categorias.
4. Criar uma mensal com prazo em 31/01 e concluir. Esperado: prazo em 28/02 (ou 29/02).
5. Abrir uma recorrente e clicar "Pular esta vez". Esperado: próxima criada, atual na lixeira, estatística de concluídas igual.
6. No Android logado na mesma conta, sincronizar. Esperado: a nova ocorrência aparece uma vez.
