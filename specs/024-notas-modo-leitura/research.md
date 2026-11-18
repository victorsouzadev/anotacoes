# Research: Modo leitura

- **Decision**: componente `NoteReaderComponent` (`features/editor/note-reader.ts`) que recebe `pages` e `paperStyle`, usa `Renderer` + `Viewport` com "ajustar à tela" por página e só pan/zoom. O editor abre o leitor por cima de si; o link público (spec 023) usa o mesmo componente sem o editor.
- **Rationale**: bloquear edição dentro do `canvas-host.ts` (927 linhas, cheio de ferramentas) é frágil; um leitor separado garante FR-001 por construção.
- **Alternatives considered**: flag `readOnly` no canvas-host (rejeitado pelo risco de uma ferramenta esquecer a flag).
