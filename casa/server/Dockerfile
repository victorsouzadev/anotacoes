FROM node:22-alpine
WORKDIR /app
COPY server.mjs .
ENV DB_PATH=/data/casa.db APK_DIR=/data/apk PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "--no-warnings", "server.mjs"]
