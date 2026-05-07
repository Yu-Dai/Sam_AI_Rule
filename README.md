# Sam AI Rule

個人 AI 助手規則 + 程式碼守衛工具包。**clone 一次到任何地方** → bootstrap → 之後任何專案直接 `ai-guardian init/adopt` 部署。

## 內容

| 項目 | 路徑 | 用途 |
|------|------|------|
| 規則本體（SSoT） | [`ai-guardian/templates/AGENTS.md`](ai-guardian/templates/AGENTS.md) | 個人身分 / 行為原則 §1–§16 / 硬性紅線 / 工具規格附錄。所有 AI coding tool（Claude Code、Cursor、Antigravity、Roo、Windsurf、ELI、GPT Codex）部署時都讀這份 |
| 動工前裁決 | [`ai-guardian/templates/current-task.md`](ai-guardian/templates/current-task.md) | Q1–Q7 填空題，由 `ai-guardian start` 在每次任務開始時 active 載入 |
| 專案方向追蹤 | [`ai-guardian/templates/PROJECT.md`](ai-guardian/templates/PROJECT.md) | 長期專案的目標 / 非目標 / 歷史轉向北極星（給人類填寫） |
| 程式碼守衛 CLI | [`ai-guardian/`](ai-guardian/) | AST-level commit 阻擋與任務流程管理 |

**設計理念**：AGENTS.md（軟）負責 prompt 階段勸說 AI；ai-guardian CLI（硬）負責 commit 階段實際阻擋。兩者互補。CLAUDE.md 在新版只是個 stub，用 Claude Code 原生 `@AGENTS.md` import 語法把 AGENTS.md 拉進 context。

---

## 使用流程

兩步：bootstrap 一次性，之後任何專案直接 `ai-guardian init/adopt`。

### Step 1（每台機器跑一次）：bootstrap

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

bootstrap 完成後，你**不再需要保留** Sam_AI_Rule clone 在任何專案旁邊。clone 只是 source，bootstrap 後可以丟到任何位置或刪掉（但保留以便未來升級會比較方便）。

### Step 2（每個專案）：直接跑 ai-guardian

```bash
cd <my-project>
ai-guardian adopt        # 既有專案，無痛掛載（不動既有結構）
# 或
ai-guardian init         # 全新專案，建立 src/production / lab / archive 隔離結構
```

兩個指令都會互動式問：
1. **本機 IDE**（多選，例如 `1,5` 同時設定 Cursor + Antigravity）
2. **是否建立 PROJECT.md**（長期方向追蹤檔，給人填）

執行完，專案根目錄會出現：
- `AGENTS.md` — 規則本體（auto-gen marker，重跑 init/adopt 可安全更新）
- `CLAUDE.md` — Claude Code stub（用 `@AGENTS.md` 把規則拉進 context）
- `.guardian/` — 沙盒目錄與任務狀態
- `.{ide}/rules/` — 各 IDE 的 rule 檔（指向 AGENTS.md 的 reference stub）
- `.{ide}/skills/adversarial-debate/SKILL.md` — 對 Claude Code / Antigravity / ELI / GPT Codex 寫，其他 IDE 跳過
- `.git/hooks/pre-commit` — guardian 攔截 hook
- `PROJECT.md`（選擇性，按你回答）

---

## 純手動部署（不用 bootstrap，自己處理 ai-guardian 安裝）

```bash
cd <project>
ai-guardian adopt        # 假設你已用其他方式裝好 ai-guardian CLI
```

或者完全不裝 CLI、只想要規則本體單檔：
```bash
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/ai-guardian/templates/AGENTS.md -o AGENTS.md
```

---

## 升級

機器級升級（在任意一個 Sam_AI_Rule clone 內）：
```bash
cd <Sam_AI_Rule clone>
git pull
bash bootstrap.sh        # 覆寫 canonical，所有專案下次跑 ai-guardian 自動拿到新版
```

專案級重新套用規則：
```bash
cd <project>
ai-guardian adopt        # AGENTS.md / CLAUDE.md 帶 auto-gen marker → 安全覆寫
```

若你曾把 AGENTS.md 客製化（移除第一行的 `— AI Guardian Project Rules` 後綴 = 標記為使用者版本），adopt 不會覆寫你的客製版本。

**Dev 場景**（你正在編輯 ai-guardian 本身的 source）：
- 改完 `.js` / `.md` 後 → 跑 `ai-guardian self-update` 增量同步到 canonical
- 不必每次重跑完整 bootstrap（省 npm install）

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

任何元件變更 → commit → push 到 `main`。下次 clone 重新 bootstrap 自動拿到最新版。

本 repo 只放**跨專案共通**的東西。個別專案的設定請放在那個專案內。
