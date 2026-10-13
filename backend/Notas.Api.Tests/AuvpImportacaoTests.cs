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
    public async Task Novas_sincronizadas_passam_pela_fila_de_categorizacao()
    {
        _auvp.Paginas = [[Item(20, -45.9m), Item(21, -60m, categoria: null)]];
        await CadastrarChave();
        await Sincronizar();

        // As duas entram na fila, mesmo a que já veio categorizada da AUVP. A
        // descrição é a mesma loja ("Compra"), então viram um grupo só.
        var fila = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes/categorizar");
        Assert.Equal(2, fila.GetProperty("pendentesHistorico").GetInt32());
        var grupo = Assert.Single(fila.GetProperty("grupos").EnumerateArray());
        Assert.NotNull(grupo.GetProperty("sugestao").GetString());

        // Confirmar tira da fila.
        var ids = grupo.GetProperty("ids").EnumerateArray().Select(i => i.GetGuid()).ToList();
        (await _client.PatchAsJsonAsync("/api/financas/transacoes/lote", new { ids, categoria = "Alimentacao" }))
            .EnsureSuccessStatusCode();
        fila = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes/categorizar");
        Assert.Equal(0, fila.GetProperty("pendentesHistorico").GetInt32());

        // Sincronizar de novo não devolve à fila o que já foi confirmado.
        await Sincronizar();
        fila = await _client.GetFromJsonAsync<JsonElement>("/api/financas/transacoes/categorizar");
        Assert.Equal(0, fila.GetProperty("pendentesHistorico").GetInt32());
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

    private async Task<JsonElement> Listar(string query = "")
    {
        var lista = await _client.GetFromJsonAsync<JsonElement>($"/api/financas/transacoes{query}");
        return lista.ValueKind == JsonValueKind.Array ? lista : lista.GetProperty("itens");
    }

    private static JsonElement PorDescricao(JsonElement itens, string descricao) =>
        itens.EnumerateArray().Single(t => t.GetProperty("descricao").GetString() == descricao);

    [Fact]
    public async Task Compra_no_cartao_conta_no_mes_da_fatura_e_le_parcelas()
    {
        // Comprada em 05/10, mas a fatura é de novembro.
        _auvp.Paginas = [[Item(30, -300m) with
        {
            Description = "LOJA BOA 2/5",
            ReferenceMonth = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero),
            Budget = new AuvpOrcamentoRef(3, "Conforto", "CONFORTO"),
            TransactionTags = [new AuvpTransacaoTag(new AuvpTag("Pai", 1))],
        }]];
        await CadastrarChave();
        await Sincronizar();

        var outubro = await _client.GetFromJsonAsync<JsonElement>("/api/financas/dashboard/resumo?ano=2026&mes=10");
        var novembro = await _client.GetFromJsonAsync<JsonElement>("/api/financas/dashboard/resumo?ano=2026&mes=11");
        Assert.Equal(0m, outubro.GetProperty("totalDespesas").GetDecimal());
        Assert.Equal(300m, novembro.GetProperty("totalDespesas").GetDecimal());

        var t = PorDescricao(await Listar("?ano=2026&mes=11"), "LOJA BOA 2/5");
        Assert.Equal(2, t.GetProperty("parcela").GetInt32());
        Assert.Equal(5, t.GetProperty("totalParcelas").GetInt32());
        Assert.Equal("CONFORTO", t.GetProperty("orcamentoAuvp").GetString());
        Assert.Equal("Cartão X", t.GetProperty("conta").GetString());
        Assert.Equal("Pai", t.GetProperty("tags")[0].GetString());
    }

    [Fact]
    public async Task Excluido_aqui_nao_volta_na_proxima_sincronizacao()
    {
        _auvp.Paginas = [[Item(40, -10m), Item(41, -20m)]];
        await CadastrarChave();
        await Sincronizar();

        var alvo = PorDescricao(await Listar(), "Compra 40");
        (await _client.DeleteAsync($"/api/financas/transacoes/{alvo.GetProperty("id").GetString()}")).EnsureSuccessStatusCode();

        var r = await Sincronizar();
        Assert.Equal(0, r.GetProperty("importadas").GetInt32());
        Assert.Single((await Listar()).EnumerateArray());
    }

    [Fact]
    public async Task Correcao_de_categoria_vai_para_a_auvp_vira_regra_e_se_aplica_aos_parecidos()
    {
        _auvp.Tags = [new AuvpTag("Alimentação", 100, Status: "ACTIVE"), new AuvpTag("Pai", 101, Status: "ACTIVE")];
        _auvp.Paginas = [[
            Item(50, -40m, categoria: 64) with { Description = "LIDER MARABA MARABA BRA",
                TransactionTags = [new AuvpTransacaoTag(new AuvpTag("Pai", 101))] },
            Item(51, -60m, categoria: 64) with { Description = "LIDER MARABA MARABA BRA" },
        ]];
        await CadastrarChave();
        await Sincronizar();

        var alvo = (await Listar()).EnumerateArray().Single(t => t.GetProperty("valor").GetDecimal() == 40m);
        var id = alvo.GetProperty("id").GetString();
        var res = await _client.PatchAsJsonAsync($"/api/financas/transacoes/{id}",
            new { categoria = "Alimentacao", foraDosTotais = true, observacoes = "conferido" });
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(JsonValueKind.Null, corpo.GetProperty("avisoAuvp").ValueKind);
        Assert.Equal(1, corpo.GetProperty("semelhantes").GetInt32());

        // Na AUVP: tag de categoria acrescentada (a "Pai" fica), ignore e observação.
        Assert.Contains(_auvp.TagsAdicionadas, x => x.TagIds.SequenceEqual([100L]));
        Assert.DoesNotContain(_auvp.TagsRemovidas, x => x.TagIds.Contains(101L));
        var alteracao = Assert.Single(_auvp.Alteracoes);
        Assert.True(alteracao.Alteracao.Ignorar);
        Assert.Equal("conferido", alteracao.Alteracao.Observacoes);

        // "Aplicar aos parecidos" leva o outro junto, e também para a AUVP.
        var aplicar = await _client.PostAsync($"/api/financas/transacoes/{id}/aplicar-categoria", null);
        aplicar.EnsureSuccessStatusCode();
        Assert.Equal(1, (await aplicar.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("atualizados").GetInt32());
        Assert.All((await Listar()).EnumerateArray(), t => Assert.Equal("Alimentacao", t.GetProperty("categoria").GetString()));

        // E a próxima compra na mesma loja já chega certa.
        _auvp.Paginas = [[Item(52, -15m, categoria: 64) with { Description = "LIDER MARABA MARABA BRA 1/2" }]];
        await _client.PostAsJsonAsync("/api/financas/auvp/sincronizar", new { de = "2026-10-01", ate = "2026-10-31" });
        var nova = (await Listar()).EnumerateArray().Single(t => t.GetProperty("valor").GetDecimal() == 15m);
        Assert.Equal("Alimentacao", nova.GetProperty("categoria").GetString());
    }

    [Fact]
    public async Task Falha_na_auvp_nao_perde_a_edicao_local()
    {
        _auvp.Paginas = [[Item(60, -40m)]];
        await CadastrarChave();
        await Sincronizar();
        _auvp.ErroEscrita = new AuvpIndisponivelException("A AUVP respondeu 400: property ignore should not exist.");

        var alvo = PorDescricao(await Listar(), "Compra 60");
        var res = await _client.PatchAsJsonAsync($"/api/financas/transacoes/{alvo.GetProperty("id").GetString()}",
            new { foraDosTotais = true });
        res.EnsureSuccessStatusCode();
        var corpo = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("should not exist", corpo.GetProperty("avisoAuvp").GetString());
        Assert.True(PorDescricao(await Listar(), "Compra 60").GetProperty("foraDosTotais").GetBoolean());
    }

    [Fact]
    public async Task Edicao_em_lote_muda_todos_e_escreve_na_auvp()
    {
        _auvp.Paginas = [[Item(70, -1m), Item(71, -2m), Item(72, -3m)]];
        await CadastrarChave();
        await Sincronizar();
        var ids = (await Listar()).EnumerateArray()
            .Where(t => t.GetProperty("valor").GetDecimal() < 3m)
            .Select(t => t.GetProperty("id").GetString()).ToList();

        var res = await _client.PatchAsJsonAsync("/api/financas/transacoes/lote",
            new { ids, foraDosTotais = true, orcamentoAuvp = "PRAZERES" });
        res.EnsureSuccessStatusCode();
        Assert.Equal(2, (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("atualizados").GetInt32());

        Assert.Equal(2, _auvp.Alteracoes.Count);
        Assert.All(_auvp.Alteracoes, a => Assert.Equal(5, a.Alteracao.OrcamentoId));
        var resumo = await _client.GetFromJsonAsync<JsonElement>("/api/financas/dashboard/resumo?ano=2026&mes=10");
        Assert.Equal(3m, resumo.GetProperty("totalDespesas").GetDecimal());
    }

    [Theory]
    [InlineData("GOLDMEN HOTEL VILA DO 8/10", 8, 10)]
    [InlineData("Mercadolivre*Mercadol 3/10", 3, 10)]
    [InlineData("TAR MSG Cobrança referente 10/09/2026", null, null)]
    [InlineData("Pix para fulano", null, null)]
    public void Le_parcela_do_fim_da_descricao(string descricao, int? parcela, int? total) =>
        Assert.Equal((parcela, total), AuvpSincronizador.LerParcela(descricao));

    [Fact]
    public void Transferencia_de_mesma_titularidade_fica_fora_dos_totais() =>
        Assert.True(AuvpSincronizador.Converter(Item(80, -9000m, categoria: 23), "u").ForaDosTotais);

    private class AuvpFalso : IAuvpCliente
    {
        public List<List<AuvpTransacao>> Paginas { get; set; } = [];
        public Exception? Erro { get; set; }
        public Exception? ErroEscrita { get; set; }
        public string? UltimaChave { get; private set; }
        public List<AuvpTag> Tags { get; set; } = [];
        public List<(long Id, AuvpAlteracao Alteracao)> Alteracoes { get; } = [];
        public List<(long Id, IReadOnlyCollection<long> TagIds)> TagsAdicionadas { get; } = [];
        public List<(long Id, IReadOnlyCollection<long> TagIds)> TagsRemovidas { get; } = [];

        public bool Habilitado => true;

        public Task<AuvpPagina> ListarTransacoesAsync(string chave, DateOnly? de, DateOnly? ate, int pagina,
            int limite, CancellationToken ct)
        {
            if (Erro is not null) throw Erro;
            UltimaChave = chave;
            var itens = pagina <= Paginas.Count ? Paginas[pagina - 1] : [];
            return Task.FromResult(new AuvpPagina(itens, new AuvpPaginacao(pagina, Paginas.Count)));
        }

        public Task<List<AuvpTag>> ListarTagsAsync(string chave, CancellationToken ct) => Task.FromResult(Tags);

        public Task<List<AuvpOrcamento>> ListarOrcamentosAsync(string chave, CancellationToken ct) =>
            Task.FromResult<List<AuvpOrcamento>>([new(3, "Conforto", "CONFORTO"), new(5, "Prazeres", "PRAZERES")]);

        public Task<AuvpOrcamentoMensal> OrcamentoMensalAsync(string chave, DateOnly mes, CancellationToken ct) =>
            Task.FromResult(new AuvpOrcamentoMensal(null, []));

        public Task<List<AuvpContaDetalhe>> ListarContasAsync(string chave, CancellationToken ct) =>
            Task.FromResult<List<AuvpContaDetalhe>>([]);

        public Task<AuvpFaturaEstimada?> FaturaEstimadaAsync(string chave, string contaIdExterno, CancellationToken ct) =>
            Task.FromResult<AuvpFaturaEstimada?>(null);

        public Task AtualizarTransacaoAsync(string chave, long id, AuvpAlteracao alteracao, CancellationToken ct)
        {
            if (ErroEscrita is not null) throw ErroEscrita;
            Alteracoes.Add((id, alteracao));
            return Task.CompletedTask;
        }

        public Task AdicionarTagsAsync(string chave, long id, IReadOnlyCollection<long> tagIds, CancellationToken ct)
        {
            if (ErroEscrita is not null) throw ErroEscrita;
            if (tagIds.Count > 0) TagsAdicionadas.Add((id, tagIds));
            return Task.CompletedTask;
        }

        public Task RemoverTagsAsync(string chave, long id, IReadOnlyCollection<long> tagIds, CancellationToken ct)
        {
            if (ErroEscrita is not null) throw ErroEscrita;
            if (tagIds.Count > 0) TagsRemovidas.Add((id, tagIds));
            return Task.CompletedTask;
        }
    }
}
