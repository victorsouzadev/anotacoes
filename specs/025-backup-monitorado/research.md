# Research: Backup monitorado

- **Sinal**: **Decision** arquivo `data/db/backup-status.json` escrito pelo script (via arquivo temporário + `mv`, atômico). **Rationale**: o `api` já monta `data/db`; não precisa de rede, banco nem processo novo. **Alternatives**: o backup rodar dentro do `api` como `BackgroundService` (rejeitado: o script também faz `pg_dump` via `docker exec` no host); healthcheck externo pago (rejeitado: Princípio VIII).
- **Quem vê**: **Decision** `PUBLICADORES` (já existente em `SitesOptions`). **Alternatives**: lista `ADMINS` nova (rejeitado: mais uma variável para a mesma pessoa).
- **Limite**: **Decision** 36 h (cron diário às 04:00 + folga de meio dia).
- **Próximo passo registrado**: cópia fora da VPS (ex.: rclone para um bucket) — spec futura.
