using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDieta : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "dieta_agua",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Data = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    Ml = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dieta_agua", x => x.Id);
                    table.ForeignKey(
                        name: "FK_dieta_agua_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "dieta_alimentos",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: true),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Kcal = table.Column<double>(type: "REAL", nullable: false),
                    Proteina = table.Column<double>(type: "REAL", nullable: false),
                    Carbo = table.Column<double>(type: "REAL", nullable: false),
                    Gordura = table.Column<double>(type: "REAL", nullable: false),
                    Fibra = table.Column<double>(type: "REAL", nullable: false),
                    Sodio = table.Column<double>(type: "REAL", nullable: false),
                    PorcaoG = table.Column<double>(type: "REAL", nullable: false),
                    PorcaoNome = table.Column<string>(type: "TEXT", nullable: true),
                    CodigoBarras = table.Column<string>(type: "TEXT", maxLength: 32, nullable: true),
                    Fonte = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    Itens = table.Column<string>(type: "TEXT", nullable: true),
                    Favorito = table.Column<bool>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dieta_alimentos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_dieta_alimentos_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "dieta_compartilhamentos",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Token = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    Titulo = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Escopos = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    ExpiraEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    RevogadoEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dieta_compartilhamentos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_dieta_compartilhamentos_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "dieta_fotos",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Data = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    Tipo = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    Rotulo = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    ContentType = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    SizeBytes = table.Column<int>(type: "INTEGER", nullable: false),
                    Conteudo = table.Column<byte[]>(type: "BLOB", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dieta_fotos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_dieta_fotos_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "dieta_perfis",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    AlturaCm = table.Column<double>(type: "REAL", nullable: false),
                    Nascimento = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    Sexo = table.Column<string>(type: "TEXT", maxLength: 1, nullable: false),
                    Atividade = table.Column<double>(type: "REAL", nullable: false),
                    Objetivo = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    MetaKcal = table.Column<int>(type: "INTEGER", nullable: false),
                    MetaProteinaG = table.Column<int>(type: "INTEGER", nullable: false),
                    MetaCarboG = table.Column<int>(type: "INTEGER", nullable: false),
                    MetaGorduraG = table.Column<int>(type: "INTEGER", nullable: false),
                    MetaAguaMl = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dieta_perfis", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_dieta_perfis_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "dieta_pesos",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Data = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    Kg = table.Column<double>(type: "REAL", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dieta_pesos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_dieta_pesos_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "dieta_plano",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    DiaSemana = table.Column<int>(type: "INTEGER", nullable: false),
                    Refeicao = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    AlimentoId = table.Column<string>(type: "TEXT", nullable: true),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    QuantidadeG = table.Column<double>(type: "REAL", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dieta_plano", x => x.Id);
                    table.ForeignKey(
                        name: "FK_dieta_plano_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "dieta_registros",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Data = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    Refeicao = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    AlimentoId = table.Column<string>(type: "TEXT", nullable: true),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    QuantidadeG = table.Column<double>(type: "REAL", nullable: false),
                    Kcal = table.Column<double>(type: "REAL", nullable: false),
                    Proteina = table.Column<double>(type: "REAL", nullable: false),
                    Carbo = table.Column<double>(type: "REAL", nullable: false),
                    Gordura = table.Column<double>(type: "REAL", nullable: false),
                    Fibra = table.Column<double>(type: "REAL", nullable: false),
                    FotoId = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dieta_registros", x => x.Id);
                    table.ForeignKey(
                        name: "FK_dieta_registros_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_dieta_agua_UserId_Data",
                table: "dieta_agua",
                columns: new[] { "UserId", "Data" });

            migrationBuilder.CreateIndex(
                name: "IX_dieta_alimentos_UserId_CodigoBarras",
                table: "dieta_alimentos",
                columns: new[] { "UserId", "CodigoBarras" });

            migrationBuilder.CreateIndex(
                name: "IX_dieta_alimentos_UserId_UpdatedAt",
                table: "dieta_alimentos",
                columns: new[] { "UserId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_dieta_compartilhamentos_Token",
                table: "dieta_compartilhamentos",
                column: "Token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_dieta_compartilhamentos_UserId",
                table: "dieta_compartilhamentos",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_dieta_fotos_UserId_Data",
                table: "dieta_fotos",
                columns: new[] { "UserId", "Data" });

            migrationBuilder.CreateIndex(
                name: "IX_dieta_pesos_UserId_Data",
                table: "dieta_pesos",
                columns: new[] { "UserId", "Data" });

            migrationBuilder.CreateIndex(
                name: "IX_dieta_plano_UserId",
                table: "dieta_plano",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_dieta_registros_UserId_Data",
                table: "dieta_registros",
                columns: new[] { "UserId", "Data" });

            migrationBuilder.CreateIndex(
                name: "IX_dieta_registros_UserId_UpdatedAt",
                table: "dieta_registros",
                columns: new[] { "UserId", "UpdatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "dieta_agua");

            migrationBuilder.DropTable(
                name: "dieta_alimentos");

            migrationBuilder.DropTable(
                name: "dieta_compartilhamentos");

            migrationBuilder.DropTable(
                name: "dieta_fotos");

            migrationBuilder.DropTable(
                name: "dieta_perfis");

            migrationBuilder.DropTable(
                name: "dieta_pesos");

            migrationBuilder.DropTable(
                name: "dieta_plano");

            migrationBuilder.DropTable(
                name: "dieta_registros");
        }
    }
}
