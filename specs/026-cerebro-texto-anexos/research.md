# Research: Texto de PDFs e imagens

- **Provedor**: **Decision** `ClaudeClassifier.CallToolAsync`-like: método novo `ExtrairTextoAsync(arquivo)` no mesmo cliente, enviando imagem como bloco `image` (base64) e PDF como bloco `document` na Anthropic; na OpenRouter, imagem como `image_url` (data URL) e PDF como `file` (suporte depende do modelo — sem suporte, `hub_note`). **Rationale**: reaproveita chave/modelo; sem dependência de OCR local (Tesseract exigiria pacote nativo na imagem Docker, Princípio VIII).
- **Ordem no worker**: **Decision** depois da transcrição e antes da classificação, no mesmo bloco "1. Extração" de `ProcessingWorker.ProcessAsync`.
- **HEIC**: **Decision** pedir ao provedor só formatos aceitos; HEIC fica com `hub_note` "formato não suportado" nesta versão (o celular costuma enviar JPEG pelo PWA).
- **Prompt**: transcrever fielmente em pt-BR original, sem resumir; se não houver texto, descrever a imagem em uma frase.
