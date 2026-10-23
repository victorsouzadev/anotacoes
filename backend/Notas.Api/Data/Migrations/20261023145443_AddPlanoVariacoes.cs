using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPlanoVariacoes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Observacao",
                table: "dieta_plano",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Opcao",
                table: "dieta_plano",
                type: "INTEGER",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "Preferencias",
                table: "dieta_perfis",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Observacao",
                table: "dieta_plano");

            migrationBuilder.DropColumn(
                name: "Opcao",
                table: "dieta_plano");

            migrationBuilder.DropColumn(
                name: "Preferencias",
                table: "dieta_perfis");
        }
    }
}
