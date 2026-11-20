using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class OAuthNucleo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SegredoServicoHash",
                table: "core_plugins_estado",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "core_mcp_tokens",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    Plugin = table.Column<string>(type: "TEXT", nullable: false),
                    Hash = table.Column<string>(type: "TEXT", nullable: false),
                    UsuarioId = table.Column<string>(type: "TEXT", nullable: false),
                    Email = table.Column<string>(type: "TEXT", nullable: false),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UltimoUso = table.Column<DateTime>(type: "TEXT", nullable: true),
                    RevogadoEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    Selo = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_mcp_tokens", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "core_oauth_clientes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    Nome = table.Column<string>(type: "TEXT", nullable: false),
                    RedirectUris = table.Column<string>(type: "TEXT", nullable: false),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UltimoUso = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_oauth_clientes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "core_oauth_codigos",
                columns: table => new
                {
                    Hash = table.Column<string>(type: "TEXT", nullable: false),
                    ClienteId = table.Column<string>(type: "TEXT", nullable: false),
                    Plugin = table.Column<string>(type: "TEXT", nullable: false),
                    UsuarioId = table.Column<string>(type: "TEXT", nullable: false),
                    Email = table.Column<string>(type: "TEXT", nullable: false),
                    CodeChallenge = table.Column<string>(type: "TEXT", nullable: false),
                    RedirectUri = table.Column<string>(type: "TEXT", nullable: false),
                    ExpiraEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UsadoEm = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_oauth_codigos", x => x.Hash);
                });

            migrationBuilder.CreateTable(
                name: "core_oauth_pedidos",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    ClienteId = table.Column<string>(type: "TEXT", nullable: false),
                    Plugin = table.Column<string>(type: "TEXT", nullable: false),
                    RedirectUri = table.Column<string>(type: "TEXT", nullable: false),
                    CodeChallenge = table.Column<string>(type: "TEXT", nullable: false),
                    State = table.Column<string>(type: "TEXT", nullable: true),
                    ExpiraEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_oauth_pedidos", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "core_oauth_revogados",
                columns: table => new
                {
                    Jti = table.Column<string>(type: "TEXT", nullable: false),
                    Plugin = table.Column<string>(type: "TEXT", nullable: false),
                    ExpiraEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_oauth_revogados", x => x.Jti);
                });

            migrationBuilder.CreateTable(
                name: "core_oauth_tokens",
                columns: table => new
                {
                    Hash = table.Column<string>(type: "TEXT", nullable: false),
                    ClienteId = table.Column<string>(type: "TEXT", nullable: false),
                    Plugin = table.Column<string>(type: "TEXT", nullable: false),
                    UsuarioId = table.Column<string>(type: "TEXT", nullable: false),
                    Email = table.Column<string>(type: "TEXT", nullable: false),
                    Familia = table.Column<string>(type: "TEXT", nullable: false),
                    ExpiraEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    RevogadoEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    UsadoEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    UltimoJti = table.Column<string>(type: "TEXT", nullable: true),
                    UltimoJtiExpira = table.Column<DateTime>(type: "TEXT", nullable: true),
                    Selo = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_oauth_tokens", x => x.Hash);
                });

            migrationBuilder.CreateIndex(
                name: "IX_core_mcp_tokens_Hash",
                table: "core_mcp_tokens",
                column: "Hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_core_oauth_revogados_Plugin",
                table: "core_oauth_revogados",
                column: "Plugin");

            migrationBuilder.CreateIndex(
                name: "IX_core_oauth_tokens_Familia",
                table: "core_oauth_tokens",
                column: "Familia");

            migrationBuilder.CreateIndex(
                name: "IX_core_oauth_tokens_UsuarioId_ClienteId",
                table: "core_oauth_tokens",
                columns: new[] { "UsuarioId", "ClienteId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "core_mcp_tokens");

            migrationBuilder.DropTable(
                name: "core_oauth_clientes");

            migrationBuilder.DropTable(
                name: "core_oauth_codigos");

            migrationBuilder.DropTable(
                name: "core_oauth_pedidos");

            migrationBuilder.DropTable(
                name: "core_oauth_revogados");

            migrationBuilder.DropTable(
                name: "core_oauth_tokens");

            migrationBuilder.DropColumn(
                name: "SegredoServicoHash",
                table: "core_plugins_estado");
        }
    }
}
