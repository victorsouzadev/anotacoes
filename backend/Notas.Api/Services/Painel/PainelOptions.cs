using System.Globalization;

namespace Notas.Api.Services.Painel;

/// <summary>Painel de plug-ins (spec 040): quem administra e os tokens do GitHub (seção "Painel").</summary>
public class PainelOptions
{
    public const string SectionName = "Painel";

    /// <summary>E-mails (separados por vírgula) de HUB_ADMINISTRADORES. Vazio = ninguém.</summary>
    public string Administradores { get; set; } = "";

    /// <summary>Dono dos repositórios <c>hub-&lt;id&gt;</c> e do núcleo.</summary>
    public string Dono { get; set; } = "victorsouzadev";

    public string GithubLeitura { get; set; } = "";
    public string GithubDisparo { get; set; } = "";

    /// <summary>Validade dos tokens (aaaa-mm-dd), só para o aviso.</summary>
    public string GithubLeituraValidade { get; set; } = "";
    public string GithubDisparoValidade { get; set; } = "";

    public bool Administra(string? email) =>
        !string.IsNullOrWhiteSpace(email) &&
        Administradores.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(a => string.Equals(a, email, StringComparison.OrdinalIgnoreCase));

    /// <summary>Avisos dos tokens para a tela, sem nenhum pedaço deles.</summary>
    public List<string> Avisos(DateOnly hoje)
    {
        var l = new List<string>();
        if (string.IsNullOrWhiteSpace(GithubLeitura))
            l.Add("Falta o token de leitura do GitHub (PAINEL_GITHUB_LEITURA): só as ferramentas do registro aparecem.");
        else Validade("leitura", GithubLeituraValidade);
        if (!string.IsNullOrWhiteSpace(GithubDisparo)) Validade("disparo", GithubDisparoValidade);
        return l;

        void Validade(string nome, string data)
        {
            if (!DateOnly.TryParseExact(data, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return;
            var dias = d.DayNumber - hoje.DayNumber;
            if (dias < 0) l.Add($"O token de {nome} do GitHub venceu.");
            else if (dias <= 7) l.Add(dias == 0 ? $"O token de {nome} do GitHub vence hoje." : $"O token de {nome} do GitHub vence em {dias} dia(s).");
        }
    }
}
