using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Notas.Api.Data;
using Notas.Api.Services.Financas.Auvp;
using Xunit;

namespace Notas.Api.Tests;

// Importação da AUVP ponta a ponta, com a API da AUVP trocada por um falso.
public class AuvpImportacaoTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private readonly AuvpFalso _auvp = new();
    private HttpClient _client = null!;

    public AuvpImportacaoTests(TasksApiFactory factory) => _factory = factory;

    public async Task InitializeAsync()
    {
        var app = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddScoped<IAuvpCliente>(_ => _auvp)));
        _client = app.CreateClient();
        var res = await _client.PostAsJsonAsync("/api/auth/register",
            new { email = $"auvp_{Guid.NewGuid():N}@example.com", password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        _client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private static AuvpTransacao Item(long id, decimal valor, int? categoria = 78, bool ignorada = false,
        bool transferencia = false, string subtipo = "CREDIT_CARD") => new(
        id, valor, valor > 0 ? "CREDIT" : "DEBIT", new DateTimeOffset(2026, 10, 5, 3, 0, 0, TimeSpan.Zero),
        $"Compra {id}", categoria, null, ignorada, transferencia, new AuvpConta("Cartão X", subtipo));

    private async Task CadastrarChave()
    {
        var res = await _client.PutAsJsonAsync("/api/financas/auvp", new { chave = "auvp_chave_teste_9876" });
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("••••••••9876", corpo.GetProperty("chaveMascarada").GetString());
        Assert.DoesNotContain("auvp_chave", corpo.ToString());
    }

    private async Task<JsonElement> Sincronizar()
    {
        var res = await _client.PostAsJsonAsync("/api/financas/auvp/sincronizar", new { });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Sem_chave_nao_sincroniza()
    {
        var res = await _client.PostAsJsonAsync("/api/financas/auvp/sincronizar", new { });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Importa_todas_as_paginas_e_nao_duplica_na_segunda_vez()
    {
        _auvp.Paginas = [[Item(1, -45.9m), Item(2, 3000m, categoria: 2, subtipo: "CHECKING_ACCOUNT")], [Item(3, -12m)]];
        await CadastrarChave();

        var primeira = await Sincronizar();
        Assert.Equal(3, primeira.GetProperty("importadas").GetInt32());
        Assert.Equal("auvp_chave_teste_9876", _auvp.UltimaChave);

        var segunda = await Sincronizar();
        Assert.Equal(0, segunda.GetProperty("importadas").GetInt32());
        Assert.Equal(3, segunda.GetProperty("jaExistentes").GetInt32());

        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes");
        var itens = lista.ValueKind == JsonValueKind.Array ? lista : lista.GetProperty("itens");
        Assert.Equal(3, itens.GetArrayLength());

        var salario = itens.EnumerateArray().Single(t => t.GetProperty("descricao").GetString() == "Compra 2");
        Assert.Equal("receita", salario.GetProperty("tipo").GetString());
        Assert.Equal("Salario", salario.GetProperty("categoria").GetString());
        Assert.Equal(3000m, salario.GetProperty("valor").GetDecimal());

        var mercado = itens.EnumerateArray().Single(t => t.GetProperty("descricao").GetString() == "Compra 1");
        Assert.Equal("despesa", mercado.GetProperty("tipo").GetString());
        Assert.Equal(45.9m, mercado.GetProperty("valor").GetDecimal());
        Assert.Equal("Alimentacao", mercado.GetProperty("categoria").GetString());
        Assert.Equal("Cartao", mercado.GetProperty("formaPagamento").GetString());
        Assert.Equal("2026-10-05", mercado.GetProperty("data").GetString());
        Assert.Equal("confirmado", mercado.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Ignoradas_e_transferencias_entram_fora_dos_totais()
    {
        _auvp.Paginas = [[Item(10, -100m, ignorada: true), Item(11, -500m, categoria: 23, transferencia: true),
            Item(12, -30m)]];
        await CadastrarChave();

        var r = await Sincronizar();
        Assert.Equal(3, r.GetProperty("importadas").GetInt32());
        Assert.Equal(2, r.GetProperty("foraDosTotais").GetInt32());

        // Aparecem na lista, mas o mês soma só a compra de verdade — como no painel da AUVP.
        var lista = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes?ano=2026&mes=10");
        var itens = lista.ValueKind == JsonValueKind.Array ? lista : lista.GetProperty("itens");
        Assert.Equal(3, itens.GetArrayLength());
        Assert.Equal(2, itens.EnumerateArray().Count(t => t.GetProperty("foraDosTotais").GetBoolean()));

        var resumo = await _client.GetFromJsonAsync<JsonElement>("/api/financas/dashboard/resumo?ano=2026&mes=10");
        Assert.Equal(30m, resumo.GetProperty("totalDespesas").GetDecimal());
        Assert.Equal(0, resumo.GetProperty("quantidadePendentes").GetInt32());

        // O usuário pode trazer uma de volta para a conta.
        var ignorada = itens.EnumerateArray().Single(t => t.GetProperty("descricao").GetString() == "Compra 10");
        var patch = await _client.PatchAsJsonAsync($"/api/financas/transacoes/{ignorada.GetProperty("id").GetString()}",
            new { foraDosTotais = false });
        patch.EnsureSuccessStatusCode();
        resumo = await _client.GetFromJsonAsync<JsonElement>("/api/financas/dashboard/resumo?ano=2026&mes=10");
        Assert.Equal(130m, resumo.GetProperty("totalDespesas").GetDecimal());
    }

    [Fact]
    public void Tag_do_usuario_vence_a_categoria_do_banco()
    {
        var item = Item(20, -50m, categoria: 64) with
        {
            TransactionTags = [new AuvpTransacaoTag(new AuvpTag("Pai")), new AuvpTransacaoTag(new AuvpTag("Alimentação"))],
        };
        Assert.Equal(Categoria.Alimentacao, AuvpSincronizador.Converter(item, "u").Categoria);

        var semTagUtil = Item(21, -50m, categoria: 64) with { TransactionTags = [new AuvpTransacaoTag(new AuvpTag("Manu"))] };
        Assert.Equal(Categoria.Compras, AuvpSincronizador.Converter(semTagUtil, "u").Categoria);
    }

    [Fact]
    public async Task Chave_recusada_vira_502_com_motivo()
    {
        _auvp.Erro = new AuvpIndisponivelException("A AUVP recusou a chave de API.", chaveRecusada: true);
        await CadastrarChave();

        var res = await _client.PostAsJsonAsync("/api/financas/auvp/sincronizar", new { });
        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
        Assert.Contains("recusou", await res.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData(78, Categoria.Alimentacao)]
    [InlineData(118, Categoria.Transporte)]
    [InlineData(100, Categoria.Moradia)]
    [InlineData(76, Categoria.Lazer)]
    [InlineData(17, Categoria.Investimentos)]
    [InlineData(null, Categoria.Outros)]
    public void Mapeia_categorias_do_open_banking(int? id, Categoria esperada) =>
        Assert.Equal(esperada, AuvpCategorias.Mapear(id, TipoTransacao.Despesa));

    private class AuvpFalso : IAuvpCliente
    {
        public List<List<AuvpTransacao>> Paginas { get; set; } = [];
        public Exception? Erro { get; set; }
        public string? UltimaChave { get; private set; }

        public bool Habilitado => true;

        public Task<AuvpPagina> ListarTransacoesAsync(string chave, DateOnly? de, DateOnly? ate, int pagina,
            int limite, CancellationToken ct)
        {
            if (Erro is not null) throw Erro;
            UltimaChave = chave;
            var itens = pagina <= Paginas.Count ? Paginas[pagina - 1] : [];
            return Task.FromResult(new AuvpPagina(itens, new AuvpPaginacao(pagina, Paginas.Count)));
        }
    }
}
