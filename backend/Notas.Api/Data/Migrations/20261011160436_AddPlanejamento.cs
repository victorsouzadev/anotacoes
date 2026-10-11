using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPlanejamento : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "financas_dividas",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Saldo = table.Column<decimal>(type: "decimal(14,2)", nullable: false),
                    JurosMensal = table.Column<decimal>(type: "decimal(6,3)", nullable: false),
                    ParcelaMinima = table.Column<decimal>(type: "decimal(14,2)", nullable: false),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_dividas", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_dividas_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "financas_fechamentos",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Ano = table.Column<int>(type: "INTEGER", nullable: false),
                    Mes = table.Column<int>(type: "INTEGER", nullable: false),
                    MetaPoupanca = table.Column<decimal>(type: "decimal(14,2)", nullable: true),
                    Reflexao = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    Compromisso = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    AtualizadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_fechamentos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_fechamentos_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "financas_preferencias",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Metodo = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    MesesReserva = table.Column<int>(type: "INTEGER", nullable: false),
                    MetaReservaId = table.Column<Guid>(type: "TEXT", nullable: true),
                    PercentualPagueSePrimeiro = table.Column<decimal>(type: "decimal(5,2)", nullable: false),
                    PatrimonioInvestido = table.Column<decimal>(type: "decimal(14,2)", nullable: false),
                    SaldoInicialFluxo = table.Column<decimal>(type: "decimal(14,2)", nullable: true),
                    AtualizadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_preferencias", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_preferencias_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "financas_provisoes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Valor = table.Column<decimal>(type: "decimal(14,2)", nullable: false),
                    MesVencimento = table.Column<int>(type: "INTEGER", nullable: false),
                    ValorReservado = table.Column<decimal>(type: "decimal(14,2)", nullable: false),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_financas_provisoes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_financas_provisoes_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_financas_dividas_UserId",
                table: "financas_dividas",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_financas_fechamentos_UserId_Ano_Mes",
                table: "financas_fechamentos",
                columns: new[] { "UserId", "Ano", "Mes" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_financas_preferencias_UserId",
                table: "financas_preferencias",
                column: "UserId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_financas_provisoes_UserId",
                table: "financas_provisoes",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "financas_dividas");

            migrationBuilder.DropTable(
                name: "financas_fechamentos");

            migrationBuilder.DropTable(
                name: "financas_preferencias");

            migrationBuilder.DropTable(
                name: "financas_provisoes");
        }
    }
}
