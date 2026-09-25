using EditorImagens.Ia;
using SkiaSharp;
using Xunit;

namespace EditorImagens.Ia.Tests;

public class AmpliacaoTests
{
    private static SKBitmap Gradiente(int w, int h)
    {
        var b = new SKBitmap(new SKImageInfo(w, h, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        var p = b.GetPixelSpan();
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int o = (y * w + x) * 4;
                p[o] = (byte)(x * 7 % 256); p[o + 1] = (byte)(y * 5 % 256); p[o + 2] = (byte)((x + y) % 256); p[o + 3] = 255;
            }
        return b;
    }

    /// <summary>Modelo falso: vizinho mais próximo 4×.</summary>
    private static float[] Vizinho(float[] entrada, int lado)
    {
        int lo = lado * 4;
        var r = new float[3 * lo * lo];
        for (int c = 0; c < 3; c++)
            for (int y = 0; y < lo; y++)
                for (int x = 0; x < lo; x++)
                    r[(c * lo + y) * lo + x] = entrada[(c * lado + y / 4) * lado + x / 4];
        return r;
    }

    [Theory]
    [InlineData(300, 200)]
    [InlineData(128, 128)]
    [InlineData(70, 45)]
    [InlineData(257, 129)]
    public void Ladrilhos_montam_a_foto_inteira_sem_costura(int w, int h)
    {
        using var foto = Gradiente(w, h);
        using var x4 = Ampliacao.Ampliar(foto, 128, Vizinho);
        Assert.Equal(w * 4, x4.Width);
        Assert.Equal(h * 4, x4.Height);
        var s = foto.GetPixelSpan();
        var d = x4.GetPixelSpan();
        for (int y = 0; y < h * 4; y++)
            for (int x = 0; x < w * 4; x++)
            {
                int o = (y * w * 4 + x) * 4, i = ((y / 4) * w + x / 4) * 4;
                if (d[o] != s[i] || d[o + 1] != s[i + 1] || d[o + 2] != s[i + 2])
                    Assert.Fail($"pixel ({x},{y}) diferente");
            }
    }
}

public class RecorteTests
{
    [Fact]
    public void Mascara_vira_alfa_no_tamanho_da_foto_e_respeita_o_alfa_que_ja_havia()
    {
        using var foto = new SKBitmap(new SKImageInfo(40, 20, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        var p = foto.GetPixelSpan();
        for (int i = 0; i < 40 * 20; i++) { p[i * 4] = 200; p[i * 4 + 3] = 255; }
        p[3] = 100; // um pixel já meio transparente
        // metade esquerda objeto (logit alto), direita fundo (logit baixo)
        const int L = 8;
        var logits = new float[L * L];
        for (int y = 0; y < L; y++) for (int x = 0; x < L; x++) logits[y * L + x] = x < L / 2 ? 20f : -20f;
        using var r = Recorte.AplicarMascara(foto, logits, L);
        var d = r.GetPixelSpan();
        Assert.Equal(200, d[(10 * 40 + 5) * 4]);
        Assert.Equal(255, d[(10 * 40 + 5) * 4 + 3]);
        Assert.Equal(0, d[(10 * 40 + 35) * 4 + 3]);
        Assert.Equal(100, d[3]);
    }
}

/// <summary>Os modelos de verdade, quando estão na máquina (pasta em EDITOR_MODELOS).</summary>
public class ModelosReaisTests
{
    private static readonly string? Pasta = Environment.GetEnvironmentVariable("EDITOR_MODELOS");

    private static byte[] FotoComCirculo()
    {
        using var b = new SKBitmap(new SKImageInfo(400, 300, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        using (var c = new SKCanvas(b))
        {
            using var fundo = new SKPaint { Shader = SKShader.CreateLinearGradient(new(0, 0), new(400, 300), [new SKColor(240, 190, 120), new SKColor(60, 90, 130)], SKShaderTileMode.Clamp) };
            c.DrawRect(0, 0, 400, 300, fundo);
            c.DrawCircle(200, 150, 90, new SKPaint { Color = SKColors.White, IsAntialias = true });
        }
        return Imagem.Png(b);
    }

    [Fact]
    public void Recorte_real_separa_o_objeto_do_fundo()
    {
        if (Pasta is null || !File.Exists(Path.Combine(Pasta, ModelosLocais.ArquivoRecorte))) return;
        using var modelos = new ModelosLocais(Pasta, tentarGpu: false);
        var png = Recorte.Executar(modelos.Recorte!, FotoComCirculo());
        using var r = Imagem.Ler(png);
        Assert.Equal(400, r.Width);
        Assert.True(r.GetPixel(200, 150).Alpha > 200, "o círculo deveria ficar");
        Assert.True(r.GetPixel(10, 10).Alpha < 60, "o fundo deveria sair");
        Assert.Equal("CPU", modelos.Motor);
    }

    [Fact]
    public void Ampliacao_real_dobra_e_quadruplica()
    {
        if (Pasta is null || !File.Exists(Path.Combine(Pasta, ModelosLocais.ArquivoAmpliacao))) return;
        using var modelos = new ModelosLocais(Pasta, tentarGpu: false);
        using var x2 = Imagem.Ler(Ampliacao.Executar(modelos.Ampliacao!, FotoComCirculo(), 2));
        Assert.Equal((800, 600), (x2.Width, x2.Height));
        // o miolo do círculo continua branco depois de ampliado
        var c = x2.GetPixel(400, 300);
        Assert.True(c.Red > 230 && c.Green > 230 && c.Blue > 230);
    }
}
