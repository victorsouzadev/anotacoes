// O servidor sobe a aplicação montada em NotasApp — a mesma que a versão
// desktop hospeda dentro do próprio programa.
Notas.Api.NotasApp.Build(args).Run();

// Torna a classe Program (implícita em top-level statements) acessível ao projeto de testes
// via WebApplicationFactory<Program>.
public partial class Program { }
