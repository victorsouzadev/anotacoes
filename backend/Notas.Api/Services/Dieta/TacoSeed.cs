using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Notas.Api.Data;

namespace Notas.Api.Services.Dieta;

/// <summary>Carrega a tabela TACO (Data/Seed/taco.csv, embutida no assembly) na primeira subida.</summary>
public static class TacoSeed
{
    public static void Aplicar(AppDbContext db)
    {
        if (db.DietaAlimentos.Any(a => a.Fonte == "taco")) return;

        using var stream = typeof(TacoSeed).Assembly.GetManifestResourceStream("Notas.Api.Data.Seed.taco.csv")
            ?? throw new InvalidOperationException("taco.csv não foi embutido no assembly.");
        using var reader = new StreamReader(stream);
        var agora = DateTime.UtcNow;
        string? linha;
        while ((linha = reader.ReadLine()) is not null)
        {
            if (linha.StartsWith('#') || linha.StartsWith("id;")) continue;
            var c = linha.Split(';');
            if (c.Length < 8) continue;
            double N(int i) => double.Parse(c[i], CultureInfo.InvariantCulture);
            db.DietaAlimentos.Add(new DietaAlimento
            {
                Id = "taco-" + c[0], UserId = null, Nome = c[1], Kcal = N(2), Proteina = N(3), Carbo = N(4),
                Gordura = N(5), Fibra = N(6), Sodio = N(7), Fonte = "taco", UpdatedAt = agora,
            });
        }
        db.SaveChanges();
        db.ChangeTracker.Clear();
    }
}
