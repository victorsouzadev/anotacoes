# Quickstart: Extrair o Segundo Cérebro como primeiro plug-in

1. Antes: anotar contagens (`select count(*) from captures`, clientes OAuth), fazer `search` pelo MCP e sincronizar o Obsidian.
2. Ensaio local com uma cópia de `data/`: subir o `hub-cerebro`; a migração roda; contagens iguais em `cerebro_capturas`.
3. Em produção: merge do `plugins.lock` com o Cérebro; conferir o card, a busca, a Inbox, `/capturar` e o conector do Claude, sem reaprovar.
4. `ls data/cerebro/hub/` mostra `hub.db.pre-033`.
5. Depois de 7 dias sem problema: PR no núcleo removendo `cerebro/` e `features/cerebro/`.
