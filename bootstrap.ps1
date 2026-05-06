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
    if (-not ((Test-Path 'ai-guardian') -and (Test-Path 'ai-guardian\templates'))) {
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
        Write-Host "[warn] npm link 失敗（exit code: $linkExitCode）。" -ForegroundColor Yellow
        Write-Host "依賴已安裝完成，但全域指令未註冊。" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Windows 上最常見原因是 EBUSY（檔案被鎖住）— 而非權限問題：" -ForegroundColor Yellow
        Write-Host "  - 其他 terminal / IDE 正在跑 ai-guardian" -ForegroundColor Gray
        Write-Host "  - Windows Defender / 防毒在掃 npm 全域目錄" -ForegroundColor Gray
        Write-Host "  - 之前的 ai-guardian 指令還有 node.exe 殘留 handle 沒釋放" -ForegroundColor Gray
        Write-Host ""
        Write-Host "選項 A（推薦）：手動清除舊 link 後重試" -ForegroundColor Cyan
        Write-Host "  1. 關掉所有跑過 ai-guardian 的 terminal / IDE 視窗" -ForegroundColor Gray
        Write-Host "  2. taskkill /F /IM node.exe   # 殺掉殘留 node" -ForegroundColor Gray
        Write-Host "  3. npm uninstall -g ai-guardian" -ForegroundColor Gray
        Write-Host "  4. cd $(Split-Path -Parent $aiGuardianBin)\..; .\bootstrap.ps1" -ForegroundColor Gray
        Write-Host ""
        Write-Host "選項 B：跳過 npm link，用 PowerShell 函式（不碰全域）" -ForegroundColor Cyan
        Write-Host "  在你的 `$PROFILE 加入這一行：" -ForegroundColor Gray
        Write-Host "  function ai-guardian { node `"$aiGuardianBin`" @args }" -ForegroundColor Gray
        Write-Host ""
        Write-Host "選項 C：每次用完整路徑呼叫" -ForegroundColor Cyan
        Write-Host "  node `"$aiGuardianBin`" <command>" -ForegroundColor Gray
        Write-Host ""
        Write-Host "（若上述都失敗，且確認真的是權限問題：以管理員 PowerShell 重跑 .\bootstrap.ps1）" -ForegroundColor DarkGray
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
