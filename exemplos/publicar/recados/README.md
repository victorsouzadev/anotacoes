# Recados: app de exemplo da ferramenta "Publicar"

Um mural de recados: front estático (`web/`), API C# (`api/`) e banco (Postgres, se o
site tiver um; senão SQLite). Serve de
modelo para qualquer sistema que você queira publicar pela ferramenta **Publicar**
do hub. O desenho da ferramenta está em [`docs/poc-multi-app/DISCOVERY.md`](../../../docs/poc-multi-app/DISCOVERY.md).

## Gerar o pacote e publicar

```bash
./empacotar.sh          # Linux/macOS
.\empacotar.ps1         # Windows (PowerShell)
```

Isso gera `recados.zip`. No hub: **Publicar → Novo site → Escolher ZIP → Publicar**.
Em alguns segundos o site está em `http://<endereço>.191-252-177-244.sslip.io:8090`.

## O contrato (o que seu app precisa seguir)

Para adaptar um sistema que já existe, use o botão **Preparar um app** na tela Publicar: ele
gera um prompt para o seu assistente de código, com estas regras e as armadilhas comuns
(HTTPS, chaves do Data Protection, logs em arquivo, URLs absolutas no front).

| # | Regra | Como o Recados faz |
|---|---|---|
| 1 | `api/` é a saída de `dotnet publish`, **framework-dependent** (.NET 8, 9 ou 10) | `dotnet publish -c Release -r linux-x64 --self-contained false -o out/api` |
| 2 | Escutar na porta de `ASPNETCORE_URLS` | Nada a fazer: o ASP.NET Core já lê essa variável |
| 3 | Banco: se o site tem **Postgres**, `ConnectionStrings:Postgres` (e `PGHOST`, `PGUSER`, `PGPASSWORD`...) traz banco, usuário e senha próprios do site. Senão, `ConnectionStrings:Default` aponta para um SQLite em `/data/app.db`. Os dois **sobrevivem a republicações**. O resto do disco é somente leitura | Usa `Postgres` se existir, senão `Default` |
| 4 | Criar ou migrar o banco na subida (`CREATE TABLE IF NOT EXISTS` ou `db.Database.Migrate()`) | `CREATE TABLE IF NOT EXISTS` no `Program.cs` |
| 5 | Rotas da API sob `/api`. O resto é servido de `web/` (com fallback para `index.html`, para SPA) | `/api/recados`, `/api/health` |
| 6 | Opcional: `publicar.json` com `health` (caminho que precisa responder 2xx), `memoriaMb` (64 a 512) e `entrada` (a DLL, se houver mais de uma) | `{ "health": "/api/health", "memoriaMb": 128 }` |

Sem `web/`, o app C# atende tudo e pode servir o próprio `wwwroot`. Sem `api/`, é um
site estático e nenhum container é criado.

Com EF Core, a troca de SQLite para Postgres é só o provedor:
`options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres"))`
(pacote `Npgsql.EntityFrameworkCore.PostgreSQL`) + `db.Database.Migrate()` na subida.

Segredos (chaves de API, senhas) vão em **Variáveis de ambiente** na tela do site.
Eles são guardados cifrados e chegam ao app como variáveis comuns: `Email__Senha`
vira `Configuration["Email:Senha"]`.

## Rodar localmente

```bash
cd api && dotnet run     # sem ConnectionStrings:Default, usa recados.db na pasta
```
Sirva `web/` com qualquer servidor estático que repasse `/api` para a API, ou
simplesmente publique pela ferramenta.
