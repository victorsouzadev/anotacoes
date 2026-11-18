# Quickstart: Exportar nota em PDF

1. `cd frontend && npx ng test` — `export-pdf-layout.spec.ts` e os testes do Editor de Imagens passam (o `buildPdf` mudou de lugar).
2. Abrir uma nota com 3 páginas (uma vazia, uma larga). Mais ações → Exportar PDF → Nota inteira, A4.
3. Esperado: arquivo `<título>.pdf` com 3 páginas, a vazia em branco, a larga em paisagem.
4. Repetir com "Página atual" e "Tamanho do conteúdo".
5. Abrir no leitor do navegador e imprimir uma página: traços nítidos.
