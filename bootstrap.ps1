# bootstrap.ps1 — 在新 Windows 機器上安裝 Sam_AI_Rule
#
# 用法（PowerShell）：
#   irm https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/bootstrap.ps1 | iex
#
# 行為：
#   1. Clone（或更新）Sam_AI_Rule 到 $HOME\Sam_AI_Rule
#   2. 安裝 ai-guardian 依賴並 npm link 為全域指令

$ErrorActionPreference = 'Stop'

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

Write-Host "[ai-guardian] 註冊為全域指令（npm link 可能需要管理員 PowerShell）..." -ForegroundColor Cyan
npm link
Pop-Location

Write-Host ""
Write-Host "完成！" -ForegroundColor Green
Write-Host "  Sam_AI_Rule 路徑：$installDir" -ForegroundColor Gray
Write-Host "  ai-guardian 已註冊為全域指令" -ForegroundColor Gray
Write-Host ""
Write-Host "新專案初始化：" -ForegroundColor Yellow
Write-Host "  cd <new-project>" -ForegroundColor Gray
Write-Host "  & '$installDir\init-project.ps1'" -ForegroundColor Gray
