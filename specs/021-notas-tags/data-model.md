# Data Model: Tags nas notas

| Onde | Campo | Tipo | Mudança |
|---|---|---|---|
| `Note` (backend) | `Tags` | `string` (JSON de `string[]`) | **novo**, padrão `"[]"`, migração aditiva |
| `NoteRecord` (frontend) | `tags` | `string[]` | **novo**, ausente = `[]` |

Regras: minúsculas, aparadas, sem vazias, únicas, ≤ 20 por nota, ≤ 40 caracteres.
