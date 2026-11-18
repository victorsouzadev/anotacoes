# Quickstart: Link somente leitura

1. `dotnet test` — `NoteShareTests` passa.
2. No editor → Compartilhar → nome "Ana", 7 dias → Copiar link.
3. Aba anônima: a nota abre em modo leitura, sem login; a resposta da API só tem `title`, `pages`, `updatedAt`.
4. Editar a nota, sincronizar, recarregar a aba anônima: mostra a versão nova.
5. Revogar: a aba anônima mostra "Este link não está mais disponível".
6. Mandar a nota para a lixeira: outro link dela também para.
