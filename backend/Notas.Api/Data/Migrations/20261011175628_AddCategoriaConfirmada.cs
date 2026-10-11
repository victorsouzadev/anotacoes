using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCategoriaConfirmada : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CategoriaConfirmada",
                table: "financas_transacoes",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CategoriaConfirmada",
                table: "financas_transacoes");
        }
    }
}
