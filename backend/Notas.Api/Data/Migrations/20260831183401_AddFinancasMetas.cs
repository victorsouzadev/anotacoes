using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinancasMetas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "financas_metas",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    ValorAlvo = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    DataAlvo = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    Observacoes = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ConcluidaEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    ArquivadaEm = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_metas", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_metas_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "financas_meta_aportes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    MetaId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Valor = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    Data = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    Observacoes = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    TransacaoId = table.Column<Guid>(type: "TEXT", nullable: true),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_meta_aportes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_meta_aportes_financas_metas_MetaId",
                        column: x => x.MetaId,
                        principalTable: "financas_metas",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_financas_meta_aportes_financas_transacoes_TransacaoId",
                        column: x => x.TransacaoId,
                        principalTable: "financas_transacoes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_financas_meta_aportes_MetaId",
                table: "financas_meta_aportes",
                column: "MetaId");

            migrationBuilder.CreateIndex(
                name: "IX_financas_meta_aportes_TransacaoId",
                table: "financas_meta_aportes",
                column: "TransacaoId",
                unique: true,
                filter: "\"TransacaoId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_financas_metas_UserId",
                table: "financas_metas",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "financas_meta_aportes");

            migrationBuilder.DropTable(
                name: "financas_metas");
        }
    }
}
