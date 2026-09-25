using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using SkiaSharp;

namespace EditorImagens.Ia;

/// <summary>
/// Remoção de fundo com o BiRefNet (licença MIT): a foto entra em 1024×1024,
/// normalizada como no ImageNet, e sai um mapa de "é objeto" em logit. O
/// mapa volta ao tamanho da foto e vira o canal alfa — a cor é sempre a da
/// foto original, na resolução cheia.
/// </summary>
public static class Recorte
{
    public const int Lado = 1024;
    private static readonly float[] Media = [0.485f, 0.456f, 0.406f];
    private static readonly float[] Desvio = [0.229f, 0.224f, 0.225f];

    /// <summary>Tensor de entrada [1,3,1024,1024] a partir da foto.</summary>
    public static DenseTensor<float> Entrada(SKBitmap foto)
    {
        using var q = Imagem.Redimensionar(foto, Lado, Lado);
        var t = new DenseTensor<float>([1, 3, Lado, Lado]);
        var px = q.GetPixelSpan();
        for (int y = 0; y < Lado; y++)
        {
            for (int x = 0; x < Lado; x++)
            {
                int o = (y * Lado + x) * 4;
                for (int c = 0; c < 3; c++) t[0, c, y, x] = (px[o + c] / 255f - Media[c]) / Desvio[c];
            }
        }
        return t;
    }

    /// <summary>Aplica o mapa (logits LxL) como alfa da foto, no tamanho dela.</summary>
    public static SKBitmap AplicarMascara(SKBitmap foto, ReadOnlySpan<float> logits, int lado)
    {
        using var mascara = new SKBitmap(new SKImageInfo(lado, lado, SKColorType.Gray8, SKAlphaType.Opaque));
        var m = mascara.GetPixelSpan();
        for (int i = 0; i < lado * lado; i++) m[i] = (byte)Math.Round(255f / (1f + MathF.Exp(-logits[i])));
        using var grande = new SKBitmap(new SKImageInfo(foto.Width, foto.Height, SKColorType.Gray8, SKAlphaType.Opaque));
        mascara.ScalePixels(grande, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.None));
        var saida = foto.Copy();
        var dst = saida.GetPixelSpan();
        var a = grande.GetPixelSpan();
        for (int i = 0; i < foto.Width * foto.Height; i++)
        {
            // multiplica pelo alfa que a foto já tinha (PNG já recortado continua recortado)
            dst[i * 4 + 3] = (byte)(dst[i * 4 + 3] * a[i] / 255);
        }
        return saida;
    }

    public static byte[] Executar(InferenceSession sessao, byte[] imagem)
    {
        using var foto = Imagem.Ler(imagem);
        var entrada = Entrada(foto);
        var nome = sessao.InputMetadata.Keys.First();
        using var res = sessao.Run([NamedOnnxValue.CreateFromTensor(nome, entrada)]);
        var saida = res.First().AsTensor<float>();
        var lado = saida.Dimensions[^1];
        var dados = saida is DenseTensor<float> d ? d.Buffer.Span : saida.ToArray();
        using var recortada = AplicarMascara(foto, dados, lado);
        return Imagem.Png(recortada);
    }
}
