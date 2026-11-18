using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class NoteShares : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "note_shares",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    NoteId = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    TokenHash = table.Column<string>(type: "TEXT", nullable: false),
                    Nome = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    ExpiraEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    RevogadoEm = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_note_shares", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_note_shares_TokenHash",
                table: "note_shares",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_note_shares_UserId_NoteId",
                table: "note_shares",
                columns: new[] { "UserId", "NoteId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "note_shares");
        }
    }
}
