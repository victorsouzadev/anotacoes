using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class NucleoPlugins : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "core_plugins_estado",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    Versao = table.Column<string>(type: "TEXT", nullable: false),
                    VersaoAnterior = table.Column<string>(type: "TEXT", nullable: true),
                    Manifesto = table.Column<string>(type: "TEXT", nullable: false),
                    NoAr = table.Column<bool>(type: "INTEGER", nullable: false),
                    UltimoHealth = table.Column<DateTime>(type: "TEXT", nullable: true),
                    UltimaFalha = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_plugins_estado", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "core_plugins_estado");
        }
    }
}
