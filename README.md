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

詳見 [`ai-guardian/`](ai-guardian/) 目錄（README 待補）。

### 新機器初次設定

bootstrap script 設計中。手動方式：clone 本 repo 到本機（如 `~/Sam_AI_Rule`），新專案再從那邊複製需要的檔案。

---

## 維護

任何元件變更 → commit → push 到 `main` 分支。下次 clone 自動拿到最新版。

不要在這個 repo 內塞「個別專案」的設定 — 這裡只放跨專案共通的東西。
