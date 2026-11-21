using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SegredosRecifrados : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "core_segredos_recifrados",
                columns: table => new
                {
                    Plugin = table.Column<string>(type: "TEXT", nullable: false),
                    Tabela = table.Column<string>(type: "TEXT", nullable: false),
                    Linha = table.Column<string>(type: "TEXT", nullable: false),
                    Em = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_segredos_recifrados", x => new { x.Plugin, x.Tabela, x.Linha });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "core_segredos_recifrados");
        }
    }
}
