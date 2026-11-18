# Data Model: Link somente leitura

## NoteShare (novo, `Data/AppDbContext.cs`)

| Campo | Tipo | Regra |
|---|---|---|
| `Id` | string (uuid) | PK |
| `NoteId` | string | FK lógica para `Note.Id` |
| `UserId` | string | dona |
| `TokenHash` | string (SHA-256 hex) | único, indexado |
| `Nome` | string ≤ 80 | |
| `ExpiraEm` | DateTime? | nulo = sem validade |
| `RevogadoEm` | DateTime? | |
| `CreatedAt` | DateTime | |

Válido quando: não revogado, não vencido, e a nota existe com `DeletedAt == null` e `TrashedAt == null` (spec 018).
