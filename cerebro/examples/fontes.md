# Como cada fonte manda dados para o hub

Todas usam `https://SUBDOMINIO/cerebro/api/v1/...` com o header `X-Api-Key`.

## Celular — compartilhar texto ou link

**Android (app HTTP Shortcuts)**

1. Novo atalho → *Regular Shortcut* → método `POST`, URL `https://SUBDOMINIO/cerebro/api/v1/captures`.
2. Headers: `X-Api-Key: <API_KEY_CELULAR>`.
3. Body → *Custom text*, tipo `application/json`:
   ```json
   {"source": "celular", "content": "{share_text}"}
   ```
   Crie a variável `share_text` como *Text input* com "Allow receiving value from share dialog" marcado.
4. Em *Trigger & Execution*, marque "Show in share menu". Pronto: Compartilhar → HTTP Shortcuts → seu atalho.

**iPhone (app Atalhos)**

1. Novo atalho → ative "Mostrar na Folha de Compartilhamento" (aceita URLs e texto).
2. Ação *Obter Conteúdo de URL*: URL `https://SUBDOMINIO/cerebro/api/v1/captures`, método `POST`,
   cabeçalho `X-Api-Key`, corpo JSON com `source = celular` e `content = Entrada do Atalho`.
3. Ação opcional *Mostrar Notificação* "Salvo na Inbox".

O hub detecta sozinho: se houver só um link no campo `url`, a página é baixada e resumida. Para mandar link, use
`{"source":"celular","url":"{share_text}"}` num segundo atalho.

## Áudio do celular (gravador)

```bash
curl -X POST https://SUBDOMINIO/cerebro/api/v1/captures/file \
  -H "X-Api-Key: $API_KEY_CELULAR" \
  -F "file=@nota.m4a" -F "source=voz"
```
Com `OPENAI_API_KEY` definido, a transcrição entra na nota antes da classificação.

## Bot de WhatsApp

No bot que já transcreve áudios, depois de transcrever:

```http
POST /api/v1/captures
X-Api-Key: <API_KEY_WHATSAPP>
Content-Type: application/json

{
  "source": "whatsapp",
  "external_id": "<id da mensagem>",
  "content": "<transcrição ou texto>",
  "occurred_at": "2026-10-13T21:10:00-03:00"
}
```
`external_id` evita duplicata se o bot reenviar. Alternativa sem código: aponte o webhook do provedor para
`POST /api/v1/webhooks/whatsapp`; o hub procura o texto em `text`, `message.text`, `data.message.text` e outros
caminhos comuns, e guarda o JSON bruto quando não acha.

## Navegador

Veja `bookmarklet.js`. Ele usa `GET /api/v1/quick?key=...`, porque um favorito não consegue mandar headers.
Use uma chave só para isso (`API_KEY_NAVEGADOR`) e troque-a se vazar.

## Diário rápido

```bash
curl -X POST https://SUBDOMINIO/cerebro/api/v1/daily \
  -H "X-Api-Key: $API_KEY_CELULAR" -H 'Content-Type: application/json' \
  -d '{"text": "Treino feito, 5 km"}'
```
