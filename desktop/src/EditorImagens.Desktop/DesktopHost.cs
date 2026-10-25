using System.Text.Json;
using System.Windows.Threading;
using EditorImagens.Ia;

namespace EditorImagens.Desktop;

/// <summary>O que os endpoints locais precisam do programa: a janela (dona dos
/// diálogos e destino dos avisos pra página), a configuração e os modelos.</summary>
public sealed class DesktopHost(Configuracao config, Dispatcher dispatcher, ModelosLocais modelos, string? arquivoInicial)
{
    public Configuracao Config { get; } = config;
    public ModelosLocais Modelos { get; } = modelos;
    public MainWindow? Janela { get; set; }

    private string? arquivoInicial = arquivoInicial;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>O arquivo com que o programa foi aberto, entregue uma vez só.</summary>
    public string? ConsumirArquivoInicial() => Interlocked.Exchange(ref arquivoInicial, null);

    /// <summary>Roda na thread da janela (diálogos, impressão, tudo que é WPF).</summary>
    public Task<T> NaJanela<T>(Func<T> acao) => dispatcher.InvokeAsync(acao).Task;

    /// <summary>Aviso pra página (arquivo aberto de fora, download concluído, foto na pasta).</summary>
    public void Postar(object mensagem) =>
        dispatcher.BeginInvoke(() => Janela?.Postar(JsonSerializer.Serialize(mensagem, Json)));
}
