using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "sites",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    OwnerUserId = table.Column<string>(type: "TEXT", nullable: false),
                    Slug = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    CurrentDeploymentId = table.Column<string>(type: "TEXT", nullable: true),
                    Parado = table.Column<bool>(type: "INTEGER", nullable: false),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sites_users_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sites_deployments",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    SiteId = table.Column<string>(type: "TEXT", nullable: false),
                    Versao = table.Column<int>(type: "INTEGER", nullable: false),
                    Tipo = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    TemWeb = table.Column<bool>(type: "INTEGER", nullable: false),
                    RuntimeVersao = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    Entrada = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    Health = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    MemoriaMb = table.Column<int>(type: "INTEGER", nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    TamanhoBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    Log = table.Column<string>(type: "TEXT", nullable: false),
                    TemBackupBanco = table.Column<bool>(type: "INTEGER", nullable: false),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    TerminadoEm = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sites_deployments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sites_deployments_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sites_variaveis",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    SiteId = table.Column<string>(type: "TEXT", nullable: false),
                    Chave = table.Column<string>(type: "TEXT", maxLength: 128, nullable: false),
                    ValorCifrado = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sites_variaveis", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sites_variaveis_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_sites_OwnerUserId",
                table: "sites",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_sites_Slug",
                table: "sites",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sites_deployments_SiteId_Versao",
                table: "sites_deployments",
                columns: new[] { "SiteId", "Versao" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sites_variaveis_SiteId_Chave",
                table: "sites_variaveis",
                columns: new[] { "SiteId", "Chave" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "sites_deployments");

            migrationBuilder.DropTable(
                name: "sites_variaveis");

            migrationBuilder.DropTable(
                name: "sites");
        }
    }
}
