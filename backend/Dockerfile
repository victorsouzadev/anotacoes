# Contexto de build: a pasta backend/ (ver docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build
WORKDIR /src
COPY Notas.Api/Notas.Api.csproj Notas.Api/
RUN dotnet restore Notas.Api/Notas.Api.csproj
COPY Notas.Api/ Notas.Api/
RUN dotnet publish Notas.Api/Notas.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0-alpine
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Notas.Api.dll"]
