# Contexto de build: a raiz do repositório (ver docker-compose.yml), porque as regras do manifesto vêm do SDK de
# pacotes/ (spec 039).
FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build
WORKDIR /src
COPY pacotes/Hub.Plugin.Sdk/Hub.Plugin.Sdk.csproj pacotes/Hub.Plugin.Sdk/
COPY deployer/Notas.Deployer/Notas.Deployer.csproj deployer/Notas.Deployer/
RUN dotnet restore deployer/Notas.Deployer/Notas.Deployer.csproj
COPY pacotes/Hub.Plugin.Sdk/ pacotes/Hub.Plugin.Sdk/
COPY deployer/Notas.Deployer/ deployer/Notas.Deployer/
RUN dotnet publish deployer/Notas.Deployer/Notas.Deployer.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0-alpine
# Só o cliente: o daemon é o do host, pelo /var/run/docker.sock montado no compose.
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Notas.Deployer.dll"]
