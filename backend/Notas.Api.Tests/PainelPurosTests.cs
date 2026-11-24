using Hub.Plugin;
using Notas.Api.Services.Painel;
using Xunit;

namespace Notas.Api.Tests;

/// <summary>Spec 040: situação, recursos, avisos e leitura do registro, sem rede (T001, T009 e T010).</summary>
public class SituacaoDoPluginTests
{
    private static Manifesto M(string id = "novo", bool congelado = false) =>
        new(id, "Novo", "grid", null, 1, "/" + id, 8080, $"/{id}/h", null, null, new Tabelas(id + "_", null), false, null, null, congelado);

    private static string Etapa(PluginNoPainel p, string nome) => p.Etapas.Single(e => e.Nome == nome).Estado;

    private static readonly PreparoDoPlugin BancoPronto = new(true, true, "novo", true, true, true);
    private static readonly PreparoDoPlugin SemBanco = new(false, false, null, false, false, null);

    private static FontesDoPlugin Candidato(PreparoDoPlugin? banco) => new("novo")
    {
        Candidato = "abc1234", Ci = Etapas.Feita, ManifestoLido = true, Manifesto = M(), Imagem = true, Preparo = banco,
    };

    [Fact]
    public void Mesclada_e_sem_banco_mostra_a_imagem_e_o_que_falta()
    {
        var p = SituacaoDoPlugin.Calcular(Candidato(SemBanco));
        Assert.Equal(SituacaoDoPlugin.Incompleto, p.Situacao);
        Assert.Equal(Etapas.Feita, Etapa(p, "imagem"));
        Assert.All(new[] { "papel", "schema", "conexao", "permissoes", "registro", "no-ar" }, n => Assert.Equal(Etapas.Pendente, Etapa(p, n)));
        Assert.Equal(("Novo", "abc1234"), (p.Nome, p.Versao));
    }

    [Fact]
    public void Tudo_pronto_fora_do_registro() => Assert.Equal(SituacaoDoPlugin.Pronto, SituacaoDoPlugin.Calcular(Candidato(BancoPronto)).Situacao);

    [Fact]
    public void Fonte_fora_do_ar_vira_nao_conferida()
    {
        var p = SituacaoDoPlugin.Calcular(new FontesDoPlugin("novo") { LockLido = false });
        Assert.Equal(SituacaoDoPlugin.Incompleto, p.Situacao);
        Assert.All(p.Etapas.Where(e => e.Nome != "no-ar"), e => Assert.Equal(Etapas.NaoConferida, e.Estado));
    }

    [Fact]
    public void Manifesto_recusado_ci_vermelha_e_conexao_que_nao_abre_falham()
    {
        var p = SituacaoDoPlugin.Calcular(Candidato(BancoPronto with { Conecta = false, DonoDoSchema = "outro" }) with
        {
            Ci = Etapas.Falhou, ProblemasDoManifesto = ["rota precisa ser /novo"],
        });
        Assert.All(new[] { "ci", "manifesto", "conexao", "schema" }, n => Assert.Equal(Etapas.Falhou, Etapa(p, n)));
        Assert.Contains("rota precisa", p.Etapas.Single(e => e.Nome == "manifesto").Detalhe);
        Assert.Equal(SituacaoDoPlugin.Incompleto, p.Situacao);
    }

    private static FontesDoPlugin Ativo(EstadoDoDeployer? e, bool? health = true) =>
        new("novo") { Lock = new("novo", "abc1234", true), Estado = e, Health = health };

    private static EstadoDoDeployer Estado(string versao = "abc1234", bool noAr = true, string? falha = null, Manifesto? m = null) =>
        new("novo", versao, "0000000", m ?? M(), noAr, falha, true);

    [Fact]
    public void No_ar()
    {
        var p = SituacaoDoPlugin.Calcular(Ativo(Estado(m: M(congelado: true))) with { MemoriaMb = 45, LimiteMb = 256 });
        Assert.Equal((SituacaoDoPlugin.NoAr, true, "0000000", true, 45), (p.Situacao, p.Health!.Value, p.VersaoAnterior, p.Congelado, p.MemoriaMb!.Value));
        Assert.Equal(["registro", "no-ar"], p.Etapas.Select(e => e.Nome));
    }

    [Fact]
    public void Primeira_subida_que_falhou_tem_manifesto_nulo_e_aparece_com_o_motivo()
    {
        var e = new EstadoDoDeployer("novo", "abc1234", null, null, false, "abc1234: não baixou a imagem", true);
        var p = SituacaoDoPlugin.Calcular(Ativo(e, null) with { Preparo = SemBanco });
        Assert.Equal((SituacaoDoPlugin.ComFalha, "novo"), (p.Situacao, p.Nome));
        Assert.Contains("não baixou a imagem", p.Etapas.Single(x => x.Nome == "no-ar").Detalhe);
        Assert.Equal(Etapas.Pendente, Etapa(p, "papel"));
    }

    [Fact]
    public void Atualizacao_que_falhou_segue_no_ar_na_anterior_com_falha()
    {
        var p = SituacaoDoPlugin.Calcular(Ativo(Estado("1111111", falha: "abc1234: health sem 200")));
        Assert.Equal((SituacaoDoPlugin.ComFalha, "1111111", true), (p.Situacao, p.Versao, p.Health!.Value));
        Assert.Contains("abc1234", p.Etapas.Single(x => x.Nome == "registro").Detalhe);
    }

    [Fact]
    public void Health_caido_e_deployer_atrasado_nao_contam_como_no_ar()
    {
        Assert.Equal(SituacaoDoPlugin.ComFalha, SituacaoDoPlugin.Calcular(Ativo(Estado(), false)).Situacao);
        Assert.Equal(Etapas.Pendente, Etapa(SituacaoDoPlugin.Calcular(Ativo(null, null)), "no-ar"));
    }

    [Fact]
    public void Desligado_mostra_as_etapas_para_voltar()
    {
        var p = SituacaoDoPlugin.Calcular(Candidato(BancoPronto) with { Lock = new("novo", "abc1234", false) });
        Assert.Equal(SituacaoDoPlugin.Desligado, p.Situacao);
        Assert.Null(p.Health);
        Assert.Contains("desligado", p.Etapas.Single(e => e.Nome == "registro").Detalhe);
    }

    [Theory]
    [InlineData(300, 8, 0)]   // 10 + 3×9 = 37
    [InlineData(255, 8, 1)]   // memória baixa
    [InlineData(300, 14, 1)]  // 10 + 3×15 = 55 > 54
    [InlineData(300, 13, 0)]  // 52
    [InlineData(100, 20, 2)]
    public void Avisos_de_recursos(int livre, int ligados, int avisos)
    {
        var r = RecursosLivres.Calcular(new(1967, livre, [], 17, 60), ligados);
        Assert.Equal(avisos, r.Avisos.Count);
        Assert.Equal(43, r.ConexoesLivres);
    }

    [Fact]
    public void Sem_deployer_nao_ha_aviso_de_recurso()
    {
        var r = RecursosLivres.Calcular(null, 10);
        Assert.Empty(r.Avisos);
        Assert.Null(r.MemoriaLivreMb);
    }

    [Theory]
    [InlineData("", "", 1, "Falta")]
    [InlineData("tok", "2026-12-31", 0, "")]
    [InlineData("tok", "2026-12-01", 1, "7 dia")]
    [InlineData("tok", "2026-11-24", 1, "hoje")]
    [InlineData("tok", "2026-11-23", 1, "venceu")]
    [InlineData("tok", "lixo", 0, "")]
    public void Avisos_do_token(string token, string validade, int quantos, string trecho)
    {
        var a = new PainelOptions { GithubLeitura = token, GithubLeituraValidade = validade }.Avisos(new DateOnly(2026, 11, 24));
        Assert.Equal(quantos, a.Count);
        if (quantos > 0) Assert.Contains(trecho, a[0]);
        Assert.DoesNotContain(a, x => x.Contains("tok\""));
    }

    [Fact]
    public void Administradores_vazio_e_ninguem()
    {
        Assert.False(new PainelOptions().Administra("a@b.c"));
        Assert.False(new PainelOptions { Administradores = "a@b.c" }.Administra(null));
        Assert.True(new PainelOptions { Administradores = "x@y.z, A@B.c" }.Administra("a@b.C"));
    }

    [Fact]
    public void Le_o_registro_como_o_deployer()
    {
        var l = ListaDoPainel.LerLock("# id: imagem@versão\na: x/y@1\r\n# b: x/z@2 # desligado\n# a: x/y@0\nlixo\n");
        Assert.Equal([new("a", "1", true), new("b", "2", false)], l);
    }
}
