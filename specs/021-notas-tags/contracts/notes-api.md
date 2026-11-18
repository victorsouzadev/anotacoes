# Contrato: Notas (mudanças)

- `NoteUpsertRequest.tags?: string[]`:
  - nota nova sem `tags` → grava `[]`;
  - nota existente sem `tags` (cliente antigo) → mantém as tags do servidor;
  - com `tags` → normaliza e grava.
- Respostas de `GET /api/notes`, `GET /api/notes/{id}` e do upsert ganham `tags: string[]`.
- 400 `{ "error": "Tags inválidas." }` acima de 20 tags ou de 40 caracteres.
