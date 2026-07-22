[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$serviceUrl = 'http://127.0.0.1:4173/'
$healthUrl = 'http://127.0.0.1:4173/api/health'

function Stop-WithMessage {
  param([string]$Message)

  Write-Output $Message
  exit 1
}

function Test-HealthyService {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 -ErrorAction Stop
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

function Open-ServiceInBrowser {
  if (-not $NoBrowser) {
    Start-Process $serviceUrl | Out-Null
  }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Stop-WithMessage '未找到 Node.js。请安装 Node.js 20 或更高版本后重试。'
}

$npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  Stop-WithMessage '未找到 npm.cmd。请安装 Node.js 20 或更高版本后重试。'
}

Push-Location -LiteralPath $projectRoot
try {
  if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
    Stop-WithMessage '缺少 .env。请先复制 .env.example 为 .env，并在本机填写 API 密钥。'
  }

  if (-not (Test-Path -LiteralPath 'node_modules' -PathType Container)) {
    Stop-WithMessage '缺少 node_modules。请先运行 npm.cmd install 安装依赖。'
  }

  if ($CheckOnly) {
    Write-Output '环境检查通过，未启动服务。'
    exit 0
  }

  if (Test-HealthyService) {
    Write-Output '服务已在运行，复用现有服务。'
    Open-ServiceInBrowser
    exit 0
  }

  try {
    $process = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('--env-file=.env', 'server/index.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
  } catch {
    Stop-WithMessage '服务启动失败。请检查 Node.js 安装和项目依赖后重试。'
  }

  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (Test-HealthyService) {
      Write-Output '服务已启动。'
      Open-ServiceInBrowser
      exit 0
    }
    if ($process.HasExited) {
      break
    }
  }

  Stop-WithMessage '服务启动失败，20 秒内未通过健康检查。请检查终端输出后重试。'
} finally {
  Pop-Location
}
