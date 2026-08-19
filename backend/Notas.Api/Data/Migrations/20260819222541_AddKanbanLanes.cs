using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddKanbanLanes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "KanbanLaneId",
                table: "tasks_items",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "tasks_kanban_lanes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    ColorHex = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Position = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tasks_kanban_lanes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tasks_kanban_lanes_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_items_KanbanLaneId",
                table: "tasks_items",
                column: "KanbanLaneId");

            migrationBuilder.CreateIndex(
                name: "IX_tasks_kanban_lanes_UserId_Position",
                table: "tasks_kanban_lanes",
                columns: new[] { "UserId", "Position" });

            migrationBuilder.AddForeignKey(
                name: "FK_tasks_items_tasks_kanban_lanes_KanbanLaneId",
                table: "tasks_items",
                column: "KanbanLaneId",
                principalTable: "tasks_kanban_lanes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tasks_items_tasks_kanban_lanes_KanbanLaneId",
                table: "tasks_items");

            migrationBuilder.DropTable(
                name: "tasks_kanban_lanes");

            migrationBuilder.DropIndex(
                name: "IX_tasks_items_KanbanLaneId",
                table: "tasks_items");

            migrationBuilder.DropColumn(
                name: "KanbanLaneId",
                table: "tasks_items");
        }
    }
}
