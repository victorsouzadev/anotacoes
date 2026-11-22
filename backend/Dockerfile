# Contexto de build: a raiz do repositório (ver docker-compose.yml), porque o núcleo usa o SDK de pacotes/ (spec 038).
FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build
WORKDIR /src
COPY pacotes/Hub.Plugin.Sdk/Hub.Plugin.Sdk.csproj pacotes/Hub.Plugin.Sdk/
COPY backend/Notas.Api/Notas.Api.csproj backend/Notas.Api/
RUN dotnet restore backend/Notas.Api/Notas.Api.csproj
COPY pacotes/Hub.Plugin.Sdk/ pacotes/Hub.Plugin.Sdk/
COPY backend/Notas.Api/ backend/Notas.Api/
RUN dotnet publish backend/Notas.Api/Notas.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0-alpine
# A imagem Alpine não traz nem o banco de fusos horários nem o ICU:
#   - tzdata: a ferramenta de finanças precisa dele para saber que dia é "hoje"
#     no fuso do usuário em vez de em UTC.
#   - icu-libs: sem ele o .NET sobe em modo globalization-invariant e qualquer
#     cultura diferente da invariante (pt-BR, no nosso caso) lança
#     CultureNotFoundException.
#   - icu-data-full: o icu-libs sozinho traz só os dados do locale raiz, então
#     GetCultureInfo("pt-BR") passa mas os meses saem em inglês ("Sep/26" em vez
#     de "set./26"). Os dados de locale estão neste pacote separado.
RUN apk add --no-cache tzdata icu-libs icu-data-full
# A imagem base define DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true; instalar o
# icu-libs sem desligar essa variável não muda nada.
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Notas.Api.dll"]
