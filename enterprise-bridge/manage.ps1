param(
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action = 'start',
    [string]$ConfigPath = (Join-Path (Split-Path $PSScriptRoot -Parent) '.verify\enterprise-bridge-config.json')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $projectRoot '.verify'
$pidFile = Join-Path $runtimeDir 'enterprise-bridge.pid'
$serverPath = Join-Path $PSScriptRoot 'server.mjs'
$startedProcess = $null

function Get-ManagedProcess {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $value = Get-Content -LiteralPath $pidFile -Raw
    $processId = 0
    if (-not [int]::TryParse($value.Trim(), [ref]$processId)) { throw '进程记录无效，未操作任何进程' }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    if (-not $process) { return $null }
    if ($process.Name -ne 'node.exe' -or -not $process.CommandLine.Contains($serverPath)) {
        throw '进程记录与企业适配层不匹配，未操作该进程'
    }
    return $process
}

function Stop-ManagedProcess {
    $process = Get-ManagedProcess
    if ($process) {
        Stop-Process -Id $process.ProcessId
        Wait-Process -Id $process.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
        if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) { throw '企业适配层未能停止' }
        Write-Output '企业适配层已停止'
    } else { Write-Output '企业适配层未运行' }
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile }
}

try {
    if ($Action -eq 'stop') { Stop-ManagedProcess; exit 0 }
    if ($Action -eq 'restart') { Stop-ManagedProcess }
    try { $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw '读取企业适配层配置失败' }
    $port = [int]$config.port
    $managed = Get-ManagedProcess
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($managed) {
        if (-not ($listener | Where-Object { $_.OwningProcess -eq $managed.ProcessId -and $_.LocalAddress -eq '127.0.0.1' })) {
            throw '已记录的企业适配层未监听预期地址'
        }
        Write-Output "企业适配层运行中：127.0.0.1:$port"
        exit 0
    }
    if ($Action -eq 'status') { Write-Output '企业适配层未运行'; exit 1 }
    if ($listener) { throw "端口 $port 已被其他进程占用，未启动" }
    if (-not (Test-Path -LiteralPath $config.nodePath -PathType Leaf)) { throw '未找到配置的 Node.js' }
    $version = & $config.nodePath --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)' -or [int]$Matches[1] -lt 22) { throw '需要 Node.js 22 或更高版本' }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\@tencent-ai\agent-sdk') -PathType Container)) {
        throw '未安装锁定的企业 SDK 依赖'
    }
    $env:WORKBUDDY_ENTERPRISE_ENDPOINT = $config.endpoint
    $env:WORKBUDDY_ENTERPRISE_BRIDGE_KEY = $config.bridgeKey
    $env:WORKBUDDY_ENTERPRISE_MODELS = ConvertTo-Json -InputObject @($config.models) -Compress
    $env:WORKBUDDY_ENTERPRISE_PORT = [string]$port
    $env:CODEBUDDY_CONFIG_DIR = $config.codebuddyConfigDir
    $env:CODEBUDDY_API_KEY = $null
    $env:CODEBUDDY_AUTH_TOKEN = $null
    $env:CODEBUDDY_BASE_URL = $null
    $env:CODEBUDDY_INTERNET_ENVIRONMENT = 'cloudhosted'
    $env:PATH = "$(Split-Path $config.nodePath -Parent);$env:PATH"
    $workDir = Join-Path $runtimeDir 'enterprise-cli-work'
    if (-not (Test-Path -LiteralPath $workDir -PathType Container)) { throw '未找到隔离工作目录' }
    $process = Start-Process -FilePath $config.nodePath -ArgumentList @("`"$serverPath`"") -WorkingDirectory $workDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'enterprise-bridge.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'enterprise-bridge.stderr.log')
    $startedProcess = $process
    [IO.File]::WriteAllText($pidFile, [string]$process.Id, [Text.Encoding]::ASCII)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($process.HasExited) { throw '企业适配层启动失败，请查看本地错误日志' }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
            $bound = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.Id -and $_.LocalAddress -eq '127.0.0.1' }
            if ($health.status -eq 'ok' -and $bound) { Write-Output "企业适配层已启动：127.0.0.1:$port"; exit 0 }
        } catch { }
        Start-Sleep -Seconds 1
    }
    throw '企业适配层启动超时，请检查本地日志'
} catch {
    if ($startedProcess -and -not $startedProcess.HasExited) {
        $managed = Get-ManagedProcess
        if ($managed -and $managed.ProcessId -eq $startedProcess.Id) {
            Stop-Process -Id $startedProcess.Id -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
        }
    }
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
