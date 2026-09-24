# Fontes do modo Ilustração

Arquivos WOFF estáticos (subconjunto latin, que cobre o português) das famílias
do Google Fonts, obtidos pelo projeto [Fontsource](https://fontsource.org)
(`@fontsource/<família>/files/<família>-latin-<peso>-normal.woff`).

Ficam servidos pelo próprio app porque o modo Ilustração lê o contorno das
letras com o opentype.js, que não abre o WOFF2 que o Google entrega.

Todas as famílias são distribuídas sob a SIL Open Font License 1.1
(<https://openfontlicense.org>), que permite uso, embutir em documentos e
redistribuição junto com software.
Os direitos de cada fonte pertencem aos respectivos autores, listados no
arquivo `LICENSE` de cada pacote `@fontsource/<família>`.

Pra acrescentar uma família: baixe `<família>-latin-400-normal.woff` (e `-700-`
quando existir) como `<família>-<peso>.woff` nesta pasta e registre-a em
`FONT_CATALOG` (`frontend/src/app/features/imagem/fonts.ts`).
