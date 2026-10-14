FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Hub/Hub.csproj src/Hub/
RUN dotnet restore src/Hub/Hub.csproj
COPY src/ src/
RUN dotnet publish src/Hub/Hub.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends git tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080 \
    HOME=/tmp \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Hub.dll"]
