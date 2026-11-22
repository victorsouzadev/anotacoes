using CopiaParaPostgres;

// Spec 038: copia o notas.db para o banco hub do Postgres, onde núcleo e plug-ins já criaram o esquema.
//   dotnet run -- --sqlite /data/db/notas.db [--limpar]   (destino em HUB_PG_DESTINO, para a senha não ir na linha de comando)
string? sqlite = null, pg = Environment.GetEnvironmentVariable("HUB_PG_DESTINO");
var limpar = false;
for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--sqlite": sqlite = args[++i]; break;
        case "--pg": pg = args[++i]; break;
        case "--limpar": limpar = true; break;
        default: Console.Error.WriteLine($"Opção desconhecida: {args[i]}"); return 2;
    }
}
if (sqlite is null || string.IsNullOrEmpty(pg))
{
    Console.Error.WriteLine("Uso: --sqlite <notas.db> [--limpar], com o destino em HUB_PG_DESTINO (ou --pg)");
    return 2;
}
try
{
    var r = Copia.Executar(sqlite, pg, limpar, Console.Out);
    Console.WriteLine($"OK: {r.Tabelas.Count} tabelas, {r.Tabelas.Sum(t => t.Linhas)} linhas conferidas.");
    return 0;
}
catch (Exception e)
{
    Console.Error.WriteLine($"FALHOU, nada foi gravado: {e.Message}");
    return 1;
}
