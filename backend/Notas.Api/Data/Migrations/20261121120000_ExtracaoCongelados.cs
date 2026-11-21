using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Notas.Api.Data.Migrations
{
    /// <summary>
    /// Spec 034: as tabelas imagem_* e treino_* passam para os plug-ins criativo e treino (banco compartilhado, 031).
    /// Escrita à mão e vazia: o EF geraria DropTable, e os dados continuam lá, agora com outro dono.
    /// </summary>
    public partial class ExtracaoCongelados : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder) { }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder) { }
    }
}
