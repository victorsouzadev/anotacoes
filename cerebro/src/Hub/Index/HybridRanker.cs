namespace Hub.Index;

/// <summary>Contas da busca semântica (spec 027): puras, sem banco nem rede.</summary>
public static class HybridRanker
{
    /// <summary>Vetor de norma 1, para o cosseno virar produto escalar.</summary>
    public static float[] Normalizar(float[] v)
    {
        double soma = 0;
        foreach (var x in v) soma += x * x;
        var n = Math.Sqrt(soma);
        if (n == 0) return v;
        var r = new float[v.Length];
        for (var i = 0; i < v.Length; i++) r[i] = (float)(v[i] / n);
        return r;
    }

    /// <summary>Cosseno entre vetores já normalizados.</summary>
    public static double Cosseno(float[] a, float[] b)
    {
        var n = Math.Min(a.Length, b.Length);
        double s = 0;
        for (var i = 0; i < n; i++) s += a[i] * b[i];
        return s;
    }

    /// <summary>
    /// Reciprocal Rank Fusion: cada lista dá 1/(k + posição) a cada item; somados, ordenam o resultado.
    /// Junta palavras e significado sem precisar comparar escalas de pontuação diferentes.
    /// </summary>
    public static IReadOnlyList<(string Id, double Score)> Rrf(IEnumerable<IReadOnlyList<string>> listas, int k = 60)
    {
        var placar = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var lista in listas)
            for (var i = 0; i < lista.Count; i++)
                placar[lista[i]] = placar.GetValueOrDefault(lista[i]) + 1.0 / (k + i + 1);
        return placar.OrderByDescending(p => p.Value).ThenBy(p => p.Key, StringComparer.Ordinal)
            .Select(p => (p.Key, p.Value)).ToList();
    }

    /// <summary>Trechos de até ~1200 caracteres, cortados em parágrafos, com o título em cada um para dar contexto.</summary>
    public static IReadOnlyList<string> Trechos(string titulo, string corpo, int tamanho = 1200, int maximo = 40)
    {
        var paragrafos = corpo.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var trechos = new List<string>();
        var atual = new System.Text.StringBuilder();
        void Fechar()
        {
            if (atual.Length == 0) return;
            trechos.Add($"{titulo}\n\n{atual.ToString().Trim()}");
            atual.Clear();
        }
        foreach (var p in paragrafos)
        {
            for (var i = 0; i < p.Length; i += tamanho)
            {
                var pedaco = p.Substring(i, Math.Min(tamanho, p.Length - i));
                if (atual.Length + pedaco.Length > tamanho) Fechar();
                atual.Append(pedaco).Append("\n\n");
            }
        }
        Fechar();
        if (trechos.Count == 0) trechos.Add(titulo);
        return trechos.Take(maximo).ToList();
    }
}
