# MCP de operação da VPS

Servidor MCP que dá a um agente (Claude Code, Claude web/app) **controle total da VPS**: shell de root
no host, logs e restart de qualquer container e leitura e escrita de arquivos.

> **Quem tem o `OPS_MCP_TOKEN` controla a VPS inteira**: o hub, o nginx-proxy-manager, os bancos,
> o `.env` e os outros apps. Trate o token como a senha de root. Se ele vazar, troque na hora
> (ver "Trocar o token").

## Como funciona

- Serviço `ops` (.NET 10) no `docker-compose.yml` da raiz, atrás do profile `ops` (desligado por padrão).
- Roda com `pid: host` e `privileged: true`. Cada comando entra nos namespaces do PID 1 com `nsenter`,
  então executa **no host** como root, e não dentro do container.
- Publicado pelo Caddy do hub em `/ops/*`, **só por HTTPS** (o mesmo subdomínio do Segundo Cérebro).
  Pelo IP:8090 responde 403. Só `/ops/health` fica liberado.
- Token obrigatório (`Authorization: Bearer` ou `?key=`), com no mínimo 32 caracteres. Com token mais
  curto o serviço nem sobe; sem token, o `/mcp` responde 503.
- Toda chamada vai para `data/ops/audit.log` (uma linha JSON com a ferramenta, os argumentos, o código
  de saída e a duração) e para o log do container.
- Limites: 60 chamadas/min, até 30 min por comando, saída cortada no meio acima de ~100 KB.

## Ferramentas

| Tool | Faz |
| --- | --- |
| `run_command` | Executa um comando bash como root no host (`timeout_seconds`, `working_directory`) |
| `system_status` | Uptime, carga, memória, disco, containers e uso de CPU/RAM por container |
| `list_containers` | Todos os containers, com status, imagem e portas |
| `container_logs` | Últimas linhas de log de um container (`tail`, `since` como `10m`/`2h`/`1d`) |
| `container_action` | `start`, `stop` ou `restart` de um container |
| `read_file` | Lê um arquivo de texto do host (até 200 KB) |
| `write_file` | Grava um arquivo, guardando antes uma cópia `<arquivo>.bak-<data>` |

## Token pela tela

Na tela do Segundo Cérebro, aba **Conectar → Claude operando a VPS**, dá para gerar o token, mostrar,
copiar e copiar os comandos prontos para o Claude Code e o Claude web. O Cérebro grava só o SHA-256 do
token em `data/cerebro/hub/access/ops-token.sha256` (montado só leitura no `ops`), que passa a valer no
lugar do `OPS_MCP_TOKEN`. Gerar outro revoga o anterior na hora, sem reiniciar o serviço.

## Ligar na VPS

```bash
cd /opt/notas-vps
echo "OPS_MCP_TOKEN=$(openssl rand -hex 32)" >> .env
nano .env        # some ",ops" ao COMPOSE_PROFILES, ex.: COMPOSE_PROFILES=publicar,cerebro,ops
grep -E 'COMPOSE_PROFILES|OPS_MCP_TOKEN' .env

C="docker compose -f docker-compose.yml -f docker-compose.vps.yml"
mkdir -p data/ops
$C build ops
$C up -d
curl -s https://cerebro.vsitefy.com.br/ops/health; echo   # {"status":"ok","modo":"nsenter","mcp":true}
```

Depois disso, os deploys pela `main` já buildam o `ops` sozinhos.

## Conectar

**Claude Code**
```bash
claude mcp add --transport http vps https://cerebro.vsitefy.com.br/ops/mcp \
  --header "Authorization: Bearer <OPS_MCP_TOKEN>"
```

**Claude (web/app), conector personalizado:** `https://cerebro.vsitefy.com.br/ops/mcp?key=<OPS_MCP_TOKEN>`.
O token vai na URL: guarde essa URL como a senha de root.

## Auditoria

```bash
tail -n 20 /opt/notas-vps/data/ops/audit.log
docker compose -f docker-compose.yml -f docker-compose.vps.yml logs ops | grep 'token recusado'
```

## Trocar o token

```bash
cd /opt/notas-vps
sed -i "s/^OPS_MCP_TOKEN=.*/OPS_MCP_TOKEN=$(openssl rand -hex 32)/" .env
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d ops
```

Para desligar de vez, tire `ops` do `COMPOSE_PROFILES` e rode `docker compose ... rm -sf ops`.

## Desenvolvimento

```bash
dotnet test ops.slnx
cd src/Ops
Ops__Token=$(openssl rand -hex 32) Ops__Mode=local Ops__DataPath=/tmp/ops dotnet run
```

`Ops__Mode=local` executa os comandos dentro do próprio processo, sem `nsenter`. Os testes usam esse modo.
