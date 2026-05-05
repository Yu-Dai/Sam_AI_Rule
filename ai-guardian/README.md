# ai-guardian

AST-level 程式碼守衛 CLI。Claude Code / Cursor / Windsurf 等 AI 助手的硬性互補工具。

> **狀態：pre-v1，本地開發中。** 介面可能變動，尚未發布到 npm。

---

## 為什麼需要

`CLAUDE.md` / `.cursor/rules` / `.windsurfrules` 是**軟性勸說** — AI 看到會考慮，但**沒有強制力**。

ai-guardian 在 git pre-commit hook 跑 AST 分析，**真的擋住違規 commit**。

| 性質 | Prompt 規則檔 | ai-guardian |
|------|--------------|-------------|
| 強度 | 軟性 | 硬性 |
| 失敗模式 | AI 可能忘 / 繞過 | 阻擋 commit（hotfix 模式有 audit log） |
| 涵蓋 | 廣（行為哲學） | 狹但精準（AST 違規） |

---

## 安裝

尚未發布 npm，手動安裝：

```bash
git clone https://github.com/Yu-Dai/Sam_AI_Rule.git ~/Sam_AI_Rule
cd ~/Sam_AI_Rule/ai-guardian
npm install
npm link  # 註冊為全域指令（Windows 可能需要管理員 PowerShell）
```

### 開發 ai-guardian 自己時：日常同步本機改動到全域

`npm install -g .` 在 Windows 容易踩 EBUSY；想快速同步時用：

```bash
cd ~/Sam_AI_Rule/ai-guardian
ai-guardian self-update    # 直接 cp src + bin 到全域，跳過 npm 工具鏈
```

只能在 ai-guardian source repo 內跑（會檢查 `package.json::name`）。

---

## 使用流程

### 一次性：在新專案掛載

```bash
cd <your-project>
ai-guardian init    # 全新專案：建立 src/production / lab / archive 結構
ai-guardian adopt   # 既有專案：無痛掛載，建立 .guardian 沙盒
```

兩者都會：
- 安裝 git pre-commit hook
- 寫入你選擇的 IDE 規則檔（Cursor / Windsurf / Roo / Claude Code / Antigravity）
- 建立 `ai-guardian.json` 設定檔

### 每個任務：完整 workflow

```bash
ai-guardian start "<任務描述>"   # ① 開工宣誓，建立 branch + git baseline commit
# ② 讀 .guardian/current-task.md，輸出 Pre-flight Checkout 開工分析報告
# ... 開發 ...
ai-guardian review               # ③ 完工審查，產出改動報告
git commit                       # ④ pre-commit hook 自動跑 AST 掃描
ai-guardian finish               # ⑤ 合併主線、清理現場
```

跳過 `start` / `review` 會被擋。

### 想反悔？

```bash
ai-guardian abort [--yes]   # 丟棄當前任務、刪除分支、回主線
```

安全機制：
- 任務分支若有 commit 超出主線 → 拒絕並列出 commits（避免永久丟失）
- 未 commit 改動透過 stash → checkout main → pop 還原（保留你的工作）
- 非互動環境必須加 `--yes`（避免 CI / AI 誤觸）

### 緊急：Hotfix 模式

```bash
ai-guardian start hotfix    # 急診模式：豁免本次 AST 審查
# ... 緊急修復 ...
git commit                  # 用後即焚 + audit log 留底
```

---

## 改動偵測機制

`start` 時用 git plumbing 凍結當下工作區為 baseline commit（**不污染主 `.git/index`**）；
`review` / `guard` / `finish` 都對這個 baseline 跑 git diff。所以：

- **不限副檔名**：改 `.gd` / `.rs` / `.json` / `.yaml` / `.sh` / `Dockerfile` 都會被偵測
  （早期版本只認 `.js .ts` 等 13 種白名單，現已棄用）
- **自動尊重 `.gitignore`**：要忽略某路徑，加進 `.gitignore` 即可
- **支援 rename / 新檔 / 刪除 / type 變更**

---

## 行級別歸屬（Line-level Attribution）

guard 的 AST 違規偵測（Magic Number / Magic String / patch 模式）按
「**新引入的行**」報告，**pre-existing 違規不會被連坐**。

```javascript
// 第 1-3 行（pre-existing）
function existing(isHotfix) {
  if (isHotfix) return 1;     // 第 3 行：不報
}
// 第 4-6 行（本任務新增）
function added(isNewFlag) {
  if (isNewFlag) return 2;    // 第 6 行：報「補丁型 if 判斷」
}
```

例外（**永遠報，不過行級別 filter**）：
- 硬編憑證偵測（安全議題優先於可讀性）
- 函式雷同偵測（cross-file 議題與行號無關）

---

## 檢查項目

| 檢查 | 偵測方式 | 範圍 |
|------|---------|------|
| **邏輯雷同（換湯不換藥）** | AST 去骨指紋 + MD5 比對 | JS/JSX/TS/TSX |
| **補丁型 if 判斷** | AST `IfStatement.test` 是 `is[A-Z]...` 或 `xxxMode` 識別字 | JS/JSX/TS/TSX |
| **危險注釋** | 行起始的 `TODO/HACK/FIXME/TEMP/XXX` 標記（大小寫敏感） | 所有副檔名 |
| **Magic Number** | AST `NumericLiteral` 字面值 | JS/JSX/TS/TSX |
| **Magic String** | 角色 / API 路徑 / 環境字串 / 版本號 / 新舊 flag | JS/JSX/TS/TSX |
| **硬編憑證** | 語境感知：`if (pw === "xxx")` 才報，誤報率極低 | JS/JSX/TS/TSX |

### Magic Number 三層豁免

1. **內建白名單值**：`0` / `1` / `-1` / `100` / `0.05`（稅率測試）
2. **位置豁免**：父節點是 `VariableDeclarator` / `ObjectProperty`（即明確的常數定義）
3. **註解豁免**：`// guardian-allow-magic` 局部 override

```javascript
const args = process.argv[42]; // guardian-allow-magic: argv index
return arr.slice(0, 5);        // 報 magic number 5

// guardian-allow-magic: next-line case
const x = arr[99];             // 不報（前一行有豁免標記）
```

---

## 設定檔

`ai-guardian.json`（init 後自動產生）：

```json
{
  "mode": "standard",
  "productionDirs": ["src/production"],
  "labDir": "src/lab",
  "archiveDir": "src/archive"
}
```

要讓某個路徑不被 guardian 掃描，加進 `.gitignore` 即可——guardian 的差異偵測走 git diff，會自動尊重。

---

## 解除安裝

```bash
ai-guardian uninstall         # 移除 git hook 與部分設定
ai-guardian uninstall --full  # 完整移除 .guardian/、ai-guardian.json
```

---

## 限制

- **AST 邏輯掃描**只支援 JavaScript / TypeScript（`.js` `.jsx` `.ts` `.tsx`）
- **改動偵測**（start / review / finish 內部走 git diff）支援所有副檔名
- 邏輯雷同偵測有最小函式長度門檻（< 3 行函式不檢查）
- 補丁注釋偵測非 JS 副檔名走 regex（best-effort，會誤抓字串 / regex literal 內的標記文字）
- `debate` 對峙法庭機制尚未完整（只實作 `debate reset`）

---

## Troubleshooting

### `Cannot find module '@babel/parser'` 或 `Error: Cannot find module ...`
**原因**：`node_modules` 未安裝（直接 `git clone` 跳過 bootstrap 的常見情況）。

**修復**：
```bash
cd <Sam_AI_Rule path>/ai-guardian
npm install
```
cli.js 從本版開始有自我體檢，會直接印出修復指令。

### 執行 `ai-guardian` 顯示「找不到指令」
**原因**：`npm link` 沒成功，全域指令未註冊。

**修復**（擇一）：
- **Windows**：以管理員 PowerShell 重跑 `npm link`，或重跑 bootstrap.ps1
- **macOS / Linux**：`sudo npm link`
- **不想用 sudo / admin**：在 shell profile 加 alias：
  - bash / zsh：`alias ai-guardian='node $HOME/Sam_AI_Rule/ai-guardian/bin/cli.js'`
  - PowerShell `$PROFILE`：`function ai-guardian { node "$HOME\Sam_AI_Rule\ai-guardian\bin\cli.js" @args }`

bootstrap script 已內建 fallback，會在 `npm link` 失敗時主動列出這幾個選項。

### Windows PowerShell 噴 ExecutionPolicy 錯誤
**原因**：PowerShell 預設禁止執行未簽名 `.ps1`。

**修復**（管理員 PowerShell 一次性設定）：
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 沒有 Node.js / npm
**修復**：先裝 Node.js（建議 LTS）：
- Windows / macOS：https://nodejs.org/
- Linux：用 distro 套件管理（`apt install nodejs npm` / `dnf install nodejs` 等）

裝好後重跑 bootstrap。

### 完全沒跑 bootstrap，純手動 git clone
最少要做：
```bash
cd <repo>/ai-guardian
npm install
```
然後加 alias 或 npm link。詳見上方「找不到指令」。
