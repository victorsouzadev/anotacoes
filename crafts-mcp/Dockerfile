# MCP remoto dos craft apps (ver servidor.mjs). As CLIs não entram na imagem: o workflow
# "Craft apps" grava em /opt/notas-vps/downloads/crafts-cli, montado em /crafts-cli.
# As CLIs são compiladas em Alpine (musl); as bibliotecas abaixo cobrem o que algumas linkam.
FROM node:22-alpine
RUN apk add --no-cache libgcc libstdc++ fontconfig font-dejavu alsa-lib
WORKDIR /app
COPY servidor.mjs .
ENV PORTA=8080
EXPOSE 8080
# Roda como root: grava na mesma pasta de trabalho que a API (root) lê. O isolamento é o próprio
# container, que só monta as CLIs (só leitura) e data/estudio/_mcp — nenhum banco, chave ou token.
CMD ["node", "servidor.mjs"]
