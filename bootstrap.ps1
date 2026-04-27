# bootstrap.ps1 — 在 Sam_AI_Rule clone 子目錄內執行，安裝 ai-guardian 為全域指令
#
# 用法：
#   cd <project>
#   git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
#   cd Sam_AI_Rule
#   .\bootstrap.ps1
#
# 行為：
#   1. 進入 ai-guardian 子目錄
#   2. npm install + npm link（每台機器跑一次即可，全域註冊 ai-guardian 指令）
#   3. 不複製規則檔（用 init-project.ps1 做）

$ErrorActionPreference = 'Stop'

# 強制 UTF-8 console encoding（避免繁中 Write-Host 在 PS 5.1 顯示亂碼）
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$exitCode = 0

try {
    # 前置檢查：必須在 Sam_AI_Rule clone 子目錄內執行
    if (-not ((Test-Path 'ai-guardian') -and (Test-Path 'CLAUDE.md'))) {
        $msg = @"
此腳本須從 Sam_AI_Rule clone 子目錄內執行（PWD: $(Get-Location)）
正確做法：
  cd <project>
  git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
  cd Sam_AI_Rule
  .\bootstrap.ps1
"@
        throw $msg
    }

    # 前置檢查：npm 必須存在
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "缺少 npm，請先安裝 Node.js（建議 LTS）：https://nodejs.org/"
    }

    Push-Location 'ai-guardian'

    Write-Host "[ai-guardian] 安裝依賴..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
        $code = $LASTEXITCODE
        Pop-Location
        throw "npm install 失敗（exit code: $code），請檢查網路或 npm 設定後重試。"
    }

    Write-Host "[ai-guardian] 清理可能的 stale link（避免 wrapper 沒被重建）..." -ForegroundColor Cyan
    npm uninstall -g ai-guardian | Out-Null
    $LASTEXITCODE = 0

    Write-Host "[ai-guardian] 嘗試 npm link 註冊全域指令..." -ForegroundColor Cyan
    npm link
    $linkExitCode = $LASTEXITCODE
    $aiGuardianBin = (Get-Location).Path + '\bin\cli.js'
    Pop-Location

    Write-Host ""
    if ($linkExitCode -eq 0) {
        Write-Host "完成！全域指令 'ai-guardian' 已註冊（每台機器跑一次即可）。" -ForegroundColor Green
        Write-Host ""
        Write-Host "下一步：在這個 Sam_AI_Rule clone 內執行 init-project.ps1" -ForegroundColor Yellow
        Write-Host "把規則檔複製到專案根目錄：" -ForegroundColor Yellow
        Write-Host "  cd .." -ForegroundColor Gray
        Write-Host "  & .\Sam_AI_Rule\init-project.ps1" -ForegroundColor Gray
    } else {
        Write-Host "[warn] npm link 失敗（exit code: $linkExitCode）。常見原因：權限不足。" -ForegroundColor Yellow
        Write-Host "依賴已安裝完成，但全域指令未註冊。請從以下擇一：" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "選項 A：以管理員 PowerShell 重新執行" -ForegroundColor Cyan
        Write-Host "  cd $(Split-Path -Parent $aiGuardianBin)\.." -ForegroundColor Gray
        Write-Host "  .\bootstrap.ps1" -ForegroundColor Gray
        Write-Host ""
        Write-Host "選項 B：手動加入 PowerShell function 到 `$PROFILE（不需要管理員）" -ForegroundColor Cyan
        Write-Host "  function ai-guardian { node `"$aiGuardianBin`" @args }" -ForegroundColor Gray
        Write-Host ""
        Write-Host "選項 C：每次用完整路徑呼叫" -ForegroundColor Cyan
        Write-Host "  node `"$aiGuardianBin`" <command>" -ForegroundColor Gray
    }
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
