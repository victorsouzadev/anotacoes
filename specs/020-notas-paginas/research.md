# Research: Duplicar e navegar entre páginas

- **Atalhos**: Ctrl+PageUp/PageDown é o padrão de abas no Chrome/VS Code, mas o navegador usa para trocar de aba do navegador; dentro da página o `keydown` chega antes e `preventDefault()` funciona em Chrome/Edge/Firefox quando o foco está no documento. **Decision**: usar e documentar Alt+←/→ como alternativa quando o navegador não entregar o evento.
- **Duplicação**: **Decision** `duplicatePage(page): NotePage` em `features/editor/engine/page-ops.ts` gera ids novos com `uuid()` e mapa antigo→novo para `fromId`/`toId` das setas.
- **Reordenar**: **Decision** HTML5 drag-and-drop nas abas (sem dependência), e botões "mover para esquerda/direita" no menu para teclado/toque.
- **Desfazer exclusão**: **Decision** guardar a página removida e o índice por 6 s; o histórico do canvas (`history.ts`) é por página e não cobre isso.
