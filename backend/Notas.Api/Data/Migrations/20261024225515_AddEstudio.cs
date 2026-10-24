using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEstudio : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "estudio_config",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    ChaveFalCifrada = table.Column<string>(type: "TEXT", nullable: true),
                    ChaveFalSufixo = table.Column<string>(type: "TEXT", maxLength: 8, nullable: true),
                    ChaveWorldLabsCifrada = table.Column<string>(type: "TEXT", nullable: true),
                    ChaveWorldLabsSufixo = table.Column<string>(type: "TEXT", maxLength: 8, nullable: true),
                    LimiteMensalCentavos = table.Column<int>(type: "INTEGER", nullable: true),
                    ConfirmarAcimaCentavos = table.Column<int>(type: "INTEGER", nullable: false),
                    AtualizadoEm = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_estudio_config", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_estudio_config_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "estudio_jobs",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    App = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    ModeloId = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Operacao = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    Provedor = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Endpoint = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Parametros = table.Column<string>(type: "TEXT", nullable: false),
                    Entradas = table.Column<string>(type: "TEXT", nullable: false),
                    Resultado = table.Column<string>(type: "TEXT", nullable: false),
                    Pipeline = table.Column<string>(type: "TEXT", nullable: true),
                    RequestId = table.Column<string>(type: "TEXT", nullable: true),
                    StatusUrl = table.Column<string>(type: "TEXT", nullable: true),
                    ResponseUrl = table.Column<string>(type: "TEXT", nullable: true),
                    CancelUrl = table.Column<string>(type: "TEXT", nullable: true),
                    PosicaoFila = table.Column<int>(type: "INTEGER", nullable: true),
                    Mensagem = table.Column<string>(type: "TEXT", nullable: true),
                    Erro = table.Column<string>(type: "TEXT", nullable: true),
                    CustoEstimadoCentavos = table.Column<double>(type: "REAL", nullable: false),
                    LinkExterno = table.Column<string>(type: "TEXT", nullable: true),
                    Tentativas = table.Column<int>(type: "INTEGER", nullable: false),
                    ProximaConsulta = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    AtualizadoEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ConcluidoEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    Oculto = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_estudio_jobs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_estudio_jobs_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "estudio_midias",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Tipo = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    ContentType = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Arquivo = table.Column<string>(type: "TEXT", maxLength: 400, nullable: false),
                    Tamanho = table.Column<long>(type: "INTEGER", nullable: false),
                    Largura = table.Column<int>(type: "INTEGER", nullable: true),
                    Altura = table.Column<int>(type: "INTEGER", nullable: true),
                    DuracaoSeg = table.Column<double>(type: "REAL", nullable: true),
                    Origem = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    JobId = table.Column<string>(type: "TEXT", nullable: true),
                    ModeloId = table.Column<string>(type: "TEXT", nullable: true),
                    Prompt = table.Column<string>(type: "TEXT", nullable: true),
                    Pasta = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    Favorito = table.Column<bool>(type: "INTEGER", nullable: false),
                    Thumb = table.Column<string>(type: "TEXT", nullable: true),
                    FalUrl = table.Column<string>(type: "TEXT", nullable: true),
                    FalUrlEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CriadoEm = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_estudio_midias", x => x.Id);
                    table.ForeignKey(
                        name: "FK_estudio_midias_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "estudio_quadros",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Tipo = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    Data = table.Column<string>(type: "TEXT", nullable: false),
                    Thumb = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_estudio_quadros", x => x.Id);
                    table.ForeignKey(
                        name: "FK_estudio_quadros_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_estudio_jobs_Status",
                table: "estudio_jobs",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_estudio_jobs_UserId_CriadoEm",
                table: "estudio_jobs",
                columns: new[] { "UserId", "CriadoEm" });

            migrationBuilder.CreateIndex(
                name: "IX_estudio_midias_JobId",
                table: "estudio_midias",
                column: "JobId");

            migrationBuilder.CreateIndex(
                name: "IX_estudio_midias_UserId_CriadoEm",
                table: "estudio_midias",
                columns: new[] { "UserId", "CriadoEm" });

            migrationBuilder.CreateIndex(
                name: "IX_estudio_quadros_UserId_Tipo_UpdatedAt",
                table: "estudio_quadros",
                columns: new[] { "UserId", "Tipo", "UpdatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "estudio_config");

            migrationBuilder.DropTable(
                name: "estudio_jobs");

            migrationBuilder.DropTable(
                name: "estudio_midias");

            migrationBuilder.DropTable(
                name: "estudio_quadros");
        }
    }
}
