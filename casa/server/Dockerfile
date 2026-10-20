FROM node:22-alpine
WORKDIR /app
COPY *.mjs ./
RUN apk add --no-cache tzdata
ENV DB_PATH=/data/casa.db APK_DIR=/data/apk PORT=8080 TZ=America/Sao_Paulo
VOLUME /data
EXPOSE 8080
CMD ["node", "--no-warnings", "server.mjs"]
