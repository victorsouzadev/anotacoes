using Microsoft.Data.Sqlite;

// App de exemplo da ferramenta "Publicar": API C# + SQLite + front estático.
//
// O contrato com a plataforma (docs/poc-multi-app/DISCOVERY.md, seção 5):
//   1. escutar em ASPNETCORE_URLS (a plataforma define; aqui não precisa fazer nada);
//   2. usar ConnectionStrings:Default (a plataforma aponta para /data/app.db);
//   3. criar/migrar o banco na subida;
//   4. rotas da API em /api — o resto (web/) o Caddy serve direto do disco.
var builder = WebApplication.CreateBuilder(args);
var conexao = builder.Configuration.GetConnectionString("Default") ?? "Data Source=recados.db";
var app = builder.Build();

using (var db = new SqliteConnection(conexao))
{
    db.Open();
    using var cmd = db.CreateCommand();
    cmd.CommandText = """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS recados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            texto TEXT NOT NULL,
            criado_em TEXT NOT NULL
        );
        """;
    cmd.ExecuteNonQuery();
}

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", versao = Environment.GetEnvironmentVariable("RECADOS_VERSAO") ?? "1" }));

app.MapGet("/api/recados", () =>
{
    using var db = new SqliteConnection(conexao);
    db.Open();
    using var cmd = db.CreateCommand();
    cmd.CommandText = "SELECT id, texto, criado_em FROM recados ORDER BY id DESC LIMIT 100";
    using var r = cmd.ExecuteReader();
    var lista = new List<Recado>();
    while (r.Read()) lista.Add(new Recado(r.GetInt64(0), r.GetString(1), r.GetString(2)));
    return Results.Ok(lista);
});

app.MapPost("/api/recados", (NovoRecado req) =>
{
    var texto = req.Texto?.Trim() ?? "";
    if (texto.Length is 0 or > 500) return Results.BadRequest(new { error = "Escreva de 1 a 500 caracteres." });
    using var db = new SqliteConnection(conexao);
    db.Open();
    using var cmd = db.CreateCommand();
    cmd.CommandText = "INSERT INTO recados (texto, criado_em) VALUES ($t, $c) RETURNING id";
    cmd.Parameters.AddWithValue("$t", texto);
    var criado = DateTime.UtcNow.ToString("O");
    cmd.Parameters.AddWithValue("$c", criado);
    var id = (long)cmd.ExecuteScalar()!;
    return Results.Created($"/api/recados/{id}", new Recado(id, texto, criado));
});

app.Run();

record Recado(long Id, string Texto, string CriadoEm);
record NovoRecado(string? Texto);
