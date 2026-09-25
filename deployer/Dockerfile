# Contexto de build: a pasta deployer/ (ver docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build
WORKDIR /src
COPY Notas.Deployer/Notas.Deployer.csproj Notas.Deployer/
RUN dotnet restore Notas.Deployer/Notas.Deployer.csproj
COPY Notas.Deployer/ Notas.Deployer/
RUN dotnet publish Notas.Deployer/Notas.Deployer.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0-alpine
# Só o cliente: o daemon é o do host, pelo /var/run/docker.sock montado no compose.
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Notas.Deployer.dll"]
