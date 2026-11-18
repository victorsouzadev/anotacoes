# Quickstart: Lixeira de notas

1. `cd backend && dotnet test` — `NotesLixeiraTests` passa (upsert guarda `TrashedAt`; limpeza transforma > 30 dias em tombstone; < 30 dias fica).
2. Subir backend e frontend. Criar nota com um desenho, excluir. Esperado: some da lista, aviso com Desfazer.
3. Abrir "Lixeira" na barra de pastas: a nota aparece com "30 dias restantes". Restaurar: volta com o desenho.
4. Em outro navegador logado: excluir lá e sincronizar aqui. Esperado: vai para a lixeira aqui também.
5. Excluir para sempre: some da lixeira e não volta em nova sincronização.
6. `cd frontend && npx ng test && npx ng build --configuration production`.
