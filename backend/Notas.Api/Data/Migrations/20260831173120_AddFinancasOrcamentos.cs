using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinancasOrcamentos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "financas_orcamentos",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Ano = table.Column<int>(type: "INTEGER", nullable: false),
                    Mes = table.Column<int>(type: "INTEGER", nullable: false),
                    ValorTotal = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    Observacoes = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    AtualizadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_orcamentos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_orcamentos_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "financas_orcamento_itens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OrcamentoId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Categoria = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    Percentual = table.Column<decimal>(type: "decimal(7,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_orcamento_itens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_orcamento_itens_financas_orcamentos_OrcamentoId",
                        column: x => x.OrcamentoId,
                        principalTable: "financas_orcamentos",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_financas_orcamento_itens_OrcamentoId_Categoria",
                table: "financas_orcamento_itens",
                columns: new[] { "OrcamentoId", "Categoria" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_financas_orcamentos_UserId_Ano_Mes",
                table: "financas_orcamentos",
                columns: new[] { "UserId", "Ano", "Mes" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "financas_orcamento_itens");

            migrationBuilder.DropTable(
                name: "financas_orcamentos");
        }
    }
}
