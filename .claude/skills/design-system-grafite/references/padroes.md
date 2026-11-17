# Padrões de tela, conteúdo e voz

## Grade e larguras

| Faixa | Largura | Margem lateral | Colunas |
| --- | --- | --- | --- |
| Celular | < 600 | `esp-4` (16) | 1 |
| Tablet | 600–959 | `esp-6` (24) | 2 |
| Desktop | ≥ 960 | `esp-8` (32), nav lateral 240 | 12, gutter 24 |

Conteúdo da página: máximo 1120. Leitura/formulário: máximo 640. Sem rolagem
horizontal em nenhuma largura.

Estrutura vertical de uma página: `legenda` opcional → `titulo-1` (ou
`titulo-2` em telas internas) → `esp-6` → conteúdo, com `esp-8` entre seções.

## Padrões de tela

### Início do hub
- Saudação em `titulo-1` ("Bom dia, Victor") + data em `legenda`.
- Grade de blocos (`g-bloco`), um por ferramenta, com a cor da ferramenta
  só no ícone. 2 colunas no celular, 3–5 no desktop.
- Abaixo, "Hoje": lista curta misturando tarefas do dia, lembretes e o saldo,
  cada item com marcador de 8px da ferramenta.

### Lista (notas, lançamentos, tarefas)
- Barra: busca + filtros em chips + ação primária ("Nova nota").
- Agrupe por data com cabeçalho `legenda` ("HOJE", "ONTEM", "12 DE OUTUBRO").
- Linhas `g-linha`; ação em massa aparece numa barra fixa no rodapé ao
  selecionar.
- Paginação por "Carregar mais" ou rolagem infinita, nunca números de página
  no celular.

### Detalhe
- Título editável em `titulo-2`, metadados em `legenda` abaixo.
- Ações secundárias num menu "…" no cabeçalho; excluir sempre dentro dele.
- Conteúdo em largura de leitura (68ch).

### Formulário
- Uma coluna. Campos na ordem em que a pessoa pensa (valor → descrição →
  categoria → data no lançamento).
- Agrupe com `titulo-3` e `esp-6` entre grupos, não com cartões aninhados.
- Valide ao sair do campo; erro no próprio campo; resumo no topo só se houver
  3+ erros.
- Rodapé com primário ("Salvar lançamento") + secundário ("Cancelar").
  Desabilite o primário só enquanto salva.
- Padrões inteligentes: data = hoje, conta = a última usada.

### Painel de números (finanças)
- Faixa de 3–4 cartões de resumo: `legenda` (rótulo) + número de destaque
  (mono 28/34) + variação em 13/18 com seta e sinal ("+ 4,2% vs. setembro").
- Depois gráfico principal em cartão, depois lista detalhada.
- Saldo negativo: número em `negativo` e com "−"; nunca só vermelho.

### Editor / canvas (Notas, Editor de Imagens)
- Canvas em folha ocupando a tela; fundo papel em volta.
- Barra de ferramentas flutuante (`g-menu` horizontal): botões de ícone
  32–40, ativo com fundo nanquim-tinta e ícone nanquim. Grupos separados por
  divisória vertical linha.
- Painel de propriedades à direita (280), fundo folha, borda esquerda linha.

### Configurações
- Lista de seções em cartões, cada linha com rótulo à esquerda e controle à
  direita (interruptor, select, valor em mono).
- Mudanças com interruptor valem na hora; o resto tem "Salvar" no rodapé.

## Estados da tela

| Estado | Como |
| --- | --- |
| Vazio (primeira vez) | Ícone de linha 40 em grafite-suave, `titulo-3` dizendo o que vai aparecer ali, uma frase de apoio e o botão primário. "Nenhuma nota ainda. Suas notas aparecem aqui. [Nova nota]" |
| Vazio (filtro) | Frase + botão fantasma "Limpar filtros". Sem ilustração |
| Carregando | Esqueleto com a forma do conteúdo; indicador só depois de 300ms |
| Erro | `g-aviso` de erro com o que houve + como resolver + "Tentar de novo" |
| Offline | Faixa discreta no topo em `atencao` 12%: "Sem conexão. As mudanças são salvas quando voltar." |
| Sucesso | Toast curto no particípio: "Nota salva". Não use modal para sucesso |

## Gráficos

- Fundo folha (dentro de cartão), grade horizontal só (derivado de grade),
  sem eixos pesados; rótulos dos eixos em 12/16 grafite-suave; valores em mono.
- Série única: nanquim. Receita × despesa: positivo × negativo.
- Várias categorias (proposta do design system, ordem fixa):
  nanquim, tarefas, notas, editor, cerebro, financas; o resto agrupado em
  "Outros" com grafite-suave. Máximo 6 cores + Outros. Aqui as cores de
  ferramenta são só tinta de dado, não significam a ferramenta.
- Legenda embaixo, marcador circular 8. Tooltip estilo `g-menu`, valor em mono.
- Rosca: espessura 20–24% do raio, total no centro em mono 28.
- Sempre ofereça os números em texto (tabela ou lista) junto do gráfico.

## Formatos (pt-BR)

| Tipo | Formato |
| --- | --- |
| Dinheiro | `R$ 1.284,90`; negativo `− R$ 45,00` (sinal de menos U+2212) |
| Data curta | `12 out` · com ano se não for o atual: `12 out 2025` |
| Data longa | `terça, 12 de outubro` |
| Hora | `14:05` (24h) |
| Relativo | "agora", "há 2 min", "há 3 h", "ontem"; depois de 7 dias, data |
| Duração | `25:00` (pomodoro), `1 h 20 min` |
| Medida | `210 × 297 mm` |
| Percentual | `4,2%` |

Todos em `numero` (mono, tabular) quando aparecem como dado.

## Voz e texto

- Português do dia a dia, frases curtas, voz ativa, tratamento por "você"
  implícito ("Salve antes de sair"), sem formalismo.
- Botões: verbo + objeto ("Salvar nota", "Importar extrato"). Confirmação no
  particípio ("Nota salva", "Extrato importado").
- Nomeie pelo que a pessoa reconhece: *orçamento*, *lembrete*, *pasta*,
  *lançamento* — não *registro*, *entidade*, *item*, *objeto*.
- Erro = o que houve + como resolver: "Não consegui ler o PDF. Tente uma foto
  do extrato." Nada de "Erro 500" ou "Algo deu errado" sozinho.
- O sistema fala em primeira pessoa quando falha ("Não consegui…") e em
  terceira quando informa ("A nota foi movida para Arquivo").
- Sem emoji como marcador, sem exclamação em mensagem de sistema, sem
  "Ops!", sem CAIXA ALTA fora do estilo `legenda`.
- Títulos em frase (só a primeira maiúscula): "Lançamentos recentes".
- Números e dados sempre com unidade; datas relativas até 7 dias.

## Acessibilidade

- Contraste 4.5:1 texto, 3:1 para texto ≥ 24px, ícones, bordas de controle e
  anel de foco — nos dois temas.
- Ordem de foco = ordem visual; atalho "Pular para o conteúdo".
- Cor nunca é o único sinal (sinal +/−, ícone, texto).
- Alvos de toque ≥ 44×44; distância ≥ 8 entre alvos.
- `prefers-reduced-motion` e `prefers-color-scheme` respeitados; o tema
  também pode ser forçado pelo usuário (`data-theme="light|dark"` em `<html>`).
- Ícone sem texto tem `aria-label`; modal tem `role="dialog"`,
  `aria-labelledby` e foco preso.

## Antipadrões (não faça)

- Gradientes, especialmente azul-roxo; vidro fosco; sombras em cartões.
- Cartão com barra colorida grossa à esquerda.
- Emoji em título, cartão ou botão.
- Botões coloridos com a cor da ferramenta.
- Dois primários lado a lado; chip marcado em nanquim sólido ao lado do primário.
- Newsreader na interface; números em fonte proporcional.
- Fundo de página branco puro (o fundo é `papel`).
- Preto puro `#000` ou branco puro como texto na Noite.
