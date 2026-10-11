using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCompetenciaTagsRegras : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "Competencia",
                table: "financas_transacoes",
                type: "TEXT",
                nullable: false,
                defaultValue: new DateOnly(1, 1, 1));

            migrationBuilder.AddColumn<string>(
                name: "Conta",
                table: "financas_transacoes",
                type: "TEXT",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OrcamentoAuvp",
                table: "financas_transacoes",
                type: "TEXT",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Parcela",
                table: "financas_transacoes",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Tags",
                table: "financas_transacoes",
                type: "TEXT",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TotalParcelas",
                table: "financas_transacoes",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "financas_regras_categoria",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Chave = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Categoria = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    AtualizadaEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_regras_categoria", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_regras_categoria_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "financas_transacoes_excluidas",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Origem = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    IdExterno = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    ExcluidaEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_transacoes_excluidas", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_transacoes_excluidas_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Lançamentos existentes contam no mês da própria data.
            migrationBuilder.Sql(
                "UPDATE financas_transacoes SET Competencia = substr(Data, 1, 7) || '-01';");

            migrationBuilder.CreateIndex(
                name: "IX_financas_transacoes_UserId_Competencia",
                table: "financas_transacoes",
                columns: new[] { "UserId", "Competencia" });

            migrationBuilder.CreateIndex(
                name: "IX_financas_regras_categoria_UserId_Chave",
                table: "financas_regras_categoria",
                columns: new[] { "UserId", "Chave" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_financas_transacoes_excluidas_UserId_Origem_IdExterno",
                table: "financas_transacoes_excluidas",
                columns: new[] { "UserId", "Origem", "IdExterno" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "financas_regras_categoria");

            migrationBuilder.DropTable(
                name: "financas_transacoes_excluidas");

            migrationBuilder.DropIndex(
                name: "IX_financas_transacoes_UserId_Competencia",
                table: "financas_transacoes");

            migrationBuilder.DropColumn(
                name: "Competencia",
                table: "financas_transacoes");

            migrationBuilder.DropColumn(
                name: "Conta",
                table: "financas_transacoes");

            migrationBuilder.DropColumn(
                name: "OrcamentoAuvp",
                table: "financas_transacoes");

            migrationBuilder.DropColumn(
                name: "Parcela",
                table: "financas_transacoes");

            migrationBuilder.DropColumn(
                name: "Tags",
                table: "financas_transacoes");

            migrationBuilder.DropColumn(
                name: "TotalParcelas",
                table: "financas_transacoes");
        }
    }
}
