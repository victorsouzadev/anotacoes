# Implementation Plan: Banco compartilhado entre núcleo e plug-ins

**Branch**: sem branch própria | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

## Summary

Formaliza o `notas.db` como banco único: tabela de donos, histórico de migração por plug-in, base de migração para tabelas existentes, guarda no SDK contra tabelas alheias, cópia e conferência de esquema no deployer antes de cada migração. No núcleo, o `AppDbContext` perde as entidades de cada ferramenta no momento em que ela é extraída (033–035), mantendo-as no banco.

## Technical Context

**Language/Version**: C# (.NET 9 no núcleo, .NET 9+ nos plug-ins), EF Core SQLite

**Primary Dependencies**: nenhuma nova

**Storage**: `data/db/notas.db` (WAL), `data/db/pre-migracao/`

**Testing**: xUnit no SDK (`TabelasDoPluginTests`: modelo só com o prefixo, `users` excluído das migrações), no deployer (cópia, comparação de esquema, reversão) e no núcleo (remover entidades do `AppDbContext` não gera migração que apague tabela); teste de carga simples com 3 processos gravando no mesmo arquivo

**Constraints**: nunca DDL em tabela de outro dono; nenhuma cópia de dados na extração

## Constitution Check

| Princípio | Situação |
|---|---|
| I (v2.0.0) | ✅ Um banco para todos |
| II | ✅ Cópia antes de migrar; nada apagado na extração; segredos com chave do dono |
| III | ✅ Sincronização inalterada |
| IV | N/A |
| V | ✅ Guarda testada no SDK e no deployer |
| VI | N/A |
| VII | ✅ |
| VIII | ✅ Mantém SQLite; nenhuma tecnologia nova |

## Project Structure

```text
backend/Notas.Api/Data/AppDbContext.cs          # perde entidades na extração; migração "vazia" que só remove do snapshot
backend/Notas.Api/Data/DonosDeTabela.cs          # core: users, refresh_tokens, configuracoes_ia, core_*
pacotes/Hub.Plugin.Sdk/Dados/                    # UsarBancoDoHub(), histórico por plug-in, referência a users, guarda de prefixo
deployer/src/.../Banco/                          # copiar, comparar esquema (sqlite_master), reverter
scripts/backup.sh                                # sem mudança de lógica; passa a documentar que cobre os plug-ins
DEPLOY.md
```
