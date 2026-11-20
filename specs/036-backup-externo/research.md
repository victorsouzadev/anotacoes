# Research: Cópia do backup fora da VPS

## Achados de produção (2026-11-20)

- O `crontab` do root tinha `0 4 * * * /opt/notas-vps/scripts/backup.sh` e o cron disparava todo dia, mas o arquivo estava `-rw-rw-rw-` (sem execução, gravável por qualquer usuário e rodado como root). A saída era descartada (`No MTA installed`). Último backup: 2026-07-09.
- O script na VPS era a versão de julho (441 bytes): o `deploy.yml` empacota `backend frontend deployer cerebro ops docker-compose*.yml caddy`, **sem `scripts/`**. A versão da 025 nunca chegou.
- Corrigido à mão nesse dia (com confirmação): script da `main`, `chmod 755`, saída em `/var/log/notas-backup.log`. A primeira execução gerou o `backup-status.json`.
- A limpeza `find "$BACKUPS" -type f -mtime +14 -delete` apagou também os arquivos de `backups/estudio-2026-10-25/`, que não eram do script. Daí o FR-010.
- `/opt/financas-vps/scripts/backup.sh` tem o mesmo `666`; fica fora desta spec.
- Tamanho atual: `data/` ≈ 180 MB (sites 85, postgres 47, cerebro 21, anotacao 18, db 4,5); disco da VPS em 77%.

## Decisão: restic para um bucket S3 compatível

- **Escolhido**: `restic` (pacote `apt`, binário único). Cifra na origem (AES-256 + senha do repositório), deduplica (o diário de 180 MB vira poucos MB por dia), tem retenção (`forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`), `check --read-data-subset` e `restore --include`, e trava concorrência no próprio repositório.
- **Rejeitado: `rclone` + `age`/`gpg`**: duas ferramentas, sem deduplicação (180 MB por dia), retenção e conferência feitas à mão em shell.
- **Rejeitado: `rsync` para outra máquina do Victor**: depende de uma máquina ligada e com IP; não é outro provedor.
- **Rejeitado: snapshot do provedor da VPS**: mesmo provedor e mesma conta; não cobre o risco principal.
- **Provedor**: qualquer S3 compatível. Recomendado Backblaze B2 (10 GB grátis, chave por bucket, "keep prior versions for N days" no lifecycle). R2 também serve.

## Decisão: arquivo de estado separado

O `backup.sh` reescreve `backup-status.json` inteiro a cada execução. Se a parte externa morasse nele, cada backup local apagaria o registro da última conferência semanal. Por isso a cópia externa grava `data/db/backup-externo.json` (mesma pasta, já montada no `api` em `/data/db`), com escrita atômica (temporário + `mv`). O formato da 025 não muda.

## Decisão: segredos fora do `.env` do compose

Repositório, senha e chave do bucket ficam em `/root/.config/notas-backup.env` (`600`), lido só pelos scripts. O `.env` do compose é montado em containers; esse arquivo não. O `.env` entra **no** instantâneo (cifrado), porque sem ele as chaves do núcleo (030) se perdem e os logins deixam de valer.

## Decisão: proteção contra apagamento

- Chave de aplicação restrita ao bucket.
- Lifecycle do bucket guardando versões ocultas/apagadas por 30 dias: uma VPS invadida que rode `restic forget` ou apague objetos não destrói a cópia antes de alguém perceber (o alerta é de 36 h).
- Object lock rejeitado por agora: complica o `prune` e não é necessário para o risco medido.

## Decisão: o que fica fora do instantâneo

`data/db/notas.db*`, `data/sites/*/data/app.db*` e `data/postgres/` (arquivos vivos; podem estar no meio de uma escrita). Valem as cópias consistentes em `backups/` do dia (`notas-*`, `site-*`, `pg-*`). Assim a cópia externa nunca precisa parar serviços nem criar temporários grandes.

## Decisão: deploy leva `scripts/`

Acrescentar `scripts` ao `tar` do `deploy.yml`, incluir `scripts` no `rm -rf` antes de extrair, e depois `chmod 755 scripts/*.sh && chown root:root scripts/*.sh`. Instala também `/etc/logrotate.d/notas-backup` a partir do repositório. O cron continua manual (documentado), para o deploy não editar o crontab.

## Conferência semanal

`scripts/backup-conferir.sh`, domingo 05:00: `restic check --read-data-subset=10%` (lê ~10% dos dados remotos por semana; cobre tudo em cerca de 10 semanas) e `restic restore latest --include '/opt/notas-vps/backups/notas-*.db' --target "$(mktemp -d)"`, seguido de `sqlite3 ... 'PRAGMA integrity_check'` (precisa devolver `ok`) e remoção da pasta temporária.
