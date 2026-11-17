# Fundamentos

## Cor

Dois temas: **Dia** (`light`) e **Noite** (`dark`). Siga o modo do sistema e
permita forçar um deles. Noite não é o Dia invertido: o papel vira um grafite
esverdeado e o nanquim clareia para manter 4.5:1.

### Base

| Token | Dia | Noite | Uso |
| --- | --- | --- | --- |
| `papel` | `#F4F5F2` | `#121514` | Fundo de página |
| `folha` | `#FFFFFF` | `#1A1E1D` | Cartão, painel, modal, campo, canvas |
| `grafite` | `#1E2523` | `#E6EAE7` | Texto principal, ícones |
| `grafite-suave` | `#5E6865` | `#9AA4A0` | Texto secundário, legenda, placeholder |
| `linha` | `#DFE3DF` | `#2A302E` | Bordas, divisórias, trilho de progresso |

### Acento (nanquim)

| Token | Dia | Noite | Uso |
| --- | --- | --- | --- |
| `nanquim` | `#2E5E5A` | `#7FB5AE` | Ação primária, link, foco, item ativo, checkbox marcado |
| `nanquim-escuro` | `#224744` | `#A3CDC7` | Hover/pressionado do que é nanquim |
| `nanquim-tinta` | `#E2ECEA` | `#1F3331` | Fundo de seleção, item de menu ativo, chip marcado |
| `sobre-nanquim` | `#FFFFFF` | `#121514` | Texto/ícone sobre nanquim |

### Estado

| Token | Dia | Noite | Uso |
| --- | --- | --- | --- |
| `positivo` | `#2F7D4F` | `#6FCF97` | Receita, meta atingida, sucesso |
| `negativo` | `#B3403A` | `#F08A84` | Despesa, estouro, erro, excluir |
| `atencao` | `#9A5D0C` | `#F0B860` | Perto do limite, aviso |

Fundos suaves de estado (aviso, chip de status): a cor do estado a 12% sobre
`folha` (`color-mix(in srgb, var(--g-negativo) 12%, var(--g-folha))`); o texto
continua `grafite` e o ícone usa a cor do estado.

### Ferramentas (lápis de cor)

| Token | Dia | Noite | Ferramenta |
| --- | --- | --- | --- |
| `notas` | `#3D5A80` | `#8FAAD0` | Notas |
| `financas` | `#4F6B3A` | `#9DBF83` | Finanças |
| `tarefas` | `#8A5F17` | `#D6AE62` | Tarefas (e o ponto da marca) |
| `editor` | `#9A4E4E` | `#D99A9A` | Editor de Imagens |
| `cerebro` | `#6A5A8C` | `#AD9FD6` | Segundo Cérebro |

Só em: ícone da ferramenta (quadrado `raio-md` preenchido, glifo em `folha`),
marcador de 8px ao lado do título, bloco da tela inicial. Nova ferramenta? Peça
ao usuário a cor ou proponha uma com a mesma luminosidade das outras e valide
com `scripts/contraste.py`.

### Derivados usados na interface

Estes não estão no guia publicado; derivam dos tokens. `borda-controle` é proposta desta skill:
as bordas de checkbox atuais do hub (`#9AA4A0` Dia, `#5E6865` Noite) ficam abaixo de 3:1 sobre `folha`.

| Uso | Dia | Noite |
| --- | --- | --- |
| Fundo de tag neutra | `#E9ECE8` | `#232927` |
| `borda-controle`: borda de campo, checkbox, rádio, interruptor (≥3:1) | `#7A8480` | `#6B7571` |
| Linhas de grade de gráfico | `grafite` 8% | `grafite` 10% |
| Sombra flutuante | `0 12px 32px rgba(30,37,35,.14)` | `0 12px 32px rgba(0,0,0,.5)` |
| Véu de modal | `rgba(30,37,35,.32)` | `rgba(0,0,0,.6)` |

### Contraste

Todos os pares de texto acima passam 4.5:1 sobre `papel` e `folha` nos dois
temas. `grafite-suave` é o mínimo para texto: não clareie mais. Bordas de
controle, anel de foco e ícones precisam de 3:1 — `linha` **não** passa 3:1,
por isso campos, checkboxes e interruptores usam `borda-controle` e `linha` fica para cartões e divisórias. Ao criar qualquer par
novo rode `python3 scripts/contraste.py "#fg" "#bg"`.

## Tipografia

Google Fonts:
`https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap`

| Estilo | Família | Tamanho/linha | Peso | Extra | Uso |
| --- | --- | --- | --- | --- | --- |
| `titulo-1` | Newsreader | 36/40 | 500 | -0.01em | Saudação da tela inicial, título de página |
| `titulo-2` | Newsreader | 26/32 | 500 | — | Título de seção |
| `titulo-3` | Figtree | 17/24 | 600 | — | Título de cartão e de diálogo |
| `corpo` | Figtree | 15/23 | 400 | — | Texto corrido, campos |
| `rotulo` | Figtree | 13/18 | 500 | — | Rótulo de campo, botão, aba |
| `legenda` | Figtree | 12/16 | 500 | +0.06em, CAIXA ALTA | Sobretítulo, metadado |
| `numero` | IBM Plex Mono | 15/22 | 500 | `tabular-nums` | Valores, datas, durações, medidas |

- No celular, `titulo-1` cai para 30/36 e `titulo-2` para 22/28.
- Número grande de destaque (saldo do painel): IBM Plex Mono 500 28/34. É a
  única ampliação permitida de `numero`.
- Texto corrido longo (nota aberta, artigo): largura máxima ~68ch.
- Nunca Newsreader em botão, rótulo, tabela ou parágrafo de interface.
- Pesos disponíveis: Newsreader 400/500, Figtree 400/500/600, Plex Mono 400/500.
  Nada de 700.

## Espaço

Grade de 4px. Tokens: `esp-1` 4 · `esp-2` 8 · `esp-3` 12 · `esp-4` 16 ·
`esp-6` 24 · `esp-8` 32. (Use 48/64 = `esp-12`/`esp-16` só como respiro de
página no desktop.)

| Onde | Valor |
| --- | --- |
| Ícone ↔ texto | `esp-1`/`esp-2` |
| Itens de lista compacta, chips | `esp-2` |
| Padding interno de botão/campo | `esp-3` horizontal ≥ 16 no botão |
| Padding de cartão; margem lateral no celular | `esp-4` |
| Entre cartões e grupos | `esp-6` |
| Entre seções de página | `esp-8` |

## Forma

| Raio | Valor | Onde |
| --- | --- | --- |
| `raio-sm` | 6px | Checkbox, chip, tag, botão de ícone pequeno |
| `raio-md` | 10px | Botão, campo, cartão, ícone de ferramenta, menu |
| `raio-lg` | 16px | Modal, folha inferior, bloco da tela inicial |
| pílula | 999px | Só em badge numérico e interruptor |

Bordas: 1px sempre. Elevação: plano (cartões) ou flutuante (`sombra-flutuante`).
Não existe nível intermediário.

## Movimento

- Troca de cor/borda/fundo: 160–220ms `ease`.
- Entrar (menu, toast, modal): 180ms `cubic-bezier(.2,.8,.2,1)`, opacidade +
  deslocamento de 4–8px. Sair: 120ms, só opacidade.
- Nada quica, nada gira (exceto o indicador de carregamento).
- `prefers-reduced-motion: reduce` → sem transições de posição; só opacidade
  ou nada.

## Iconografia

- Linha, sem preenchimento, cantos e pontas arredondados.
- Guia: grade de 24px, traço 1.75px. O conjunto do hub (`<app-icon>`) usa grade
  20 com traço 1.6 — mesma proporção; prefira-o dentro do repositório.
- Tamanhos: 16 (dentro de texto/chip), 20 (botões, listas), 24 (barra de
  navegação).
- Cor `grafite`; `grafite-suave` quando secundário; `nanquim` quando ativo.
- Ícone de ferramenta: quadrado 32 (ou 40/56) `raio-md` na cor da ferramenta,
  glifo 60% do lado em `folha`.
- Ícone sozinho como botão sempre com `aria-label` e dica (tooltip).

## Marca

Símbolo 32×32: quadrado `rx 8` em nanquim; pautas `M7 12.5h18M7 19.5h18` em
papel a 28%; traço de lápis `M9.5 24 21 9.5` (3px, ponta redonda) em papel;
ponto em (23.6, 23.2) r 1.9 em `#D6AE62`. Versão escura: quadrado `#7FB5AE`,
traço e ponto `#121514`. Arquivos em `assets/marca.svg` e `assets/marca-escura.svg`.

- Assinatura: símbolo + "Grafite" em Newsreader 500, altura do texto ≈ 60% do símbolo.
- Área livre: metade da largura do símbolo. Mínimo 20px (favicon 16px: só quadrado e traço).
- Não recolorir, girar, esticar ou pôr sombra.
