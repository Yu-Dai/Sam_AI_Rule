# bootstrap.ps1 — 把 ai-guardian source 安裝到 canonical 路徑並全域註冊
#
# 用法：
#   cd <project>
#   git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
#   cd Sam_AI_Rule
#   .\bootstrap.ps1
#
# 行為：
#   1. 偵測 canonical 路徑（$env:LOCALAPPDATA\ai-guardian）
#   2. 把 ai-guardian\ 複製到 canonical（覆寫，但保留 canonical 自己的 node_modules）
#   3. cd canonical → npm install → npm link
#   4. 全域 ai-guardian 指令永遠指向 canonical（不指向 clone）
#
# 環境變數：
#   $env:AI_GUARDIAN_CANONICAL_DIR — 覆寫 canonical 路徑（除錯 / 自訂用）

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

    # 決定 canonical 路徑（環境變數優先；否則用 $env:LOCALAPPDATA\ai-guardian）
    if ($env:AI_GUARDIAN_CANONICAL_DIR) {
        $canonicalDir = $env:AI_GUARDIAN_CANONICAL_DIR
    } else {
        $canonicalDir = Join-Path $env:LOCALAPPDATA 'ai-guardian'
    }

    $sourceDir = Join-Path (Get-Location).Path 'ai-guardian'

    Write-Host "[ai-guardian] Source 來源:    $sourceDir" -ForegroundColor Gray
    Write-Host "[ai-guardian] Canonical 路徑: $canonicalDir" -ForegroundColor Gray

    # 邊界：source 已是 canonical（從 canonical 自身重跑 bootstrap）
    $sourceReal = (Resolve-Path $sourceDir -ErrorAction SilentlyContinue).Path
    $canonicalReal = if (Test-Path $canonicalDir) { (Resolve-Path $canonicalDir).Path } else { $canonicalDir }

    if ($sourceReal -and $sourceReal -eq $canonicalReal) {
        Write-Host "[ai-guardian] Source 已是 canonical，跳過複製，直接 install + link" -ForegroundColor Yellow
    } else {
        Write-Host "[ai-guardian] 複製 source 到 canonical（覆寫）..." -ForegroundColor Cyan
        if (-not (Test-Path $canonicalDir)) {
            New-Item -ItemType Directory -Path $canonicalDir -Force | Out-Null
        }
        # robocopy: /MIR 鏡像同步、/XD node_modules 排除依賴目錄、/NFL /NDL /NJH /NJS 安靜輸出
        # exit code 0-7 都是「成功或微小差異」；>=8 才是真錯
        & robocopy $sourceDir $canonicalDir /MIR /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
        $robocopyExit = $LASTEXITCODE
        if ($robocopyExit -ge 8) {
            throw "robocopy 失敗（exit code: $robocopyExit）。可能 canonical 目錄被其他程序鎖住，請關掉相關 terminal / IDE 後重試。"
        }
        # robocopy 用 0-7 表示成功，但 PowerShell 看了會以為錯，要重置
        $LASTEXITCODE = 0
    }

    Push-Location $canonicalDir

    Write-Host "[ai-guardian] 安裝依賴（in canonical）..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
        $code = $LASTEXITCODE
        Pop-Location
        throw "npm install 失敗（exit code: $code），請檢查網路或 npm 設定後重試。"
    }

    Write-Host "[ai-guardian] 清理可能的 stale link..." -ForegroundColor Cyan
    npm uninstall -g ai-guardian | Out-Null
    $LASTEXITCODE = 0

    Write-Host "[ai-guardian] 註冊全域指令（npm link）..." -ForegroundColor Cyan
    npm link
    $linkExitCode = $LASTEXITCODE
    $aiGuardianBin = Join-Path $canonicalDir 'bin\cli.js'
    Pop-Location

    Write-Host ""
    if ($linkExitCode -eq 0) {
        Write-Host "✅ 完成！全域 'ai-guardian' 指令已註冊。" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Source of truth: $canonicalDir" -ForegroundColor Gray
        Write-Host "  （之後從任何 Sam_AI_Rule clone 跑 bootstrap 都會覆寫此處）" -ForegroundColor Gray
        Write-Host ""
        Write-Host "下一步：在這個 Sam_AI_Rule clone 內執行 init-project.ps1 部署到專案" -ForegroundColor Yellow
        Write-Host "  cd .." -ForegroundColor Gray
        Write-Host "  & .\Sam_AI_Rule\init-project.ps1" -ForegroundColor Gray
        Write-Host ""
        Write-Host "[Dev 場景] 編輯 source clone 的 .js / .md 後，跑 'ai-guardian self-update'" -ForegroundColor DarkGray
        Write-Host "          即可同步到 canonical（不需重跑 bootstrap）" -ForegroundColor DarkGray
    } else {
        Write-Host "[warn] npm link 失敗（exit code: $linkExitCode）。" -ForegroundColor Yellow
        Write-Host "依賴已安裝，但全域指令未註冊。" -ForegroundColor Yellow
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
        Write-Host "  4. cd `"$canonicalDir`"; npm link" -ForegroundColor Gray
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
