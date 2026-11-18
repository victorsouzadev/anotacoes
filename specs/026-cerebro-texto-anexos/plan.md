# Implementation Plan: Texto de PDFs e imagens

**Branch**: sem branch própria | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## Summary

Nova etapa de extração no `ProcessingWorker` que, com a opção ligada, manda o anexo ao provedor de IA já configurado e acrescenta `## Texto extraído`; configuração e aviso na tela do Cérebro.

## Technical Context

C# .NET 10 (`cerebro/`) · Storage: tabela `settings` do `HubDb` · Testing: xUnit em `cerebro/tests/Hub.Tests` com `HttpMessageHandler` falso (imagem, PDF, limite, desligado, idempotência) · Frontend: Angular 21 (`features/cerebro`) · Constraints: desligado por padrão; limites de tamanho.

## Constitution Check

I ✅ dentro do serviço existente · II ✅ não altera originais nem notas da pessoa · III N/A · IV ✅ desligado por padrão, aviso de custo, IA configurada · V ✅ testes · VI ✅ · VII ✅ · VIII ✅ sem OCR local. Re-check: sem violações.

## Project Structure

```text
cerebro/src/Hub/Pipeline/AttachmentReader.cs     # novo: limites, montagem do pedido, parse
cerebro/src/Hub/Pipeline/ProcessingWorker.cs     # chama antes da classificação
cerebro/src/Hub/Pipeline/AiSettings.cs           # opção LerAnexos
cerebro/src/Hub/Api/WebEndpoints.cs              # GET/PUT da opção; reprocessar item
cerebro/tests/Hub.Tests/AttachmentReaderTests.cs
frontend/src/app/features/cerebro/               # chave em Configurações; botão na Inbox
cerebro/README.md
```

## Complexity Tracking

Sem violações.
