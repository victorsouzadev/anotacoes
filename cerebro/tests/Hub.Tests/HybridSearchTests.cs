using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Hub.Core;
using Hub.Data;
using Hub.Index;
using Hub.Pipeline;
using Hub.Vault;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Hub.Tests;

/// <summary>Busca semântica (spec 027).</summary>
public sealed class HybridSearchTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cerebro-vetores-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    [Fact]
    public void Rrf_premia_o_que_aparece_nas_duas_listas()
    {
        var r = HybridRanker.Rrf([["a", "b", "c"], ["c", "d"]]);
        Assert.Equal("c", r[0].Id);
        // b e d empatam (1/62 cada): desempate alfabético, para o resultado ser estável.
        Assert.Equal(new[] { "c", "a", "b", "d" }, r.Select(x => x.Id).ToArray());
    }

    [Fact]
    public void Cosseno_de_vetores_normalizados()
    {
        var a = HybridRanker.Normalizar([3, 4]);
        Assert.Equal(1, HybridRanker.Cosseno(a, a), 6);
        Assert.Equal(0, HybridRanker.Cosseno(HybridRanker.Normalizar([1, 0]), HybridRanker.Normalizar([0, 2])), 6);
        var bytes = VectorIndex.ParaBytes(a);
        Assert.Equal(a, VectorIndex.DeBytes(bytes));
    }

    [Fact]
    public void Vinte_mil_trechos_de_1536_dimensoes_cabem_no_orcamento_de_latencia()
    {
        var rnd = new Random(42);
        float[] Vetor() => HybridRanker.Normalizar(Enumerable.Range(0, 1536).Select(_ => (float)rnd.NextDouble() - 0.5f).ToArray());
        var base_ = Enumerable.Range(0, 20_000).Select(_ => Vetor()).ToArray();
        var q = Vetor();
        HybridRanker.Cosseno(q, base_[0]);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var melhor = base_.Select(v => HybridRanker.Cosseno(q, v)).Max();
        sw.Stop();
        Assert.True(melhor > 0);
        // Meta da spec: < 300 ms. O limite do teste é folgado para não falhar em CI lento.
        Assert.True(sw.ElapsedMilliseconds < 1500, $"{sw.ElapsedMilliseconds} ms");
        Console.WriteLine($"cosseno em 20 mil trechos: {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public void Trechos_cortam_por_paragrafo_e_levam_o_titulo()
    {
        var corpo = string.Join("\n\n", Enumerable.Range(0, 5).Select(i => new string((char)('a' + i), 500)));
        var t = HybridRanker.Trechos("Título", corpo, 1200);
        Assert.Equal(3, t.Count);
        Assert.All(t, x => Assert.StartsWith("Título\n\n", x));
        Assert.Single(HybridRanker.Trechos("Só título", ""));
    }

    private sealed class Conceitos : HttpMessageHandler
    {
        public int Chamadas;
        public int Textos;
        public bool Falhar;
        private static readonly string[][] Dimensoes =
        [
            ["carro", "gol", "revisão", "oficina", "automóvel", "pneu"],
            ["bolo", "receita", "forno", "farinha"],
            ["reunião", "projeto", "prazo"],
        ];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Chamadas++;
            if (Falhar) return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("{}") };
            var entrada = JsonNode.Parse(await request.Content!.ReadAsStringAsync(ct))!["input"]!.AsArray();
            Textos += entrada.Count;
            var data = new JsonArray();
            for (var i = 0; i < entrada.Count; i++)
            {
                var t = entrada[i]!.GetValue<string>().ToLowerInvariant();
                var v = new JsonArray(Dimensoes.Select(d => (JsonNode)JsonValue.Create(d.Count(t.Contains) + 0.01)).ToArray());
                data.Add(new JsonObject { ["index"] = i, ["embedding"] = v });
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(new JsonObject { ["data"] = data }.ToJsonString(), Encoding.UTF8, "application/json") };
        }
    }

    private sealed class Fabrica(HttpMessageHandler h) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(h, disposeHandler: false);
    }

    private (NoteIndex Index, VectorIndex Vetores, HybridSearch Busca, Embeddings Emb, Conceitos Http, string Vault) Montar()
    {
        var o = new HubOptions { DataPath = Path.Combine(_dir, "hub"), VaultPath = Path.Combine(_dir, "vault") };
        o.Embeddings.ApiKey = "sk-teste";
        o.Web.JwtSecret = "segredo-jwt-de-teste-com-32-bytes!!";
        var opts = Options.Create(o);
        var vault = Path.Combine(_dir, "vault");
        Directory.CreateDirectory(Path.Combine(vault, "30-Recursos"));
        File.WriteAllText(Path.Combine(vault, "30-Recursos", "Revisão do Gol.md"), "# Revisão do Gol\n\nOficina trocou o pneu e fez a revisão: R$ 850.\n");
        File.WriteAllText(Path.Combine(vault, "30-Recursos", "Bolo de cenoura.md"), "# Bolo de cenoura\n\nReceita: farinha, forno a 180 graus.\n");
        File.WriteAllText(Path.Combine(vault, "30-Recursos", "Reunião.md"), "# Reunião\n\nProjeto novo, prazo em março.\n");
        var store = new VaultStore(opts, NullLogger<VaultStore>.Instance);
        var index = new NoteIndex(opts, store, NullLogger<NoteIndex>.Instance);
        var db = new HubDb(opts);
        var http = new Conceitos();
        var emb = new Embeddings(new Fabrica(http), opts, new TranscriptionSettings(db, opts, new SecretBox(opts)), db);
        var vetores = new VectorIndex(opts, index, store, emb, NullLogger<VectorIndex>.Instance);
        return (index, vetores, new HybridSearch(index, vetores, emb, NullLogger<HybridSearch>.Instance), emb, http, vault);
    }

    [Fact]
    public async Task Desligada_a_busca_e_so_por_palavras_e_nada_e_enviado()
    {
        var (index, vetores, busca, _, http, _) = Montar();
        await index.FullScanAsync();
        Assert.Equal(0, await vetores.SincronizarAsync(CancellationToken.None));
        Assert.Empty(await busca.SearchAsync("gastos com o automóvel", null, 5, null, CancellationToken.None));
        Assert.Equal(0, http.Chamadas);
    }

    [Fact]
    public async Task Ligada_acha_pelo_sentido_e_reindexa_so_o_que_mudou()
    {
        var (index, vetores, busca, emb, http, vault) = Montar();
        await index.FullScanAsync();
        emb.SetLigado(true);
        Assert.Equal(3, await vetores.SincronizarAsync(CancellationToken.None));
        Assert.Equal((3, 3), vetores.Progresso());

        var hits = await busca.SearchAsync("gastos com o automóvel", null, 5, null, CancellationToken.None);
        Assert.Equal("30-Recursos/Revisão do Gol.md", hits[0].Path);
        Assert.Equal("Revisão do Gol", hits[0].Title);

        var textosAntes = http.Textos;
        Assert.Equal(0, await vetores.SincronizarAsync(CancellationToken.None));
        Assert.Equal(textosAntes, http.Textos);

        File.AppendAllText(Path.Combine(vault, "30-Recursos", "Bolo de cenoura.md"), "\nCobertura de chocolate.\n");
        await index.FullScanAsync();
        Assert.Equal(1, await vetores.SincronizarAsync(CancellationToken.None));

        File.Delete(Path.Combine(vault, "30-Recursos", "Reunião.md"));
        await index.FullScanAsync();
        await vetores.SincronizarAsync(CancellationToken.None);
        Assert.Equal((2, 2), vetores.Progresso());
    }

    [Fact]
    public async Task Modo_palavras_ignora_vetores_e_falha_do_provedor_cai_para_palavras()
    {
        var (index, vetores, busca, emb, http, _) = Montar();
        await index.FullScanAsync();
        emb.SetLigado(true);
        await vetores.SincronizarAsync(CancellationToken.None);

        var palavras = await busca.SearchAsync("receita", null, 5, "palavras", CancellationToken.None);
        Assert.Equal("30-Recursos/Bolo de cenoura.md", Assert.Single(palavras).Path);

        http.Falhar = true;
        var semVetor = await busca.SearchAsync("receita", null, 5, null, CancellationToken.None);
        Assert.Equal("30-Recursos/Bolo de cenoura.md", Assert.Single(semVetor).Path);
    }
}
