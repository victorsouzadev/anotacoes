using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddConfiguracaoIa : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "configuracoes_ia",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Provedor = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    ChaveApiCifrada = table.Column<string>(type: "TEXT", nullable: true),
                    ChaveApiSufixo = table.Column<string>(type: "TEXT", maxLength: 8, nullable: true),
                    Modelo = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    AtualizadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_configuracoes_ia", x => x.Id);
                    table.ForeignKey(
                        name: "FK_configuracoes_ia_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_configuracoes_ia_UserId",
                table: "configuracoes_ia",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "configuracoes_ia");
        }
    }
}
