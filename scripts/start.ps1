[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

function Stop-WithMessage {
  param([string]$Message)

  Write-Output $Message
  exit 1
}

function Get-ServicePort {
  $rawPort = & $nodeCommand.Source '--env-file=.env' '-p' 'process.env.PORT ?? 4173'
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage '无法读取 .env 中的 PORT 配置。'
  }

  [int]$parsedPort = 0
  if (-not [int]::TryParse(([string]$rawPort).Trim(), [ref]$parsedPort) `
    -or $parsedPort -lt 1 `
    -or $parsedPort -gt 65535) {
    Stop-WithMessage 'PORT 配置无效，请填写 1 至 65535 的整数。'
  }

  return $parsedPort
}

function Test-PortInUse {
  param([int]$Port)

  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return $null -ne ($listeners | Where-Object { $_.Port -eq $Port } | Select-Object -First 1)
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

  $servicePort = Get-ServicePort
  $serviceUrl = "http://127.0.0.1:$servicePort/"
  $healthUrl = "${serviceUrl}api/health"

  if (Test-PortInUse -Port $servicePort) {
    Stop-WithMessage "端口 $servicePort 已被占用，未启动服务。请先关闭占用程序或修改 .env 中的 PORT。"
  }

  if ($CheckOnly) {
    Write-Output '环境检查通过，未启动服务。'
    exit 0
  }

  $serviceProcess = $null
  try {
    try {
      $serviceProcess = Start-Process `
        -FilePath $nodeCommand.Source `
        -ArgumentList @('--env-file=.env', 'server/index.js') `
        -WorkingDirectory $projectRoot `
        -NoNewWindow `
        -PassThru
    } catch {
      Stop-WithMessage '服务启动失败。请检查 Node.js 安装和项目依赖后重试。'
    }

    $deadline = (Get-Date).AddSeconds(20)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
      if (Test-HealthyService) {
        $healthy = $true
        break
      }
      if ($serviceProcess.HasExited) {
        break
      }
    }

    if (-not $healthy) {
      Stop-WithMessage '服务启动失败，20 秒内未通过健康检查。请检查终端输出后重试。'
    }

    Write-Output "服务已启动：$serviceUrl"
    Open-ServiceInBrowser
    $serviceProcess.WaitForExit()
    exit $serviceProcess.ExitCode
  } finally {
    if ($serviceProcess -and -not $serviceProcess.HasExited) {
      Stop-Process -Id $serviceProcess.Id -Force -ErrorAction SilentlyContinue
      [void]$serviceProcess.WaitForExit(5000)
    }
  }
} finally {
  Pop-Location
}
