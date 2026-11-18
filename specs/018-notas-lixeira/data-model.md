# Data Model: Lixeira de notas

## Note (backend, `Data/AppDbContext.cs`)

| Campo | Tipo | Mudança |
|---|---|---|
| `TrashedAt` | `DateTime?` | **novo**, anulável, migração EF aditiva |
| `DeletedAt` | `DateTime?` | sem mudança (tombstone definitivo) |

## NoteRecord (frontend, `data/models.ts`)

| Campo | Tipo | Mudança |
|---|---|---|
| `trashedAt` | `string \| null` | **novo**, opcional na leitura (registros antigos = `null`) |

## Estados

```text
ativa --excluir--> na lixeira (trashedAt=agora) --restaurar--> ativa (trashedAt=null)
na lixeira --excluir para sempre | 30 dias--> tombstone (deletedAt=agora, Elements="[]")
```

Toda transição atualiza `updatedAt` e marca `dirty` (cliente).
