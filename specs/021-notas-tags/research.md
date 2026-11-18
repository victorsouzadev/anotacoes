# Research: Tags nas notas

- **Onde guardar**: **Decision** coluna `Tags` (texto JSON, padrão `"[]"`) em `Note`, fora do blob `Elements`. **Rationale**: o servidor trata `Elements` como opaco (FR-009 da spec 002); tags são metadado como `Title`. **Alternatives**: tabela `NoteTag` N:N (rejeitado: sem consulta no servidor que precise disso; Princípio VIII).
- **Normalização**: **Decision** função pura `normalizarTags(lista)` no cliente e validação equivalente no servidor (minúsculas, trim, únicas, limites) — servidor recusa com 400 acima dos limites.
- **Filtro**: **Decision** puro em `features/notes/notes-filter.ts` (pasta + busca + tags), testado; hoje o filtro está dentro do componente.
