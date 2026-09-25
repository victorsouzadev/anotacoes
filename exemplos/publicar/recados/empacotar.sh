#!/bin/sh
# Gera recados.zip pronto para a ferramenta "Publicar":
#   api/  ← dotnet publish para linux-x64, framework-dependent (a plataforma roda em aspnet:9.0;
#           o -r linux-x64 deixa de fora as libs nativas de Windows/macOS e encolhe o ZIP)
#   web/  ← front estático
set -e
cd "$(dirname "$0")"
rm -rf out recados.zip
dotnet publish api/Recados.csproj -c Release -r linux-x64 --self-contained false -p:DebugType=none -o out/api
cp -r web out/web
cp publicar.json out/
(cd out && python3 -c "import shutil; shutil.make_archive('../recados', 'zip', '.')")
echo "Pronto: $(pwd)/recados.zip"
