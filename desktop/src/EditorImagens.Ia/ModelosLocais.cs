using Microsoft.ML.OnnxRuntime;

namespace EditorImagens.Ia;

/// <summary>
/// Onde estão os modelos e como abrir cada um. As sessões são caras de criar
/// (segundos, e memória de vídeo), então nascem na primeira vez que alguém
/// pede e ficam abertas enquanto o programa roda. Tenta a placa de vídeo pelo
/// DirectML (qualquer GPU no Windows, sem instalar CUDA) e cai pra CPU se não
/// der.
/// </summary>
public sealed class ModelosLocais : IDisposable
{
    public const string ArquivoRecorte = "birefnet.onnx";
    public const string ArquivoAmpliacao = "real_esrgan_x4plus.onnx";

    private readonly string _pasta;
    private readonly bool _tentarGpu;
    private readonly Lazy<InferenceSession?> _recorte;
    private readonly Lazy<InferenceSession?> _ampliacao;

    /// <summary>"DirectML", "CPU" ou vazio enquanto nenhum modelo foi aberto.</summary>
    public string Motor { get; private set; } = "";

    public ModelosLocais(string pasta, bool tentarGpu = true)
    {
        _pasta = pasta;
        _tentarGpu = tentarGpu;
        _recorte = new Lazy<InferenceSession?>(() => Abrir(ArquivoRecorte), LazyThreadSafetyMode.ExecutionAndPublication);
        _ampliacao = new Lazy<InferenceSession?>(() => Abrir(ArquivoAmpliacao), LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public bool TemRecorte => File.Exists(Path.Combine(_pasta, ArquivoRecorte));
    public bool TemAmpliacao => File.Exists(Path.Combine(_pasta, ArquivoAmpliacao));

    public InferenceSession? Recorte => TemRecorte ? _recorte.Value : null;
    public InferenceSession? Ampliacao => TemAmpliacao ? _ampliacao.Value : null;

    private InferenceSession? Abrir(string arquivo)
    {
        var caminho = Path.Combine(_pasta, arquivo);
        if (!File.Exists(caminho)) return null;
        if (_tentarGpu)
        {
            try
            {
                var gpu = new SessionOptions();
                // DirectML não aceita execução paralela nem otimizações que
                // mudam o layout de memória: é o que a documentação dele pede.
                gpu.EnableMemoryPattern = false;
                gpu.ExecutionMode = ExecutionMode.ORT_SEQUENTIAL;
                gpu.AppendExecutionProvider_DML(0);
                var s = new InferenceSession(caminho, gpu);
                Motor = "DirectML";
                return s;
            }
            catch
            {
                // sem GPU compatível (ou sem o motor DirectML): segue na CPU
            }
        }
        var cpu = new SessionOptions { GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL };
        var sessao = new InferenceSession(caminho, cpu);
        if (Motor != "DirectML") Motor = "CPU";
        return sessao;
    }

    public void Dispose()
    {
        if (_recorte.IsValueCreated) _recorte.Value?.Dispose();
        if (_ampliacao.IsValueCreated) _ampliacao.Value?.Dispose();
    }
}
