using Hub.Core;
using Hub.Index;
using Hub.Vault;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Hub.Tests;

/// <summary>Grafo do vault: [[links]] resolvidos por nome de arquivo ou caminho; links quebrados ficam de fora.</summary>
public sealed class GraphTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cerebro-grafo-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    [Fact]
    public async Task Links_viram_arestas_entre_notas_existentes()
    {
        var opts = Options.Create(new HubOptions { DataPath = Path.Combine(_dir, "hub"), VaultPath = Path.Combine(_dir, "vault") });
        var vault = Path.Combine(_dir, "vault");
        Directory.CreateDirectory(Path.Combine(vault, "10-Projetos"));
        Directory.CreateDirectory(Path.Combine(vault, "30-Recursos"));
        File.WriteAllText(Path.Combine(vault, "10-Projetos", "Hub.md"), "# Hub\n\nUsa [[Docker]] e [[30-Recursos/Caddy|o Caddy]]. Ver [[Inexistente]].\n");
        File.WriteAllText(Path.Combine(vault, "30-Recursos", "Docker.md"), "# Docker\n\nVolta para [[hub]].\n");
        File.WriteAllText(Path.Combine(vault, "30-Recursos", "Caddy.md"), "# Caddy\n");

        var index = new NoteIndex(opts, new VaultStore(opts, NullLogger<VaultStore>.Instance), NullLogger<NoteIndex>.Instance);
        await index.FullScanAsync();
        var (nodes, edges) = index.Graph();

        Assert.Equal(3, nodes.Count);
        Assert.Contains(new GraphEdge("10-Projetos/Hub.md", "30-Recursos/Docker.md"), edges);
        Assert.Contains(new GraphEdge("10-Projetos/Hub.md", "30-Recursos/Caddy.md"), edges);
        Assert.Contains(new GraphEdge("30-Recursos/Docker.md", "10-Projetos/Hub.md"), edges);
        Assert.Equal(3, edges.Count);
    }
}
