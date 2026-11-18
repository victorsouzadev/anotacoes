# Quickstart: Texto de PDFs e imagens

1. `cd cerebro && dotnet test segundo-cerebro.slnx` — `AttachmentReaderTests`.
2. Tela do Cérebro → Configurações: "Ler texto de PDFs e imagens" desligado; ligar (aviso de custo).
3. Capturar foto de um recibo pelo `/capturar`. Esperado: nota na Inbox com `## Texto extraído` e sugestão do Claude usando o texto.
4. Buscar um valor do recibo: a nota aparece.
5. Desligar e capturar outra foto: nota com `hub_note` explicando como ligar.
