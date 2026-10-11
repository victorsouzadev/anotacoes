using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Services.Financas;
using Xunit;

namespace Notas.Api.Tests;

// Fila de categorização: o que está em "Outros" sem confirmação, agrupado por loja.
public class CategorizacaoTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;
    private string _userId = "";

    public CategorizacaoTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        var res = await _client.PostAsJsonAsync("/api/auth/register",
            new { email = $"cat_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", corpo.GetProperty("accessToken").GetString());
        _userId = corpo.GetProperty("user").GetProperty("id").GetString()!;
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task Lancar(string descricao, decimal valor, Categoria categoria = Categoria.Outros, int dia = 5)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Transacoes.Add(new Transacao
        {
            UserId = _userId, Descricao = descricao, Valor = valor, Tipo = TipoTransacao.Despesa,
            Categoria = categoria, Data = new DateOnly(2026, 9, dia), Status = StatusTransacao.Confirmado,
        });
        await db.SaveChangesAsync();
    }

    private Task<JsonElement> Fila() =>
        _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes/categorizar?ano=2026&mes=9");

    [Fact]
    public async Task Agrupa_por_loja_sugere_e_some_da_fila_ao_categorizar()
    {
        await Lancar("POSTO SHELL MARABA PA", 200, dia: 2);
        await Lancar("POSTO SHELL MARABA PA", 150, dia: 9);
        await Lancar("Pix para Fulano de Tal", 50);
        await Lancar("LIDER MARABA BRA", 80, Categoria.Alimentacao);

        var fila = await Fila();
        Assert.Equal(4, fila.GetProperty("total").GetInt32());
        Assert.Equal(3, fila.GetProperty("pendentes").GetInt32());
        Assert.Equal(25m, fila.GetProperty("percentual").GetDecimal());

        var posto = fila.GetProperty("grupos")[0];
        Assert.Equal(2, posto.GetProperty("quantidade").GetInt32());
        Assert.Equal(350m, posto.GetProperty("total").GetDecimal());
        Assert.Equal("Transporte", posto.GetProperty("sugestao").GetString());

        var ids = posto.GetProperty("ids").EnumerateArray().Select(i => i.GetString()).ToList();
        (await _client.PatchAsJsonAsync("/api/financas/transacoes/lote", new { ids, categoria = "Transporte" }))
            .EnsureSuccessStatusCode();

        fila = await Fila();
        Assert.Equal(1, fila.GetProperty("pendentes").GetInt32());

        // "É Outros mesmo" confirma e tira da fila sem mudar a categoria.
        var pix = fila.GetProperty("grupos")[0].GetProperty("ids").EnumerateArray().Select(i => i.GetString()).ToList();
        (await _client.PatchAsJsonAsync("/api/financas/transacoes/lote", new { ids = pix, categoria = "Outros" }))
            .EnsureSuccessStatusCode();
        fila = await Fila();
        Assert.Equal(0, fila.GetProperty("pendentes").GetInt32());
        Assert.Equal(100m, fila.GetProperty("percentual").GetDecimal());

        // E a regra aprendida no lote vale para a próxima compra no mesmo posto.
        var nova = await _client.PostAsJsonAsync("/api/financas/transacoes",
            new { texto = "POSTO SHELL MARABA 90 reais hoje" });
        nova.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Sugere_pelo_que_ja_foi_categorizado_antes()
    {
        await Lancar("EMPORIO DOS PARAFUSO MARABA", 30, Categoria.Moradia, dia: 1);
        await Lancar("EMPORIO DOS PARAFUSO MARABA", 40);

        var grupo = (await Fila()).GetProperty("grupos")[0];
        Assert.Equal("Moradia", grupo.GetProperty("sugestao").GetString());
        Assert.Contains("já categorizou", grupo.GetProperty("motivo").GetString());
    }

    [Theory]
    [InlineData("CARRO CHEFE SUPERMERCA MARABA PA", Categoria.Alimentacao)]
    [InlineData("DROGASIL 1234", Categoria.Saude)]
    [InlineData("Mercadolivre*Mercadol 3/10", Categoria.Compras)]
    [InlineData("NETFLIX.COM", Categoria.ContasServicos)]
    [InlineData("Pix para Fulano", null)]
    public void Reconhece_o_estabelecimento_pelo_nome(string descricao, Categoria? esperada) =>
        Assert.Equal(esperada, Categorizacao.PorNomeDoEstabelecimento(descricao));

    [Fact]
    public async Task Pagamento_de_fatura_sugere_tirar_dos_totais_e_despesa_nunca_vira_salario()
    {
        await Lancar("Pagamento de fatura", 5000);
        await Lancar("Pagamento de pix", 40);

        var grupos = (await Fila()).GetProperty("grupos").EnumerateArray().ToList();
        var fatura = grupos.Single(g => g.GetProperty("descricao").GetString() == "Pagamento de fatura");
        Assert.True(fatura.GetProperty("sugerirForaDosTotais").GetBoolean());
        Assert.Equal(JsonValueKind.Null, fatura.GetProperty("sugestao").ValueKind);
        var pix = grupos.Single(g => g.GetProperty("descricao").GetString() == "Pagamento de pix");
        Assert.NotEqual("Salario", pix.GetProperty("sugestao").ToString());
    }

    [Fact]
    public void Pix_agrupa_pelo_destinatario()
    {
        var a = RegrasCategoria.ChaveDeDescricao("Pix para NU PAGAMENTOS - IP · CPF •••.042-75");
        var b = RegrasCategoria.ChaveDeDescricao("Pix para NU PAGAMENTOS - IP · CPF •••.542-15");
        Assert.NotEqual(a, b);
        Assert.Equal(a, RegrasCategoria.ChaveDeDescricao("PIX PARA NU PAGAMENTOS - IP · CPF •••.042-75"));
        // Loja comum continua pelas três primeiras palavras.
        Assert.Equal("LIDER MARABA MARABA", RegrasCategoria.ChaveDeDescricao("Lider Maraba   MARABA BRA 2/3"));
    }
}
