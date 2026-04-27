# bootstrap.ps1 — 在新 Windows 機器上安裝 Sam_AI_Rule
#
# 用法（PowerShell）：
#   irm https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/bootstrap.ps1 | iex
#
# 行為：
#   1. Clone（或更新）Sam_AI_Rule 到 $HOME\Sam_AI_Rule
#   2. 安裝 ai-guardian 依賴並 npm link 為全域指令

$ErrorActionPreference = 'Stop'

# 強制 UTF-8 console encoding（避免繁中 Write-Host 在 PS 5.1 顯示亂碼）
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$repoUrl     = 'https://github.com/Yu-Dai/Sam_AI_Rule.git'
$installDir  = Join-Path $HOME 'Sam_AI_Rule'

# 前置檢查
foreach ($cmd in @('git', 'npm')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "[error] 缺少 $cmd，請先安裝。" -ForegroundColor Red
        exit 1
    }
}

# 1. Clone or pull
if (Test-Path $installDir) {
    Write-Host "[Sam_AI_Rule] 已存在於 $installDir，執行 git pull..." -ForegroundColor Cyan
    Push-Location $installDir
    git pull
    Pop-Location
} else {
    Write-Host "[Sam_AI_Rule] Clone 到 $installDir..." -ForegroundColor Cyan
    git clone $repoUrl $installDir
}

# 2. ai-guardian
Write-Host "[ai-guardian] 安裝依賴..." -ForegroundColor Cyan
Push-Location (Join-Path $installDir 'ai-guardian')
npm install
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "[error] npm install 失敗（exit code: $LASTEXITCODE），請檢查網路或 npm 設定後重試。" -ForegroundColor Red
    exit 1
}

Write-Host "[ai-guardian] 嘗試 npm link 註冊全域指令..." -ForegroundColor Cyan
npm link
$linkExitCode = $LASTEXITCODE
Pop-Location

Write-Host ""
if ($linkExitCode -eq 0) {
    Write-Host "完成！全域指令 'ai-guardian' 已註冊。" -ForegroundColor Green
    Write-Host "  Sam_AI_Rule 路徑：$installDir" -ForegroundColor Gray
    Write-Host ""
    Write-Host "新專案初始化：" -ForegroundColor Yellow
    Write-Host "  cd <new-project>" -ForegroundColor Gray
    Write-Host "  & '$installDir\init-project.ps1'" -ForegroundColor Gray
} else {
    Write-Host "[warn] npm link 失敗（exit code: $linkExitCode）。常見原因：權限不足。" -ForegroundColor Yellow
    Write-Host "依賴已安裝完成，但全域指令未註冊。請從以下擇一：" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "選項 A：以管理員 PowerShell 重新執行 bootstrap" -ForegroundColor Cyan
    Write-Host "  irm https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/bootstrap.ps1 | iex" -ForegroundColor Gray
    Write-Host ""
    Write-Host "選項 B：手動加入 PowerShell function 到 `$PROFILE（不需要管理員）" -ForegroundColor Cyan
    Write-Host "  把下面這行加進你的 `$PROFILE：" -ForegroundColor Gray
    Write-Host "  function ai-guardian { node `"$installDir\ai-guardian\bin\cli.js`" @args }" -ForegroundColor Gray
    Write-Host ""
    Write-Host "選項 C：每次用完整路徑呼叫" -ForegroundColor Cyan
    Write-Host "  node `"$installDir\ai-guardian\bin\cli.js`" <command>" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Sam_AI_Rule 路徑：$installDir" -ForegroundColor Gray
}
