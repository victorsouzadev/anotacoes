# Componentes

Medidas em px. Classes entre parênteses são as de `assets/grafite.css`.
Estados comuns a tudo que é interativo:

| Estado | Regra |
| --- | --- |
| Hover | Escurece um passo (nanquim → nanquim-escuro; neutro → fundo `nanquim-tinta` ou borda `grafite-suave`) |
| Pressionado | Igual ao hover + `translateY(1px)` (sem escala) |
| Foco (teclado) | `outline: 2px solid nanquim; outline-offset: 2px`. Nunca remover sem substituto |
| Desabilitado | Opacidade .45, `cursor: not-allowed`, sem hover. Prefira explicar por que está desabilitado |
| Carregando | Mantém a largura, troca o rótulo por indicador + texto ("Salvando…") |

Alturas: **32** (compacto, desktop denso), **40** (padrão), **44** (toque,
padrão no celular). Alvo de toque mínimo 44×44 mesmo se o visual for menor.

## Botão (`g-btn`)

Rótulo em `rotulo` (13/18 500), ícone 20 opcional à esquerda, gap `esp-2`,
padding horizontal 16, `raio-md`, altura 40.

| Variante | Fundo | Texto | Borda | Quando |
| --- | --- | --- | --- | --- |
| Primário (`g-btn--primario`) | nanquim | sobre-nanquim | — | A ação principal. **Um por tela/diálogo** |
| Secundário (padrão) | folha | grafite | linha → grafite-suave no hover | Demais ações |
| Fantasma (`g-btn--fantasma`) | transparente | grafite-suave → grafite | — | Ações terciárias, "Cancelar" em barras |
| Perigo (`g-btn--perigo`) | folha | negativo | negativo 40% | Excluir. Sólido em negativo só no diálogo de confirmação |
| Ícone (`g-btn--icone`) | transparente | grafite-suave | — | 40×40 (32 compacto), `raio-sm`, `aria-label` obrigatório |

- Ordem num par: secundário à esquerda, primário à direita (desktop). No
  celular, primário embaixo ocupando a largura.
- Rótulo = verbo + objeto: "Salvar nota", "Importar extrato". Nunca "OK".

## Link

nanquim, sublinhado 1px com `text-underline-offset: 3px`; hover nanquim-escuro.
Dentro de texto corrido sempre sublinhado. Link não é botão: navega, não executa.

## Campo de texto (`g-campo`)

Estrutura: rótulo (`rotulo`, grafite, `esp-2` acima) → caixa → ajuda/erro
(`legenda` sem caixa alta, 12/16 400, grafite-suave, `esp-1` abaixo).

- Caixa: altura 40 (44 no toque), fundo folha, borda 1px `borda-controle`, `raio-md`, padding 0 12, texto `corpo`.
- Placeholder em grafite-suave; nunca substitui o rótulo.
- Foco: borda nanquim + anel `0 0 0 3px nanquim-tinta`.
- Erro: borda negativo, mensagem em negativo com ícone, dizendo como corrigir.
- Valor monetário/numérico: fonte `numero`, alinhado à direita, prefixo "R$"
  dentro da caixa em grafite-suave.
- Textarea: mesmo estilo, mínimo 3 linhas, redimensiona só na vertical.
- Select: mesmo estilo + chevron 16 à direita.
- Busca: ícone de lupa 16 à esquerda, botão limpar à direita quando tem texto.

## Checkbox, rádio e interruptor

- Checkbox (`g-check`): 18×18, `raio-sm`, borda 1.5px `borda-controle`. Marcado: fundo nanquim, visto em sobre-nanquim. Tarefa concluída:
  texto em grafite-suave com tachado.
- Rádio: 18 circular, ponto interno 8 nanquim.
- Interruptor (`g-switch`): 36×20 pílula; desligado trilho `linha` com borda
  `borda-controle` + bolinha folha; ligado trilho nanquim. Só para efeito imediato
  (sem botão Salvar).
- Rótulo clicável, à direita, `corpo`.

## Chip e tag

- Chip de filtro (`g-chip`): altura 32, padding 0 12, `raio-sm`, `rotulo`,
  borda linha, fundo folha. Marcado: fundo nanquim-tinta, borda nanquim, texto
  grafite, ícone de visto 16. (Não use nanquim sólido: isso disputa com o
  primário.)
- Tag (`g-tag`): altura 22, padding 0 8, `raio-sm`, 12/16 500, fundo tag
  neutra, texto grafite-suave. Estado: fundo cor do estado 12%, texto grafite,
  ponto 6 na cor do estado.
- Badge numérico (`g-badge`): pílula, mínimo 18, `numero` 11/16, fundo
  nanquim, texto sobre-nanquim. Só para contagem que exige ação.

## Cartão (`g-cartao`)

Fundo folha, borda 1px linha, `raio-md`, padding `esp-4` (24 no desktop
espaçoso), **sem sombra**.

- Cabeçalho: `titulo-3` + ação fantasma/ícone à direita; `legenda` opcional
  acima do título.
- Conteúdo separado por divisórias `linha`, nunca por cartões dentro de
  cartões.
- Cartão clicável: o cartão inteiro é o alvo; hover troca a borda para
  grafite-suave; foco com anel.
- Bloco da tela inicial (`g-bloco`): cartão com `raio-lg`, ícone da ferramenta
  40, nome em `titulo-3`, uma linha de resumo em grafite-suave e um número
  em `numero`.

## Lista e linha (`g-lista`, `g-linha`)

- Linha: altura mínima 48 (56 com duas linhas), padding 12 16, divisória
  linha entre linhas (não após a última).
- Anatomia: [ícone/checkbox] · título (`corpo` 500) + apoio (13/18
  grafite-suave) · [valor em `numero` à direita] · [chevron ou menu].
- Selecionada: fundo nanquim-tinta. Hover: fundo papel.
- Valores financeiros: despesa em `negativo` com "−", receita em `positivo` com
  "+"; o sinal é obrigatório (não depende só da cor).

## Tabela (`g-tabela`)

- Cabeçalho em `legenda` (caixa alta) grafite-suave, borda inferior linha.
- Linhas 44, divisória linha, sem listras zebradas.
- Colunas numéricas em `numero`, alinhadas à direita, cabeçalho também à
  direita. Totais com borda superior `grafite` 1px.
- No celular vira lista (`g-linha`), não rola na horizontal.

## Abas e segmentado

- Abas (`g-abas`): `rotulo`, altura 40, item ativo grafite com sublinhado 2px
  nanquim; inativos grafite-suave. Divisória linha embaixo de toda a barra.
- Segmentado (`g-segmentado`): trilho papel com borda linha, `raio-md`,
  item ativo folha com borda linha e texto grafite. Para 2–4 opções de visão
  (Lista/Grade, Mês/Ano).

## Navegação

- Lateral (desktop ≥ 960): largura 240, fundo papel, borda direita linha.
  Topo: assinatura da marca. Itens 40 de altura, ícone da ferramenta 20 +
  nome; ativo = fundo nanquim-tinta + texto grafite 600.
- Inferior (celular): altura 64 + área segura, fundo folha, borda superior
  linha, até 5 itens, ícone 24 + rótulo 12. Ativo em nanquim.
- Barra superior da tela: título da página, marcador de 8px na cor da
  ferramenta, ações à direita (ícones). Sem fundo colorido.

## Menu e popover (`g-menu`)

Folha, borda linha, `raio-md`, `sombra-flutuante`, padding 4. Itens 36,
padding 0 12, `corpo`, ícone 16 opcional; hover fundo papel. Ação destrutiva
por último, em negativo, separada por divisória.

## Modal e folha inferior (`g-modal`)

- Véu (tabela de derivados). Caixa folha, `raio-lg`, `sombra-flutuante`,
  largura 480 (formulário) ou 640 (conteúdo), padding 24.
- Cabeçalho: `titulo-3` + botão fechar (ícone). Rodapé: botões alinhados à
  direita, primário por último.
- Celular: vira folha inferior, cantos superiores `raio-lg`, alça 32×4 linha.
- Esc e clique no véu fecham (exceto se houver dados não salvos: pergunte).
  Foco preso dentro e devolvido ao gatilho ao fechar.
- Confirmação destrutiva: título diz a ação ("Excluir 3 lançamentos?"),
  corpo diz a consequência, primário em negativo sólido com o verbo.

## Toast (`g-toast`)

Fundo grafite, texto papel (inverso), `raio-md`, `sombra-flutuante`, padding
12 16, máximo 400 de largura. Embaixo no centro (celular, acima da navegação)
ou embaixo à esquerda (desktop). Some em 4s; com ação ("Desfazer", em
nanquim do tema oposto, ou seja `nanquim` da Noite no Dia) fica 6s. Um por vez.

## Aviso em linha (`g-aviso`)

Bloco dentro da página: fundo cor de estado 12%, borda 1px cor de estado 35%,
`raio-md`, padding 12 16, ícone 20 na cor do estado, texto grafite. Variantes:
info (nanquim), sucesso, atenção, erro. Sem barra grossa à esquerda.

## Progresso e carregamento

- Barra (`g-progresso`): altura 6, trilho linha, preenchimento nanquim,
  `raio` pílula. Orçamento: preenchimento positivo < 80%, atencao 80–100%,
  negativo > 100% + texto "Estourou R$ 120,00".
- Indicador: anel 20, traço 2 nanquim sobre linha, gira 0.8s linear.
- Esqueleto (`g-esqueleto`): blocos linha 60% com `raio-sm`, pulso de
  opacidade 1.2s. Use para listas e cartões; o indicador para ações.

## Botão flutuante (FAB)

56×56, `raio-lg`, fundo nanquim, ícone 24 sobre-nanquim, `sombra-flutuante`,
16 da borda (acima da navegação inferior). Só no celular e só se for a ação
primária da tela (então não há outro primário visível).

## Dica (tooltip)

Fundo grafite, texto papel 12/16, padding 6 8, `raio-sm`, aparece após 400ms
no hover/foco. Só complementa; nunca guarda informação essencial.

## Avatar e ícone de ferramenta

- Avatar: círculo 32/40, iniciais em `rotulo` grafite sobre tag neutra.
- Ícone de ferramenta: ver Fundamentos → Iconografia.
