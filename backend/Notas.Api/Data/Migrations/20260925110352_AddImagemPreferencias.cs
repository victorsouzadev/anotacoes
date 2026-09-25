using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddImagemPreferencias : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "imagem_preferencias",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Data = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_imagem_preferencias", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_imagem_preferencias_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "imagem_preferencias");
        }
    }
}
