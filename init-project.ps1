# init-project.ps1 — 在當前專案目錄初始化 Sam_AI_Rule 設定
#
# 用法（在新專案目錄內執行）：
#   & "$HOME\Sam_AI_Rule\init-project.ps1"
#
# 行為：
#   1. 複製 CLAUDE.md 到當前目錄（若已存在則跳過）
#   2. (詢問) 複製 PROJECT.md 模板
#   3. (詢問) 執行 ai-guardian adopt 掛載守衛

$ErrorActionPreference = 'Stop'

# 強制 UTF-8 console encoding（避免繁中 Write-Host 在 PS 5.1 顯示亂碼）
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$exitCode = 0

try {
    $repoDir = Join-Path $HOME 'Sam_AI_Rule'

    if (-not (Test-Path $repoDir)) {
        throw "Sam_AI_Rule 未安裝於 $repoDir，請先執行 bootstrap.ps1"
    }

    # 1. CLAUDE.md
    if (Test-Path 'CLAUDE.md') {
        Write-Host "[skip] CLAUDE.md 已存在" -ForegroundColor Yellow
    } else {
        Copy-Item (Join-Path $repoDir 'CLAUDE.md') .
        Write-Host "[ok] CLAUDE.md 已建立" -ForegroundColor Green
    }

    # 2. PROJECT.md (詢問)
    $ans = Read-Host '是否建立 PROJECT.md（長期專案方向追蹤）？(y/N)'
    if ($ans -eq 'y' -or $ans -eq 'Y') {
        if (Test-Path 'PROJECT.md') {
            Write-Host "[skip] PROJECT.md 已存在" -ForegroundColor Yellow
        } else {
            Copy-Item (Join-Path $repoDir 'templates\PROJECT.md') .
            Write-Host "[ok] PROJECT.md 模板已建立，請填寫" -ForegroundColor Green
        }
    }

    # 3. ai-guardian (詢問)
    $ans = Read-Host '是否掛載 ai-guardian？(y/N)'
    if ($ans -eq 'y' -or $ans -eq 'Y') {
        if (-not (Get-Command ai-guardian -ErrorAction SilentlyContinue)) {
            Write-Host "[error] ai-guardian 指令未找到，請確認 bootstrap.ps1 已正確執行（包含 npm link）" -ForegroundColor Red
        } else {
            ai-guardian adopt
        }
    }

    Write-Host ""
    Write-Host "初始化完成。" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "[error] 腳本中斷：$($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
}
finally {
    Write-Host ""
    Read-Host "按 Enter 關閉視窗" | Out-Null
    if ($exitCode -ne 0) { exit $exitCode }
}
