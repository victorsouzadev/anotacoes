# Contrato: Notas (mudanças)

## `PUT /api/notes/{id}` e `POST /api/notes`

`NoteUpsertRequest` ganha `trashedAt: string | null` (opcional; ausente = `null`). Resto igual (LWW por `updatedAt`).

## `GET /api/notes?since=` e `GET /api/notes/{id}`

A resposta ganha `trashedAt`. Notas na lixeira **são** devolvidas (o cliente decide esconder).

## `DELETE /api/notes/{id}`

Sem mudança: continua sendo "excluir para sempre" (tombstone).
