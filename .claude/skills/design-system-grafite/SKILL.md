---
name: design-system-grafite
description: Design system Grafite (papel, grafite, nanquim; Newsreader/Figtree/IBM Plex Mono) para PROJETAR e CONSTRUIR interface nova — telas, componentes, páginas, protótipos, artifacts, mockups, e-mails ou gráficos — com os fundamentos, a especificação dos componentes, os padrões de tela e a voz do hub. Use quando o usuário pedir uma tela, componente, página ou layout "no Grafite", "no meu design system", "com a cara do hub" ou "no meu estilo", ou ao criar UI nova dentro deste repositório. Para só trocar as cores/fontes de um app existente, use a skill aplicar-grafite.
---

# Design system Grafite

Um caderno de trabalho: papel levemente frio, texto em grafite e uma única
tinta, o nanquim verde-azulado. Tudo é calmo; a atenção vai para o conteúdo da
pessoa, não para a interface.

Fonte da verdade: o guia publicado (https://claude.ai/artifact/2z6Yu8iV9x2UCEeKkXWnZW)
e `assets/tokens.json` (cópia dele). Nunca invente cor, tamanho ou raio fora
dos tokens; se faltar algo, derive dos existentes e diga ao usuário que é uma
proposta.

## Arquivos desta skill

| Arquivo | Quando ler |
| --- | --- |
| `references/fundamentos.md` | Sempre, antes de desenhar: cor, tipo, espaço, forma, movimento, ícones, marca |
| `references/componentes.md` | Ao montar qualquer componente: anatomia, medidas, estados |
| `references/padroes.md` | Ao montar uma tela inteira: layouts, estados vazios/erro, formulários, gráficos, voz |
| `assets/grafite.css` | Implementação web pronta (tokens + componentes, dia/noite). Copie ou importe |
| `assets/exemplo.html` | Vitrine de todos os componentes usando `grafite.css`; base para protótipos |
| `assets/tokens.json` | Tokens em JSON (para gerar tema em outra stack) |
| `assets/marca.svg`, `assets/marca-escura.svg` | Símbolo para fundo claro e escuro |
| `scripts/contraste.py` | Confere 4.5:1 / 3:1 de pares de cor nos dois temas |

## As cinco regras (decore)

1. **Uma tinta só.** `nanquim` marca a ação principal da tela, o foco e o item
   ativo. Duas coisas chamativas em nanquim na mesma área é erro: rebaixe uma
   para botão secundário.
2. **Linhas, não sombras.** Cartão = `folha` sobre `papel` + borda `linha` 1px.
   `sombra-flutuante` só no que flutua (menu, modal, folha inferior, FAB, toast).
3. **Lápis de cor com parcimônia.** As cores de ferramenta (`notas`,
   `financas`, `tarefas`, `editor`, `cerebro`) só em ícone, marcador de 8px e
   bloco da tela inicial. Nunca em botão, link ou fundo grande.
4. **Números em mono.** Valor, data, hora, duração e medida usam `numero`
   (IBM Plex Mono 500, `tabular-nums`) e se alinham à direita em colunas.
5. **Estado não decora.** `positivo`, `negativo`, `atencao` só significam
   estado (receita/despesa, sucesso/erro, aviso) e vêm sempre com texto ou
   ícone, nunca só a cor.

Mais: sempre Dia **e** Noite (Noite não é o Dia invertido), contraste 4.5:1 em
texto, foco visível, alvo de toque ≥ 44px, `prefers-reduced-motion` respeitado.

## Como trabalhar

1. **Entenda o pedido** — que ferramenta (Notas, Finanças, Tarefas, Editor,
   Cérebro, ou nova), que tela, que plataforma. A cor da ferramenta só entra no
   marcador do cabeçalho.
2. **Ache a ação principal** da tela. Ela é a única coisa em nanquim sólido.
3. **Escolha o padrão de tela** em `references/padroes.md` (início, lista,
   detalhe, formulário, painel de números, editor/canvas, configurações).
4. **Monte com os componentes** de `references/componentes.md`. Não crie
   variante nova se uma existente resolve; se precisar, siga as mesmas medidas
   (alturas 32/40/44, raios 6/10/16, grade de 4).
5. **Implemente**:
   - Web solta (artifact, protótipo, página): parta de `assets/grafite.css` e
     das classes `g-*`; use `assets/exemplo.html` como esqueleto.
   - Neste repositório (Angular): não importe `grafite.css`; use as variáveis que
     o app já expõe (`--bg`, `--bg-card`, `--text`, `--text-muted`, `--border`,
     `--accent`, `--accent-dark`, `--accent-soft`, `--accent-contrast`,
     `--positivo`, `--negativo`, `--atencao`, `--radius-sm/--radius/--radius-lg`,
     `--shadow-lg`, `--font-heading`, `--font-body`) para não quebrar os outros
     temas, e o `<app-icon>` de `frontend/src/app/shared/icon.ts` para ícones.
   - Outra stack (Compose, Flutter, RN…): mapeie os tokens como descrito na
     skill `aplicar-grafite` e reproduza as medidas dos componentes.
6. **Escreva o texto** com a voz do Grafite (`padroes.md` → Voz).
7. **Revise** com o checklist abaixo e, se puder, renderize nos dois temas
   (Playwright) e olhe as capturas.

## Checklist de entrega

- [ ] Só uma ação primária em nanquim por tela/área; nenhum outro uso decorativo.
- [ ] Cartões sem sombra; sombra só em elementos flutuantes.
- [ ] Cores de ferramenta só em ícone/marcador/bloco inicial.
- [ ] Números em `numero` (mono, tabular), alinhados à direita.
- [ ] Estados com texto/ícone, não só cor.
- [ ] Newsreader só em `titulo-1`/`titulo-2`; resto em Figtree.
- [ ] Espaçamentos múltiplos de 4; raios 6/10/16.
- [ ] Dia e Noite conferidos; `python3 scripts/contraste.py` passa para cores novas.
- [ ] Foco visível (anel nanquim 2px, deslocado 2px) e alvos ≥ 44px no toque.
- [ ] Estados vazio, carregando e erro desenhados.
- [ ] Texto em português do dia a dia, sem emoji de seção, sem exclamação de sistema.
