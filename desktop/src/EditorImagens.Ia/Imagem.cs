using SkiaSharp;

namespace EditorImagens.Ia;

/// <summary>Leitura, escrita e redimensionamento de imagem (SkiaSharp).</summary>
public static class Imagem
{
    public static SKBitmap Ler(byte[] bytes)
    {
        var bmp = SKBitmap.Decode(bytes) ?? throw new InvalidDataException("Imagem ilegível.");
        // tudo em RGBA sem pré-multiplicar, pra ler e escrever os canais direto
        if (bmp.ColorType == SKColorType.Rgba8888 && bmp.AlphaType == SKAlphaType.Unpremul) return bmp;
        var conv = new SKBitmap(new SKImageInfo(bmp.Width, bmp.Height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        using (var canvas = new SKCanvas(conv))
        {
            canvas.Clear(SKColors.Transparent);
            canvas.DrawBitmap(bmp, 0, 0);
        }
        bmp.Dispose();
        return conv;
    }

    public static SKBitmap Redimensionar(SKBitmap src, int w, int h)
    {
        var dst = new SKBitmap(new SKImageInfo(w, h, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        src.ScalePixels(dst, new SKSamplingOptions(SKCubicResampler.Mitchell));
        return dst;
    }

    public static byte[] Png(SKBitmap bmp)
    {
        using var img = SKImage.FromBitmap(bmp);
        using var data = img.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }
}
