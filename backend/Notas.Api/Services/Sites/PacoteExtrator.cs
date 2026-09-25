using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Notas.Api.Services.Sites;

public class PacoteInvalidoException(string message) : Exception(message);

/// <summary>O que foi encontrado no pacote depois de extraído.</summary>
public record PacoteInfo(
    bool TemWeb,
    bool TemApi,
    string? Entrada,
    string? RuntimeVersao,
    string? Health,
    int? MemoriaMb,
    long TamanhoDescompactado);

/// <summary>
/// Extrai o ZIP enviado pelo usuário para a pasta da versão e descobre o que há nele.
///
/// Layout aceito (ver docs/poc-multi-app/DISCOVERY.md, seção 5):
///   api/  → saída do dotnet publish     web/ → front estático     publicar.json (opcional)
/// Também aceita, por conveniência, um ZIP com uma pasta só por fora (o "Compactar pasta"
/// do Windows faz isso), o conteúdo de web/ solto (tem index.html na raiz) ou a saída do
/// dotnet publish solta (tem *.runtimeconfig.json na raiz).
/// </summary>
public static partial class PacoteExtrator
{
    public static readonly string[] RuntimesSuportados = ["8.0", "9.0", "10.0"];

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.dll$")]
    public static partial Regex EntradaValida();

    [GeneratedRegex(@"^/[A-Za-z0-9/._~%?=&-]{0,199}$")]
    private static partial Regex HealthValido();

    public static PacoteInfo Extrair(Stream zip, string destino, SitesOptions limites)
    {
        ZipArchive arquivo;
        try { arquivo = new ZipArchive(zip, ZipArchiveMode.Read, leaveOpen: true); }
        catch (InvalidDataException) { throw new PacoteInvalidoException("O arquivo enviado não é um ZIP válido."); }

        using (arquivo)
        {
            var entradas = Normalizar(arquivo, limites);
            var mapeadas = Mapear(entradas);

            Directory.CreateDirectory(destino);
            var raiz = Path.GetFullPath(destino) + Path.DirectorySeparatorChar;
            long total = 0;
            foreach (var (entry, caminho) in mapeadas)
            {
                var alvo = Path.GetFullPath(Path.Combine(raiz, caminho));
                // Defesa em profundidade: Normalizar já recusou "..", mas o destino final é
                // o que importa.
                if (!alvo.StartsWith(raiz, StringComparison.Ordinal))
                    throw new PacoteInvalidoException($"Caminho inválido no ZIP: {entry.FullName}");

                if (caminho.EndsWith('/'))
                {
                    Directory.CreateDirectory(alvo);
                    continue;
                }
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(alvo)!);
                    using var origem = entry.Open();
                    using var saida = new FileStream(alvo, FileMode.CreateNew, FileAccess.Write);
                    // O tamanho declarado no cabeçalho do ZIP pode mentir (zip bomb): conta o que
                    // de fato sai do descompactador.
                    total += CopiarComLimite(origem, saida, limites.MaxDescompactadoBytes - total);
                }
                catch (Exception e) when (e is IOException or InvalidDataException && e is not PacoteInvalidoException)
                {
                    throw new PacoteInvalidoException($"Não consegui extrair {entry.FullName} (arquivo repetido ou corrompido?).");
                }
            }

            return Analisar(destino, total);
        }
    }

    private static List<(ZipArchiveEntry Entry, string Nome)> Normalizar(ZipArchive arquivo, SitesOptions limites)
    {
        if (arquivo.Entries.Count > limites.MaxArquivos)
            throw new PacoteInvalidoException($"O ZIP tem mais de {limites.MaxArquivos} arquivos.");

        var lista = new List<(ZipArchiveEntry, string)>();
        long declarado = 0;
        foreach (var e in arquivo.Entries)
        {
            var nome = e.FullName.Replace('\\', '/');
            if (nome.Length == 0) continue;
            // Lixo que o macOS coloca em todo ZIP.
            if (nome.StartsWith("__MACOSX/", StringComparison.Ordinal) || nome.EndsWith("/.DS_Store", StringComparison.Ordinal) || nome == ".DS_Store")
                continue;

            var segmentos = nome.TrimEnd('/').Split('/');
            if (nome.StartsWith('/') || nome.Contains(':') || segmentos.Any(s => s is "" or "." or ".."))
                throw new PacoteInvalidoException($"Caminho inválido no ZIP: {e.FullName}");

            // Link simbólico (modo Unix nos 16 bits altos): poderia apontar para fora da pasta.
            var modo = (e.ExternalAttributes >> 16) & 0xF000;
            if (modo == 0xA000)
                throw new PacoteInvalidoException($"O ZIP contém um link simbólico, que não é aceito: {e.FullName}");

            declarado += e.Length;
            if (declarado > limites.MaxDescompactadoBytes)
                throw new PacoteInvalidoException(TextoLimite(limites.MaxDescompactadoBytes));
            lista.Add((e, nome));
        }
        if (lista.Count == 0) throw new PacoteInvalidoException("O ZIP está vazio.");
        return lista;
    }

    /// <summary>Decide onde cada entrada vai parar (api/, web/ ou a raiz da versão).</summary>
    private static List<(ZipArchiveEntry, string)> Mapear(List<(ZipArchiveEntry Entry, string Nome)> entradas)
    {
        // Uma pasta só por fora (meu-app/api/..., meu-app/web/...): tira o prefixo.
        var raizes = entradas.Select(x => x.Nome.Split('/')[0]).Distinct().ToList();
        if (raizes.Count == 1 && entradas.All(x => x.Nome.Contains('/')) && !EhRaizConhecida(entradas, ""))
        {
            var prefixo = raizes[0] + "/";
            entradas = entradas
                .Where(x => x.Nome != prefixo)
                .Select(x => (x.Entry, x.Nome[prefixo.Length..]))
                .ToList();
        }

        bool Tem(string nome) => entradas.Any(x => x.Nome == nome || x.Nome.StartsWith(nome + "/", StringComparison.Ordinal));
        var temRuntimeConfigSolto = entradas.Any(x => !x.Nome.Contains('/') && x.Nome.EndsWith(".runtimeconfig.json", StringComparison.OrdinalIgnoreCase));

        if (Tem("api") || Tem("web"))
            return entradas;
        if (temRuntimeConfigSolto)
            return entradas.Select(x => (x.Entry, x.Nome == "publicar.json" ? x.Nome : "api/" + x.Nome)).ToList();
        if (entradas.Any(x => x.Nome == "index.html"))
            return entradas.Select(x => (x.Entry, x.Nome == "publicar.json" ? x.Nome : "web/" + x.Nome)).ToList();

        throw new PacoteInvalidoException(
            "Não encontrei o que publicar. O ZIP precisa ter uma pasta api/ (saída do dotnet publish), " +
            "uma pasta web/ (front estático), ou um index.html na raiz.");
    }

    private static bool EhRaizConhecida(List<(ZipArchiveEntry Entry, string Nome)> entradas, string prefixo) =>
        entradas.Any(x => x.Nome.StartsWith(prefixo + "api/", StringComparison.Ordinal)
            || x.Nome.StartsWith(prefixo + "web/", StringComparison.Ordinal)
            || x.Nome == prefixo + "index.html"
            || x.Nome == prefixo + "publicar.json");

    private static long CopiarComLimite(Stream origem, Stream destino, long restante)
    {
        var buffer = new byte[81920];
        long copiado = 0;
        int lidos;
        while ((lidos = origem.Read(buffer, 0, buffer.Length)) > 0)
        {
            copiado += lidos;
            if (copiado > restante) throw new PacoteInvalidoException("O conteúdo descompactado passa do limite.");
            destino.Write(buffer, 0, lidos);
        }
        return copiado;
    }

    private static string TextoLimite(long bytes) =>
        $"O conteúdo descompactado passa do limite de {bytes / (1024 * 1024)} MB.";

    private sealed record Manifesto(string? Entrada, string? Health, int? MemoriaMb);

    private static PacoteInfo Analisar(string destino, long total)
    {
        var manifesto = LerManifesto(Path.Combine(destino, "publicar.json"));
        var pastaWeb = Path.Combine(destino, "web");
        var pastaApi = Path.Combine(destino, "api");
        var temWeb = Directory.Exists(pastaWeb) && Directory.EnumerateFileSystemEntries(pastaWeb).Any();
        var temApi = Directory.Exists(pastaApi) && Directory.EnumerateFileSystemEntries(pastaApi).Any();

        if (!temWeb && !temApi)
            throw new PacoteInvalidoException("As pastas api/ e web/ estão vazias.");

        if (!temApi)
            return new PacoteInfo(true, false, null, null, null, null, total);

        var configs = Directory.GetFiles(pastaApi, "*.runtimeconfig.json", SearchOption.TopDirectoryOnly);
        string config;
        if (manifesto.Entrada is { } entrada)
        {
            if (!EntradaValida().IsMatch(entrada))
                throw new PacoteInvalidoException("\"entrada\" no publicar.json precisa ser o nome de uma DLL, ex.: MeuApp.dll.");
            config = Path.Combine(pastaApi, Path.GetFileNameWithoutExtension(entrada) + ".runtimeconfig.json");
            if (!File.Exists(config))
                throw new PacoteInvalidoException($"Não achei api/{Path.GetFileName(config)} para a entrada {entrada}.");
        }
        else if (configs.Length == 1)
        {
            config = configs[0];
        }
        else if (configs.Length == 0)
        {
            throw new PacoteInvalidoException(
                "A pasta api/ não tem nenhum *.runtimeconfig.json. Envie a saída de \"dotnet publish -c Release -o api\".");
        }
        else
        {
            throw new PacoteInvalidoException(
                "A pasta api/ tem mais de um *.runtimeconfig.json. Diga qual usar com \"entrada\" no publicar.json.");
        }

        var nomeBase = Path.GetFileName(config)[..^".runtimeconfig.json".Length];
        var dll = nomeBase + ".dll";
        if (!EntradaValida().IsMatch(dll))
            throw new PacoteInvalidoException($"Nome de DLL não suportado: {dll}");
        if (!File.Exists(Path.Combine(pastaApi, dll)))
            throw new PacoteInvalidoException($"Não achei api/{dll}.");

        var runtime = LerRuntime(config);

        string? health = manifesto.Health;
        if (health is not null && !HealthValido().IsMatch(health))
            throw new PacoteInvalidoException("\"health\" no publicar.json precisa ser um caminho, ex.: /api/health.");

        int? memoria = manifesto.MemoriaMb;
        if (memoria is < 64 or > 512)
            throw new PacoteInvalidoException("\"memoriaMb\" no publicar.json precisa estar entre 64 e 512.");

        return new PacoteInfo(temWeb, true, dll, runtime, health, memoria, total);
    }

    private static Manifesto LerManifesto(string caminho)
    {
        if (!File.Exists(caminho)) return new Manifesto(null, null, null);
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(caminho),
                new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
            var r = doc.RootElement;
            string? Texto(string nome) => r.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            int? Numero(string nome) => r.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;
            return new Manifesto(Texto("entrada"), Texto("health"), Numero("memoriaMb"));
        }
        catch (Exception e) when (e is JsonException or FormatException or InvalidOperationException)
        {
            throw new PacoteInvalidoException("O publicar.json não é um JSON válido.");
        }
    }

    /// <summary>Versão do .NET (major.minor) pedida pelo runtimeconfig — escolhe a imagem aspnet.</summary>
    private static string LerRuntime(string config)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(config));
            var opcoes = doc.RootElement.GetProperty("runtimeOptions");
            var frameworks = new List<JsonElement>();
            if (opcoes.TryGetProperty("framework", out var f)) frameworks.Add(f);
            if (opcoes.TryGetProperty("frameworks", out var fs)) frameworks.AddRange(fs.EnumerateArray());

            // Prefere o ASP.NET Core (é a imagem que tem os dois); cai para o NETCore.App.
            var escolhido = frameworks.FirstOrDefault(x => x.GetProperty("name").GetString() == "Microsoft.AspNetCore.App");
            if (escolhido.ValueKind == JsonValueKind.Undefined)
                escolhido = frameworks.FirstOrDefault(x => x.GetProperty("name").GetString() == "Microsoft.NETCore.App");
            if (escolhido.ValueKind == JsonValueKind.Undefined)
                throw new PacoteInvalidoException("O runtimeconfig não diz qual .NET usar (app self-contained não é suportado).");

            var versao = Version.Parse(escolhido.GetProperty("version").GetString()!);
            var mm = $"{versao.Major}.{versao.Minor}";
            if (!RuntimesSuportados.Contains(mm))
                throw new PacoteInvalidoException($".NET {mm} não é suportado. Use {string.Join(", ", RuntimesSuportados)}.");
            return mm;
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or FormatException or ArgumentException or InvalidOperationException)
        {
            throw new PacoteInvalidoException("Não consegui ler o *.runtimeconfig.json.");
        }
    }
}
