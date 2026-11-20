# Research: Extrair e congelar as ferramentas sem uso

- **Um repositório para as criativas**: **Decision** `hub-criativo`. Moldes usa geometria e impressão em folha do Editor de Imagens; Precificação e Bolo 3D atendem o mesmo negócio (Viih Mimos). Separar em quatro criaria quatro CIs paradas. **Alternatives**: um por ferramenta (rejeitado pelo custo); deixar no núcleo (rejeitado: é o que mais pesa no build e nos testes).
- **Treino à parte**: tem MCP e tela nova (017) e é o único com chance de voltar a uso diário (atividades físicas). Separado, pode ser descongelado sem mexer no criativo.
- **App Windows**: **Decision** o `Servidor.cs` passa a chamar `CriativoApp.Build` no lugar de `NotasApp.Build`, com o mesmo modo desktop (login local). **Alternatives**: aposentar o app (rejeitado: é a forma de usar o Editor sem a VPS).
- **Helpers compartilhados**: **Decision** cópia de `shared/pdf.ts` e `shared/heic.ts` no criativo. Pacote só para isso (rejeitado: o criativo está congelado, a cópia não diverge).
- **Marcar congelado**: campo `"congelado": true` no manifesto (vira opcional no schema da 032); o hub mostra o card normal e Configurações → Servidor lista "congelado".
