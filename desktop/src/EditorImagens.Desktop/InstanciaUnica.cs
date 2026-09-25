using System.IO;
using System.IO.Pipes;

namespace EditorImagens.Desktop;

/// <summary>Garante uma instância por usuário. As seguintes só entregam o
/// arquivo que deviam abrir, por um pipe nomeado, e saem.</summary>
public sealed class InstanciaUnica : IDisposable
{
    private static readonly string Nome = "EditorImagens-" + Environment.UserName;
    private readonly Mutex mutex;
    private readonly CancellationTokenSource fim = new();

    public bool Primeira { get; }

    /// <summary>Um caminho (ou vazio: só trazer a janela pra frente).</summary>
    public event Action<string>? Recebido;

    public InstanciaUnica()
    {
        mutex = new Mutex(true, "Local\\" + Nome, out var criado);
        Primeira = criado;
    }

    public void Escutar() => _ = Task.Run(async () =>
    {
        while (!fim.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(Nome, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await pipe.WaitForConnectionAsync(fim.Token);
                using var leitor = new StreamReader(pipe);
                var caminho = await leitor.ReadToEndAsync(fim.Token);
                Recebido?.Invoke(caminho.Trim());
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (IOException)
            {
                // cliente caiu no meio: espera o próximo
            }
        }
    });

    public void Encaminhar(string caminho)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", Nome, PipeDirection.Out);
            pipe.Connect(3000);
            using var escritor = new StreamWriter(pipe);
            escritor.Write(caminho);
        }
        catch (Exception ex) when (ex is TimeoutException or IOException)
        {
            // a outra instância está fechando; nada a fazer
        }
    }

    public void Dispose()
    {
        fim.Cancel();
        if (Primeira) mutex.ReleaseMutex();
        mutex.Dispose();
    }
}
