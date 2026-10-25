using System.IO;

namespace EditorImagens.Desktop;

/// <summary>Onde o programa guarda as coisas dele. Fora da pasta de instalação,
/// que o instalador troca a cada atualização.</summary>
public static class Pastas
{
    public static string Dados { get; } = Criar(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EditorImagens.Dados"));
    public static string Banco => Path.Combine(Dados, "editor.db");
    public static string WebView => Criar(Path.Combine(Dados, "WebView2"));
    public static string Programa => AppContext.BaseDirectory;
    public static string Site => Path.Combine(Programa, "wwwroot");
    public static string Modelos => Path.Combine(Programa, "modelos");
    /// <summary>Biblioteca do Estúdio (gerações, uploads, documentos dos craft apps).</summary>
    public static string Estudio => Criar(Path.Combine(Dados, "estudio"));
    /// <summary>ffmpeg que vem no instalador (montagem de vídeo, quadros, troca de fundo, miniaturas).</summary>
    public static string Ffmpeg => Path.Combine(Programa, "ffmpeg", "ffmpeg.exe");
    public static string Ffprobe => Path.Combine(Programa, "ffmpeg", "ffprobe.exe");
    /// <summary>Linhas de comando dos craft apps (o MCP do Estúdio roda cada uma sem janela).</summary>
    public static string CraftsCli => Path.Combine(Programa, "crafts-cli");
    /// <summary>Hash do token do MCP local (ver <see cref="McpLocal"/>).</summary>
    public static string McpToken => Path.Combine(Dados, "mcp-token.json");

    /// <summary>Pastas do usuário que o programa cria: pacotes do Studio, exportações.</summary>
    public static string Documentos(string sub) =>
        Criar(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Editor de Imagens", sub));

    private static string Criar(string p)
    {
        Directory.CreateDirectory(p);
        return p;
    }
}
