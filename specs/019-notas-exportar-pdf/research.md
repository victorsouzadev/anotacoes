# Research: Exportar nota em PDF

## Gerador de PDF

- **Decision**: mover `buildPdf`, `PdfPage` e `jpegToPdf` de `features/imagem/sheet.ts` para `shared/pdf.ts` e reexportar em `sheet.ts` (os 5 importadores atuais não mudam).
- **Rationale**: já é testado em uso no Editor de Imagens; uma feature não deve importar de dentro de outra; sem dependência nova (Princípio VIII).
- **Alternatives considered**: jsPDF/pdf-lib (rejeitado: dependência nova para o que já existe).

## Resolução

- **Decision**: renderizar cada página num canvas offscreen com escala tal que o conteúdo encaixado no A4 dê ~200 DPI, exportar JPEG qualidade 0,9 e embutir com `DCTDecode`.
- **Rationale**: nítido para impressão, arquivo de tamanho razoável; JPEG evita implementar Flate+PNG no gerador.

## Orientação

- **Decision**: paisagem quando largura/altura do bbox do conteúdo > 1,1.
