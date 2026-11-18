# Quickstart: Tags nas notas

1. `dotnet test` (backend) — `NotesTagsTests`: upsert com tags, normalização, limite, cliente sem `tags` não apaga as existentes.
2. `npx ng test` — `notes-filter.spec.ts` (pasta + busca + tags E).
3. No editor, adicionar "Faculdade" e "provas": salvas como `faculdade`, `provas`.
4. Barra lateral: "provas (2)"; clicar filtra; clicar "faculdade" junto restringe (E).
5. Em outro navegador, sincronizar: tags iguais.
