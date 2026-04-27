# Sam AI Rule

個人 AI 助手（Claude Code）設定與專案初始化工具包。

## 內容

| 項目 | 路徑 | 用途 |
|------|------|------|
| 全域行為規則 | [`CLAUDE.md`](CLAUDE.md) | Claude Code 跨專案行為準則（軟性） |
| 文件模板 | [`templates/`](templates/) | 專案模板（如 `PROJECT.md`） |
| 程式碼守衛 | [`ai-guardian/`](ai-guardian/) | AST-level commit 阻擋 CLI（硬性） |

**設計理念**：CLAUDE.md（軟）負責 prompt 階段勸說 AI；ai-guardian（硬）負責 commit 階段實際阻擋。兩者互補。

---

## ⚠️ 重要：使用者心智模型

本 repo 是「**全機器一份**」的工具庫，**不是**每個專案複製一份。

**正確**：clone 一次到 `$HOME/Sam_AI_Rule`，所有專案共用。

**錯誤**：在每個專案目錄內 `git clone` 本 repo（會在專案內塞一個 `Sam_AI_Rule/` 子目錄，後續設定全建在錯的地方）。

---

## 使用流程

### 步驟 1：新機器一次性安裝

**Windows（PowerShell）**：

```powershell
irm https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/bootstrap.ps1 | iex
```

**Linux / Mac / Windows git bash**：

```bash
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/bootstrap.sh | bash
```

執行內容：
1. Clone（或 git pull）本 repo 到 `$HOME/Sam_AI_Rule`
2. 安裝 ai-guardian 依賴並 `npm link` 為全域指令

完成後 `$HOME/Sam_AI_Rule` 是全機器共享的 Sam_AI_Rule 安裝點，**不要動它**。

### 步驟 2：每個新專案執行一次初始化

在你的**專案根目錄**（不是 `$HOME/Sam_AI_Rule`）內執行：

```powershell
# Windows
cd <your-project-root>
& "$HOME\Sam_AI_Rule\init-project.ps1"
```

```bash
# Linux / Mac / git bash
cd <your-project-root>
bash $HOME/Sam_AI_Rule/init-project.sh
```

互動式詢問：是否複製 `CLAUDE.md` / `PROJECT.md` / 掛載 ai-guardian。

執行完，`CLAUDE.md`、`.guardian/`、`.claude/`、`AGENTS.md` 等會建立在你的**專案根目錄**。

---

## 不需要完整安裝？只想拉單一檔案

```bash
# 只想要規則檔
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/CLAUDE.md -o CLAUDE.md

# 只想要 PROJECT.md 模板
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/templates/PROJECT.md -o PROJECT.md
```

---

## 維護

任何元件變更 → commit → push 到 `main`。`bootstrap` 重跑會自動 git pull 拿到最新。

本 repo 只放**跨專案共通**的東西。個別專案的設定請放在那個專案內。
