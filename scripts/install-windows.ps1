# Instalador do Ripper para Windows: traz o Node (winget) se faltar, instala, cria o serviço e abre o app.
# Uso normal: dois cliques em scripts\instalar-windows.cmd.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function NodeMajor {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { return 0 }
  return [int]((& node -v) -replace '^v(\d+).*', '$1')
}

try {
  Step 'Verificando o Node.js'
  if ((NodeMajor) -lt 22) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      throw 'Node.js 22+ não encontrado e o winget não está disponível. Instale o Node em https://nodejs.org e rode de novo.'
    }
    Step 'Instalando o Node.js LTS (winget)'
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    # o PATH novo só vale em janelas novas: recarrega aqui
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if ((NodeMajor) -lt 22) { throw 'O Node foi instalado, mas não apareceu no PATH. Feche esta janela e rode o instalador de novo.' }
  }
  Write-Host "Node $(node -v)"

  Step 'Instalando dependências'
  npm ci
  if ($LASTEXITCODE) { throw 'npm ci falhou.' }

  Step 'Montando o app'
  npm run build
  if ($LASTEXITCODE) { throw 'npm run build falhou.' }

  Step 'Criando o serviço (sobe com o Windows)'
  node scripts/service.mjs install
  if ($LASTEXITCODE) { throw 'Não consegui criar o serviço.' }

  $port = if ($env:PORT) { $env:PORT } else { 3000 }
  $url = "http://127.0.0.1:$port"
  Step "Abrindo $url"
  for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-WebRequest "$url/healthz" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
  }
  Start-Process $url
  Write-Host "`nPronto. O Ripper fica rodando em $url e volta sozinho quando o Windows liga." -ForegroundColor Green
} catch {
  Write-Host "`nNão deu certo: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
