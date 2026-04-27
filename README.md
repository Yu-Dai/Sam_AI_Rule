# Sam AI Rule

個人 AI 助手（Claude Code）設定與專案初始化工具包。一次 clone，取得規則 + 守衛 + 模板。

## 內容

| 項目 | 路徑 | 用途 |
|------|------|------|
| 全域行為規則 | [`CLAUDE.md`](CLAUDE.md) | Claude Code 跨專案行為準則（軟性） |
| 文件模板 | [`templates/`](templates/) | 專案模板（如 `PROJECT.md`） |
| 程式碼守衛 | [`ai-guardian/`](ai-guardian/) | AST-level commit 阻擋 CLI（硬性） |

**設計理念**：CLAUDE.md（軟）負責 prompt 階段勸說 AI；ai-guardian（硬）負責 commit 階段實際阻擋。兩者互補。

---

## 使用方式

### 新專案僅需規則檔

```bash
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/CLAUDE.md -o CLAUDE.md
```

### 新專案需要長期方向追蹤

```bash
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/templates/PROJECT.md -o PROJECT.md
```

填寫後保留在專案根目錄。詳見 CLAUDE.md §15（方向對齊）。

### 新專案掛載 ai-guardian

詳見 [`ai-guardian/README.md`](ai-guardian/README.md)。

### 新機器初次設定

**Windows（PowerShell）**：

```powershell
irm https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/bootstrap.ps1 | iex
```

**Linux / Mac / Windows git bash**：

```bash
curl -fsSL https://raw.githubusercontent.com/Yu-Dai/Sam_AI_Rule/main/bootstrap.sh | bash
```

兩者都會：
1. Clone（或更新）本 repo 到 `~/Sam_AI_Rule`
2. 安裝 ai-guardian 依賴並 `npm link` 為全域指令

### 新專案一鍵初始化（裝過 bootstrap 後）

在新專案目錄內執行：

```powershell
# Windows
& "$HOME\Sam_AI_Rule\init-project.ps1"
```

```bash
# Linux / Mac / git bash
bash $HOME/Sam_AI_Rule/init-project.sh
```

互動式詢問：複製 `CLAUDE.md`、是否要 `PROJECT.md`、是否要掛載 ai-guardian。

---

## 維護

任何元件變更 → commit → push 到 `main` 分支。下次 clone 自動拿到最新版。

不要在這個 repo 內塞「個別專案」的設定 — 這裡只放跨專案共通的東西。
