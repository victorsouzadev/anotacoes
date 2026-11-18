# Contrato: links de nota

Autenticados (dona):

| Método | Rota | Corpo / resposta |
|---|---|---|
| `GET` | `/api/notes/{id}/links` | `[{ id, nome, expiraEm, revogadoEm, createdAt }]` |
| `POST` | `/api/notes/{id}/links` | `{ nome, diasValidade? }` → `{ id, nome, expiraEm, createdAt, url }` (`url` só aqui) |
| `DELETE` | `/api/notes/{id}/links/{linkId}` | 204; marca `RevogadoEm` |

Público (sem login, política de taxa `publico`):

| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/api/notes/publico/{token}` | 200 `{ title, pages, updatedAt }` · 404 `{ error: "Este link não está mais disponível." }` |
