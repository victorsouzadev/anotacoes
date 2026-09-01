using Notas.Api.Data;
using Notas.Api.Dtos;

namespace Notas.Api.Services.Financas;

// Distribuições prontas oferecidas na tela de cadastro, para o usuário não começar
// de uma folha em branco. Os pesos dentro de cada grupo são realistas (moradia pesa
// mais que transporte), em vez de uma divisão igual entre categorias.
public static class ModelosOrcamento
{
    public record Modelo(string Id, string Nome, string Descricao, (Categoria Categoria, decimal Percentual)[] Itens);

    public static readonly IReadOnlyList<Modelo> Todos = new[]
    {
        new Modelo("50-30-20", "Regra 50/30/20",
            "Metade para o essencial, 30% para estilo de vida e 20% para o futuro.",
            new[]
            {
                (Categoria.Moradia, 25m), (Categoria.Alimentacao, 12m), (Categoria.Transporte, 6m),
                (Categoria.ContasServicos, 5m), (Categoria.Saude, 2m),
                (Categoria.Compras, 12m), (Categoria.Lazer, 10m), (Categoria.Outros, 8m),
                (Categoria.Investimentos, 20m),
            }),

        new Modelo("equilibrado", "Equilibrado",
            "Um meio-termo, com uma reserva mensal um pouco maior.",
            new[]
            {
                (Categoria.Moradia, 20m), (Categoria.Alimentacao, 15m), (Categoria.Transporte, 8m),
                (Categoria.ContasServicos, 5m), (Categoria.Saude, 5m), (Categoria.Educacao, 5m),
                (Categoria.Lazer, 8m), (Categoria.Compras, 7m), (Categoria.Outros, 2m),
                (Categoria.Investimentos, 25m),
            }),

        new Modelo("enxuto", "Enxuto",
            "Corta o supérfluo e joga 40% para investimentos.",
            new[]
            {
                (Categoria.Moradia, 22m), (Categoria.Alimentacao, 10m), (Categoria.Transporte, 5m),
                (Categoria.ContasServicos, 5m), (Categoria.Saude, 3m),
                (Categoria.Lazer, 5m), (Categoria.Compras, 5m), (Categoria.Outros, 5m),
                (Categoria.Investimentos, 40m),
            }),

        new Modelo("familia", "Família",
            "Peso maior em alimentação, educação e saúde.",
            new[]
            {
                (Categoria.Moradia, 25m), (Categoria.Alimentacao, 18m), (Categoria.Educacao, 10m),
                (Categoria.Transporte, 8m), (Categoria.ContasServicos, 6m), (Categoria.Saude, 6m),
                (Categoria.Lazer, 6m), (Categoria.Compras, 6m),
                (Categoria.Investimentos, 15m),
            }),
    };

    // Materializa um modelo já em reais, para o cliente conseguir mostrar a prévia
    // da distribuição antes de salvar.
    public static ModeloOrcamentoResponse ToResponse(Modelo modelo, decimal valorTotal)
    {
        var valores = OrcamentoService.Distribuir(valorTotal, modelo.Itens.Select(i => i.Percentual).ToList());

        var itens = modelo.Itens
            .Select((item, i) => new OrcamentoItemResponse(
                item.Categoria.ToString(),
                CategoriaInfo.Rotulo(item.Categoria),
                CategoriaInfo.Grupo(item.Categoria).ToString(),
                item.Percentual,
                valores[i]))
            .ToList();

        return new ModeloOrcamentoResponse(modelo.Id, modelo.Nome, modelo.Descricao, itens);
    }
}
