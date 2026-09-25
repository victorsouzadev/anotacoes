# Windows: gera recados.zip pronto para a ferramenta "Publicar" (ver empacotar.sh).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Remove-Item -Recurse -Force out, recados.zip -ErrorAction SilentlyContinue
dotnet publish api/Recados.csproj -c Release -r linux-x64 --self-contained false -p:DebugType=none -o out/api
Copy-Item -Recurse web out/web
Copy-Item publicar.json out/
Compress-Archive -Path out/* -DestinationPath recados.zip
Write-Host "Pronto: $PSScriptRoot\recados.zip"
