# Contrato: regras do banco compartilhado

Todo plug-in, por meio do `Hub.Plugin.Sdk` (032):

```csharp
builder.Services.AddDbContext<DietaDb>(o => o.UsarBancoDoHub("dieta"));
// = UseSqlite("Data Source=/data/db/notas.db") + busy_timeout 5000 + WAL
//   + MigrationsHistoryTable("__EFMigrationsHistory_dieta")

protected override void OnModelCreating(ModelBuilder b)
{
    b.ReferenciarUsuarios();            // users só com Id, fora das migrações
    b.Entity<DietaRegistro>().ToTable("dieta_registros");
}
```

Teste obrigatório no repositório do plug-in:

```csharp
[Fact] public void Tabelas_so_do_plugin() => TabelasDoPlugin.Conferir<DietaDb>("plugin.json");
```

| Regra | Quem garante |
|---|---|
| Só tabelas do prefixo (e legadas listadas) no modelo | teste do SDK, na CI do plug-in |
| Migração não toca tabela de outro dono | deployer (esquema antes/depois) |
| Cópia antes de migração nova | deployer |
| Nada de `DROP TABLE` na extração | teste no núcleo |
| Banco em disco local | deployer recusa montagem de rede |
| Montagem: `./data/db:/data/db` | deployer |
