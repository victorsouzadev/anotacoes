using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EditorImagens.Desktop;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api;
using Notas.Api.Services.Imagens;
using Xunit;

namespace EditorImagens.Ia.Tests;

public class ArquivoProjetoTests
{
    [Fact]
    public void Grava_e_le_o_mesmo_projeto()
    {
        var caminho = Path.Combine(Path.GetTempPath(), $"teste-{Guid.NewGuid():N}.edimg");
        try
        {
            var dados = JsonSerializer.Serialize(new { version = 3, images = new[] { new { name = "ção.png", original = "data:image/png;base64,AAAA" } } });
            ArquivoProjeto.Gravar(caminho, "Topo da Ana", dados, "1.0.0");
            var lido = ArquivoProjeto.Ler(caminho);
            Assert.Equal("Topo da Ana", lido.Nome);
            Assert.Equal(dados, lido.Dados);
            Assert.False(File.Exists(caminho + ".salvando"));

            // regravar por cima troca o conteúdo
            ArquivoProjeto.Gravar(caminho, "Outro", "{}", "1.0.0");
            Assert.Equal("{}", ArquivoProjeto.Ler(caminho).Dados);

            using var zip = ZipFile.OpenRead(caminho);
            Assert.Equal(["projeto.json", "dados.json"], zip.Entries.Select(e => e.FullName));
        }
        finally
        {
            File.Delete(caminho);
        }
    }

    [Fact]
    public void Arquivo_que_nao_e_projeto_falha_com_erro_de_formato()
    {
        var caminho = Path.Combine(Path.GetTempPath(), $"teste-{Guid.NewGuid():N}.edimg");
        try
        {
            File.WriteAllText(caminho, "não sou zip");
            Assert.ThrowsAny<InvalidDataException>(() => ArquivoProjeto.Ler(caminho));
        }
        finally
        {
            File.Delete(caminho);
        }
    }

    [Theory]
    [InlineData("Topo: Ana/5 anos?", "Topo- Ana-5 anos-")]
    [InlineData("   ", "projeto")]
    [InlineData("fim.", "fim")]
    public void Nome_de_arquivo_sem_caracteres_proibidos(string nome, string esperado)
    {
        // no Linux só "/" é proibido; os demais valem no Windows — confere o que vale aqui
        var r = ArquivoProjeto.NomeDeArquivo(nome);
        Assert.DoesNotContain(r, c => Path.GetInvalidFileNameChars().Contains(c));
        if (OperatingSystem.IsWindows()) Assert.Equal(esperado, r);
        else Assert.False(string.IsNullOrWhiteSpace(r));
    }
}

/// <summary>A API hospedada como no programa desktop: login local e IA local no lugar do serviço externo.</summary>
public class HospedagemDesktopTests
{
    private static async Task<(WebApplication app, HttpClient http)> Subir(string pastaModelos)
    {
        var dir = Directory.CreateTempSubdirectory("editor-desktop-").FullName;
        var chave = "chave-de-teste";
        var app = NotasApp.Build(["--urls", "http://127.0.0.1:0"], new NotasAppOptions
        {
            Desktop = true,
            ConfigureBuilder = b => b.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JWT_SECRET"] = new string('x', 48),
                ["ConnectionStrings:Db"] = $"Data Source={Path.Combine(dir, "editor.db")}",
                ["Desktop:Key"] = chave,
            }),
            ConfigureServices = s =>
            {
                s.AddSingleton(new ModelosLocais(pastaModelos, tentarGpu: false));
                s.AddScoped<IUpscalerFactory, IaLocalFactory>();
            },
        });
        await app.StartAsync();
        var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        var login = new HttpRequestMessage(HttpMethod.Post, "/api/auth/local");
        login.Headers.Add("X-Desktop-Key", chave);
        var res = await http.SendAsync(login);
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (app, http);
    }

    [Fact]
    public async Task Sem_modelos_a_ia_fica_desligada_e_sem_luz()
    {
        var (app, http) = await Subir(Directory.CreateTempSubdirectory("vazio-").FullName);
        await using var _ = app;
        var status = await http.GetFromJsonAsync<JsonElement>("/api/imagens/upscale");
        Assert.False(status.GetProperty("disponivel").GetBoolean());
        Assert.False(status.GetProperty("luz").GetBoolean());
    }

    [Fact]
    public async Task Com_modelos_remove_fundo_no_proprio_pc()
    {
        var pasta = Environment.GetEnvironmentVariable("EDITOR_MODELOS");
        if (pasta is null || !File.Exists(Path.Combine(pasta, ModelosLocais.ArquivoRecorte))) return;
        var (app, http) = await Subir(pasta);
        await using var _ = app;
        var status = await http.GetFromJsonAsync<JsonElement>("/api/imagens/upscale");
        Assert.True(status.GetProperty("disponivel").GetBoolean());

        using var bmp = new SkiaSharp.SKBitmap(64, 48);
        bmp.Erase(SkiaSharp.SKColors.OrangeRed);
        var png = Convert.ToBase64String(SkiaSharp.SKImage.FromBitmap(bmp).Encode(SkiaSharp.SKEncodedImageFormat.Png, 100).ToArray());
        var res = await http.PostAsJsonAsync("/api/imagens/remover-fundo", new { imagem = "data:image/png;base64," + png });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var imagem = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("imagem").GetString()!;
        Assert.StartsWith("data:image/png;base64,", imagem);
    }
}
