using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddImportacaoAuvp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IdExterno",
                table: "financas_transacoes",
                type: "TEXT",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OrigemExterna",
                table: "financas_transacoes",
                type: "TEXT",
                maxLength: 20,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "configuracoes_auvp",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    ChaveCifrada = table.Column<string>(type: "TEXT", nullable: true),
                    ChaveSufixo = table.Column<string>(type: "TEXT", maxLength: 8, nullable: true),
                    UltimaSincronizacaoEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    AtualizadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_configuracoes_auvp", x => x.Id);
                    table.ForeignKey(
                        name: "FK_configuracoes_auvp_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_financas_transacoes_UserId_OrigemExterna_IdExterno",
                table: "financas_transacoes",
                columns: new[] { "UserId", "OrigemExterna", "IdExterno" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_configuracoes_auvp_UserId",
                table: "configuracoes_auvp",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "configuracoes_auvp");

            migrationBuilder.DropIndex(
                name: "IX_financas_transacoes_UserId_OrigemExterna_IdExterno",
                table: "financas_transacoes");

            migrationBuilder.DropColumn(
                name: "IdExterno",
                table: "financas_transacoes");

            migrationBuilder.DropColumn(
                name: "OrigemExterna",
                table: "financas_transacoes");
        }
    }
}
