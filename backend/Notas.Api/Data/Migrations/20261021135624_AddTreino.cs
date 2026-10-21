using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTreino : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "treino_atividades",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Inicio = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Tipo = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    Titulo = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    DuracaoSeg = table.Column<int>(type: "INTEGER", nullable: false),
                    DistanciaM = table.Column<double>(type: "REAL", nullable: false),
                    MaiorCorridaSeg = table.Column<int>(type: "INTEGER", nullable: true),
                    Esforco = table.Column<int>(type: "INTEGER", nullable: true),
                    Dor = table.Column<bool>(type: "INTEGER", nullable: false),
                    Meta = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    FcMedia = table.Column<int>(type: "INTEGER", nullable: true),
                    FcMax = table.Column<int>(type: "INTEGER", nullable: true),
                    Nota = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_treino_atividades", x => x.Id);
                    table.ForeignKey(
                        name: "FK_treino_atividades_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "treino_planos",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Programa = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Semana = table.Column<int>(type: "INTEGER", nullable: false),
                    SemanasTotal = table.Column<int>(type: "INTEGER", nullable: false),
                    SessoesFeitas = table.Column<int>(type: "INTEGER", nullable: false),
                    SessoesTotal = table.Column<int>(type: "INTEGER", nullable: false),
                    ProximaSessao = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_treino_planos", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_treino_planos_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_treino_atividades_UserId_Inicio",
                table: "treino_atividades",
                columns: new[] { "UserId", "Inicio" });

            migrationBuilder.CreateIndex(
                name: "IX_treino_atividades_UserId_UpdatedAt",
                table: "treino_atividades",
                columns: new[] { "UserId", "UpdatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "treino_atividades");

            migrationBuilder.DropTable(
                name: "treino_planos");
        }
    }
}
