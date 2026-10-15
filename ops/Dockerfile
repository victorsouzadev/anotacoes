FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Ops/Ops.csproj src/Ops/
RUN dotnet restore src/Ops/Ops.csproj
COPY src/ src/
RUN dotnet publish src/Ops/Ops.csproj -c Release -o /app --no-restore

# Roda como root e com pid: host (ver docker-compose.yml): o nsenter entra nos
# namespaces do PID 1 do host para executar os comandos na VPS, não no container.
FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends util-linux tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Ops.dll"]
