# Research: Arrastar imagens para o canvas

- **Decision**: `@HostListener('dragover'|'dragleave'|'drop')` no `CanvasHostComponent`, convertendo `clientX/Y` para mundo com `viewport.screenToWorld`, e refatorar `insertPastedImage(blob)` para `insertImage(blob, pontoMundo?)`.
- **HEIC**: mover `features/imagem/heic.ts` para `shared/heic.ts` e reexportar no lugar antigo (os importadores do Editor de Imagens não mudam).
- **Limite de 8 MB**: **Decision** estimar o tamanho do JSON das páginas (`JSON.stringify(...).length`) antes de inserir; mesmo limite do servidor (`MaxElementsBytes`).
- **Cascata**: deslocamento de 24 px de mundo por imagem.
