using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSitesPostgres : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PostgresBanco",
                table: "sites",
                type: "TEXT",
                maxLength: 63,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PostgresSenhaCifrada",
                table: "sites",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PostgresBanco",
                table: "sites");

            migrationBuilder.DropColumn(
                name: "PostgresSenhaCifrada",
                table: "sites");
        }
    }
}
