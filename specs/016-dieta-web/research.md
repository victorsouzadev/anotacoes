# Research: Tela web da Dieta

## Persistência na web

- **Decision**: chamadas diretas à API, sem IndexedDB.
- **Rationale**: o web de Tarefas faz igual; uso no computador quase sempre tem rede. Offline continua no app (Princípio III pede local-first onde o uso pede — o celular).
- **Alternatives considered**: espelhar o Room em IndexedDB (rejeitado: dobra a lógica de sync sem uso real).

## Ids e conflito

- **Decision**: id gerado no cliente (`core/uuid`) e `updatedAt = new Date().toISOString()` em todo PUT, igual ao app.
- **Rationale**: o backend já resolve last-write-wins por `UpdatedAt` e responde com a versão vencedora.

## Gráficos

- **Decision**: Chart.js (já usado em Finanças e Tarefas), com cores do `chart-theme.ts` de Finanças movido/reaproveitado.
- **Alternatives considered**: SVG próprio (rejeitado: já existe padrão no repo).

## Ícone e cor

- **Decision**: ícone novo em `shared/icon.ts`, pintado com `nanquim`.
- **Rationale**: a identidade Grafite só define cor de ferramenta para notas, finanças, tarefas, editor e cérebro; criar uma cor para a Dieta é emenda da identidade, fora desta feature.
