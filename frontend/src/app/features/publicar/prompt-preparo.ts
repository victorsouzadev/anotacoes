/**
 * Prompt para um assistente de código (Claude Code, Cursor, Copilot...) adaptar um
 * sistema existente ao contrato da ferramenta "Publicar" e gerar o pacote.
 *
 * As regras aqui espelham o que a plataforma faz de verdade — se mudar o Caddyfile, o
 * Deployer (ComandosDocker.Run) ou SitesEndpoints, revise este texto junto.
 */
export interface OpcoesPrompt {
  /** Site de destino, para personalizar URL e banco. Sem ele, o prompt sai genérico. */
  site?: { nome: string; slug: string; url: string; temPostgres: boolean } | null;
  /** O servidor tem o Postgres compartilhado ligado. */
  postgresNoServidor: boolean;
  /** "http://{slug}.<domínio>:<porta>", para o exemplo de URL no prompt genérico. */
  urlModelo: string;
}

export function gerarPromptPreparo(o: OpcoesPrompt): string {
  const url = o.site?.url ?? o.urlModelo.replace('{slug}', '<endereco>');
  const destino = o.site
    ? `o site **${o.site.nome}**, que vai responder em \`${url}\``
    : `um site que vai responder em \`${url}\``;

  const banco = secaoBanco(o);

  return `# Preparar esta aplicação para a plataforma "Publicar"

Você vai adaptar o projeto deste repositório para ser publicado na plataforma **Publicar**
(um mini-PaaS numa VPS própria) e gerar o pacote de deploy. O destino é ${destino}.

Trabalhe em etapas: primeiro **analise e me mostre o plano**, depois implemente, depois valide.
Não invente requisitos: se algo do projeto não couber nas regras abaixo, pare e me explique.

## Como a plataforma roda o app

- Recebe um **ZIP** e serve em \`http://<endereco>.<dominio>:<porta>\` (HTTP, **sem HTTPS** por enquanto).
- **Front estático** (pasta \`web/\`): servido direto pelo Caddy, com fallback para \`index.html\` (SPA).
- **API C#** (pasta \`api/\`): a saída de \`dotnet publish\` roda num container da imagem oficial
  \`mcr.microsoft.com/dotnet/aspnet:<versão>\` (.NET **8.0, 9.0 ou 10.0**), assim:
  - pasta \`/app\` **somente leitura**; disco todo somente leitura, exceto **\`/data\`** (persistente) e \`/tmp\` (memória, 64 MB);
  - usuário **1000:1000**, sem capabilities, **192 MB** de RAM por padrão (configurável de 64 a 512), meia CPU;
  - rede isolada: o app **não** alcança outros serviços além do Postgres da plataforma e da internet;
  - a plataforma define \`ASPNETCORE_URLS=http://0.0.0.0:8080\`, \`HOME=/tmp\`, \`DOTNET_gcServer=0\`;
  - requisições chegam **pelo Caddy**, que manda **só \`/api\` e \`/api/*\`** para a API; o resto é o front.
    Se não houver \`web/\`, a API recebe tudo.
- A cada deploy, a plataforma faz backup do banco, sobe a versão nova e espera o **health check**
  responder (até 30 s). Se não responder, volta sozinha para a versão anterior e restaura o banco.

## O pacote que você deve gerar

\`\`\`
<nome>.zip
├── api/            ← dotnet publish -c Release -r linux-x64 --self-contained false -o api
├── web/            ← build de produção do front (index.html na raiz desta pasta)
└── publicar.json   ← { "health": "/api/health", "memoriaMb": 192 }
\`\`\`

\`publicar.json\` aceita: \`health\` (caminho que precisa responder 2xx), \`memoriaMb\` (64–512) e
\`entrada\` (nome da DLL, **obrigatório se** houver mais de um \`*.runtimeconfig.json\` em \`api/\`).
Limites do ZIP: 100 MB compactado, 300 MB extraído, 10 000 arquivos. Sem links simbólicos.

## O que adaptar

### 1. Backend (.NET)
1. **TargetFramework** \`net8.0\`, \`net9.0\` ou \`net10.0\`. Publicar **framework-dependent** para \`linux-x64\`
   (\`--self-contained false\`): o runtime já está na imagem. Se o projeto for .NET Framework / .NET < 8,
   diga o que precisa para migrar antes de continuar.
2. **Porta**: não fixe URL/porta no código (\`UseUrls\`, \`Kestrel.Endpoints\` no appsettings de produção).
   Deixe o ASP.NET Core ler \`ASPNETCORE_URLS\`.
3. **HTTPS**: o tráfego é HTTP. Em produção, **remova \`UseHttpsRedirection()\` e \`UseHsts()\`** (causariam
   loop de redirecionamento) e não use \`CookieSecurePolicy.Always\` (use \`SameAsRequest\`), senão login por cookie não funciona.
4. **Proxy**: adicione \`UseForwardedHeaders\` com \`XForwardedFor | XForwardedProto\` e \`KnownNetworks/KnownProxies\`
   limpos (o Caddy está na frente, dentro da rede Docker).
5. **Rotas**: toda a API sob o prefixo **\`/api\`** (ex.: \`app.MapGroup("/api")\`, ou \`[Route("api/[controller]")]\`).
   Rotas fora de \`/api\` nunca chegam ao app quando existe \`web/\`.
6. **Health check**: crie \`GET /api/health\` que responda 200 **tocando no banco** (ex.: \`SELECT 1\`).
7. **Disco**: nada de escrever na pasta do app. Uploads, arquivos gerados e caches em **\`/data\`**
   (ex.: \`/data/uploads\`), criando as pastas na subida. Temporários em \`/tmp\`.
8. **Data Protection**: persista as chaves em \`/data/keys\`
   (\`AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo("/data/keys"))\`), senão cookies de
   login e antiforgery ficam inválidos a cada deploy ou reinício.
9. **Logs**: só no console (stdout/stderr). Remova log em arquivo (Serilog File sink etc.): a plataforma
   mostra os logs do container na tela.
10. **Configuração e segredos**: tudo que muda por ambiente vem de **variáveis de ambiente** no formato do
    .NET (\`Secao__Chave\` → \`Configuration["Secao:Chave"]\`). Tire senhas e chaves do \`appsettings.json\`
    versionado. Nomes **reservados** pela plataforma (não use): \`ASPNETCORE_URLS\`, \`ASPNETCORE_HTTP_PORTS\`,
    \`HOME\`, \`PATH\`, \`DOTNET_*\`, \`ConnectionStrings__Default\`, \`ConnectionStrings__Postgres\`, \`PG*\`.
11. **Memória**: o app precisa caber no limite escolhido (192 MB padrão). Evite caches em memória grandes;
    se precisar de mais, ajuste \`memoriaMb\` (máximo 512).
12. **Dependências externas**: não há Redis, RabbitMQ, SQL Server, MongoDB etc. na plataforma. Se o projeto
    depende de algum, liste e proponha alternativa (ex.: cache em memória, fila em tabela do banco, serviço gerenciado externo).

### 2. Banco de dados
${banco}

### 3. Frontend
1. Build de produção com **base href \`/\`** (o site é a raiz do subdomínio).
2. Chamadas à API com **URL relativa \`/api/...\`** — nada de \`http://localhost:5000\` ou domínio fixo.
   Como front e API ficam na mesma origem, **não precisa de CORS** (remova se só existia por isso).
3. Rotas do cliente (Angular/React/Vue Router) funcionam: a plataforma devolve \`index.html\` para qualquer caminho sem arquivo.
4. O conteúdo da pasta de saída do build (ex.: \`dist/<app>/browser\`, \`dist\`, \`build\`) vai para \`web/\`.
5. Se a API servir o próprio front (\`wwwroot\` + \`MapFallbackToFile\`), pode omitir \`web/\` — mas prefira \`web/\`:
   é servido sem gastar memória do container.

### 4. Empacotamento
Crie **dois scripts** na raiz do repositório, que geram o ZIP do zero:
- \`publicar/empacotar.sh\` (bash) e \`publicar/empacotar.ps1\` (PowerShell), que:
  1. limpam a pasta de saída;
  2. rodam \`dotnet publish <projeto da API> -c Release -r linux-x64 --self-contained false -p:DebugType=none -o <saida>/api\`;
  3. fazem o build de produção do front e copiam a saída para \`<saida>/web\`;
  4. escrevem \`<saida>/publicar.json\`;
  5. compactam o **conteúdo** de \`<saida>\` (sem uma pasta por fora) em \`<nome>.zip\`.
- Adicione a pasta de saída e o \`.zip\` ao \`.gitignore\`.

## Validação (obrigatória antes de me entregar)

1. \`dotnet build\` e os testes existentes passam.
2. Rode o pacote **exatamente como a plataforma roda**, com Docker:
\`\`\`bash
mkdir -p ./.publicar-data && chmod 777 ./.publicar-data
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp:rw,size=64m \\
  --user 1000:1000 --memory 192m --cpus 0.5 --cap-drop ALL \\
  -v "$PWD/<saida>/api:/app:ro" -v "$PWD/.publicar-data:/data" -w /app \\
  -e ASPNETCORE_URLS=http://0.0.0.0:8080 -e HOME=/tmp -e DOTNET_gcServer=0 \\
  -e "ConnectionStrings__Default=Data Source=/data/app.db" \\
  mcr.microsoft.com/dotnet/aspnet:9.0 dotnet /app/<Projeto>.dll
\`\`\`${o.postgresNoServidor ? `
   Com Postgres: suba um \`docker run -d --name pg -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:17-alpine\`,
   troque \`-p 8080:8080\` por \`--network host\` e acrescente
   \`-e "ConnectionStrings__Postgres=Host=localhost;Database=postgres;Username=postgres;Password=x"\`.` : ''}
   Use a imagem \`aspnet\` da mesma versão do seu TargetFramework (8.0, 9.0 ou 10.0).
   e confirme: \`curl -i http://localhost:8080/api/health\` responde 200; o app não tenta escrever fora de \`/data\`;
   reiniciar o container mantém dados e sessão (chaves do Data Protection em \`/data/keys\`).
3. Abra \`web/index.html\` servido por qualquer servidor estático com proxy de \`/api\` para a porta 8080
   (ou só confira que não há URL absoluta de API no bundle: \`grep -r "localhost" <saida>/web\` não acha nada).
4. Confira o ZIP: tem \`api/<Projeto>.dll\`, \`api/<Projeto>.runtimeconfig.json\` (com \`Microsoft.AspNetCore.App\`
   8.0/9.0/10.0), \`web/index.html\` e \`publicar.json\` **na raiz** do ZIP.

## O que me entregar no final

1. Resumo das mudanças, arquivo por arquivo.
2. **Lista de variáveis de ambiente** que eu preciso cadastrar em *Publicar → Variáveis de ambiente*
   (nome no formato \`Secao__Chave\` e para que serve — sem valores reais).
3. Se o app **precisa de banco Postgres** (e se sim, que as migrations rodam sozinhas na subida).
4. O comando para gerar o ZIP e o caminho do arquivo gerado.
5. Pendências ou riscos (dependências não suportadas, migrations destrutivas, consumo de memória).

Depois é só: *Publicar → ${o.site ? o.site.nome : 'Novo site'} → Enviar nova versão → escolher o ZIP → Publicar*.
`;
}

function secaoBanco(o: OpcoesPrompt): string {
  const sqlite = `- **SQLite**: use \`ConnectionStrings:Default\` (a plataforma aponta para \`Data Source=/data/app.db\`,
  que sobrevive a deploys). Com EF Core: \`UseSqlite(builder.Configuration.GetConnectionString("Default"))\`.`;
  const postgres = `- **Postgres**: use \`ConnectionStrings:Postgres\`. A plataforma cria um banco e um usuário só deste
  site e entrega a connection string completa (também como \`PGHOST\`, \`PGPORT\`, \`PGDATABASE\`, \`PGUSER\`,
  \`PGPASSWORD\`). Com EF Core: pacote \`Npgsql.EntityFrameworkCore.PostgreSQL\` e
  \`UseNpgsql(builder.Configuration.GetConnectionString("Postgres"))\`. O usuário é dono só do próprio banco
  (não cria bancos nem roles; use o schema \`public\`). Limite de **10 conexões** — mantenha o pool pequeno.`;
  const comum = `- **Migrations na subida**: aplique ao iniciar (\`db.Database.Migrate()\` num scope logo após \`Build()\`),
  antes de atender requisições. Não dependa de rodar \`dotnet ef database update\` à mão.
- Prefira migrations **compatíveis com a versão anterior** (adicionar coluna/tabela em vez de renomear/apagar
  na mesma versão): a plataforma consegue voltar a versão restaurando o backup, mas é melhor não precisar.
- Se o projeto usa **SQL Server, MySQL ou outro**, migre o provedor (de preferência para Postgres${o.postgresNoServidor ? '' : ', se a plataforma tiver Postgres; senão SQLite'}),
  revisando tipos, SQL cru e \`HasColumnType\`, e recrie as migrations para o novo provedor.
- Seed de dados, se houver, precisa ser idempotente (roda a cada subida).`;

  if (o.site?.temPostgres)
    return `Este site **tem banco Postgres** criado na plataforma.\n${postgres}\n${comum}`;
  if (o.site && o.postgresNoServidor)
    return `Este site ainda **não tem banco Postgres**. Se o app precisar de um banco relacional de verdade, eu crio o Postgres na
tela antes do deploy; senão, SQLite serve. Escolha pelo que o projeto já usa e me diga qual.\n${postgres}\n${sqlite}\n${comum}`;
  if (o.postgresNoServidor)
    return `A plataforma oferece dois bancos — escolha pelo que o projeto já usa e me diga qual:\n${postgres}\n${sqlite}\n${comum}`;
  return `A plataforma oferece **SQLite** (Postgres não está ligado neste servidor):\n${sqlite}\n${comum}`;
}
