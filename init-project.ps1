# init-project.ps1 — 在 Sam_AI_Rule clone 子目錄內執行，把規則檔複製到 parent (專案根目錄)
#
# 用法：
#   cd <project>\Sam_AI_Rule
#   .\init-project.ps1
#
# 行為（操作目標都是 parent，即專案根目錄）：
#   1. 從 ai-guardian\templates\CLAUDE.md 複製 CLAUDE.md 到 parent（若已存在則跳過）
#      若使用者選擇步驟 4 的 ai-guardian adopt，CLAUDE.md 也會由 adopt 帶 marker 重新產生
#   2. (詢問) 複製 PROJECT.md 模板到 parent
#   3. (詢問) 把 Sam_AI_Rule/ 加到 parent 的 .gitignore
#      （避免 ai-guardian adopt 把 Sam_AI_Rule 內的程式碼納入掃描）
#   4. (詢問) cd 到 parent 後執行 ai-guardian adopt 掛載守衛（會同步生成 AGENTS.md + CLAUDE.md）

$ErrorActionPreference = 'Stop'

# 強制 UTF-8 console encoding（避免繁中 Write-Host 在 PS 5.1 顯示亂碼）
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$exitCode = 0

try {
    # 前置檢查：必須在 Sam_AI_Rule clone 子目錄內執行
    if (-not ((Test-Path 'ai-guardian') -and (Test-Path 'ai-guardian\templates') -and (Test-Path 'templates'))) {
        $msg = @"
此腳本須從 Sam_AI_Rule clone 子目錄內執行（PWD: $(Get-Location)）
正確做法：
  cd <project>\Sam_AI_Rule
  .\init-project.ps1
"@
        throw $msg
    }

    $samAiDir = (Get-Location).Path
    $target = (Get-Item ..).FullName
    $samAiName = Split-Path -Leaf $samAiDir

    Write-Host "Sam_AI_Rule 路徑：$samAiDir" -ForegroundColor Gray
    Write-Host "專案根目錄：$target" -ForegroundColor Gray
    Write-Host ""

    # 1. CLAUDE.md（template 在 ai-guardian\templates\，不在根目錄）
    if (Test-Path (Join-Path $target 'CLAUDE.md')) {
        Write-Host "[skip] $target\CLAUDE.md 已存在" -ForegroundColor Yellow
    } else {
        Copy-Item 'ai-guardian\templates\CLAUDE.md' (Join-Path $target 'CLAUDE.md')
        Write-Host "[ok] CLAUDE.md → $target\" -ForegroundColor Green
    }

    # 2. PROJECT.md (詢問)
    $ans = Read-Host '是否建立 PROJECT.md（長期專案方向追蹤）？(y/N)'
    if ($ans -eq 'y' -or $ans -eq 'Y') {
        if (Test-Path (Join-Path $target 'PROJECT.md')) {
            Write-Host "[skip] $target\PROJECT.md 已存在" -ForegroundColor Yellow
        } else {
            Copy-Item (Join-Path 'templates' 'PROJECT.md') (Join-Path $target 'PROJECT.md')
            Write-Host "[ok] PROJECT.md → $target\（請填寫）" -ForegroundColor Green
        }
    }

    # 3. 把 Sam_AI_Rule 加到 parent 的 .gitignore
    $gitignorePath = Join-Path $target '.gitignore'
    $alreadyIgnored = $false
    if (Test-Path $gitignorePath) {
        $pattern = "^/?$([regex]::Escape($samAiName))/?$"
        $alreadyIgnored = (Get-Content $gitignorePath) -match $pattern
    }

    if ($alreadyIgnored) {
        Write-Host "[skip] $target\.gitignore 已含 $samAiName/" -ForegroundColor Yellow
    } else {
        $ans = Read-Host "是否把 $samAiName/ 加到 $target\.gitignore？(Y/n)"
        if ($ans -ne 'n' -and $ans -ne 'N') {
            Add-Content $gitignorePath ""
            Add-Content $gitignorePath "# Sam_AI_Rule clone（vendored 工具，不入 git）"
            Add-Content $gitignorePath "/$samAiName/"
            Write-Host "[ok] 已將 /$samAiName/ 加入 $target\.gitignore" -ForegroundColor Green
        }
    }

    # 4. ai-guardian (詢問)
    $ans = Read-Host '是否在專案根目錄掛載 ai-guardian？(y/N)'
    if ($ans -eq 'y' -or $ans -eq 'Y') {
        if (-not (Get-Command ai-guardian -ErrorAction SilentlyContinue)) {
            Write-Host "[error] ai-guardian 指令未找到。請先在 Sam_AI_Rule 內執行 .\bootstrap.ps1" -ForegroundColor Red
        } else {
            Push-Location $target
            ai-guardian adopt
            Pop-Location
        }
    }

    Write-Host ""
    Write-Host "初始化完成於：$target" -ForegroundColor Green
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
