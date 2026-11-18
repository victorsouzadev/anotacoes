# Feature Specification: Editor de Imagens (web e Windows)

**Feature Branch**: `007-editor-imagens` (spec retroativa, sem branch)

**Created**: 2026-11-18

**Status**: Implementado — spec retroativa, descreve o comportamento atual

**Input**: Levantamento do código existente: `features/imagem`, `Endpoints/ImagemEndpoints.cs`, `Services/Imagens`, `desktop/` e seções "Editor de Imagens" e "Versão Windows" do README.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Print & Cut: preparar arte para a recortadora (Priority: P1)

A pessoa importa PNG/JPG, remove o fundo (clique com tolerância, borracha ou IA), gera o contorno com margem em mm (na silhueta ou forma analítica), monta a folha A4/A3/Carta com cópias e exporta para a ScanNCut ou Silhouette.

**Why this priority**: É o fluxo original e o mais usado para produção de papelaria.

**Independent Test**: Importar um PNG, gerar contorno de 3 mm, encher uma A4 e exportar o PDF impressão + corte; imprimir e cortar com as linhas batendo.

**Acceptance Scenarios**:

1. **Given** uma arte com borda anti-serrilhada, **When** o contorno é gerado, **Then** a linha segue a borda com precisão subpixel, suavizada e em curvas de Bézier, preservando cantos propositais, sem invadir a margem impressa.
2. **Given** várias peças, **When** a pessoa escolhe encaixe por silhueta, **Then** as peças entram pelo formato real (com giros de 90°) e cabem mais peças que em linhas.
3. **Given** máquina Silhouette (Studio Basic), **When** exporta, **Then** recebe o Pacote com PNG 300 DPI, DXF R12 em mm com moldura da página e passo a passo, com a faixa das marcas de registro reservada.
4. **Given** uma folha de adesivos, **When** exporta, **Then** meio-corte das peças e corte total da folha saem em camadas e DXFs separados.
5. **Given** qualquer folha, **When** a pessoa usa "Simular corte", **Then** vê a lâmina percorrer as linhas com comprimento e tempo estimados.
6. **Given** exportação PNG/PDF/SVG, **Then** as posições batem entre impressão e corte e o PNG traz o DPI gravado.

---

### User Story 2 - Molde SVG: encaixar fotos num molde (Priority: P2)

A pessoa sobe um `.svg` próprio (ou escolhe um molde pronto, ou cria um a partir de PNG transparente); os encaixes são achados pela convenção de nome ou marcados com clique; as fotos são recortadas no contorno, com várias por encaixe, ordem, opacidade e frente/atrás do molde; textos do molde são editáveis.

**Independent Test**: Subir um SVG com um `<rect id="foto1">`, encaixar duas fotos, uma atrás e uma na frente, e exportar o SVG editável no Inkscape.

**Acceptance Scenarios**:

1. **Given** um SVG com `<script>`, handlers `on*`, `<foreignObject>` ou referência externa, **When** é carregado, **Then** tudo isso é removido, o `<style>` vira inline e os ids ganham prefixo.

---

### User Story 3 - Redes sociais: foto pronta para post (Priority: P3)

Formatos, 34 filtros, cor e luz, ampliação e luz por IA, Automático, textos e figurinhas arrastáveis, carrossel de 2 a 10 posts e lote (mesmo look em várias fotos), exportados em ZIP.

---

### User Story 4 - Ilustração: editor vetorial para corte e impressão (Priority: P2)

Palco SVG em mm; interface no estilo Illustrator/Inkscape (ferramentas, barra de controle, dock com Propriedades/Camadas/Vetorizar/Exportar, réguas, guias, grade, atalhos). Vetorização de imagem com leitura sugerida (logo, traço, clipart, foto, silhueta, linha central) em quatro modos, texto em curvas com 37 fontes ou fonte enviada (arco, caminho, círculo), operações booleanas, contorno com margem, edição de nós, caneta Bézier, lápis, borracha vetorial, pintura e efeitos, máscara, camada de caneta da máquina, modelos prontos e várias pranchetas.

**Independent Test**: Vetorizar um logo, escrever um nome em arco, soldar com a forma, gerar contorno de 2 mm e exportar o SVG só de corte.

---

### User Story 5 - Projeto único com rascunho, biblioteca e pacote (Priority: P1)

Os quatro modos convivem no mesmo projeto salvo na conta (JSON opaco até 9 MB). Rascunho automático no IndexedDB com "Recuperar"; desfazer/refazer em todos os modos; "Enviar para…" outro modo ou a Biblioteca da conta; Pacote ZIP com tudo o que o projeto produz e um LEIAME.

**Independent Test**: Trabalhar sem salvar, fechar a aba, voltar e recuperar o rascunho.

---

### User Story 6 - Versão Windows offline (Priority: P3)

Programa WPF + WebView2 com a mesma página e a mesma API rodando localmente: IAs de remover fundo e ampliar na GPU (ONNX + DirectML), projetos `.edimg`, exportação direta em pasta, impressão em tamanho real com calibração, "Abrir no Silhouette Studio", fontes do Windows e pasta monitorada no lote. Sem login; uma instância por usuário.

**Independent Test**: Sem internet, abrir um `.edimg`, remover fundo pela GPU e imprimir em tamanho real.

### Edge Cases

- Recursos cobrados (Replicate) só aparecem com chave configurada.
- Projeto acima de 9 MB é recusado.
- No desktop ficam de fora a luz por IA e os nomes de arquivo por IA (sem chave, nome padrão).
- `.edimg` é gravado num arquivo ao lado e trocado no fim, para não corromper em queda de energia.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O editor MUST ter quatro modos (Print & Cut, Molde SVG, Redes sociais, Ilustração) num mesmo projeto, com salvar, abrir e novo comuns.
- **FR-002**: O contorno de corte MUST ser vetorizado com precisão subpixel, suavizado em mm e exportado em Bézier, preservando a área e os cantos.
- **FR-003**: O sistema MUST exportar PNG 300 DPI, PDF em tamanho físico, PDF impressão + corte, SVG de corte e DXF R12 em mm.
- **FR-004**: SVG enviado pelo usuário MUST ser saneado antes de entrar na página.
- **FR-005**: O sistema MUST guardar rascunho local automático e oferecer recuperação.
- **FR-006**: O sistema MUST permitir mandar a arte entre modos e para a Biblioteca da conta.
- **FR-007**: IA cobrada por uso MUST nascer desligada e só aparecer com chave.
- **FR-008**: A versão Windows MUST reutilizar a mesma página e a mesma API, trocando só a fábrica de IA e acrescentando os endpoints do desktop.
- **FR-009**: Lógica de geometria, contorno, encaixe, vetorização e texto MUST ficar fora dos componentes Angular e ter testes.

### Key Entities

- **Projeto de imagem**: nome e JSON com o estado dos quatro modos e as artes embutidas.
- **Arte da Biblioteca**: imagem guardada na conta, com miniatura.
- **Preferências de corte**: anotações de material (lâmina, velocidade, força, passadas) por usuário.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Linhas de impressão e corte coincidem na peça física.
- **SC-002**: O encaixe por silhueta coloca pelo menos tantas peças quanto o arranjo em linhas, e o dobro em formas como estrelas.
- **SC-003**: Nenhum trabalho se perde ao fechar a aba sem salvar.

## Assumptions

- Máquinas-alvo: Brother ScanNCut e Silhouette (Studio Basic e Designer Edition).
- Corte direto pela USB não está implementado (avaliado em `desktop/README.md`).
