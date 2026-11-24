# Quickstart: validar a 039

1. **Regras compartilhadas.** Rode `dotnet test` no SDK e no deployer. Os testes antigos de `Plugins.Validar` precisam passar com a `RegrasDoManifesto`.
2. **Rotas do núcleo.** No teste do backend:
   - com o segredo do `agente`, a resposta é 200;
   - com o segredo de outro plug-in, é 401;
   - com um id que não está no lock, é 404;
   - um log com `Password=` sai limpo.
3. **Diagnóstico (US1).**
   - Primeiro local, com um agente falso no Vitest e um deployer simulado.
   - Depois na VPS, com a confirmação do dono: suba o `agente`, derrube o health de um plug-in de teste e peça o diagnóstico.
   - Esperado: o relatório mostra a falha e nada muda. Para conferir, compare o `estado.json` de antes e de depois.
4. **Esqueleto (US2).**
   - Com o token já gravado pelo dono, peça um plug-in chamado "lembretes".
   - Esperado: o `hub-lembretes` é criado, o PR fica aberto e a CI passa. O `plugins.lock` e a VPS continuam iguais.
   - Uma tentativa forçada de gravar em outro repositório gera um evento `recusa`.
5. **MCP (US3).** Conecte o `/agente/mcp` e liste os plug-ins. Depois valide um manifesto com `rota: "/api/core"`. Esperado: a regra violada aparece na lista.
