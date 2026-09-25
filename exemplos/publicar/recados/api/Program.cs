using System.Data.Common;
using Microsoft.Data.Sqlite;
using Npgsql;

// App de exemplo da ferramenta "Publicar": API C# + banco + front estático.
//
// O contrato com a plataforma (docs/poc-multi-app/DISCOVERY.md, seção 5):
//   1. escutar em ASPNETCORE_URLS (a plataforma define; aqui não precisa fazer nada);
//   2. banco: ConnectionStrings:Postgres quando o site tem banco Postgres (a plataforma
//      entrega usuário e senha próprios do site); senão ConnectionStrings:Default, um
//      SQLite em /data/app.db;
//   3. criar/migrar o banco na subida;
//   4. rotas da API em /api — o resto (web/) o Caddy serve direto do disco.
var builder = WebApplication.CreateBuilder(args);
var postgres = builder.Configuration.GetConnectionString("Postgres");
var sqlite = builder.Configuration.GetConnectionString("Default") ?? "Data Source=recados.db";
var usaPostgres = !string.IsNullOrEmpty(postgres);
var app = builder.Build();

DbConnection Abrir()
{
    DbConnection c = usaPostgres ? new NpgsqlConnection(postgres) : new SqliteConnection(sqlite);
    c.Open();
    return c;
}

using (var db = Abrir())
using (var cmd = db.CreateCommand())
{
    cmd.CommandText = usaPostgres
        ? """
          CREATE TABLE IF NOT EXISTS recados (
              id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
              texto TEXT NOT NULL,
              criado_em TEXT NOT NULL
          );
          """
        : """
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS recados (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              texto TEXT NOT NULL,
              criado_em TEXT NOT NULL
          );
          """;
    cmd.ExecuteNonQuery();
}

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    versao = Environment.GetEnvironmentVariable("RECADOS_VERSAO") ?? "1",
    banco = usaPostgres ? "postgres" : "sqlite",
}));

app.MapGet("/api/recados", () =>
{
    using var db = Abrir();
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
    using var db = Abrir();
    using var cmd = db.CreateCommand();
    // "@nome" funciona nos dois provedores.
    cmd.CommandText = "INSERT INTO recados (texto, criado_em) VALUES (@t, @c) RETURNING id";
    var criado = DateTime.UtcNow.ToString("O");
    Parametro(cmd, "t", texto);
    Parametro(cmd, "c", criado);
    var id = Convert.ToInt64(cmd.ExecuteScalar());
    return Results.Created($"/api/recados/{id}", new Recado(id, texto, criado));
});

app.Run();

static void Parametro(DbCommand cmd, string nome, object valor)
{
    var p = cmd.CreateParameter();
    p.ParameterName = nome;
    p.Value = valor;
    cmd.Parameters.Add(p);
}

record Recado(long Id, string Texto, string CriadoEm);
record NovoRecado(string? Texto);
