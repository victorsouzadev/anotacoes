using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskProjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "tasks_projects",
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
                    table.PrimaryKey("PK_tasks_projects", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tasks_projects_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_projects_UserId",
                table: "tasks_projects",
                column: "UserId");

            migrationBuilder.AddColumn<string>(
                name: "ProjectId",
                table: "tasks_kanban_lanes",
                type: "TEXT",
                nullable: true);

            // Backfill: cada usuário com raias hoje ganha um projeto "Geral" pra não perder o quadro
            // existente — quem não tem raia nenhuma não ganha projeto (lista de projetos começa vazia).
            migrationBuilder.Sql(
                @"INSERT INTO tasks_projects (Id, UserId, Name, ColorHex, Position, UpdatedAt)
                  SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
                         UserId, 'Geral', '#2563eb', 0, datetime('now')
                  FROM tasks_kanban_lanes
                  GROUP BY UserId;");

            migrationBuilder.Sql(
                @"UPDATE tasks_kanban_lanes
                  SET ProjectId = (SELECT p.Id FROM tasks_projects p WHERE p.UserId = tasks_kanban_lanes.UserId AND p.Name = 'Geral');");

            migrationBuilder.DropIndex(
                name: "IX_tasks_kanban_lanes_UserId_Position",
                table: "tasks_kanban_lanes");

            migrationBuilder.AlterColumn<string>(
                name: "ProjectId",
                table: "tasks_kanban_lanes",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_tasks_kanban_lanes_ProjectId_Position",
                table: "tasks_kanban_lanes",
                columns: new[] { "ProjectId", "Position" });

            migrationBuilder.AddForeignKey(
                name: "FK_tasks_kanban_lanes_tasks_projects_ProjectId",
                table: "tasks_kanban_lanes",
                column: "ProjectId",
                principalTable: "tasks_projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.CreateTable(
                name: "tasks_project_memberships",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", nullable: false),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    TaskId = table.Column<string>(type: "TEXT", nullable: false),
                    ProjectId = table.Column<string>(type: "TEXT", nullable: false),
                    KanbanLaneId = table.Column<string>(type: "TEXT", nullable: true),
                    Position = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tasks_project_memberships", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tasks_project_memberships_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_tasks_project_memberships_tasks_items_TaskId",
                        column: x => x.TaskId,
                        principalTable: "tasks_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_tasks_project_memberships_tasks_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "tasks_projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_tasks_project_memberships_tasks_kanban_lanes_KanbanLaneId",
                        column: x => x.KanbanLaneId,
                        principalTable: "tasks_kanban_lanes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_project_memberships_TaskId_ProjectId",
                table: "tasks_project_memberships",
                columns: new[] { "TaskId", "ProjectId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tasks_project_memberships_ProjectId_Position",
                table: "tasks_project_memberships",
                columns: new[] { "ProjectId", "Position" });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_project_memberships_UserId",
                table: "tasks_project_memberships",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_tasks_project_memberships_KanbanLaneId",
                table: "tasks_project_memberships",
                column: "KanbanLaneId");

            // Backfill: preserva o vínculo tarefa/raia existente como membership do projeto "Geral"
            // que a raia acabou de herdar.
            migrationBuilder.Sql(
                @"INSERT INTO tasks_project_memberships (Id, UserId, TaskId, ProjectId, KanbanLaneId, Position, UpdatedAt)
                  SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
                         ti.UserId, ti.Id, kl.ProjectId, ti.KanbanLaneId, ti.Position, datetime('now')
                  FROM tasks_items ti
                  JOIN tasks_kanban_lanes kl ON kl.Id = ti.KanbanLaneId
                  WHERE ti.KanbanLaneId IS NOT NULL;");

            migrationBuilder.DropForeignKey(
                name: "FK_tasks_items_tasks_kanban_lanes_KanbanLaneId",
                table: "tasks_items");

            migrationBuilder.DropIndex(
                name: "IX_tasks_items_KanbanLaneId",
                table: "tasks_items");

            migrationBuilder.DropColumn(
                name: "KanbanLaneId",
                table: "tasks_items");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "KanbanLaneId",
                table: "tasks_items",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_tasks_items_KanbanLaneId",
                table: "tasks_items",
                column: "KanbanLaneId");

            migrationBuilder.DropTable(
                name: "tasks_project_memberships");

            migrationBuilder.DropForeignKey(
                name: "FK_tasks_kanban_lanes_tasks_projects_ProjectId",
                table: "tasks_kanban_lanes");

            migrationBuilder.DropIndex(
                name: "IX_tasks_kanban_lanes_ProjectId_Position",
                table: "tasks_kanban_lanes");

            migrationBuilder.DropColumn(
                name: "ProjectId",
                table: "tasks_kanban_lanes");

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

            migrationBuilder.DropTable(
                name: "tasks_projects");
        }
    }
}
