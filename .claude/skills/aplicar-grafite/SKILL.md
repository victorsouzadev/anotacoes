---
name: aplicar-grafite
description: Aplica a identidade visual Grafite (cores papel/grafite/nanquim, fontes Newsreader/Figtree/IBM Plex Mono, raios, ícone) em qualquer app — Android (Compose ou XML), Flutter, React Native, web (CSS, Tailwind, Angular, React). Use quando o usuário pedir para aplicar o Grafite, a identidade do hub, "meu tema" ou "minha identidade visual" num projeto ou APK.
---

# Aplicar a identidade Grafite

Guia completo da marca: https://claude.ai/artifact/2z6Yu8iV9x2UCEeKkXWnZW
Os valores abaixo são a fonte da verdade desta skill; não invente outros.

## Tokens

| Token | Dia | Noite | Uso |
| --- | --- | --- | --- |
| papel | #F4F5F2 | #121514 | fundo da tela |
| folha | #FFFFFF | #1A1E1D | cartões, painéis, modais |
| grafite | #1E2523 | #E6EAE7 | texto principal, ícones |
| grafite-suave | #5E6865 | #9AA4A0 | texto secundário |
| linha | #DFE3DF | #2A302E | bordas, divisórias |
| nanquim | #2E5E5A | #7FB5AE | acento único: ação primária, link, foco, item ativo |
| nanquim-escuro | #224744 | #A3CDC7 | hover/pressionado |
| nanquim-tinta | #E2ECEA | #1F3331 | seleção, chip marcado |
| sobre-nanquim | #FFFFFF | #121514 | texto sobre nanquim |
| positivo | #2F7D4F | #6FCF97 | receita, sucesso |
| negativo | #B3403A | #F08A84 | despesa, erro, excluir |
| atencao | #9A5D0C | #F0B860 | aviso |

Cores de ferramenta (só ícone/marcador, nunca botão ou fundo grande):
notas #3D5A80/#8FAAD0, financas #4F6B3A/#9DBF83, tarefas #8A5F17/#D6AE62,
editor #9A4E4E/#D99A9A, cerebro #6A5A8C/#AD9FD6.

Tipografia: Newsreader 500 só em títulos grandes (36/40 e 26/32); Figtree
para a interface (17/24 600 título de cartão, 15/23 400 corpo, 13/18 500
rótulo, 12/16 500 caixa alta +0.06em legenda); IBM Plex Mono 500 15/22
para valores, datas e medidas. Todas no Google Fonts (OFL).

Espaço: grade de 4px (4, 8, 12, 16, 24, 32). Raios: 6 (chips, checkbox),
10 (botões, campos, cartões), 16 (modais, blocos). Sombra só no que
flutua: `0 12px 32px rgba(30,37,35,.14)` (noite: `rgba(0,0,0,.5)`).

Símbolo: quadrado 32×32 com rx 8 em nanquim, traço de lápis
`M9.5 24 21 9.5` (largura 3, ponta redonda) em papel, ponto em
(23.6, 23.2) r 1.9 em #D6AE62. Versão escura: quadrado #7FB5AE, traço e
ponto #121514. Pautas opcionais `M7 12.5h18M7 19.5h18` em papel com 28% de opacidade.

## Regras

1. Um acento só (nanquim). Duas coisas em nanquim na mesma tela é erro.
2. Cartões em folha sobre papel com borda linha de 1px, sem sombra.
3. Estados (positivo/negativo/atencao) nunca decoram.
4. Sempre os dois temas, seguindo o modo do sistema.
5. Contraste mínimo 4.5:1 para texto; os pares acima já cumprem.

## Como aplicar

1. Descubra a stack lendo o projeto (build.gradle(.kts), pubspec.yaml,
   package.json, angular.json…) e procure um tema existente. Substitua os
   valores dele em vez de criar um sistema paralelo, mantendo os nomes que
   o código já usa.
2. Mapeie conforme a plataforma:
   - **Compose (Material 3)**: `lightColorScheme`/`darkColorScheme` com
     background=papel, surface=folha, onBackground/onSurface=grafite,
     onSurfaceVariant=grafite-suave, outline=linha, outlineVariant=linha,
     primary=nanquim, onPrimary=sobre-nanquim, primaryContainer=nanquim-tinta,
     onPrimaryContainer=grafite, error=negativo. `Shapes(6/10/16.dp)`.
     Fontes em `res/font/` via `FontFamily`. Desligue `dynamicColor`.
     Cores de ferramenta e estados num `object GrafiteCores` à parte.
   - **Android XML (Views)**: `res/values/colors.xml` e
     `res/values-night/colors.xml` com os tokens; tema
     `Theme.Material3.DayNight.NoActionBar` com `colorPrimary`,
     `colorSurface`, `android:colorBackground`, `colorOnSurface`, `colorOutline`.
   - **Flutter**: `ColorScheme(brightness: …)` com o mesmo mapeamento do
     Compose em `ThemeData(useMaterial3: true)` e `darkTheme`; fontes pelo
     pacote `google_fonts` ou em `assets/fonts` declaradas no pubspec;
     `themeMode: ThemeMode.system`.
   - **React Native**: objeto `grafite.dia`/`grafite.noite` escolhido por
     `useColorScheme()`; fontes com `expo-font` ou `react-native.config.js`.
   - **Web**: custom properties em `:root` com os valores Dia e redefinição em
     `@media (prefers-color-scheme: dark)`; Tailwind: `theme.extend.colors`
     apontando para as variáveis. No hub (este repositório) o tema já
     existe: `frontend/src/app/core/themes.data.ts`, id `grafite`.
3. Ícone do app: gere a partir do símbolo (Android: adaptive icon com fundo
   #2E5E5A e o traço+ponto em primeiro plano, dentro da zona segura de 66%;
   web: favicon SVG).
4. Troque cores fixas espalhadas pelo código (hex literais, `Color.Blue`,
   `Colors.purple`) pelos tokens. Liste ao usuário o que não deu para trocar.
5. Valide com o build da própria stack (`./gradlew assembleDebug`,
   `flutter analyze`, `tsc`…) e, se possível, gere o APK/app para conferir os
   dois temas. Informe o que foi verificado e o que não foi.
