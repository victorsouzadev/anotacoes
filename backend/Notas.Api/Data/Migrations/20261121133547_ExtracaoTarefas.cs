using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <summary>
    /// Spec 035: as tabelas tasks_* passam para o plug-in tarefas (banco compartilhado, 031).
    /// Escrita à mão e vazia: o EF geraria DropTable, e os dados continuam lá, agora com outro dono.
    /// </summary>
    public partial class ExtracaoTarefas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder) { }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder) { }
    }
}
