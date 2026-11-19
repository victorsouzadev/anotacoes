# Quickstart: Banco compartilhado entre núcleo e plug-ins

1. `dotnet test` no SDK e no deployer — guarda de prefixo, cópia, comparação de esquema.
2. Plug-in de exemplo (029) com tabela `exemplo_itens`: sobe, cria a tabela e registra `__EFMigrationsHistory_exemplo`.
3. Versão do exemplo com migração que adiciona coluna em `dieta_registros`: o deployer reverte, restaura a cópia e mantém a versão anterior.
4. `ls data/db/pre-migracao/` mostra a cópia da tentativa.
5. Três processos gravando ao mesmo tempo por 1 minuto (`scripts/carga-sqlite.sh`): nenhum `database is locked`.
6. `scripts/backup.sh` e restauração num diretório temporário: dados do núcleo e do exemplo presentes.
