using System.Text.Json.Nodes;
using Json.Schema;
using Xunit;

namespace Hub.Plugin.Sdk.Tests;

/// <summary>Spec 032 (T003): o <c>plugin.schema.json</c> aceita os manifestos do contrato e recusa os quebrados.</summary>
public class SchemaTests
{
    private static readonly JsonSchema Schema = JsonSchema.FromFile(Path.Combine(AppContext.BaseDirectory, "plugin.schema.json"));

    private const string Cerebro = """
        { "id": "cerebro", "nome": "Segundo Cérebro", "icone": "brain", "descricao": "Notas", "contrato": 1, "rota": "/cerebro",
          "porta": 8080, "health": "/cerebro/health", "mcp": "/cerebro/mcp", "rotasLegadas": ["/capturar", "/sw-cerebro.js", "/cerebro-app"],
          "tabelas": { "prefixo": "cerebro_", "legadas": [] }, "usaIa": true, "dados": ["/data/vault", "/data/hub"] }
        """;

    private const string Minimo = """
        { "id": "exemplo", "nome": "Exemplo", "icone": "grid", "contrato": 1, "rota": "/exemplo", "porta": 8080,
          "health": "/exemplo/api/health", "tabelas": { "prefixo": "exemplo_" } }
        """;

    private static bool Valido(string json) =>
        Schema.Evaluate(JsonNode.Parse(json), new EvaluationOptions { OutputFormat = OutputFormat.Flag }).IsValid;

    private static string Trocar(string json, string campo, JsonNode? valor)
    {
        var o = JsonNode.Parse(json)!.AsObject();
        if (valor is null) o.Remove(campo); else o[campo] = valor;
        return o.ToJsonString();
    }

    [Fact]
    public void Aceita_manifestos_do_contrato()
    {
        Assert.True(Valido(Cerebro));
        Assert.True(Valido(Minimo));
        Assert.True(Valido(Trocar(Minimo, "contrato", 0)));
        Assert.True(Valido(Trocar(Minimo, "congelado", true)));
    }

    [Fact]
    public void Congelado_e_opcional_e_chega_ao_sdk()
    {
        var arq = Path.Combine(Path.GetTempPath(), "schema-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(arq, Trocar(Minimo, "congelado", true));
        try
        {
            Assert.True(Manifesto.Ler(arq).Congelado);
            File.WriteAllText(arq, Minimo);
            Assert.False(Manifesto.Ler(arq).Congelado);
        }
        finally { File.Delete(arq); }
    }

    [Theory]
    [InlineData("id", "\"Exemplo\"")]
    [InlineData("id", "\"x\"")]
    [InlineData("contrato", "2")]
    [InlineData("porta", "70000")]
    [InlineData("rota", "\"/\"")]
    [InlineData("rotasLegadas", "[\"/api/core/x\"]")]
    [InlineData("rotasLegadas", "[\"/.well-known/oauth\"]")]
    [InlineData("rotasLegadas", "[\"/a/../b\"]")]
    [InlineData("dados", "[\"/data/db\"]")]
    [InlineData("dados", "[\"/etc\"]")]
    [InlineData("tabelas", "{\"prefixo\":\"core_\"}")]
    [InlineData("tabelas", "{\"prefixo\":\"Dieta\"}")]
    [InlineData("campoNovo", "true")]
    public void Recusa_manifestos_quebrados(string campo, string valor) =>
        Assert.False(Valido(Trocar(Minimo, campo, JsonNode.Parse(valor))));

    [Theory]
    [InlineData("nome")]
    [InlineData("health")]
    [InlineData("tabelas")]
    public void Recusa_sem_campo_obrigatorio(string campo) => Assert.False(Valido(Trocar(Minimo, campo, null)));

    [Fact]
    public void Schema_e_sdk_concordam_no_manifesto_minimo()
    {
        var arq = Path.Combine(Path.GetTempPath(), "schema-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(arq, Cerebro);
        try { Assert.Empty(Manifesto.Ler(arq).Problemas()); }
        finally { File.Delete(arq); }
    }
}
