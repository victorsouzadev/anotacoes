# Research: Link somente leitura de nota

- **Modelo**: **Decision** tabela `NoteShare` (Id, NoteId, UserId, Token, Nome, ExpiraEm, RevogadoEm, CreatedAt), como `DietaCompartilhamento`. **Rationale**: padrão já existente e testado no repo.
- **Token**: **Decision** `RandomNumberGenerator.GetBytes(32)` em Base64Url, guardando só o SHA-256. O link completo aparece uma vez, logo após criar; a lista mostra nome e datas. **Rationale**: um vazamento do banco não abre as notas compartilhadas (Princípio II). **Alternatives**: guardar o token em claro como a Dieta, para poder copiar de novo depois (rejeitado: para reenviar, cria-se outro link).
- **Renderização**: **Decision** Angular `/p/nota/:token` com `NoteReaderComponent` (spec 024). O Caddy já serve o SPA para qualquer rota fora de `/api`.
- **Limite de taxa**: **Decision** política `publico` com o `RateLimiter` do ASP.NET Core (já usado em `financas-ia`): 60 req/min por IP.
