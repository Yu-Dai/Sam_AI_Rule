# Sam AI Rule

個人 AI 助手規則 + 程式碼守衛工具包。**每個專案 clone 一份**，把規則與守衛部署到專案根目錄。

## 內容

| 項目 | 路徑 | 用途 |
|------|------|------|
| 規則本體（SSoT） | [`ai-guardian/templates/AGENTS.md`](ai-guardian/templates/AGENTS.md) | 個人身分 / 行為原則 §1–§16 / 硬性紅線 / 工具規格附錄。所有 AI coding tool（Claude Code、Cursor、Antigravity、Roo、Windsurf）部署時都讀這份 |
| 動工前裁決 | [`ai-guardian/templates/current-task.md`](ai-guardian/templates/current-task.md) | Q1–Q7 填空題，由 `ai-guardian start` 在每次任務開始時 active 載入 |
| 專案方向追蹤 | [`ai-guardian/templates/PROJECT.md`](ai-guardian/templates/PROJECT.md) | 長期專案的目標 / 非目標 / 歷史轉向北極星（給人類填寫） |
| 程式碼守衛 CLI | [`ai-guardian/`](ai-guardian/) | AST-level commit 阻擋與任務流程管理 |

**設計理念**：AGENTS.md（軟）負責 prompt 階段勸說 AI；ai-guardian CLI（硬）負責 commit 階段實際阻擋。兩者互補。CLAUDE.md 在新版只是個 1-行 stub 指向 AGENTS.md（為了 Claude Code 與人類瀏覽者的方便）。

---

## 使用流程

### 一次性（每台新機器跑一次）：安裝 ai-guardian 為全域指令

任意挑一個目錄 clone Sam_AI_Rule，跑 bootstrap：

```bash
git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
cd Sam_AI_Rule
bash bootstrap.sh        # Linux / Mac / Windows git bash
# 或
.\bootstrap.ps1          # Windows PowerShell
```

bootstrap 做的事：**把 `ai-guardian/` source 複製到 canonical 路徑 → npm install → npm link**。

**Canonical 路徑（global ai-guardian 永遠指向這裡）**：
- Linux / Mac：`~/.ai-guardian/`
- Windows：`%LOCALAPPDATA%\ai-guardian\`
- 環境變數覆寫：`AI_GUARDIAN_CANONICAL_DIR`

**為什麼不直接 npm link 到 clone？** 解開「source clone = global target」的耦合：
- 多個 Sam_AI_Rule clone（不同機器、不同分支實驗）不會互搶全域 link
- 重跑 bootstrap = 覆寫 canonical，永遠可預期目標
- 想升級就在任一 clone `git pull` 後重跑 bootstrap

**Dev 場景**（編輯 ai-guardian 本身的 source）：
- 改完 `.js` / `.md` 後 → 跑 `ai-guardian self-update` 把 src/bin/templates 增量同步到 canonical
- 不必每次重跑完整 bootstrap（不需 npm install）

### 每個新專案：clone Sam_AI_Rule 並初始化

```bash
cd <project>
git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
cd Sam_AI_Rule
bash init-project.sh     # 或 .\init-project.ps1
```

`init-project` 會在 **parent 目錄（你的專案根目錄）** 互動式做以下事：
1. 詢問是否複製 `PROJECT.md` 模板（給人類填的方向追蹤檔）
2. 詢問是否把 `Sam_AI_Rule/` 加到專案的 `.gitignore`（推薦，因為這是 vendored 工具）
3. 詢問是否在專案根目錄掛載 ai-guardian（執行 `ai-guardian adopt`）

執行 `ai-guardian adopt` 後，你的專案根目錄會出現：
- `AGENTS.md` — 規則本體（規則的 SSoT，所有 IDE 都讀），帶 auto-gen marker，重跑 init/adopt 可安全更新
- `CLAUDE.md` — 1-行 stub，內容只有「See AGENTS.md」，給 Claude Code 與人類瀏覽者
- `.guardian/` — 沙盒目錄與任務狀態
- `.{ide}/rules/` — 各 IDE 的 rule 檔，內容是指向 AGENTS.md 的 reference stub
- `.git/hooks/pre-commit` — guardian 攔截 hook

`PROJECT.md` 與 IDE 的 skill 檔（如 `.claude/skills/adversarial-debate/`）為選擇性產生。

---

## 不想用 init-project 腳本？純手動也可以

```bash
cd <project>
git clone https://github.com/Yu-Dai/Sam_AI_Rule.git
echo "/Sam_AI_Rule/" >> .gitignore       # 推薦
ai-guardian adopt                        # 寫 AGENTS.md / CLAUDE.md stub / hook
cp Sam_AI_Rule/ai-guardian/templates/PROJECT.md .   # 需要的話
```

不用手動 `cp AGENTS.md` 或 `cp CLAUDE.md` — `ai-guardian adopt` 會從 template 渲染並寫入。

或者完全不 clone，只想要規則本體單檔（不裝 CLI）：
```bash
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/ai-guardian/templates/AGENTS.md -o AGENTS.md
```

---

## 升級 Sam_AI_Rule 在某個專案

```bash
cd <project>/Sam_AI_Rule
git pull
ai-guardian adopt        # 重跑 adopt，AGENTS.md / CLAUDE.md 會被重新渲染（auto-gen marker 仍在 → 安全覆寫）
```

若你曾把 AGENTS.md 客製化（移除第一行的 `— AI Guardian Project Rules` 後綴 = 標記為使用者版本），adopt 不會覆寫你的客製版本。

---

## ai-guardian 工作流（在掛載專案內）

```bash
ai-guardian start "<任務描述>"   # 開工：建立 branch、產生 .guardian/current-task.md（Q1–Q7 填空題）
# ... AI 填寫 Q1–Q7、改 code ...
ai-guardian review               # commit 前審查（AST 掃描補丁模式 / 殭屍代碼）
git commit                       # 通過 review 才能 commit
ai-guardian finish               # 任務完結：合併主線 + 歸檔
```

緊急情況用 `ai-guardian start "hotfix: ..."`，繞過部分審查但仍記錄。詳見部署後的 AGENTS.md。

---

## 維護

任何元件變更 → commit → push 到 `main`。下次 clone 自動拿到最新版。

本 repo 只放**跨專案共通**的東西。個別專案的設定請放在那個專案內。
