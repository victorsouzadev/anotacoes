# Research: Lixeira de notas

## Campo novo × reaproveitar `deletedAt`

- **Decision**: coluna nova `TrashedAt` (anulável) em `Note`; `DeletedAt` continua sendo o tombstone definitivo.
- **Rationale**: o `pull` do `SyncService` já apaga localmente quando chega `deletedAt`, e o servidor zera `Elements`. Mudar o significado de `deletedAt` quebraria o contrato e qualquer cliente antigo aberto. Um campo novo é aditivo (Princípio II).
- **Alternatives considered**: guardar a lixeira só no IndexedDB (rejeitado: não sincroniza e some ao limpar o navegador).

## Limpeza de 30 dias

- **Decision**: limpeza no servidor, ao subir e a cada 24 h, num `BackgroundService` pequeno (`NotesLixeiraWorker`), marcando `DeletedAt`, zerando `Elements` e atualizando `UpdatedAt` para a mudança chegar aos clientes.
- **Rationale**: funciona mesmo sem nenhum navegador aberto.
- **Alternatives considered**: limpeza no cliente ao abrir a lista (rejeitado: depende de alguém abrir; dois clientes fariam a mesma coisa).

## IndexedDB

- **Decision**: sem nova versão do banco local; `trashedAt` é só mais um campo do objeto `NoteRecord` (o store não tem índice por ele).
