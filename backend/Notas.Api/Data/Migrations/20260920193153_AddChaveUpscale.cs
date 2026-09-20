using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddChaveUpscale : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ChaveUpscaleCifrada",
                table: "configuracoes_ia",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChaveUpscaleSufixo",
                table: "configuracoes_ia",
                type: "TEXT",
                maxLength: 8,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ChaveUpscaleCifrada",
                table: "configuracoes_ia");

            migrationBuilder.DropColumn(
                name: "ChaveUpscaleSufixo",
                table: "configuracoes_ia");
        }
    }
}
