using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBackupPostgres : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "TemBackupPostgres",
                table: "sites_deployments",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TemBackupPostgres",
                table: "sites_deployments");
        }
    }
}
