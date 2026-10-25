using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace EditorImagens.Desktop;

public sealed class Calibracao
{
    /// <summary>Deslocamento somado a tudo que se imprime, em mm (+ = pra direita / pra baixo).</summary>
    public double DxMm { get; set; }
    public double DyMm { get; set; }
    /// <summary>Correção de escala (1 = nenhuma). A régua de 150 mm saiu com 149? 150/149.</summary>
    public double EscalaX { get; set; } = 1;
    public double EscalaY { get; set; } = 1;
}

/// <summary>Preferências do programa num JSON na pasta de dados. Pequeno, lido
/// na abertura e regravado a cada mudança.</summary>
public sealed class Configuracao
{
    public string JwtSecret { get; set; } = "";
    public List<string> Recentes { get; set; } = [];
    public string? UltimaPastaExportacao { get; set; }
    public string? UltimaPastaProjetos { get; set; }
    public Dictionary<string, Calibracao> Calibracoes { get; set; } = [];
    public double? JanelaLargura { get; set; }
    public double? JanelaAltura { get; set; }
    public bool JanelaMaximizada { get; set; } = true;

    private static readonly string Arquivo = Path.Combine(Pastas.Dados, "config.json");
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    private readonly object trava = new();

    public static Configuracao Carregar()
    {
        Configuracao c;
        try
        {
            c = File.Exists(Arquivo) ? JsonSerializer.Deserialize<Configuracao>(File.ReadAllText(Arquivo)) ?? new() : new();
        }
        catch (JsonException)
        {
            c = new();
        }
        // O segredo dos tokens fica guardado: assim o login local sobrevive a
        // fechar e abrir o programa.
        if (c.JwtSecret.Length < 32)
        {
            c.JwtSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
            c.Salvar();
        }
        return c;
    }

    public void Salvar()
    {
        lock (trava)
        {
            var tmp = Arquivo + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
            File.Move(tmp, Arquivo, overwrite: true);
        }
    }

    public void LembrarRecente(string caminho)
    {
        lock (trava)
        {
            Recentes.RemoveAll(r => string.Equals(r, caminho, StringComparison.OrdinalIgnoreCase));
            Recentes.Insert(0, caminho);
            if (Recentes.Count > 12) Recentes.RemoveRange(12, Recentes.Count - 12);
        }
        Salvar();
    }
}
