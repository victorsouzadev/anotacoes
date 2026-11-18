# Research: OAuth 2.1 no MCP

- **Onde implementar**: **Decision** no próprio `cerebro/` (é o resource server), com endpoints `/cerebro/oauth/*` e os `.well-known` servidos pelo Caddy a partir de `/cerebro`. **Alternatives**: servidor de autorização no `Notas.Api` (rejeitado nesta fase: só o Cérebro precisa; se os MCPs dos apps entrarem depois, mover para o `Notas.Api` é a evolução natural).
- **Biblioteca**: **Decision** implementação própria e pequena (registro, authorize, token, revogação) sobre o `HubDb`, porque o escopo é estreito (um recurso, um tipo de usuário). **Alternatives**: OpenIddict (rejeitado: peso e configuração para um fluxo só; reavaliar se crescer).
- **Consentimento**: **Decision** rota Angular `/autorizar` na raiz (o Caddy manda todo `/cerebro/*` para o serviço, então a página não pode ficar sob `/cerebro`), logada no hub, que mostra cliente e escopo e chama `POST /cerebro/oauth/consent` com o JWT do hub; o Cérebro responde com o redirect contendo `code` e `state`.
- **Tokens**: opacos (32 bytes), SHA-256 no banco, acesso 1 h, atualização 30 dias com rotação e detecção de reuso (mesma política do hub, spec 001).
- **Descoberta**: `WWW-Authenticate: Bearer resource_metadata="https://<domínio>/.well-known/oauth-protected-resource/cerebro/mcp"`.
