using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MultiCategoryTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tasks_items_tasks_categories_CategoryId",
                table: "tasks_items");

            migrationBuilder.DropIndex(
                name: "IX_tasks_items_CategoryId",
                table: "tasks_items");

            migrationBuilder.AddColumn<string>(
                name: "CategoryIds",
                table: "tasks_items",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");

            // Preserva a categoria única existente de cada tarefa como o primeiro (e único) item da
            // nova lista, antes de descartar a coluna antiga.
            migrationBuilder.Sql(
                "UPDATE tasks_items SET CategoryIds = '[\"' || CategoryId || '\"]' WHERE CategoryId IS NOT NULL;");

            migrationBuilder.DropColumn(
                name: "CategoryId",
                table: "tasks_items");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CategoryIds",
                table: "tasks_items");

            migrationBuilder.AddColumn<string>(
                name: "CategoryId",
                table: "tasks_items",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_tasks_items_CategoryId",
                table: "tasks_items",
                column: "CategoryId");

            migrationBuilder.AddForeignKey(
                name: "FK_tasks_items_tasks_categories_CategoryId",
                table: "tasks_items",
                column: "CategoryId",
                principalTable: "tasks_categories",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
