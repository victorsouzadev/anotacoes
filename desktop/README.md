# Editor de Imagens — versão Windows

O mesmo Editor de Imagens do site, como um programa do Windows que funciona
**100% sem internet** e usa o PC: placa de vídeo para as IAs, disco para os
projetos, impressora e Silhouette Studio direto.

## Como funciona

```
EditorImagens.exe (WPF)
 ├─ WebView2 (o Edge do Windows) mostrando o Angular do site
 ├─ a API do site (Notas.Api) rodando dentro do programa, em 127.0.0.1,
 │   com um banco SQLite em %LocalAppData%\EditorImagens.Dados
 ├─ IAs locais (ONNX Runtime + DirectML: qualquer GPU, NVIDIA inclusive)
 └─ /api/desktop/*: arquivos, impressora, Studio, fontes, pasta monitorada
```

- A página e a API são as mesmas do site (`NotasApp.Build`); o programa só troca
  a fábrica de IA (`IaLocalFactory`) e acrescenta os endpoints do desktop.
- Não há login: a janela injeta uma chave aleatória (muda a cada abertura) e a
  página entra sozinha como o usuário local (`POST /api/auth/local`). Os
  endpoints do desktop exigem essa chave (`X-Desktop-Key`), além de a API escutar
  só em 127.0.0.1.
- Uma instância por usuário: abrir outro `.edimg` com o programa aberto manda o
  arquivo para a janela que já existe.

## O que tem a mais que o site

| Recurso | Onde |
|---|---|
| Projetos em arquivo `.edimg` (Abrir, Salvar Ctrl+S, Salvar como Ctrl+Shift+S, recentes, duplo clique no Explorer) | Barra de cima › Abrir |
| Exportar direto numa pasta ("Salvar como" do Windows) e **Mostrar na pasta** | Qualquer botão de exportar |
| Remover fundo (BiRefNet) e ampliar (Real-ESRGAN ×2/×4) na placa de vídeo | Os mesmos botões de IA do site |
| Impressão direta em tamanho real, com calibração por impressora | Print & Cut › Folha |
| Abrir no Silhouette Studio (grava o pacote em Documentos e abre o DXF) | Print & Cut › Folha, máquina Silhouette |
| Fontes instaladas no Windows no texto | Ilustração › seletor de fonte › Fontes do Windows |
| Pasta monitorada: cada foto que chega sai com o look do lote em `prontas\` | Redes sociais › Exportar › Lote |

Fica de fora no desktop: **luz por IA** (modelo de difusão pesado demais para
rodar local; o botão some) e os **nomes por IA** dos arquivos do ZIP (usam
LLM na nuvem; sem chave, cai no nome padrão).

### Arquivo `.edimg`

Um ZIP com `projeto.json` (nome, versão do formato) e `dados.json` (o mesmo
JSON que o site guarda na conta, com as artes embutidas). Grava num arquivo ao
lado e troca no fim, então queda de energia no meio não estraga o que existia.
O rascunho automático do editor continua valendo por cima disso.

### Impressão e calibração

A folha é enviada ao driver como uma página do tamanho exato do papel (XPS
`FixedPage`, posições a partir da borda do papel), sem "ajustar à página".
Cada impressora desloca e estica um pouco o que imprime; em **Calibrar**:

1. imprima a página de calibração (cruz a 20 mm das bordas, réguas de 150 e 200 mm);
2. meça com régua A (borda esquerda → cruz), B (borda de cima → cruz), C (régua
   de cima) e D (régua da esquerda);
3. salve. O editor calcula o deslocamento e a escala (`impresso = x·s + o`,
   então desenha em `x/s − o/s`) e guarda por impressora.

## Desenvolvimento

Compila em qualquer sistema (`EnableWindowsTargeting`); roda só no Windows.

```bash
cd desktop
dotnet build EditorImagens.sln
dotnet test tests/EditorImagens.Ia.Tests                # sem modelos: pula os testes de IA real
EDITOR_MODELOS=/caminho/modelos dotnet test tests/EditorImagens.Ia.Tests
```

Para rodar no Windows a partir do código: compile o Angular
(`cd frontend && npx ng build`) e copie `dist/frontend/browser` para
`desktop/src/EditorImagens.Desktop/wwwroot`; ponha os modelos em
`desktop/src/EditorImagens.Desktop/modelos` (`birefnet.onnx`,
`real_esrgan_x4plus.onnx` e `real_esrgan_x4plus.data` — os links estão em
`.github/workflows/desktop.yml`). As duas pastas ficam fora do git.

| Projeto | O quê |
|---|---|
| `src/EditorImagens.Desktop` | O programa (WPF + WebView2), a hospedagem da API e os endpoints do desktop |
| `src/EditorImagens.Ia` | Recorte e ampliação com ONNX Runtime (sem WPF; testável no Linux) |
| `tests/EditorImagens.Ia.Tests` | Ladrilhos da ampliação, máscara do recorte, modelos reais, `.edimg`, hospedagem |

## Instalador, download e atualizações

O workflow **Desktop (Windows)** (Actions › Run workflow, com a versão; ou a tag
`desktop-v1.2.3`) monta tudo num `Setup.exe` (Velopack: instala por usuário,
sem pedir administrador, e instala o WebView2 se faltar) e **publica no site**:

- grava em `/opt/notas-vps/downloads/windows` na VPS, que o Caddy serve em
  `/downloads/windows/` (fora da imagem do site: o instalador tem centenas de MB
  e muda sem novo deploy). Fica só a última versão;
- o site mostra **Baixar para Windows** no card do Editor de Imagens (tela
  inicial) e na barra do editor — só quando existe um `versao.json` publicado;
- o programa instalado busca atualização nesse mesmo endereço ao abrir (com
  internet), baixa em segundo plano e aplica ao fechar. Projetos e
  configurações ficam em `%LocalAppData%\EditorImagens.Dados`, fora da pasta do
  programa, e sobrevivem às atualizações;
- com a tag, também sai uma Release no GitHub.

A primeira vez exige um deploy da main antes (é ele que monta a pasta
`downloads` no container do Caddy); o workflow confere o link no fim e avisa se
faltar isso. Espaço na VPS: ~800 MB (instalador + pacote de atualização).

Modelos: BiRefNet (licença MIT) e Real-ESRGAN (BSD-3), dentro do instalador.

## F6 — cortar direto pela USB (avaliado, não implementado)

A ideia era mandar o corte para a Cameo 5 sem passar pelo Silhouette Studio.
Conclusão da avaliação: **não vale o risco agora**.

- A Silhouette não documenta o protocolo. O que existe é engenharia reversa
  (GPGL, usada por projetos como `inkscape-silhouette` e `gpgl`), com suporte
  parcial e instável à Cameo 5.
- No Windows, falar com a máquina por libusb exige **trocar o driver** do
  dispositivo (Zadig/WinUSB). Com o driver trocado, **o Silhouette Studio deixa
  de enxergar a máquina** até desfazer a troca no Gerenciador de Dispositivos —
  exatamente o programa que você usa para imprimir com as marcas.
- A leitura das marcas de registro (o que torna o Print & Cut preciso) é feita
  pelo sensor sob comando do Studio; reproduzir isso por fora é a parte menos
  confiável da engenharia reversa.
- Um erro de comando pode levar a lâmina a cortar fora do papel ou
  forçar a esteira.

O caminho escolhido é o **Abrir no Silhouette Studio**: o editor grava o
pacote alinhado (PNG + DXF + passo a passo) e abre o DXF no Studio, que
continua cuidando das marcas e do corte. Se um dia a Silhouette publicar um SDK
ou o Studio ganhar linha de comando para enviar o corte, vale reavaliar.
