using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using SkiaSharp;

namespace EditorImagens.Ia;

/// <summary>
/// Ampliação com o Real-ESRGAN x4plus (licença BSD-3). O modelo recebe
/// ladrilhos de tamanho fixo (128×128, RGB de 0 a 1) e devolve cada um 4×
/// maior. A foto é percorrida em ladrilhos que se sobrepõem um pouco, e de cada
/// um se aproveita só o miolo — a borda de um ladrilho é onde o modelo vê
/// menos contexto e erra mais. Pra 2×, amplia 4× e reduz pela metade.
/// </summary>
public static class Ampliacao
{
    public const int Fator = 4;
    /// <summary>Quanto do contorno de cada ladrilho é descartado, em px de entrada.</summary>
    public const int Margem = 8;

    /// <summary>Executa um ladrilho: RGB CHW de 0 a 1 entra, 4× maior sai.</summary>
    public delegate float[] Executor(float[] ladrilho, int lado);

    /// <summary>
    /// Amplia a foto inteira 4× com o executor dado (o modelo, ou um falso nos
    /// testes). Alfa, se houver, é ampliado à parte com filtro comum.
    /// </summary>
    public static SKBitmap Ampliar(SKBitmap foto, int lado, Executor executar)
    {
        int W = foto.Width, H = foto.Height;
        var saida = new SKBitmap(new SKImageInfo(W * Fator, H * Fator, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        var src = foto.GetPixelSpan().ToArray();
        var dst = saida.GetPixelSpan();
        int passo = Math.Max(1, lado - 2 * Margem);
        var entrada = new float[3 * lado * lado];
        for (int ty = 0; ty < H; ty += passo)
        {
            for (int tx = 0; tx < W; tx += passo)
            {
                // janela de entrada: começa uma margem antes, sem sair da foto
                int x0 = Math.Clamp(tx - Margem, 0, Math.Max(0, W - lado));
                int y0 = Math.Clamp(ty - Margem, 0, Math.Max(0, H - lado));
                for (int y = 0; y < lado; y++)
                {
                    int sy = Math.Min(H - 1, y0 + y);
                    for (int x = 0; x < lado; x++)
                    {
                        int sx = Math.Min(W - 1, x0 + x);
                        int o = (sy * W + sx) * 4;
                        for (int c = 0; c < 3; c++) entrada[(c * lado + y) * lado + x] = src[o + c] / 255f;
                    }
                }
                var r = executar(entrada, lado);
                int lo = lado * Fator;
                // região que este ladrilho "é dono": [tx, tx+passo) × [ty, ty+passo)
                int ox1 = Math.Min(W, tx + passo), oy1 = Math.Min(H, ty + passo);
                for (int y = ty * Fator; y < oy1 * Fator; y++)
                {
                    int ly = y - y0 * Fator;
                    if (ly < 0 || ly >= lo) continue;
                    for (int x = tx * Fator; x < ox1 * Fator; x++)
                    {
                        int lx = x - x0 * Fator;
                        if (lx < 0 || lx >= lo) continue;
                        int d = (y * W * Fator + x) * 4;
                        for (int c = 0; c < 3; c++)
                        {
                            float v = r[(c * lo + ly) * lo + lx];
                            dst[d + c] = (byte)Math.Clamp((int)MathF.Round(v * 255f), 0, 255);
                        }
                        dst[d + 3] = 255;
                    }
                }
            }
        }
        // transparência: a do original, ampliada com filtro comum
        bool temAlfa = false;
        for (int i = 3; i < src.Length; i += 4) if (src[i] < 255) { temAlfa = true; break; }
        if (temAlfa)
        {
            using var alfa = Imagem.Redimensionar(foto, W * Fator, H * Fator);
            var a = alfa.GetPixelSpan();
            for (int i = 3; i < dst.Length; i += 4) dst[i] = a[i];
        }
        return saida;
    }

    public static byte[] Executar(InferenceSession sessao, byte[] imagem, int escala)
    {
        using var foto = Imagem.Ler(imagem);
        var meta = sessao.InputMetadata.First();
        int lado = meta.Value.Dimensions[^1] > 0 ? meta.Value.Dimensions[^1] : 128;
        using var x4 = Ampliar(foto, lado, (ladrilho, l) =>
        {
            var t = new DenseTensor<float>(ladrilho, [1, 3, l, l]);
            using var res = sessao.Run([NamedOnnxValue.CreateFromTensor(meta.Key, t)]);
            return res.First().AsTensor<float>().ToArray();
        });
        if (escala >= 4) return Imagem.Png(x4);
        using var x2 = Imagem.Redimensionar(x4, foto.Width * 2, foto.Height * 2);
        return Imagem.Png(x2);
    }
}
