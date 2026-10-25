using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <summary>
    /// Desfaz o Estúdio (migration AddEstudio, que saiu do código): apaga as tabelas estudio_* onde
    /// ela chegou a rodar. Onde nunca rodou, não há nada para apagar.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261025030000_RemoveEstudio")]
    public partial class RemoveEstudio : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS estudio_quadros;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS estudio_jobs;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS estudio_midias;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS estudio_config;");
            migrationBuilder.Sql("DELETE FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\" = '20261024225515_AddEstudio';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
